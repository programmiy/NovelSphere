// queue_session.ts: '다음에 번역할 소설' 목록 작업 중인 탭의 동작 (콘텐츠 스크립트 측)
//
// - 서버가 목록에서 시작시킨 탭인지 백그라운드에 물어본다 (사이트가 바뀌어도 탭 기준으로 유지됨)
// - 이미 번역된 회차는 자동으로 다음 화로 건너뛴다 (목록 작업에서만)
// - 마지막 화가 끝나면 서버에 '소설 완료'를 알려 다음 소설로 넘어가게 한다
// - 신데렐라: 하루 한 번 있는 초기화 시간 정지를 새로고침으로 넘기고 번역을 이어간다
import { state } from './state';
import { getScraper } from '../scrapers';
import { showLanovelHud } from '../ui/hud';
import { logToSidebar } from '../ui/sidebar';
import type { QueueSession, QueueEventData, RemoteConfig } from '../types/remote';

const RESET_STOP_REASON = '초기화 시간 도달';
const CINDERELLA_COOLDOWN_MS = 120_000;   // 이어하기 직후 또 정지되면 새로고침 무한반복 방지
const CINDERELLA_RELOAD_DELAY_MS = 5000;
const WATCHDOG_MS = 120_000;              // 목록 작업 탭이 이 시간 안에 번역/건너뛰기를 시작하지 못하면 문제로 보고

let session: QueueSession | null = null;
let decided = false;            // 이 페이지에서 '번역/건너뛰기/완료/문제' 중 하나가 결정됨
let reportedEnd = false;        // novel_finished / page_problem 중복 보고 방지
let skipScheduled = false;
let cinderellaScheduled = false;

export function getQueueSession(): QueueSession | null {
  return session;
}

function sendEvent(kind: QueueEventData['kind'], extra: Partial<QueueEventData> = {}): void {
  const data: QueueEventData = { kind, queue_item_id: session ? session.queue_item_id : null, ...extra };
  try {
    chrome.runtime.sendMessage({ action: 'remoteQueueEvent', data }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    /* extension context invalidated */
  }
}

/** init() 맨 처음에 호출. 이 탭이 목록 작업 중인지 백그라운드에 묻는다. */
export async function loadQueueSession(): Promise<void> {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'remoteQueueSession' });
    session = res && res.session ? (res.session as QueueSession) : null;
  } catch (e) {
    session = null;
  }
  if (!session) return;

  console.log('[LANOVEL] 목록 작업 탭입니다:', session);
  const timer = setTimeout(() => {
    if (!decided && !state.hasScannedForPTags && state.inflight === 0 && !state.isTranslationCancelled) {
      reportPageProblem('페이지가 시간 안에 준비되지 않았습니다. (로그인/연령 확인 화면일 수 있어요)');
    }
  }, WATCHDOG_MS);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();
}

/** 콜백 주입이 끝난 뒤 호출: 신데렐라 새로고침 직후라면 이어하기 이력을 알리고 쾌속모드를 복원한다. */
export function afterInit(): void {
  let pending = false;
  let wasTurbo = false;
  try {
    pending = sessionStorage.getItem('lanovel_cinderella_pending') === '1';
    wasTurbo = sessionStorage.getItem('lanovel_cinderella_turbo') === '1';
    sessionStorage.removeItem('lanovel_cinderella_pending');
    sessionStorage.removeItem('lanovel_cinderella_turbo');
  } catch (e) {
    return;
  }
  if (!pending || !session) return;

  sendEvent('cinderella');
  logToSidebar('🌙 [신데렐라] 초기화 시간을 넘겨 번역을 이어갑니다.');
  if (wasTurbo && !state.isTurboMode && state.onToggleTurboMode) {
    state.onToggleTurboMode(true, false);   // 새 초기화 구간 기준으로 쾌속모드 복원
  }
}

export function reportNovelFinished(reason: string): void {
  if (!session || reportedEnd) return;
  reportedEnd = true;
  decided = true;
  logToSidebar(`[목록] 소설 번역이 끝났습니다 (${reason}). 다음 소설로 넘어갑니다.`);
  showLanovelHud('목록: 이 소설 완료 → 다음 소설', '📚', 3000);
  sendEvent('novel_finished');
}

export function reportPageProblem(reason: string): void {
  if (!session || reportedEnd) return;
  reportedEnd = true;
  decided = true;
  logToSidebar(`[목록] 페이지 문제: ${reason}`, 'log-error');
  sendEvent('page_problem', { reason });
}

/**
 * 번역할 내용이 없는(이미 번역된) 회차를 만났을 때 호출.
 * 목록 작업이면 다음 화로 건너뛰고 true, 아니면 아무것도 하지 않고 false.
 */
export function onNothingToTranslate(paragraphCount: number): boolean {
  if (!session || !session.skip_translated) return false;
  if (skipScheduled || reportedEnd) return true;
  skipScheduled = true;
  decided = true;

  const scraper = getScraper();
  // 본문 문단이 하나도 없으면 '이미 번역됨'이 아니라 페이지 로딩/차단/연령 확인 화면 문제일 수 있다.
  if (paragraphCount === 0) {
    reportPageProblem('본문을 찾지 못했습니다.');
    return true;
  }

  const delay = 2000 + Math.floor(Math.random() * 2000);   // 사이트에 부담을 주지 않도록 2~4초 간격
  logToSidebar('[목록] 이미 번역된 회차입니다. 다음 화로 건너뜁니다.');
  setTimeout(async () => {
    if (state.isTranslationCancelled) {
      skipScheduled = false;   // 사용자가 멈춘 상태면 이동하지 않는다
      return;
    }
    let link = scraper.findNextEpisodeLink();
    if (!link) {
      await new Promise((r) => setTimeout(r, 300));
      link = scraper.findNextEpisodeLink();
    }
    if (link && link.href) {
      showLanovelHud('목록: 번역된 회차 건너뛰기', '⏭️', 1500);
      window.location.href = link.href;
    } else {
      reportNovelFinished('마지막 화');
    }
  }, delay);
  return true;
}

/** 쾌속모드 자동 중단(abortTurboMode) 직후 호출. 신데렐라가 켜져 있으면 새로고침으로 이어간다. */
export async function onAbortTurbo(reason: string, wasTurbo: boolean): Promise<void> {
  if (!session || cinderellaScheduled || reason !== RESET_STOP_REASON) return;

  let config: RemoteConfig | undefined;
  try {
    const stored = await chrome.storage.local.get('lanovelRemoteConfig');
    config = stored.lanovelRemoteConfig as RemoteConfig | undefined;
  } catch (e) {
    return;
  }
  if (!config || !config.cinderella) return;

  let last = 0;
  try {
    last = Number(sessionStorage.getItem('lanovel_cinderella_at') || 0);
  } catch (e) {
    /* ignore */
  }
  if (Date.now() - last < CINDERELLA_COOLDOWN_MS) {
    logToSidebar('🌙 [신데렐라] 방금 이어하기를 했는데 다시 정지되어, 이번에는 새로고침하지 않습니다.', 'log-error');
    return;
  }

  cinderellaScheduled = true;
  try {
    sessionStorage.setItem('lanovel_cinderella_at', String(Date.now()));
    sessionStorage.setItem('lanovel_cinderella_pending', '1');
    sessionStorage.setItem('lanovel_cinderella_turbo', wasTurbo ? '1' : '0');
  } catch (e) {
    /* ignore */
  }
  logToSidebar(`🌙 [신데렐라] 초기화 시간을 넘기기 위해 ${CINDERELLA_RELOAD_DELAY_MS / 1000}초 뒤 새로고침합니다.`);
  setTimeout(() => window.location.reload(), CINDERELLA_RELOAD_DELAY_MS);
}
