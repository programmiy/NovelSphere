// separators.ts: 소설별 상/하단 구분선 관리 및 영역 분석 모듈
import { ParagraphItem, SeparatorConfig, SeparatorAnalysis } from '../types/novel';

export const DEFAULT_GLOBAL_SEPARATORS: string[] = [
  '◆◇◆◇',
  '◇◆◇◆',
  '----------------',
  '------------------------------------------------',
  '＊＊＊',
  '***',
  '===',
];

export const PRESET_SEPARATORS: Array<{ name: string; sep: string }> = [
  { name: '다이아 (◆◇◆◇)', sep: '◆◇◆◇' },
  { name: '역다이아 (◇◆◇◆)', sep: '◇◆◇◆' },
  { name: '짧은 대시 (----------------)', sep: '----------------' },
  { name: '긴 대시 (------------------------------------------------)', sep: '------------------------------------------------' },
  { name: '전각 별 (＊＊＊)', sep: '＊＊＊' },
  { name: '반각 별 (***)', sep: '***' },
];

export function checkSeparatorMatch(text: string, separators: string[]): string | null {
  if (!text || !separators || separators.length === 0) return null;
  const trimmed = text.trim();
  for (const sep of separators) {
    if (!sep || !sep.trim()) continue;
    const cleanSep = sep.trim();
    if (trimmed === cleanSep || trimmed.includes(cleanSep)) {
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
  };

  if (!validParagraphs || validParagraphs.length === 0 || !separators || separators.length === 0) {
    return result;
  }

  const matches: Array<{ index: number; pid: string; sep: string }> = [];
  validParagraphs.forEach((p, idx) => {
    const matched = checkSeparatorMatch(p.text, separators);
    if (matched) {
      matches.push({ index: idx, pid: p.pid, sep: matched });
      result.separatorPids.add(p.pid);
    }
  });

  if (matches.length === 0) {
    return result;
  }

  const total = validParagraphs.length;

  if (matches.length === 1) {
    const single = matches[0];
    if (single.index <= total * 0.3) {
      result.topSeparator = { sep: single.sep, index: single.index };
      for (let i = 0; i <= single.index; i++) {
        result.prefacePids.add(validParagraphs[i].pid);
      }
    } else {
      result.bottomSeparator = { sep: single.sep, index: single.index };
      for (let i = single.index; i < total; i++) {
        result.afterwordPids.add(validParagraphs[i].pid);
      }
    }
    return result;
  }

  // 2개 이상일 때: 첫 번째는 상단 구분선, 마지막은 하단 구분선
  const first = matches[0];
  const last = matches[matches.length - 1];

  result.topSeparator = { sep: first.sep, index: first.index };
  for (let i = 0; i <= first.index; i++) {
    result.prefacePids.add(validParagraphs[i].pid);
  }

  result.bottomSeparator = { sep: last.sep, index: last.index };
  for (let i = last.index; i < total; i++) {
    result.afterwordPids.add(validParagraphs[i].pid);
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

  try {
    await fetch('http://127.0.0.1:8001/api/separators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('[saveNovelSeparators] Server save failed:', e);
  }

  const cacheKey = `separators_${novelTitle}`;
  await chrome.storage.local.set({ [cacheKey]: config });
  return config;
}
