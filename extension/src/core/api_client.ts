// api_client.ts: 백그라운드 프록시 기반 안전한 서버 통신 클라이언트
// 크롬의 Private Network Access(PNA) 정책으로 인해 외부 웹페이지(Syosetu, Kakuyomu 등)의
// 콘텐츠 스크립트에서 로컬 루프백(127.0.0.1)으로의 직접 fetch가 차단되는 문제를
// background service worker를 대리인(Proxy)으로 경유하여 원천 해결합니다.

export interface ServerFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: <T = any>() => Promise<T>;
  text: () => Promise<string>;
  error?: string;
}

export async function serverFetch(
  urlOrPath: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    signal?: any;
  }
): Promise<ServerFetchResponse> {
  const targetUrl = urlOrPath.startsWith('http')
    ? urlOrPath
    : `http://127.0.0.1:8001${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;

  // Chrome Extension 런타임 환경 (콘텐츠 스크립트 등)에서는 Background Service Worker를 경유
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
    return new Promise<ServerFetchResponse>((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'serverFetch',
          url: targetUrl,
          options: {
            method: options?.method || 'GET',
            headers: options?.headers,
            body: options?.body,
          },
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || 'Background communication error';
            resolve({
              ok: false,
              status: 0,
              statusText: errMsg,
              error: errMsg,
              json: async () => {
                throw new Error(errMsg);
              },
              text: async () => errMsg,
            });
            return;
          }

          if (!resp) {
            const errMsg = 'No response from background service worker';
            resolve({
              ok: false,
              status: 0,
              statusText: errMsg,
              error: errMsg,
              json: async () => {
                throw new Error(errMsg);
              },
              text: async () => errMsg,
            });
            return;
          }

          resolve({
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText || '',
            error: resp.error,
            json: async <T = any>(): Promise<T> => {
              if (resp.data !== null && resp.data !== undefined) {
                return resp.data as T;
              }
              return JSON.parse(resp.text || '{}') as T;
            },
            text: async () => resp.text || '',
          });
        }
      );
    });
  }

  // 테스트 환경(Node.js / Mock) 또는 브라우저 전역 fetch 직접 호출 폴백
  const directResponse = await fetch(targetUrl, options as any);
  return {
    ok: directResponse.ok,
    status: directResponse.status,
    statusText: directResponse.statusText,
    json: async <T = any>() => (await directResponse.json()) as T,
    text: async () => await directResponse.text(),
  };
}
