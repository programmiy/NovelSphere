// retry_policy.ts: 청크 번역 오류 분류 및 503 과부하 / 일반 통신 오류 재시도 정책

export const MAX_COMMUNICATION_RETRIES = 5;

/**
 * 503 API 과부하 시 최대 총 시도 횟수 (최초 1회 + 서버 세션 초기화 후 재시도 2회 = 503 최대 3회 연속 허용).
 * 4번째 연속 호출 및 일반 통신 오류의 5회 장기 대기·반갈 분할 재시도를 차단합니다.
 */
export const MAX_503_ATTEMPTS = 3;
export const OVERLOAD_503_RETRY_DELAY_MS = 5000;

export type RetryDecision =
  | {
      action: 'retry';
      delayMs: number;
      attempt: number;
      maxAttempts: number;
      isOverload503: boolean;
    }
  | {
      action: 'pause_503';
      maxAttempts: number;
    }
  | {
      action: 'split_fallback';
      maxAttempts: number;
    };

/**
 * 오류 객체나 응답 페이로드에서 HTTP 503(API 과부하) 여부를 판별합니다.
 */
export function isServiceUnavailable503Error(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    if (typeof error === 'string') {
      return /\b503\b/.test(error) && /(HTTP\s*503|과부하|Service Unavailable|overload)/i.test(error);
    }
    return false;
  }

  const errObj = error as { status?: unknown; message?: unknown; error?: unknown };
  if (Number(errObj.status) === 503) return true;

  const rawMsg =
    typeof errObj.message === 'string'
      ? errObj.message
      : typeof errObj.error === 'string'
        ? errObj.error
        : '';
  if (!rawMsg) return false;

  return (
    /HTTP\s*503\b/i.test(rawMsg) ||
    /Gemini API 오류\s*\(\s*503\s*\)/i.test(rawMsg) ||
    /503\s*(Service Unavailable|과부하|API 과부하)/i.test(rawMsg) ||
    /(API 과부하|Service Unavailable).*503/i.test(rawMsg)
  );
}

/**
 * HTTP 상태 코드(status)를 보존한 Error 인스턴스를 생성합니다.
 */
export function createResponseError(message: string, status?: number): Error & { status?: number } {
  const err = new Error(message || 'Unknown translation error') as Error & { status?: number };
  if (typeof status === 'number' && !Number.isNaN(status)) {
    err.status = status;
  }
  return err;
}

/**
 * 현재 시도 횟수(0-based)와 오류 유형에 따라 다음 행동(재시도 / 503 일시중지 / 반갈 분할)을 결정합니다.
 */
export function decideChunkRetryAction(
  attempt: number,
  error: unknown,
  randomFn: () => number = Math.random
): RetryDecision {
  const safeRandom = Math.max(0, Math.min(1, randomFn()));

  if (isServiceUnavailable503Error(error)) {
    if (attempt < MAX_503_ATTEMPTS - 1) {
      return {
        action: 'retry',
        delayMs: OVERLOAD_503_RETRY_DELAY_MS + Math.floor(safeRandom * 500),
        attempt: attempt + 1,
        maxAttempts: MAX_503_ATTEMPTS,
        isOverload503: true,
      };
    }
    return {
      action: 'pause_503',
      maxAttempts: MAX_503_ATTEMPTS,
    };
  }

  if (attempt < MAX_COMMUNICATION_RETRIES - 1) {
    return {
      action: 'retry',
      delayMs: (40 + Math.pow(2, attempt)) * 1000 + Math.floor(safeRandom * 1000),
      attempt: attempt + 1,
      maxAttempts: MAX_COMMUNICATION_RETRIES,
      isOverload503: false,
    };
  }

  return {
    action: 'split_fallback',
    maxAttempts: MAX_COMMUNICATION_RETRIES,
  };
}
