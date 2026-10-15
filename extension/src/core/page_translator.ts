// page_translator.ts: 웹소설 페이지 번역 실행, 청크 전송, 재시도, DOM 주입 및 서버 동기화 코어 엔진
import { state } from './state';
import { TranslationRecord, ParagraphItem } from '../types/novel';
import {
  isTranslatableText,
  isPurePunctuationOnly,
  checkIsVerbatimOrParaphrased,
  getPendingEmptyItems,
  PID_REGEX,
} from './filters';
import { createBudgetChunks, chunkArray, CHUNK_BUDGET_CHARACTERS, CHUNK_BUDGET_MAX_ITEMS } from './chunker';
import {
  detectCutoffInfo,
  calculateNextCutoffTimestamp,
  checkCutoffTimeReached,
} from './turbo';
import { analyzeSeparatorSections, checkSeparatorMatch } from './separators';
import {
  recordRecentEpisode,
  getRecentEpisodeCount,
  calculateAdaptiveEpisodeDelay,
  calculateAdaptiveChunkDelay,
  updateAndGetBatchCount,
  sendProgressNotification,
  sendCompleteNotification,
} from './adaptive_throttle';
import {
  logToSidebar,
  updateSidebarWithTranslations,
  addEntryToSidebar,
  addPlaceholderRows,
  sortSidebar,
  updateEmptyState,
  populateSidebar,
  updateApplyButtonUI,
  updateTurboModeUI,
  updateTurboBadgeUI,
  showSidebar,
} from '../ui/sidebar';
import { showLanovelHud } from '../ui/hud';
import { getScraper } from '../scrapers';

export function getCleanUrl(): string {
  return window.location.href.split('#')[0].trim();
}

export function getTargetParagraphs(): HTMLElement[] {
  const allParagraphs = document.querySelectorAll<HTMLElement>('p[id]');
  return Array.from(allParagraphs).filter((p) => !p.classList.contains('blank') && PID_REGEX.test(p.id));
}

export function sleepResponsive(getDelayFn: (() => number) | number): Promise<void> {
  return new Promise((resolve) => {
    state.currentDelayStart = Date.now();
    state.activeDelayFn = getDelayFn;
    const checkInterval = 50;

    const intervalId = setInterval(() => {
      if (state.isTranslationCancelled) {
        clearInterval(intervalId);
        state.currentDelayResolver = null;
        state.activeDelayFn = null;
        resolve();
        return;
      }

      const elapsed = Date.now() - state.currentDelayStart;
      const targetDelay = typeof getDelayFn === 'function' ? getDelayFn() : getDelayFn;

      if (elapsed >= targetDelay) {
        clearInterval(intervalId);
        state.currentDelayResolver = null;
        state.activeDelayFn = null;
        resolve();
      }
    }, checkInterval);

    state.currentDelayResolver = () => {
      const elapsed = Date.now() - state.currentDelayStart;
      const targetDelay = typeof getDelayFn === 'function' ? getDelayFn() : getDelayFn;
      if (elapsed >= targetDelay) {
        clearInterval(intervalId);
        state.currentDelayResolver = null;
        state.activeDelayFn = null;
        resolve();
      }
    };
  });
}

export async function loadTurboModeState(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([
      'lanovel_turbo_mode',
      'lanovel_turbo_cutoff',
      'lanovel_turbo_target',
    ]);
    state.isTurboMode = !!stored.lanovel_turbo_mode;
    state.turboCutoffHour = stored.lanovel_turbo_cutoff || null;
    state.turboTargetTimestamp = stored.lanovel_turbo_target || 0;

    if (state.isTurboMode) {
      if (!state.turboTargetTimestamp || Date.now() >= state.turboTargetTimestamp) {
        state.turboAbortedOnLoad = true;
        await abortTurboMode('초기화 시간 도달');
        return;
      }
    }
    updateTurboModeUI(state.isTurboMode);
    updateTurboBadgeUI();
  } catch (e) {
    console.warn('[TurboMode] Error loading state from storage:', e);
  }
}

export async function setTurboMode(enabled: boolean, manual = true): Promise<void> {
  state.isTurboMode = enabled;
  const info = detectCutoffInfo(state.turboCutoffHour);
  if (enabled) {
    state.turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
  } else {
    state.turboTargetTimestamp = 0;
  }

  try {
    await chrome.storage.local.set({
      lanovel_turbo_mode: state.isTurboMode,
      lanovel_turbo_cutoff: state.turboCutoffHour,
      lanovel_turbo_target: state.turboTargetTimestamp,
    });
  } catch (e) {
    console.warn('[TurboMode] Failed to save state:', e);
  }

  updateTurboModeUI(state.isTurboMode);
  updateTurboBadgeUI();

  if (state.currentDelayResolver) {
    state.currentDelayResolver();
  }

  if (manual) {
    if (state.isTurboMode) {
      const targetDate = new Date(state.turboTargetTimestamp);
      const targetTimeStr = `${targetDate.getHours()}:${String(targetDate.getMinutes()).padStart(2, '0')}`;
      logToSidebar(
        `⚡ [쾌속모드 활성화] 번역간 대기 2초, 다음화 넘어가기 8초로 설정되었습니다. (초기화 기준: ${info.label}, ${targetTimeStr} 정각 도달 시 즉시 중단)`
      );
    } else {
      logToSidebar(`⚡ [쾌속모드 비활성화] 일반 번역 모드로 전환되었습니다.`);
    }
  }
  state.broadcastStatus();
}

export async function abortTurboMode(reason = '초기화 시간 도달'): Promise<void> {
  state.isTranslationCancelled = true;
  state.isTurboMode = false;
  state.turboTargetTimestamp = 0;
  try {
    await chrome.storage.local.set({
      lanovel_turbo_mode: false,
      lanovel_turbo_target: 0,
    });
  } catch (e) {}

  updateTurboModeUI(false);

  const stopBtn = document.getElementById('stop-translation-btn');
  if (stopBtn) stopBtn.style.display = 'none';
  const retryBtn = document.getElementById('retry-translation-btn');
  if (retryBtn) retryBtn.style.display = 'inline-block';

  logToSidebar(`⏰ [쾌속모드 자동 중단] 사유: ${reason}. 자동 번역 및 다음 화 이동이 차단되었습니다.`, 'log-error');
  showLanovelHud(`쾌속모드 자동 중단 (${reason})`, '⏰', 3500);
  state.broadcastStatus();
}

export async function fetchTranslationsForUrl(url: string): Promise<TranslationRecord[] | null> {
  try {
    const fetchUrl = `http://127.0.0.1:8001/translations?url=${encodeURIComponent(url)}&limit=5000`;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      console.warn(`[fetchTranslationsForUrl] Server responded with ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.translations;
  } catch (error) {
    console.error('Error fetching translations for URL:', error);
    logToSidebar('서버에서 번역을 불러오는 데 실패했습니다.', 'log-error');
    return null;
  }
}

export async function fetchExclusionsForUrl(url: string): Promise<string[] | null> {
  try {
    const fetchUrl = `http://127.0.0.1:8001/excluded_sentences?url=${encodeURIComponent(url)}`;
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      console.warn(`[fetchExclusionsForUrl] Server responded with ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.excluded_texts;
  } catch (error) {
    console.error('Error fetching exclusions for URL:', error);
    return null;
  }
}

export async function ensureTranslationsLoaded(): Promise<TranslationRecord[] | null> {
  if (state.translationsLoadedPromise) {
    return state.translationsLoadedPromise;
  }

  state.translationsLoadedPromise = (async () => {
    const url = getCleanUrl();
    logToSidebar('저장된 번역을 서버에서 불러오는 중...');
    try {
      const [translations, excluded] = await Promise.all([
        fetchTranslationsForUrl(url),
        fetchExclusionsForUrl(url),
      ]);

      if (excluded) {
        state.exclusionSet = new Set(excluded);
      }

      if (translations && Array.isArray(translations) && translations.length > 0) {
        state.translationCache.clear();
        translations.forEach((t) => {
          if (t.pid && t.translated && t.translated.trim()) {
            state.translationCache.set(t.pid, t);
          }
        });
        populateSidebar(translations);
        logToSidebar(`서버에서 ${translations.length}개의 저장된 번역을 불러왔습니다.`);
      } else {
        logToSidebar('서버에 저장된 기존 번역이 없습니다.');
      }
      return translations;
    } catch (e: any) {
      console.error('[ensureTranslationsLoaded] 번역 로드 실패:', e);
      logToSidebar(`저장된 번역 로드 실패: ${e.message}`, 'log-error');
      return null;
    }
  })();

  return state.translationsLoadedPromise;
}

export function hasUntranslatedParagraphs(): boolean {
  const allParagraphs = getTargetParagraphs();
  const validParagraphs: ParagraphItem[] = [];
  allParagraphs.forEach((p) => {
    if (!p || p.id === 'tagCount' || /^(la|lp)\d+$/i.test(p.id)) return;
    const text = p.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
    if (text) {
      validParagraphs.push({ element: p, text: text, pid: p.id });
    }
  });

  const sepAnalysis = analyzeSeparatorSections(validParagraphs, state.activeSeparators);

  for (const item of validParagraphs) {
    if (sepAnalysis.prefacePids.has(item.pid)) continue;
    if (sepAnalysis.afterwordPids.has(item.pid)) continue;
    if (sepAnalysis.separatorPids.has(item.pid)) continue;

    const cached = state.translationCache.get(item.pid);
    if (cached && cached.translated && cached.translated.trim()) {
      continue;
    }

    const cleanedText = item.text.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
    if (state.exclusionSet.has(cleanedText)) continue;

    if (isTranslatableText(cleanedText)) {
      return true;
    }
  }
  return false;
}

export function applyTranslationsToPage(translations: any[], logNotification = true): void {
  if (!translations || translations.length === 0) return;

  const translationMap = new Map(translations.map((t) => [t.pid || t.id, t.translated]));
  const paragraphs = getTargetParagraphs();
  let replacementCount = 0;

  paragraphs.forEach((p) => {
    if (translationMap.has(p.id)) {
      const translatedText = translationMap.get(p.id);
      if (translatedText && !translatedText.includes('번역 실패') && !translatedText.includes('API 오류')) {
        if (!p.dataset.lanovelOriginalHtml) {
          p.dataset.lanovelOriginalHtml = p.innerHTML;
          p.dataset.lanovelOriginalStyle = p.getAttribute('style') || '';
        }
        p.innerHTML = translatedText;
        p.classList.add('lanovel-applied-text');
        const appliedStyle = { color: '#E2E8F0', fontFamily: 'TwoCon' };
        Object.assign(p.style, appliedStyle);
        replacementCount++;
      }
    }
  });

  if (logNotification && replacementCount > 0) {
    logToSidebar(`페이지에 번역 ${replacementCount}개를 적용했습니다.`);
  }
  updateApplyButtonUI(true, paragraphs.length);
  setupParagraphInteraction();
}

export function restoreOriginalPage(): void {
  const paragraphs = getTargetParagraphs();
  let restoredCount = 0;

  paragraphs.forEach((p) => {
    if (p.dataset.lanovelOriginalHtml) {
      p.innerHTML = p.dataset.lanovelOriginalHtml;
      if (p.dataset.lanovelOriginalStyle) {
        p.setAttribute('style', p.dataset.lanovelOriginalStyle);
      } else {
        p.removeAttribute('style');
      }
      p.classList.remove('lanovel-applied-text');
      restoredCount++;
    }
  });

  logToSidebar(`본문을 원문으로 복원했습니다 (${restoredCount}개 문단).`);
  updateApplyButtonUI(false, paragraphs.length);
  setupParagraphInteraction();
}

export async function setPageApplyStatus(applied: boolean, syncStorageAndServer = true): Promise<void> {
  state.isPageApplied = applied;

  if (state.isPageApplied) {
    const allTranslations = Array.from(state.translationCache.values());
    applyTranslationsToPage(allTranslations, true);
  } else {
    restoreOriginalPage();
  }

  const paragraphs = getTargetParagraphs();
  updateApplyButtonUI(state.isPageApplied, paragraphs.length);

  if (syncStorageAndServer) {
    const cleanUrl = getCleanUrl();
    const currentUrl = window.location.href;

    try {
      await fetch('http://127.0.0.1:8001/api/urls/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, apply: state.isPageApplied }),
      });
    } catch (e) {
      console.warn('[setPageApplyStatus] Failed to sync apply status to server:', e);
    }

    try {
      const statusObj = { applied: state.isPageApplied, timestamp: Date.now() };
      await chrome.storage.local.set({
        ['status-' + cleanUrl]: statusObj,
        ['status-' + currentUrl]: statusObj,
      });
    } catch (e) {
      console.warn('[setPageApplyStatus] Failed to sync apply status to chrome storage:', e);
    }
  }
}

export function togglePageApplyStatus(): void {
  setPageApplyStatus(!state.isPageApplied, true);
}

export function setupParagraphInteraction(): void {
  const paragraphs = getTargetParagraphs();
  paragraphs.forEach((p) => {
    if (p.dataset.lanovelLinked) return;
    p.dataset.lanovelLinked = 'true';

    p.addEventListener('click', () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${p.id}"]`);
      if (row) {
        showSidebar();
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('lanovel-row-highlight');
        void row.offsetWidth;
        row.classList.add('lanovel-row-highlight');
        setTimeout(() => {
          row.classList.remove('lanovel-row-highlight');
        }, 1600);
      }
    });
  });
}

export async function saveAllTranslations(itemsToSave: any[]): Promise<void> {
  const validItems = itemsToSave.filter((item) => item.translated && item.translated.trim());
  if (validItems.length === 0) return;

  const url = getCleanUrl();
  const scraper = getScraper();
  const title = scraper.extractEpisodeTitle() || document.title;
  const records = validItems.map((item) => ({
    url: url,
    pid: item.id || item.pid,
    original: item.original,
    translated: item.translated,
    timestamp: Math.floor(Date.now() / 1000),
    folderName: null,
    title: title,
  }));

  try {
    const response = await fetch('http://127.0.0.1:8001/translations/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records),
    });
    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }
    logToSidebar(`${records.length}개의 번역을 서버에 저장했습니다.`);
  } catch (error: any) {
    console.error('Error saving all translations to server:', error);
    logToSidebar(`서버에 일괄 저장 실패: ${error.message}`, 'log-error');
  }
}

export async function checkAndExcludeSeparatorTranslations(translationsList: any[]): Promise<void> {
  if (!translationsList || !Array.isArray(translationsList) || translationsList.length === 0) return;
  if (!state.activeSeparators || state.activeSeparators.length === 0) return;

  const allParagraphs = getTargetParagraphs();
  const validParagraphs: ParagraphItem[] = [];
  allParagraphs.forEach((p) => {
    if (!p || p.id === 'tagCount' || /^(la|lp)\d+$/i.test(p.id)) return;
    const text = p.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
    if (text) {
      validParagraphs.push({ element: p, text: text, pid: p.id });
    }
  });

  const sepAnalysis = analyzeSeparatorSections(validParagraphs, state.activeSeparators);
  const targetsToExclude: any[] = [];
  const targetIds: string[] = [];

  translationsList.forEach((t) => {
    if (!t || !t.id) return;
    if (state.exclusionSet.has(t.original)) return;

    let isExcluded = false;
    if (t.pid && (sepAnalysis.prefacePids.has(t.pid) || sepAnalysis.afterwordPids.has(t.pid) || sepAnalysis.separatorPids.has(t.pid))) {
      isExcluded = true;
    } else if (t.original && checkSeparatorMatch(t.original.trim(), state.activeSeparators)) {
      isExcluded = true;
    }

    if (isExcluded && t.translated && t.translated.trim()) {
      targetsToExclude.push(t);
      targetIds.push(t.id);
    }
  });

  if (targetsToExclude.length === 0) return;

  try {
    const response = await fetch('http://127.0.0.1:8001/translations/exclude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: targetIds }),
    });

    if (response.ok) {
      targetsToExclude.forEach((item) => {
        if (item.pid) {
          state.userDeletedTranslationPids.add(String(item.pid));
          state.translationCache.delete(item.pid);
          const row = document.querySelector(`tr[data-pid="${item.pid}"]`);
          if (row) row.remove();
        }
        if (item.original) {
          state.exclusionSet.add(item.original);
        }
      });
      logToSidebar(`[구분선/후기 감지] ${targetsToExclude.length}개 단락을 번역에서 자동 제외했습니다.`);
    }
  } catch (e) {
    console.warn('[checkAndExcludeSeparatorTranslations] Server call failed:', e);
  }
}

export async function checkAndLoadReviewTargets(): Promise<void> {
  try {
    const cleanUrl = getCleanUrl();
    let batchId: string | null = null;
    if (window.location.hash.includes('lanovel_review=')) {
      state.isReviewSession = true;
      const hashMatch = window.location.hash.match(/lanovel_review=([^&]+)/);
      if (hashMatch) {
        batchId = decodeURIComponent(hashMatch[1]);
      }
    } else if (window.location.hash.includes('lanovel_review')) {
      state.isReviewSession = true;
    }

    let apiUrl = `http://127.0.0.1:8001/cleanup/review_targets?url=${encodeURIComponent(cleanUrl)}`;
    if (batchId) {
      apiUrl += `&batch_id=${encodeURIComponent(batchId)}`;
    }

    const res = await fetch(apiUrl);
    if (!res.ok) return;
    const data = await res.json();

    if (data.has_targets && Array.isArray(data.targets) && data.targets.length > 0) {
      state.isReviewSession = true;
      state.reviewTargetsData = data;
      state.reviewTargetPids = new Set(data.targets.map((t: any) => t.pid).filter(Boolean));

      if (window.location.hash.includes('lanovel_review')) {
        showSidebar();
        logToSidebar(
          `🔔 [알림 센터 연계] 재번역 검수 대상 ${data.targets.length}건이 감지되었습니다.`
        );
      }
    }
  } catch (e) {
    console.warn('[checkAndLoadReviewTargets] Failed to load review targets:', e);
  }
}

export async function translateAllPTags(isRetranslation = false): Promise<void> {
  if (state.turboAbortedOnLoad) {
    console.log('[translateAllPTags] 쾌속모드 정각 도달로 번역이 차단되었습니다.');
    return;
  }
  state.isTranslationCancelled = false;
  state.notifyInflightStart();

  const stopBtn = document.getElementById('stop-translation-btn');
  if (stopBtn) stopBtn.style.display = 'inline-block';
  const retryBtn = document.getElementById('retry-translation-btn');
  if (retryBtn) retryBtn.style.display = 'none';

  try {
    if (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
      await abortTurboMode('초기화 시간 도달');
      return;
    }

    if (!isRetranslation) {
      await ensureTranslationsLoaded();
    }

    const allParagraphs = getTargetParagraphs();
    const validParagraphs: ParagraphItem[] = [];
    allParagraphs.forEach((p) => {
      if (!p || p.id === 'tagCount' || /^(la|lp)\d+$/i.test(p.id)) return;
      const text = p.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
      if (text) {
        validParagraphs.push({ element: p, text: text, pid: p.id });
      }
    });

    const sepAnalysis = analyzeSeparatorSections(validParagraphs, state.activeSeparators);
    const textsToTranslate: Array<{ id: string; text: string }> = [];
    const instantPunctuationItems: Array<{ id: string; original: string; translated: string }> = [];

    validParagraphs.forEach((item) => {
      if (sepAnalysis.prefacePids.has(item.pid)) return;
      if (sepAnalysis.afterwordPids.has(item.pid)) return;
      if (sepAnalysis.separatorPids.has(item.pid)) return;

      const cached = state.translationCache.get(item.pid);
      if (cached && cached.translated && cached.translated.trim()) {
        return;
      }

      const cleanedText = item.text.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
      if (state.exclusionSet.has(cleanedText)) return;

      if (cleanedText && isTranslatableText(cleanedText)) {
        if (isPurePunctuationOnly(cleanedText)) {
          instantPunctuationItems.push({ id: item.pid, original: cleanedText, translated: cleanedText });
        } else {
          textsToTranslate.push({ id: item.pid, text: cleanedText });
        }
      }
    });

    // ⚡ 순수 문장부호/기호 문장 즉시 대입 (Fast-Path)
    if (instantPunctuationItems.length > 0) {
      instantPunctuationItems.forEach((item) => {
        state.userDeletedTranslationPids.delete(String(item.id));
        state.translationCache.set(item.id, { pid: item.id, original: item.original, translated: item.translated });
        addEntryToSidebar({ pid: item.id, original: item.original, translated: item.translated });
      });
      updateSidebarWithTranslations(instantPunctuationItems);
      sortSidebar(allParagraphs.map((p) => p.id));
      if (state.isPageApplied) {
        applyTranslationsToPage(instantPunctuationItems, false);
      }
      await saveAllTranslations(instantPunctuationItems);
      logToSidebar(`[즉시 대입] 문자 없는 문장부호 문장 ${instantPunctuationItems.length}개를 즉시 적용했습니다.`);
    }

    if (textsToTranslate.length === 0) {
      if (instantPunctuationItems.length > 0) {
        logToSidebar('모든 번역 작업이 완료되었습니다. (순수 문장부호 즉시 대입 완료)');
      } else {
        logToSidebar('번역할 새로운 내용이 없습니다.');
      }
      if (stopBtn) stopBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'inline-block';
      return;
    }

    const chunks = createBudgetChunks(textsToTranslate, CHUNK_BUDGET_CHARACTERS, CHUNK_BUDGET_MAX_ITEMS);
    const totalChars = textsToTranslate.reduce((sum, item) => sum + (item.text ? item.text.length : 0), 0);
    logToSidebar(
      `[소설: ${state.currentNovelTitle || '기본'}] 총 ${textsToTranslate.length}개 문장(약 ${totalChars.toLocaleString()}자)을 ${chunks.length}개 묶음으로 번역 시작합니다.`
    );

    addPlaceholderRows(textsToTranslate);

    // 묶음 번역 헬퍼
    async function translateChunk(items: Array<{ id: string; text: string }>, chunkSize: number): Promise<void> {
      if (state.isTranslationCancelled) return;
      const MAX_MESSAGE_RETRIES = 5;

      for (let attempt = 0; attempt < MAX_MESSAGE_RETRIES; attempt++) {
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'batchTranslate',
            items: items,
            isRetranslation: isRetranslation,
          });

          if (state.isTranslationCancelled) return;

          if (chrome.runtime.lastError) {
            throw new Error(chrome.runtime.lastError.message);
          }

          if (response && response.error) {
            if (response.error.includes('초기화 시간') || response.error.includes('자동 번역을 중지')) {
              await abortTurboMode('초기화 시간 도달');
              return;
            }
            throw new Error(response.error);
          }

          if (response && response.notification) {
            logToSidebar(response.notification, 'log-error');
            if (response.stop) {
              if (response.isQuotaResetStop || response.isServerOffline) {
                await abortTurboMode(response.isServerOffline ? '서버 오프라인' : '초기화 시간 도달');
                return;
              }
              if (stopBtn) stopBtn.style.display = 'none';
              const resumeBtn = document.getElementById('resume-translation-btn');
              if (resumeBtn) resumeBtn.style.display = 'inline-block';
              logToSidebar('번역이 일시 중지되었습니다. 재개 버튼(▶️)을 눌러주세요.');

              await new Promise((resolve) => {
                state.resolveResume = resolve as () => void;
              });
              return await translateChunk(items, chunkSize);
            }
            return;
          }

          if (response && response.translations) {
            const verbatimItems = response.translations.filter(
              (t: any) => Boolean(t.verbatim) || (t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated))
            );
            const verbatimIdSet = new Set(verbatimItems.map((v: any) => String(v.id)));

            const successes = response.translations.filter(
              (t: any) => !verbatimIdSet.has(String(t.id)) && t.translated !== null && !t.translated.includes('번역 실패')
            );
            const failures = response.translations.filter(
              (t: any) => !verbatimIdSet.has(String(t.id)) && (t.translated === null || t.translated.includes('번역 실패'))
            );

            if (successes.length > 0) {
              updateSidebarWithTranslations(successes);
              successes.forEach((s: any) => {
                state.translationCache.set(s.id, { pid: s.id, original: s.original, translated: s.translated });
              });
              if (state.isPageApplied) {
                applyTranslationsToPage(successes, false);
              }
              await saveAllTranslations(successes);
            }

            if (failures.length > 0) {
              const failedOriginalItems = items.filter((originalItem) =>
                failures.some((failedItem: any) => failedItem.id === originalItem.id)
              );
              logToSidebar(`${failedOriginalItems.length}개 항목 번역 실패. 더 작은 단위로 재시도합니다.`, 'log-error');
              await handleFailure(failedOriginalItems, chunkSize);
            }
            return;
          } else {
            throw new Error('Malformed response from background script');
          }
        } catch (error: any) {
          if (error.message && (error.message.includes('초기화 시간') || error.message.includes('자동 번역을 중지'))) {
            await abortTurboMode('초기화 시간 도달');
            return;
          }
          if (attempt < MAX_MESSAGE_RETRIES - 1) {
            const delay = (40 + Math.pow(2, attempt)) * 1000 + Math.floor(Math.random() * 1000);
            logToSidebar(`통신 오류. ${Math.round(delay / 1000)}초 후 재시도... (${attempt + 1}/${MAX_MESSAGE_RETRIES})`, 'log-error');
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            logToSidebar(`${items.length}개 항목 통신 최종 실패. 단위를 줄여 재시도합니다.`, 'log-error');
            await handleFailure(items, chunkSize);
          }
        }
      }
    }

    async function handleFailure(failedItems: Array<{ id: string; text: string }>, currentChunkSize: number): Promise<void> {
      if (state.isTranslationCancelled) return;
      if (currentChunkSize > 1 && failedItems.length > 1) {
        const newChunkSize = Math.ceil(currentChunkSize / 2);
        logToSidebar(`묶음 단위를 ${newChunkSize}으로 줄여 재시도합니다.`);
        const subChunks = chunkArray(failedItems, newChunkSize);
        for (const [index, subChunk] of subChunks.entries()) {
          if (state.isTranslationCancelled) break;
          await translateChunk(subChunk, newChunkSize);
          if (index < subChunks.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }
      } else if (failedItems.length > 0) {
        for (const item of failedItems) {
          if (state.isTranslationCancelled) break;
          const sentences = item.text.split('。').filter((s) => s.trim().length > 0);
          if (sentences.length > 1) {
            logToSidebar(`문장 분할 재시도... (ID: ${item.id})`, 'info');
            const subItems = sentences.map((sentence, idx) => ({
              id: `${item.id}-part${idx}`,
              text: sentence + '。',
            }));
            try {
              const res = await chrome.runtime.sendMessage({
                action: 'batchTranslate',
                items: subItems,
                isRetranslation: true,
              });
              if (res && res.translations) {
                const combined = res.translations.map((t: any) => t.translated || '').join(' ');
                const finalResult = { id: item.id, original: item.text, translated: combined };
                updateSidebarWithTranslations([finalResult]);
                await saveAllTranslations([finalResult]);
              }
            } catch (e) {
              console.error('Sentence split retry failed:', e);
            }
          }
        }
      }
    }

    // 묶음 순차 번역 루프
    const recentEpCount = await getRecentEpisodeCount(5);
    const chunkDelay = calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode);

    for (const [index, chunk] of chunks.entries()) {
      if (state.isTranslationCancelled) break;

      let currentChunk = chunk;
      const isLastChunk = index === chunks.length - 1;

      if (isLastChunk) {
        const currentChunkIdSet = new Set(chunk.map((c) => String(c.id)));
        const emptyItems = getPendingEmptyItems(textsToTranslate, currentChunkIdSet);
        if (emptyItems.length > 0) {
          logToSidebar(`[마지막 꾸러미 포함] 미완료 문장 ${emptyItems.length}개를 마지막 꾸러미에 통합합니다.`);
          currentChunk = [...chunk, ...emptyItems];
        }
      }

      await translateChunk(currentChunk, currentChunk.length);

      if (index < chunks.length - 1 && !state.isTranslationCancelled) {
        await sleepResponsive(() => calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode));
      }
    }

    logToSidebar('모든 번역 작업이 완료되었습니다.');

    // 번역 완료 후 다음 화 자동 이동 및 알림 처리
    if (!state.isTranslationCancelled && !state.isReviewSession) {
      const currentUrl = getCleanUrl();
      const batchStats = await updateAndGetBatchCount(currentUrl);
      const consecutiveCount = batchStats.consecutiveCount;

      if (consecutiveCount > 0 && consecutiveCount % 10 === 0) {
        sendProgressNotification(
          state.currentNovelTitle,
          getScraper().extractEpisodeTitle() || document.title,
          textsToTranslate.length,
          textsToTranslate.length,
          100,
          currentUrl,
          consecutiveCount
        );
      }

      await recordRecentEpisode(currentUrl);
      const completedRecentCount = await getRecentEpisodeCount(5);

      const targetDelay = calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode);
      const delaySec = Math.round(targetDelay / 1000);
      logToSidebar(`번역 완료. ${delaySec}초 후 다음 페이지로 이동합니다.`);

      await sleepResponsive(() => calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode));
      if (state.isTranslationCancelled) return;

      const scraper = getScraper();
      const nextLink = scraper.findNextEpisodeLink();
      if (nextLink && nextLink.href) {
        sessionStorage.setItem('lanovel_auto_translate_next', '1');
        showLanovelHud('다음 화로 자동 이동...', '⚡');
        setTimeout(() => {
          window.location.href = nextLink.href;
        }, 1500);
      } else {
        logToSidebar('다음 페이지 링크를 찾을 수 없습니다. (마지막 회차)');
        sendCompleteNotification(
          state.currentNovelTitle,
          scraper.extractEpisodeTitle() || document.title,
          textsToTranslate.length,
          currentUrl,
          consecutiveCount
        );
      }
    }
  } finally {
    state.notifyInflightEnd();
    if (stopBtn) stopBtn.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
}
