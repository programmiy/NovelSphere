import type { BatchStats } from '../types/novel.ts';

export const RECENT_EPISODES_STORAGE_KEY = 'lanovel_recent_episodes';
let recentEpisodesMemoryCache: Array<{ url: string; timestamp: number }> = [];

export async function recordRecentEpisode(cleanUrl: string): Promise<void> {
  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  try {
    const data = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
    let list: Array<{ url: string; timestamp: number }> = data[RECENT_EPISODES_STORAGE_KEY] || [];
    // 10분 이상 지난 오래된 항목 제거
    list = list.filter((item) => item.timestamp >= tenMinutesAgo);

    // 동일 URL 중복 제거 및 최신 타임스탬프로 갱신
    list = list.filter((item) => item.url !== cleanUrl);
    list.push({ url: cleanUrl, timestamp: now });

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
    const list: Array<{ url: string; timestamp: number }> = data[RECENT_EPISODES_STORAGE_KEY] || [];
    recentEpisodesMemoryCache = list;

    const recentItems = list.filter((item) => item.timestamp >= cutoffTime);
    const uniqueUrls = new Set(recentItems.map((item) => item.url));
    return uniqueUrls.size;
  } catch (e) {
    console.warn('[getRecentEpisodeCount] Fallback to memory cache:', e);
    const recentItems = recentEpisodesMemoryCache.filter((item) => item.timestamp >= cutoffTime);
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

export async function updateAndGetBatchCount(currentCleanUrl: string): Promise<BatchStats> {
  const now = Date.now();
  const sessionTimeoutMs = 30 * 60 * 1000; // 30분 유휴 시 연속 카운트 리셋
  const todayDateStr = new Date().toISOString().split('T')[0];

  try {
    const data = await chrome.storage.local.get([
      'lanovel_consecutive_batch_count',
      'lanovel_last_batch_timestamp',
      'lanovel_last_batch_url',
      'lanovel_daily_counts',
    ]);

    let consecutive = data.lanovel_consecutive_batch_count || 0;
    const lastTimestamp = data.lanovel_last_batch_timestamp || 0;
    const lastUrl = data.lanovel_last_batch_url || '';
    let dailyCounts = data.lanovel_daily_counts || {};

    if (!dailyCounts[todayDateStr]) {
      dailyCounts = { [todayDateStr]: { total: 0, byUrl: {} } };
    }

    // 30분 이상 경과 시 세션 초기화
    if (now - lastTimestamp > sessionTimeoutMs) {
      consecutive = 0;
    }

    // 직전 완료 회차와 동일 URL이 아닐 때만 카운트 증가
    if (lastUrl !== currentCleanUrl) {
      consecutive++;
      dailyCounts[todayDateStr].total = (dailyCounts[todayDateStr].total || 0) + 1;
      dailyCounts[todayDateStr].byUrl[currentCleanUrl] =
        (dailyCounts[todayDateStr].byUrl[currentCleanUrl] || 0) + 1;

      await chrome.storage.local.set({
        lanovel_consecutive_batch_count: consecutive,
        lanovel_last_batch_timestamp: now,
        lanovel_last_batch_url: currentCleanUrl,
        lanovel_daily_counts: dailyCounts,
      });
    }

    return {
      consecutiveCount: consecutive,
      novelTodayCount: dailyCounts[todayDateStr]?.byUrl[currentCleanUrl] || 1,
      totalTodayCount: dailyCounts[todayDateStr]?.total || 1,
    };
  } catch (e) {
    console.warn('[updateAndGetBatchCount] Failed to update batch count:', e);
    return { consecutiveCount: 1, novelTodayCount: 1, totalTodayCount: 1 };
  }
}

export function sendProgressNotification(
  novelTitle: string,
  episodeTitle: string,
  translatedCount: number,
  totalCount: number,
  percent: number,
  url: string,
  consecutiveEpisodes: number
): void {
  try {
    fetch('http://127.0.0.1:8001/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'progress',
        novel_title: novelTitle,
        episode_title: episodeTitle,
        translated_count: translatedCount,
        total_count: totalCount,
        progress_percentage: percent,
        url: url,
        consecutive_episodes: consecutiveEpisodes,
      }),
    }).catch(() => {});
  } catch (e) {}
}

export function sendCompleteNotification(
  novelTitle: string,
  episodeTitle: string,
  totalCount: number,
  url: string,
  consecutiveEpisodes: number
): void {
  try {
    fetch('http://127.0.0.1:8001/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'complete',
        novel_title: novelTitle,
        episode_title: episodeTitle,
        total_count: totalCount,
        url: url,
        consecutive_episodes: consecutiveEpisodes,
      }),
    }).catch(() => {});
  } catch (e) {}
}
