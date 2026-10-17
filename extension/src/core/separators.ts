// separators.ts: 소설별 상/하단 구분선 관리 및 영역 분석 모듈
import type { ParagraphItem, SeparatorConfig, SeparatorAnalysis } from '../types/novel';

export const DEFAULT_GLOBAL_SEPARATORS: string[] = [
  '＜あとがき＞',
  '&lt;あとがき&gt;',
  '【あとがき】',
  '＜解説＞',
  '【大事なお知らせ】',
  '【宣伝】',
  'お読み頂きありがとうございます！',
];

export const PRESET_SEPARATORS: Array<{ name: string; sep: string }> = [
  { name: '◎◎◎', sep: '◎◎◎' },
  { name: '----------', sep: '----------' },
  { name: '++', sep: '++' },
  { name: '　☆☆☆☆☆', sep: '　☆☆☆☆☆' },
  { name: '――――', sep: '――――' },
  { name: '***', sep: '***' },
  { name: '◆◇◆◇', sep: '◆◇◆◇' },
  { name: '◇◆◇◆', sep: '◇◆◇◆' },
  { name: '＊＊＊', sep: '＊＊＊' },
];

export function checkSeparatorMatch(text: string, separators: string[]): string | null {
  if (!text || !separators || separators.length === 0) return null;
  for (const sep of separators) {
    if (!sep) continue;
    if (sep === '— (em-dash)' || sep === '^[\\s—]+$') {
      if (/^[\s—]+$/.test(text)) return sep;
    } else if (text.includes(sep)) {
      return sep;
    }
  }
  return null;
}

export function analyzeSeparatorSections(validParagraphs: ParagraphItem[], separators: string[]): SeparatorAnalysis {
  const result: SeparatorAnalysis = {
    prefacePids: new Set<string>(),
    afterwordPids: new Set<string>(),
    separatorPids: new Set<string>(),
    excludedPidMap: new Map(),
    topSeparator: null,
    bottomSeparator: null,
  };

  if (!validParagraphs || validParagraphs.length === 0 || !separators || separators.length === 0) {
    return result;
  }

  const N = validParagraphs.length;
  const separatorHits: Array<{ index: number; item: ParagraphItem; sep: string }> = [];
  for (let i = 0; i < N; i++) {
    const item = validParagraphs[i];
    const matchedSep = checkSeparatorMatch(item.text, separators);
    if (matchedSep) {
      separatorHits.push({ index: i, item, sep: matchedSep });
    }
  }

  if (separatorHits.length === 0) {
    return result;
  }

  const firstHit = separatorHits[0];
  const firstIndex = firstHit.index;

  // 상단 머리말 구분선 판정:
  // 1) 전체 문단 수 대비 앞쪽 20% 이내 (최대 15문단 상한선 Cap 적용)
  // 2) 잔여 본문 단락 수가 5개 이상이고, 머리말 문단 수보다 본문이 더 길 것
  // 3) 명백한 후기 전용 키워드(DEFAULT_GLOBAL_SEPARATORS)는 상단 머리말 구분선으로 취급하지 않음
  const isExplicitAfterwordKeyword = DEFAULT_GLOBAL_SEPARATORS.includes(firstHit.sep);
  const maxPrefaceCount = Math.max(5, Math.min(15, Math.floor(N * 0.20)));
  const remainingAfterFirst = N - 1 - firstIndex;
  const isTopSeparator =
    !isExplicitAfterwordKeyword &&
    firstIndex <= maxPrefaceCount &&
    remainingAfterFirst >= 5 &&
    remainingAfterFirst > firstIndex;

  const maxAfterwordCount = Math.max(5, Math.min(25, Math.floor(N * 0.25)));

  if (isTopSeparator) {
    result.topSeparator = { index: firstIndex, sep: firstHit.sep, pid: firstHit.item.pid };
    result.separatorPids.add(firstHit.item.pid);

    for (let i = 0; i < firstIndex; i++) {
      const pItem = validParagraphs[i];
      result.prefacePids.add(pItem.pid);
      result.excludedPidMap.set(pItem.pid, {
        matchedSep: firstHit.sep,
        isSubsequent: false,
        isPreface: true,
      });
    }

    result.excludedPidMap.set(firstHit.item.pid, {
      matchedSep: firstHit.sep,
      isSubsequent: false,
      isPreface: false,
    });

    const remainingHits = separatorHits.slice(1);
    if (remainingHits.length > 0) {
      const lastHit = remainingHits[remainingHits.length - 1];
      const lastIndex = lastHit.index;
      const remainingAfterLast = N - 1 - lastIndex;
      const isLastExplicitAfterword = DEFAULT_GLOBAL_SEPARATORS.includes(lastHit.sep);

      if ((isLastExplicitAfterword || remainingAfterLast <= maxAfterwordCount) && lastIndex > firstIndex) {
        result.bottomSeparator = { index: lastIndex, sep: lastHit.sep, pid: lastHit.item.pid };
        result.separatorPids.add(lastHit.item.pid);

        result.excludedPidMap.set(lastHit.item.pid, {
          matchedSep: lastHit.sep,
          isSubsequent: false,
          isPreface: false,
        });

        for (let j = lastIndex + 1; j < N; j++) {
          const nextItem = validParagraphs[j];
          result.afterwordPids.add(nextItem.pid);
          result.excludedPidMap.set(nextItem.pid, {
            matchedSep: lastHit.sep,
            isSubsequent: true,
            isPreface: false,
          });
        }
      }
    }
  } else {
    // 첫 번째 구분선이 상단이 아닌 경우:
    // 명백한 후기 키워드이거나 후반부(끝에서 25% 또는 25문단 이내)에 위치한 구분선을 하단 후기 시작선으로 채택
    const bottomCandidate =
      separatorHits.find((h) => DEFAULT_GLOBAL_SEPARATORS.includes(h.sep) && h.index > 0) ||
      [...separatorHits].reverse().find((h) => N - 1 - h.index <= maxAfterwordCount && h.index > 0);

    if (bottomCandidate) {
      const lastIndex = bottomCandidate.index;
      result.bottomSeparator = { index: lastIndex, sep: bottomCandidate.sep, pid: bottomCandidate.item.pid };
      result.separatorPids.add(bottomCandidate.item.pid);

      result.excludedPidMap.set(bottomCandidate.item.pid, {
        matchedSep: bottomCandidate.sep,
        isSubsequent: false,
        isPreface: false,
      });

      for (let j = lastIndex + 1; j < N; j++) {
        const nextItem = validParagraphs[j];
        result.afterwordPids.add(nextItem.pid);
        result.excludedPidMap.set(nextItem.pid, {
          matchedSep: bottomCandidate.sep,
          isSubsequent: true,
          isPreface: false,
        });
      }
    } else {
      // 본문 중간의 장면 전환 기호인 경우 해당 구분선 줄만 제외하고 본문은 보존
      separatorHits.forEach((h) => {
        result.separatorPids.add(h.item.pid);
        result.excludedPidMap.set(h.item.pid, {
          matchedSep: h.sep,
          isSubsequent: false,
          isPreface: false,
        });
      });
    }
  }

  return result;
}

export async function loadNovelSeparators(novelTitle: string): Promise<SeparatorConfig> {
  const title = novelTitle || '기본 소설';
  try {
    const resp = await fetch(`http://127.0.0.1:8001/api/separators?novel_title=${encodeURIComponent(title)}`);
    if (resp.ok) {
      const data = await resp.json();
      const config: SeparatorConfig = {
        useDefaults: data.use_defaults,
        customSeparators: data.custom_separators || [],
        effectiveSeparators: data.effective_separators || [],
      };
      const cacheKey = `separators_${title}`;
      chrome.storage.local.set({ [cacheKey]: config });
      return config;
    }
  } catch (e) {
    console.warn('[loadNovelSeparators] Server request failed, falling back to local storage:', e);
  }

  try {
    const cacheKey = `separators_${title}`;
    const stored = await chrome.storage.local.get(cacheKey);
    if (stored[cacheKey]) {
      return stored[cacheKey];
    }
  } catch (e) {
    console.error('[loadNovelSeparators] Local storage get failed:', e);
  }

  return {
    useDefaults: true,
    customSeparators: [],
    effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS],
  };
}

export async function saveNovelSeparators(
  novelTitle: string,
  customSeparators: string[],
  useDefaults: boolean
): Promise<SeparatorConfig> {
  const payload = {
    novel_title: novelTitle,
    separators: customSeparators,
    use_defaults: useDefaults,
  };

  let effective: string[] = [];
  if (useDefaults) {
    effective.push(...DEFAULT_GLOBAL_SEPARATORS);
  }
  for (const s of customSeparators) {
    if (!effective.includes(s)) effective.push(s);
  }

  const config: SeparatorConfig = {
    useDefaults,
    customSeparators,
    effectiveSeparators: effective,
  };

  const cacheKey = `separators_${novelTitle}`;
  await chrome.storage.local.set({ [cacheKey]: config });

  try {
    const resp = await fetch('http://127.0.0.1:8001/api/separators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.warn('Failed to persist separators to server, stored locally:', resp.status);
    }
  } catch (e) {
    console.warn('[saveNovelSeparators] Server save failed:', e);
  }

  return config;
}

export async function resetNovelSeparators(novelTitle: string): Promise<SeparatorConfig> {
  try {
    await fetch(`http://127.0.0.1:8001/api/separators?novel_title=${encodeURIComponent(novelTitle)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.warn('Server delete request failed:', e);
  }

  const cacheKey = `separators_${novelTitle}`;
  try {
    await chrome.storage.local.remove(cacheKey);
  } catch (_) {}

  return {
    useDefaults: true,
    customSeparators: [],
    effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS],
  };
}

