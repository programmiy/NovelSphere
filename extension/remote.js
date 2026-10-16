// =================================================================================
// 원격 제어 - 백그라운드(service worker) 측
//  - PC 서버와 WebSocket 연결 (끊기면 HTTP 폴링으로 대체, 알람으로 주기적 재연결)
//  - 번역 탭 상태를 서버로 전달
//  - 서버가 보낸 명령 실행: reload/goto 는 여기서 직접, 나머지는 번역 탭의 content script 로 전달
// background.js 맨 위에서 importScripts('remote.js') 로 로드된다.
// =================================================================================

const DEFAULT_PORTS = [8001, 8000];
let currentPortIndex = 0;
let cachedBaseHttp = `http://127.0.0.1:${DEFAULT_PORTS[0]}`;
let cachedBaseWs = `ws://127.0.0.1:${DEFAULT_PORTS[0]}`;
const REMOTE_POLL_INTERVAL_MS = 5000;
const REMOTE_WS_RETRY_MS = 10000;
const REMOTE_PING_INTERVAL_MS = 20000;   // service worker 30초 유휴 종료 방지 + 서버 생존 신호
const REMOTE_CONTENT_TIMEOUT_MS = 5000;

let remoteWs = null;
let remotePollTimer = null;
let remotePingTimer = null;
let remoteRetryTimer = null;
let remoteConnecting = false;

// tabId -> { data, at, activeAt }
const remoteReports = new Map();
let remoteTargetTabId = null;

async function remoteGetBaseUrls() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const stored = await chrome.storage.local.get(['server_url', 'server_port']);
            if (stored.server_url && typeof stored.server_url === 'string') {
                const http = stored.server_url.replace(/\/+$/, '');
                const ws = http.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
                return { http, ws };
            }
            if (stored.server_port) {
                const port = parseInt(stored.server_port, 10);
                if (!isNaN(port) && port > 0) {
                    return {
                        http: `http://127.0.0.1:${port}`,
                        ws: `ws://127.0.0.1:${port}`
                    };
                }
            }
        }
    } catch (_) {}
    const port = DEFAULT_PORTS[currentPortIndex];
    return {
        http: `http://127.0.0.1:${port}`,
        ws: `ws://127.0.0.1:${port}`
    };
}

async function remoteRotateFallbackPort() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const stored = await chrome.storage.local.get(['server_url', 'server_port']);
            if (stored.server_url || stored.server_port) {
                return; // 사용자가 명시한 고정 설정이 있으면 자동 순환 안 함
            }
        }
    } catch (_) {}
    currentPortIndex = (currentPortIndex + 1) % DEFAULT_PORTS.length;
    const port = DEFAULT_PORTS[currentPortIndex];
    cachedBaseHttp = `http://127.0.0.1:${port}`;
    cachedBaseWs = `ws://127.0.0.1:${port}`;
}

// ---------- 서버 호출 ----------
// 확장은 PC 안(127.0.0.1)에서 서버에 접속하므로 별도 토큰이 필요 없다. (서버가 루프백을 신뢰)
async function remoteFetch(path, options = {}) {
    const base = await remoteGetBaseUrls();
    cachedBaseHttp = base.http;
    cachedBaseWs = base.ws;
    return fetch(`${base.http}/api/remote${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
}
// ---------- 번역 탭 선택/상태 ----------
function remotePickTarget() {
    let best = null;
    for (const [tabId, r] of remoteReports) {
        if (!best || r.activeAt > best.r.activeAt || (r.activeAt === best.r.activeAt && r.at > best.r.at)) {
            best = { tabId, r };
        }
    }
    remoteTargetTabId = best ? best.tabId : null;
    return best;
}

function remoteCurrentStatusPayload() {
    const best = remotePickTarget();
    if (!best) return { phase: 'idle', text: '번역 중인 탭이 없습니다', percentage: 0 };
    return { ...best.r.data, tab_id: best.tabId };
}

function remoteSendStatus() {
    const payload = remoteCurrentStatusPayload();
    if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
        remoteWs.send(JSON.stringify({ type: 'status', data: payload }));
    }
}

chrome.runtime.onMessage.addListener((request, sender) => {
    if (request && request.action === 'remoteStatus' && sender.tab) {
        const now = Date.now();
        const prev = remoteReports.get(sender.tab.id);
        const activePhases = ['translating', 'censor_split', 'delay_wait'];
        const isActive = activePhases.includes(request.data.phase);
        remoteReports.set(sender.tab.id, {
            data: request.data,
            at: now,
            activeAt: isActive ? now : (prev ? prev.activeAt : 0),
        });
        remoteSendStatus();
    }
    return false;   // 응답 없음 (다른 리스너 처리 방해 금지)
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (remoteReports.delete(tabId)) remoteSendStatus();
});

// ---------- 명령 실행 ----------
function remoteWithTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
}

async function remoteSetAutoTranslateFlag(tabId) {
    // 새로고침/이동 후에도 기존 '자동 번역 시작' 로직(sessionStorage 플래그)이 동작하게 함
    try {
        await remoteWithTimeout(chrome.scripting.executeScript({
            target: { tabId },
            func: () => { try { sessionStorage.setItem('lanovel_auto_translate_next', '1'); } catch (e) { } },
        }), 3000);
    } catch (e) {
        console.warn('[remote] 자동 번역 플래그 설정 실패(무시):', e.message);
    }
}

async function remoteExecute(cmd) {
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
        await remoteSetAutoTranslateFlag(tabId);   // 같은 사이트(origin)면 이동 후 자동 번역 이어짐
        await chrome.tabs.update(tabId, { url });
        return { ok: true, message: `이동: ${url}` };
    }

    try {
        const res = await remoteWithTimeout(
            chrome.tabs.sendMessage(tabId, { action: 'remoteCommand', type: cmd.type, params: cmd.params || {} }),
            REMOTE_CONTENT_TIMEOUT_MS
        );
        return res || { ok: false, message: '탭에서 응답이 없습니다.' };
    } catch (e) {
        return { ok: false, message: `탭이 응답하지 않습니다 (${e.message}). 새로고침을 시도해 보세요.` };
    }
}

async function remoteHandleCommands(commands) {
    for (const cmd of commands || []) {
        let result;
        try { result = await remoteExecute(cmd); }
        catch (e) { result = { ok: false, message: String(e && e.message || e) }; }
        await remoteAck(cmd.id, result);
    }
}

async function remoteAck(id, result) {
    if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
        remoteWs.send(JSON.stringify({ type: 'ack', id, ok: !!result.ok, message: result.message || '' }));
        return;
    }
    try {
        await remoteFetch('/ack', { method: 'POST', body: JSON.stringify({ id, ok: !!result.ok, message: result.message || '' }) });
    } catch (e) { /* 서버 오프라인 */ }
}

// ---------- 연결 관리 ----------
function remoteStartPolling() {
    if (remotePollTimer) return;
    const tick = async () => {
        try {
            const payload = remoteCurrentStatusPayload();
            await remoteFetch('/report', { method: 'POST', body: JSON.stringify(payload) });
            const res = await remoteFetch('/poll');
            if (res.ok) {
                const json = await res.json();
                await remoteHandleCommands(json.commands);
            } else {
                await remoteRotateFallbackPort();
            }
        } catch (e) {
            /* 서버 오프라인 또는 포트 불일치: 다음 주기에 대체 포트 시도 */
            await remoteRotateFallbackPort();
        }
    };
    tick();
    remotePollTimer = setInterval(tick, REMOTE_POLL_INTERVAL_MS);
}

function remoteStopPolling() {
    if (remotePollTimer) { clearInterval(remotePollTimer); remotePollTimer = null; }
}

function remoteScheduleReconnect() {
    if (remoteRetryTimer) return;
    remoteRetryTimer = setTimeout(() => { remoteRetryTimer = null; remoteConnect(); }, REMOTE_WS_RETRY_MS);
}

async function remoteConnect() {
    if (remoteConnecting) return;
    if (remoteWs && (remoteWs.readyState === WebSocket.OPEN || remoteWs.readyState === WebSocket.CONNECTING)) return;
    remoteConnecting = true;
    try {
        const base = await remoteGetBaseUrls();
        cachedBaseHttp = base.http;
        cachedBaseWs = base.ws;
        const ws = new WebSocket(`${base.ws}/api/remote/ws`);
        remoteWs = ws;

        ws.onopen = () => {
            remoteStopPolling();
            remoteSendStatus();
            clearInterval(remotePingTimer);
            remotePingTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                    remoteSendStatus();    // 상태를 겸해서 보내 서버의 '진행 없음' 판정을 정확하게 유지
                }
            }, REMOTE_PING_INTERVAL_MS);
        };
        ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data);
                if (msg.type === 'commands') remoteHandleCommands(msg.commands);
            } catch (e) { console.warn('[remote] 잘못된 WS 메시지', e); }
        };
        ws.onclose = () => {
            clearInterval(remotePingTimer); remotePingTimer = null;
            if (remoteWs === ws) remoteWs = null;
            remoteRotateFallbackPort(); // 연결 실패 시 8001 ↔ 8000 교차 시도
            remoteStartPolling();       // WS가 안 될 땐 폴링으로 대체
            remoteScheduleReconnect();
        };
        ws.onerror = () => { /* onclose 에서 처리 */ };
    } catch (e) {
        await remoteRotateFallbackPort();
    } finally {
        remoteConnecting = false;
    }
}
// service worker 가 종료돼도 알람이 깨워서 재연결 (최소 주기 30초)
chrome.alarms.create('remote-keepalive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'remote-keepalive') remoteConnect();
});

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.server_url || changes.server_port)) {
            if (remoteWs) {
                try { remoteWs.close(); } catch (_) {}
            }
            remoteConnect();
        }
    });
}

remoteConnect();
