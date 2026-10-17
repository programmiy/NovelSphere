import type { BatchStats } from '../types/novel.ts';
import { detectCutoffInfo, getCurrentQuotaWindow } from './turbo.ts';

export { getCurrentQuotaWindow };

export const RECENT_EPISODES_STORAGE_KEY = 'lanovel_recent_episodes';
let recentEpisodesMemoryCache: Array<{ url: string; timestamp: number }> = [];
let cachedTodayTotalEpisodes = 0;

export async function recordRecentEpisode(cleanUrl: string): Promise<void> {
  if (!cleanUrl) return;
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  try {
    const data = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
    let list: Array<{ url: string; timestamp: number }> = Array.isArray(data[RECENT_EPISODES_STORAGE_KEY])
      ? data[RECENT_EPISODES_STORAGE_KEY].filter((item: any) => item && item.timestamp >= tenMinutesAgo)
      : [];

    // 동일 URL 중복 제거 및 최신 타임스탬프로 갱신
    const existingIndex = list.findIndex((item) => item.url === cleanUrl);
    if (existingIndex >= 0) {
      list[existingIndex].timestamp = now;
    } else {
      list.push({ url: cleanUrl, timestamp: now });
    }

    recentEpisodesMemoryCache = list;
    await chrome.storage.local.set({ [RECENT_EPISODES_STORAGE_KEY]: list });
  } catch (e) {
    console.warn('[recordRecentEpisode] Failed to save recent episode:', e);
  }
}

export async function getRecentEpisodeCount(windowMinutes = 5): Promise<number> {
  const now = Date.now();
  const cutoffTime = now - windowMinutes * 60 * 1000;

  try {
    const data = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
    const list: Array<{ url: string; timestamp: number }> = Array.isArray(data[RECENT_EPISODES_STORAGE_KEY])
      ? data[RECENT_EPISODES_STORAGE_KEY]
      : recentEpisodesMemoryCache;
    recentEpisodesMemoryCache = list;

    const recentItems = list.filter((item) => item && item.timestamp >= cutoffTime && item.url);
    const uniqueUrls = new Set(recentItems.map((item) => item.url));
    return uniqueUrls.size;
  } catch (e) {
    console.warn('[getRecentEpisodeCount] Fallback to memory cache:', e);
    const recentItems = recentEpisodesMemoryCache.filter((item) => item && item.timestamp >= cutoffTime && item.url);
    return new Set(recentItems.map((item) => item.url)).size;
  }
}

export function calculateAdaptiveEpisodeDelay(recentCount: number, isTurbo: boolean): number {
  if (isTurbo) {
    // 쾌속모드: 최근 번역한 회차가 많을수록 분당 요청 폭증(RPM 초과)을 막기 위해 점진적/대폭 지연 부여
    if (recentCount <= 2) return 8000; // 0~2화: 기본 8초 (안전 구간)
    if (recentCount === 3) return 15000; // 3화: 15초 (주의 구간)
    if (recentCount === 4) return 22000; // 4화: 22초 (경고 구간)
    if (recentCount === 5) return 30000; // 5화: 30초 (과열 주의 구간)
    if (recentCount === 6) return 40000; // 6화: 40초 (과열 위험 구간)
    return 55000; // 7화 이상: 55초 (완전 쿨다운, 60초 슬라이딩 윈도우 리셋)
  }

  // 일반 모드: 기본 60초, 회차 급증 시 안전하게 추가 연장
  if (recentCount <= 4) return 60000;
  if (recentCount <= 6) return 75000;
  return 90000;
}

export function calculateAdaptiveChunkDelay(recentCount: number, isTurbo: boolean): number {
  if (isTurbo) {
    if (recentCount <= 3) return 2000; // 기본 2초
    if (recentCount <= 5) return 3000; // 3초 미세 완충
    return 4500; // 4.5초 과열 완충
  }

  // 일반 모드: 기본 5초, 회차 누적 시 6.5초
  if (recentCount <= 4) return 5000;
  return 6500;
}

export function getNovelWorkKey(customUrl?: string, customNovelTitle?: string): string {
  const url = customUrl ?? (typeof window !== 'undefined' ? window.location.href : '');
  let host = '';
  try {
    host = customUrl ? new URL(customUrl).hostname : typeof window !== 'undefined' ? window.location.hostname : '';
  } catch (_) {
    host = typeof window !== 'undefined' ? window.location.hostname : '';
  }

  // 1. 카쿠요무: /works/1177354054887975130
  if (host.includes('kakuyomu.jp')) {
    const match = url.match(/\/works\/(\d+)/);
    if (match) return `kakuyomu_${match[1]}`;
  }
  // 2. 쇼세츠 (소설가가 되자): /n3298hj/ or /n4913gc/ (끝 슬래시 유무 무관)
  if (host.includes('syosetu.com')) {
    const match = url.match(/\/(n\d+[a-z]+)(\/|$)/i);
    if (match) return `syosetu_${match[1].toLowerCase()}`;
  }
  // 3. 노벨업플러스: /story/12345
  if (host.includes('novelup.plus')) {
    const match = url.match(/\/story\/(\d+)/);
    if (match) return `novelup_${match[1]}`;
  }
  // 4. 하멜른: /novel/12345
  if (host.includes('syosetu.org')) {
    const match = url.match(/\/novel\/(\d+)/);
    if (match) return `hameln_${match[1]}`;
  }
  // 5. 알파폴리스: /novel/12345
  if (host.includes('alphapolis.co.jp')) {
    const match = url.match(/\/novel\/(\d+)/);
    if (match) return `alphapolis_${match[1]}`;
  }

  // 6. Fallback: 소설 제목 정규화 (일본어, 영문, 숫자, 한글 모두 포함)
  const novelTitle = customNovelTitle || '';
  if (novelTitle && novelTitle !== '기본 소설' && novelTitle !== '閉じる') {
    const sanitized = novelTitle.trim().replace(/[^a-zA-Z0-9가-힣\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff_]/g, '_');
    if (sanitized && sanitized.replace(/_/g, '').length > 0) {
      return `novel_${sanitized}`;
    }
  }

  return 'default';
}

export async function updateAndGetBatchCount(
  currentCleanUrl: string,
  onLog?: (message: string) => void,
  novelTitle = '',
  turboCutoffHour: number | null = null
): Promise<BatchStats> {
  const workKey = getNovelWorkKey(currentCleanUrl, novelTitle);
  const stateKey = `lanovel_batch_state_${workKey}`;

  // 레거시 비정상 키(380 등 기존 누적 오염값) 완전 청소
  try {
    const allKeys = await chrome.storage.local.get(null);
    const legacyKeys = Object.keys(allKeys).filter((k) => k.startsWith('lanovel_batch_count_'));
    if (legacyKeys.length > 0) {
      await chrome.storage.local.remove(legacyKeys);
    }
  } catch (_) {}

  const currentWindow = getCurrentQuotaWindow(new Date(), turboCutoffHour);
  const cutoffInfo = detectCutoffInfo(turboCutoffHour);
  const cutoffHour = cutoffInfo.hour;
  const now = Date.now();
  const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분 미활동 시 세션 만료 (새 세션은 1화부터 시작)

  const batchState = {
    consecutiveCount: 0,
    lastUpdated: 0,
    lastUrl: '',
    window: currentWindow,
  };

  try {
    const stored = await chrome.storage.local.get(stateKey);
    if (stored && stored[stateKey]) {
      const s = stored[stateKey];
      batchState.consecutiveCount = typeof s.consecutiveCount === 'number' ? s.consecutiveCount : 0;
      batchState.lastUpdated = s.lastUpdated || 0;
      batchState.lastUrl = s.lastUrl || '';
      batchState.window = s.window || currentWindow;
    }
  } catch (e) {
    console.warn('[Notification] Failed to read batch state from storage:', e);
  }

  // 1. API 일일 쿼터 초기화 시각(오후 4시/16시 또는 오후 5시/17시) 도달 시 카운터 0으로 갱신
  if (batchState.window && batchState.window !== currentWindow) {
    if (onLog) {
      onLog(`🔄 [일일 갱신] Gemini API 쿼터 초기화 시간(${cutoffHour}시)에 도달하여 이번 세션 연속 번역 카운터를 새로 시작합니다.`);
    }
    batchState.consecutiveCount = 0;
    batchState.lastUrl = '';
    batchState.window = currentWindow;
  }

  // 2. 세션 타임아웃 검사 (이전 번역 완료 후 30분 이상 지났으면 새 세션으로 0으로 초기화)
  const isSessionExpired = !batchState.lastUpdated || now - batchState.lastUpdated > SESSION_TIMEOUT_MS;
  if (isSessionExpired) {
    batchState.consecutiveCount = 0;
    batchState.lastUrl = '';
  }

  // 3. 동일 URL(회차) 중복 카운트 방지
  const isSameEpisode = Boolean(batchState.lastUrl && batchState.lastUrl === currentCleanUrl);
  if (isSameEpisode) {
    if (!batchState.consecutiveCount || batchState.consecutiveCount < 1) {
      batchState.consecutiveCount = 1;
    }
    if (onLog) {
      onLog(`[번역 진행 카운터] 동일 회차 재번역 감지: 이번 연속 번역 카운터를 유지합니다. (${batchState.consecutiveCount}화)`);
    }
  } else {
    // 새 회차 번역: 연속 카운터 + 1 (새 세션 첫 번역이면 0 + 1 = 1)
    batchState.consecutiveCount = (batchState.consecutiveCount || 0) + 1;
  }

  batchState.lastUpdated = now;
  batchState.lastUrl = currentCleanUrl;
  batchState.window = currentWindow;

  try {
    await chrome.storage.local.set({ [stateKey]: batchState });
  } catch (e) {
    console.warn('[Notification] Failed to save batch state:', e);
  }

  // 4. [서버 DB 동기화] 오늘 번역된 DB 기록을 바탕으로 오늘 소설 누적 및 전체 누적 회차 동기화
  let novelTodayCount = batchState.consecutiveCount;
  let totalTodayCount = cachedTodayTotalEpisodes || 0;

  try {
    const syncUrl = `http://127.0.0.1:8001/api/translation_session_count?url=${encodeURIComponent(currentCleanUrl)}&work_key=${encodeURIComponent(workKey)}&novel_title=${encodeURIComponent(novelTitle || '')}`;
    const serverResp = await fetch(syncUrl);
    if (serverResp.ok) {
      const serverData = await serverResp.json();
      if (typeof serverData.total_today_count === 'number') {
        totalTodayCount = serverData.total_today_count;
        cachedTodayTotalEpisodes = totalTodayCount;
      }
      if (typeof serverData.count === 'number' && serverData.count > 0) {
        novelTodayCount = serverData.count;
      }
    }
  } catch (_) {}

  return {
    consecutiveCount: batchState.consecutiveCount,
    novelTodayCount: novelTodayCount,
    totalTodayCount: totalTodayCount,
  };
}

export async function resetBatchCount(customUrl?: string, novelTitle = ''): Promise<void> {
  const workKey = getNovelWorkKey(customUrl, novelTitle);
  const stateKey = `lanovel_batch_state_${workKey}`;
  try {
    await chrome.storage.local.remove(stateKey);
  } catch (_) {}
}

export async function sendProgressNotification(
  novelTitle: string,
  episodeTitle: string,
  current: number,
  total: number,
  percentage: number,
  url: string,
  episodeCount: number | null = null
): Promise<void> {
  try {
    const payload: Record<string, any> = {
      novel_title: novelTitle || '',
      episode_title: episodeTitle || '',
      current: current,
      total: total,
      percentage: percentage,
      url: url || '',
    };
    if (episodeCount !== null && episodeCount !== undefined) {
      payload.episode_count = episodeCount;
    }
    await fetch('http://127.0.0.1:8001/api/notifications/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // 알림 전송 실패는 메인 프로세스를 방해하지 않음
  }
}

export async function sendCompleteNotification(
  novelTitle: string,
  episodeTitle: string,
  totalCount: number,
  url: string,
  episodeCount: number | null = null
): Promise<void> {
  try {
    const payload: Record<string, any> = {
      novel_title: novelTitle || '',
      episode_title: episodeTitle || '',
      total_count: totalCount,
      url: url || '',
    };
    if (episodeCount !== null && episodeCount !== undefined) {
      payload.episode_count = episodeCount;
    }
    await fetch('http://127.0.0.1:8001/api/notifications/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // 알림 전송 실패는 메인 프로세스를 방해하지 않음
  }
}

