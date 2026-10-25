// queue_tabs.ts: '다음에 번역할 소설' 목록 작업의 백그라운드 측 보조 로직
//
// - 어떤 탭이 목록 작업 중인지 표시를 보관한다 (탭 기준이라 카쿠요무 → ncode처럼 사이트가 바뀌어도 유지)
// - 콘텐츠 스크립트가 보낸 목록 이벤트(소설 완료 등)를 보관함에 쌓았다가 서버로 재전송한다
//   (서버가 잠깐 꺼져 있어도 '소설 완료' 보고가 유실되지 않게)
// - 서버가 내려준 목록 설정(신데렐라 등)을 storage 에 저장해 콘텐츠 스크립트가 읽게 한다
import type {
  QueueSession,
  QueueEventData,
  RemoteConfig,
  RemoteCommand,
  RemoteCommandResult,
} from '../types/remote';

const QUEUE_TABS_KEY = 'lanovelQueueTabs'; // chrome.storage.session : { [tabId]: QueueSession }
const OUTBOX_KEY = 'lanovelQueueOutbox'; // chrome.storage.local : QueueEventData[]
const CONFIG_KEY = 'lanovelRemoteConfig'; // chrome.storage.local : RemoteConfig
const MAX_OUTBOX = 50;

// storage.session 을 쓸 수 없는 환경(구버전 Chrome)에서도 동작하도록 메모리 사본을 함께 둔다.
const memoryTabs = new Map<number, QueueSession>();

// 읽기-수정-쓰기가 겹치지 않도록 직렬화
let lockChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockChain.then(fn, fn);
  lockChain = run.catch(() => undefined);
  return run;
}

async function readTabs(): Promise<Record<string, QueueSession>> {
  try {
    const r = await chrome.storage.session.get(QUEUE_TABS_KEY);
    return (r[QUEUE_TABS_KEY] || {}) as Record<string, QueueSession>;
  } catch (e) {
    const out: Record<string, QueueSession> = {};
    memoryTabs.forEach((v, k) => {
      out[String(k)] = v;
    });
    return out;
  }
}

async function writeTabs(tabs: Record<string, QueueSession>): Promise<void> {
  memoryTabs.clear();
  Object.keys(tabs).forEach((k) => memoryTabs.set(Number(k), tabs[k]));
  try {
    await chrome.storage.session.set({ [QUEUE_TABS_KEY]: tabs });
  } catch (e) {
    /* 메모리 사본만 사용 */
  }
}

export async function getQueueSession(tabId: number | null): Promise<QueueSession | null> {
  if (tabId == null) return null;
  const tabs = await readTabs();
  return tabs[String(tabId)] || null;
}

export function setQueueSession(tabId: number, session: QueueSession | null): Promise<void> {
  return withLock(async () => {
    const tabs = await readTabs();
    if (session) tabs[String(tabId)] = session;
    else delete tabs[String(tabId)];
    await writeTabs(tabs);
  });
}

/** 서버가 보낸 goto(queue_session) 명령: 탭에 목록 표시를 붙인 뒤 이동. 탭이 없으면 새 탭으로 연다. */
export async function remoteQueueGoto(cmd: RemoteCommand, tabId: number | null): Promise<RemoteCommandResult> {
  const params = cmd.params || {};
  const url = params.url;
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, message: '올바르지 않은 URL' };

  const session: QueueSession = {
    queue_item_id: typeof params.queue_item_id === 'number' ? params.queue_item_id : null,
    skip_translated: !!params.skip_translated,
  };

  if (tabId != null) {
    try {
      await setQueueSession(tabId, session);
      await chrome.tabs.update(tabId, { url });
      return { ok: true, message: `목록: 이동 ${url}` };
    } catch (e) {
      await setQueueSession(tabId, null); // 탭이 사라졌다면 아래에서 새 탭으로 연다
    }
  }

  const tab = await chrome.tabs.create({ url, active: true });
  if (tab.id != null) await setQueueSession(tab.id, session);
  return { ok: true, message: `목록: 새 탭에서 열기 ${url}` };
}

// ---------- 이벤트 보관함 ----------
async function readOutbox(): Promise<QueueEventData[]> {
  try {
    const r = await chrome.storage.local.get(OUTBOX_KEY);
    return (r[OUTBOX_KEY] || []) as QueueEventData[];
  } catch (e) {
    return [];
  }
}

export function enqueueQueueEvent(data: QueueEventData): Promise<void> {
  return withLock(async () => {
    const items = await readOutbox();
    items.push(data);
    await chrome.storage.local.set({ [OUTBOX_KEY]: items.slice(-MAX_OUTBOX) });
  });
}

let flushing = false;

/** 보관함의 이벤트를 순서대로 보낸다. 하나라도 실패하면 멈추고 다음 기회에 다시 시도한다. */
export async function flushQueueOutbox(send: (data: QueueEventData) => Promise<boolean>): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    for (;;) {
      const items = await readOutbox();
      if (!items.length) break;
      const ok = await send(items[0]);
      if (!ok) break;
      await withLock(async () => {
        const latest = await readOutbox();
        latest.shift();
        await chrome.storage.local.set({ [OUTBOX_KEY]: latest });
      });
    }
  } finally {
    flushing = false;
  }
}

// ---------- 설정 ----------
export function saveRemoteConfig(cfg: Partial<RemoteConfig> | null | undefined): void {
  if (!cfg || typeof cfg !== 'object') return;
  const clean: RemoteConfig = { running: !!cfg.running, cinderella: !!cfg.cinderella };
  chrome.storage.local.set({ [CONFIG_KEY]: clean }).catch(() => undefined);
}
