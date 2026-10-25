// index.ts: 백그라운드 서비스 워커 메인 엔트리포인트
import { initRemoteControl } from './remote_ws';

// 원격 제어 모듈 초기화 (WebSocket + HTTP 폴링)
initRemoteControl();

// =================================================================================
// One-time migration script for quote style
// =================================================================================
async function migrateQuotes(): Promise<void> {
  const migrationStatus = await chrome.storage.local.get('quote_migration_v2');
  if (migrationStatus.quote_migration_v2) {
    return;
  }

  const allData = await chrome.storage.local.get(null);
  let updatedCount = 0;
  const urlsUpdated = new Set<string>();

  for (const key in allData) {
    if (
      key.startsWith('status-') ||
      key === 'apiKey' ||
      key === 'error_log' ||
      key === 'excluded_sentences' ||
      key.startsWith('quote_migration_')
    ) {
      continue;
    }

    const translations = allData[key];
    if (Array.isArray(translations)) {
      let wasUpdated = false;
      const updatedTranslations = translations.map((t: any) => {
        if (t.original && t.translated && t.translated.startsWith('"') && t.translated.endsWith('"')) {
          const innerText = t.translated.substring(1, t.translated.length - 1);
          if (t.original.includes('「') && t.original.includes('」')) {
            t.translated = `「${innerText}」`;
            updatedCount++;
            wasUpdated = true;
          } else if (t.original.includes('『') && t.original.includes('』')) {
            t.translated = `『${innerText}』`;
            updatedCount++;
            wasUpdated = true;
          }
        }
        return t;
      });

      if (wasUpdated) {
        await chrome.storage.local.set({ [key]: updatedTranslations });
        urlsUpdated.add(key);
      }
    }
  }

  if (updatedCount > 0) {
    console.log(`Quote migration v2 complete. Updated ${updatedCount} translations across ${urlsUpdated.size} URLs.`);
  } else {
    console.log('No translations found that required quote migration v2.');
  }

  await chrome.storage.local.set({ quote_migration_v2: true });
}

// 서비스 워커 기동 시 1회 실행
migrateQuotes();

// 권한 확인
chrome.permissions.getAll((permissions) => {
  console.log('Permissions granted to the extension:', permissions);
});

// 확장 프로그램 설치/업데이트 시 컨텍스트 메뉴 설정
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.contextMenus) {
    chrome.contextMenus.create({
      id: 'translateJapanese',
      title: '일본어 번역하기',
      contexts: ['selection'],
    });
  } else {
    console.warn('Context Menus API is not available.');
  }
});

// 컨텍스트 메뉴 클릭 처리
if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(async (info) => {
    switch (info.menuItemId) {
      case 'translateJapanese':
        break;
    }
  });
}

// 메시지 처리 (콘텐츠 스크립트에서 오는 요청들)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const channelClosedMessage = 'The message channel closed before a response was received.';

  if (request.action === 'batchTranslate') {
    (async () => {
      try {
        const rawUrl = sender.tab?.url || '';
        const cleanTabUrl = rawUrl.split('#')[0].trim();
        const result = await handleBatchTranslate(
          request.items,
          cleanTabUrl,
          request.isRetranslation || false,
          request.model || null
        );
        try {
          sendResponse({
            translations: result.translations,
            recommended_turbo_delay_ms: result.recommended_turbo_delay_ms,
          });
        } catch (e: any) {
          if (e.message && e.message.includes(channelClosedMessage)) {
            console.log('Failed to send translation success response: Channel was closed by the client.');
          } else {
            console.error('Error sending translation success response:', e);
          }
        }
      } catch (error: any) {
        console.error('Error in background script, sending error response:', error.message);
        try {
          if (error.status === 429) {
            sendResponse({
              notification: 'API 요청 한도를 초과했습니다. 번역을 중지합니다.',
              stop: true,
            });
          } else if (
            error.status === 503 &&
            (error.message.includes('초기화 시간') || error.message.includes('자동 번역을 중지'))
          ) {
            sendResponse({
              notification: error.message,
              stop: true,
              isQuotaResetStop: true,
            });
          } else if (
            error.message &&
            (error.message.includes('Failed to fetch') ||
              error.message.includes('NetworkError') ||
              error.message.includes('network error'))
          ) {
            sendResponse({
              notification:
                '❌ PC 번역 서버(http://127.0.0.1:8001)에 연결할 수 없습니다. main.py(서버)가 실행 중인지 확인해주세요.',
              stop: true,
              isServerOffline: true,
            });
          } else {
            sendResponse({ error: error.message, status: error.status });
          }
        } catch (e: any) {
          if (e.message && e.message.includes(channelClosedMessage)) {
            console.log('Failed to send error response: Channel was closed by the client.');
          } else {
            console.error('Error sending error response:', e);
          }
        }
      }
    })();
    return true; // 비동기 응답 대기
  } else if (request.action === 'fetchTitle') {
    (async () => {
      try {
        const title = await fetchPageTitle(request.url);
        try {
          sendResponse({ title });
        } catch (e: any) {
          if (e.message && e.message.includes(channelClosedMessage)) {
            console.log('Failed to send title success response: Channel was closed by the client.');
          } else {
            console.error('Error sending title success response:', e);
          }
        }
      } catch (error: any) {
        saveErrorLog([], error, request.url);
        try {
          sendResponse({ title: request.url, error: error.message });
        } catch (e: any) {
          if (e.message && e.message.includes(channelClosedMessage)) {
            console.log('Failed to send title error response: Channel was closed by the client.');
          } else {
            console.error('Error sending title error response:', e);
          }
        }
      }
    })();
    return true;
  } else if (request.action === 'upsertTranslations') {
    (async () => {
      try {
        const response = await fetch('http://127.0.0.1:8001/translations/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request.records),
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({ detail: `Server error: ${response.status}` }));
          throw new Error(errData.detail || `Server returned status ${response.status}`);
        }
        const data = await response.json();
        sendResponse({ success: true, data });
      } catch (error: any) {
        console.error('Error in background upsertTranslations:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (request.action === 'serverFetch') {
    (async () => {
      try {
        const rawUrl = request.url;
        const targetUrl = rawUrl.startsWith('http')
          ? rawUrl
          : `http://127.0.0.1:8001${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
        const fetchInit: RequestInit = {
          method: (request.options && request.options.method) || 'GET',
        };
        const headers: Record<string, string> = Object.assign({}, (request.options && request.options.headers) || {});

        if (request.options && request.options.body !== undefined && request.options.body !== null) {
          if (typeof request.options.body === 'string') {
            fetchInit.body = request.options.body;
          } else {
            fetchInit.body = JSON.stringify(request.options.body);
            if (!headers['Content-Type'] && !headers['content-type']) {
              headers['Content-Type'] = 'application/json';
            }
          }
        }
        fetchInit.headers = headers;

        const response = await fetch(targetUrl, fetchInit);
        const text = await response.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (_) {}

        sendResponse({
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          data,
          text,
        });
      } catch (error: any) {
        console.error('[serverFetch] Background fetch error:', error);
        sendResponse({
          ok: false,
          status: 0,
          statusText: error.message || 'Network error',
          error: error.message || 'Network error',
          data: null,
          text: '',
        });
      }
    })();
    return true;
  }
  return false;
});

async function fetchPageTitle(url: string): Promise<string> {
  try {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
    }
    const text = await response.text();
    const titleMatch = text.match(/<title>(.*?)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : url;
  } catch (e: any) {
    console.error(`Failed to fetch title for ${url}:`, e);
    throw new Error(`제목 가져오기 실패: ${e.message}`);
  }
}

async function handleBatchTranslate(
  items: Array<{ id: string; text: string }>,
  sourceUrl: string,
  isRetranslation = false,
  model: string | null = null
): Promise<{ translations: any[]; recommended_turbo_delay_ms: number }> {
  try {
    const cleanSourceUrl = (sourceUrl || '').split('#')[0].trim();
    const bodyPayload: Record<string, any> = { items: items, url: cleanSourceUrl };
    if (isRetranslation) {
      bodyPayload.is_retranslation = true;
    }
    if (model) {
      bodyPayload.model = model;
    }

    const response = await fetch('http://127.0.0.1:8001/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const apiLimitError: any = new Error('API rate limit exceeded.');
        apiLimitError.status = 429;
        throw apiLimitError;
      }
      const errorData = await response.json().catch(() => ({ detail: `Server error: ${response.status}` }));
      const customError: any = new Error(errorData.detail || `Server error: ${response.status}`);
      customError.status = response.status;
      throw customError;
    }

    const data = await response.json();

    if (!data.translations || data.translations.length !== items.length) {
      console.error('Mismatched response length from server', data);
      throw new Error('Received invalid translation data from server.');
    }

    return {
      translations: data.translations,
      recommended_turbo_delay_ms: data.recommended_turbo_delay_ms || 2000,
    };
  } catch (error) {
    console.error('Translation request to local server failed:', error);
    throw error;
  }
}

async function saveErrorLog(items: any[], error: any, url: string): Promise<void> {
  const logEntry = {
    timestamp: Date.now(),
    reason: error.message || '알 수 없는 오류',
    url: url || '알 수 없는 URL',
    texts: items.map((item) => item.text),
    stack: error.stack || null,
  };

  try {
    const result = await chrome.storage.local.get('error_log');
    const existingLogs = result.error_log || [];
    existingLogs.unshift(logEntry);
    if (existingLogs.length > 20) {
      existingLogs.length = 20;
    }
    await chrome.storage.local.set({ error_log: existingLogs });
    console.log('오류 로그를 저장했습니다.');
  } catch (e) {
    console.error('오류 로그 저장 실패:', e);
  }
}
