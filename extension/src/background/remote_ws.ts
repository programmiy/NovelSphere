// remote_ws.ts: 백그라운드 원격 제어 모듈 (WebSocket + HTTP 폴링 장애대응)
import { RemoteStatusPayload, RemoteCommand, RemoteCommandResult, RemoteTabReport } from '../types/remote';

const REMOTE_BASE_HTTP = 'http://127.0.0.1:8001';
const REMOTE_BASE_WS = 'ws://127.0.0.1:8001';
const REMOTE_POLL_INTERVAL_MS = 5000;
const REMOTE_WS_RETRY_MS = 10000;
const REMOTE_PING_INTERVAL_MS = 20000; // service worker 30초 유휴 종료 방지 + 서버 생존 신호
const REMOTE_CONTENT_TIMEOUT_MS = 5000;

let remoteWs: WebSocket | null = null;
let remotePollTimer: ReturnType<typeof setInterval> | null = null;
let remotePingTimer: ReturnType<typeof setInterval> | null = null;
let remoteRetryTimer: ReturnType<typeof setTimeout> | null = null;
let remoteConnecting = false;

// tabId -> { data, at, activeAt }
const remoteReports = new Map<number, RemoteTabReport>();
let remoteTargetTabId: number | null = null;

// ---------- 서버 호출 ----------
// 확장은 PC 안(127.0.0.1)에서 서버에 접속하므로 별도 토큰이 필요 없다. (서버가 루프백을 신뢰)
function remoteFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${REMOTE_BASE_HTTP}/api/remote${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

// ---------- 번역 탭 선택/상태 ----------
function remotePickTarget(): { tabId: number; r: RemoteTabReport } | null {
  let best: { tabId: number; r: RemoteTabReport } | null = null;
  for (const [tabId, r] of remoteReports) {
    if (!best || r.activeAt > best.r.activeAt || (r.activeAt === best.r.activeAt && r.at > best.r.at)) {
      best = { tabId, r };
    }
  }
  remoteTargetTabId = best ? best.tabId : null;
  return best;
}

function remoteCurrentStatusPayload(): RemoteStatusPayload {
  const best = remotePickTarget();
  if (!best) return { phase: 'idle', text: '번역 중인 탭이 없습니다', url: '', book_title: '', chapter_title: '', percentage: 0, delay_remaining_sec: 0, next_scheduled: false, turbo: false };
  return { ...best.r.data, tab_id: best.tabId };
}

function remoteSendStatus(): void {
  const payload = remoteCurrentStatusPayload();
  if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
    remoteWs.send(JSON.stringify({ type: 'status', data: payload }));
  }
}

// ---------- 명령 실행 ----------
function remoteWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function remoteSetAutoTranslateFlag(tabId: number): Promise<void> {
  try {
    await remoteWithTimeout(
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          try {
            sessionStorage.setItem('lanovel_auto_translate_next', '1');
          } catch (e) {}
        },
      }),
      3000
    );
  } catch (e: any) {
    console.warn('[remote] 자동 번역 플래그 설정 실패(무시):', e.message);
  }
}

async function remoteExecute(cmd: RemoteCommand): Promise<RemoteCommandResult> {
  const tabId = remoteTargetTabId ?? (remotePickTarget() || {}).tabId;
  if (tabId == null) return { ok: false, message: '조종할 번역 탭을 찾지 못했습니다.' };

  if (cmd.type === 'reload') {
    await remoteSetAutoTranslateFlag(tabId);
    await chrome.tabs.reload(tabId);
    return { ok: true, message: '번역 탭을 새로고침했습니다.' };
  }
  if (cmd.type === 'goto') {
    const url = cmd.params && cmd.params.url;
    if (!url || !/^https?:\/\//.test(url)) return { ok: false, message: '올바르지 않은 URL' };
    await remoteSetAutoTranslateFlag(tabId);
    await chrome.tabs.update(tabId, { url });
    return { ok: true, message: `이동: ${url}` };
  }

  try {
    const res = await remoteWithTimeout(
      chrome.tabs.sendMessage(tabId, { action: 'remoteCommand', type: cmd.type, params: cmd.params || {} }),
      REMOTE_CONTENT_TIMEOUT_MS
    );
    return res || { ok: false, message: '탭에서 응답이 없습니다.' };
  } catch (e: any) {
    return { ok: false, message: `탭이 응답하지 않습니다 (${e.message}). 새로고침을 시도해 보세요.` };
  }
}

async function remoteAck(id: string | undefined, result: RemoteCommandResult): Promise<void> {
  if (!id) return;
  if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
    remoteWs.send(JSON.stringify({ type: 'ack', id, ok: !!result.ok, message: result.message || '' }));
    return;
  }
  try {
    await remoteFetch('/ack', { method: 'POST', body: JSON.stringify({ id, ok: !!result.ok, message: result.message || '' }) });
  } catch (e) {
    /* 서버 오프라인 */
  }
}

async function remoteHandleCommands(commands: RemoteCommand[]): Promise<void> {
  for (const cmd of commands || []) {
    let result: RemoteCommandResult;
    try {
      result = await remoteExecute(cmd);
    } catch (e: any) {
      result = { ok: false, message: String(e && e.message || e) };
    }
    await remoteAck(cmd.id, result);
  }
}

// ---------- 연결 관리 ----------
function remoteStartPolling(): void {
  if (remotePollTimer) return;
  const tick = async () => {
    try {
      const payload = remoteCurrentStatusPayload();
      await remoteFetch('/report', { method: 'POST', body: JSON.stringify(payload) });
      const res = await remoteFetch('/poll');
      if (res.ok) {
        const json = await res.json();
        await remoteHandleCommands(json.commands);
      }
    } catch (e) {
      /* 서버 오프라인: 다음 주기에 재시도 */
    }
  };
  tick();
  remotePollTimer = setInterval(tick, REMOTE_POLL_INTERVAL_MS);
}

function remoteStopPolling(): void {
  if (remotePollTimer) {
    clearInterval(remotePollTimer);
    remotePollTimer = null;
  }
}

function remoteScheduleReconnect(): void {
  if (remoteRetryTimer) return;
  remoteRetryTimer = setTimeout(() => {
    remoteRetryTimer = null;
    remoteConnect();
  }, REMOTE_WS_RETRY_MS);
}

export async function remoteConnect(): Promise<void> {
  if (remoteConnecting) return;
  if (remoteWs && (remoteWs.readyState === WebSocket.OPEN || remoteWs.readyState === WebSocket.CONNECTING)) return;
  remoteConnecting = true;
  try {
    const ws = new WebSocket(`${REMOTE_BASE_WS}/api/remote/ws`);
    remoteWs = ws;

    ws.onopen = () => {
      remoteStopPolling();
      remoteSendStatus();
      if (remotePingTimer) clearInterval(remotePingTimer);
      remotePingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
          remoteSendStatus();
        }
      }, REMOTE_PING_INTERVAL_MS);
      console.log('[LANOVEL Remote] WebSocket connected to server.');
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'commands') {
          remoteHandleCommands(msg.commands);
        }
      } catch (e) {
        console.warn('[remote] 잘못된 WS 메시지', e);
      }
    };

    ws.onclose = () => {
      if (remotePingTimer) {
        clearInterval(remotePingTimer);
        remotePingTimer = null;
      }
      if (remoteWs === ws) remoteWs = null;
      remoteStartPolling();
      remoteScheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose 에서 처리 */
    };
  } finally {
    remoteConnecting = false;
  }
}

export function initRemoteControl(): void {
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (request && request.action === 'remoteStatus' && sender.tab && sender.tab.id != null) {
      const now = Date.now();
      const prev = remoteReports.get(sender.tab.id);
      const activePhases: string[] = ['translating', 'censor_split', 'delay_wait'];
      const isActive = activePhases.includes(request.data.phase);
      remoteReports.set(sender.tab.id, {
        data: request.data,
        at: now,
        activeAt: isActive ? now : (prev ? prev.activeAt : 0),
      });
      remoteSendStatus();
    }
    return false;
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (remoteReports.delete(tabId)) {
      remoteSendStatus();
    }
  });

  // service worker 가 종료돼도 알람이 깨워서 재연결 (최소 주기 30초)
  chrome.alarms.create('remote-keepalive', { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'remote-keepalive') {
      remoteConnect();
    }
  });

  remoteConnect();
}
