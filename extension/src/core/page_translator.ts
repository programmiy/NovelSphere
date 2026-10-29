import { serverFetch } from './api_client';
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
  sortSidebarDescending,
  updateEmptyState,
  populateSidebar,
  updateApplyButtonUI,
  updateTurboModeUI,
  updateTurboBadgeUI,
  showSidebar,
} from '../ui/sidebar';
import {
  showLanovelHud,
  showLanovelProgressHud,
  startLanovelCountdownHud,
  hideLanovelHud,
} from '../ui/hud';
import { updateReviewCardTranslation } from '../ui/review_panel';
import { getScraper } from '../scrapers';
import { onNothingToTranslate, reportNovelFinished, onAbortTurbo } from './queue_session';
import {
  getCleanUrl,
  getTargetParagraphs,
  applyTranslationsToPage,
  restoreOriginalPage,
  setPageApplyStatus,
  togglePageApplyStatus,
  setupParagraphInteraction,
  jumpToParagraph,
} from './dom_applier';

export {
  getCleanUrl,
  getTargetParagraphs,
  applyTranslationsToPage,
  restoreOriginalPage,
  setPageApplyStatus,
  togglePageApplyStatus,
  setupParagraphInteraction,
  jumpToParagraph,
};

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
  const wasTurbo = state.isTurboMode;   // 신데렐라 새로고침 후 쾌속모드 복원용
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
  hideLanovelHud(true);
  showLanovelHud(`쾌속모드 자동 중단 (${reason})`, '⏰', 3500);
  void onAbortTurbo(reason, wasTurbo);   // 목록 작업 + 신데렐라 ON이면 새로고침으로 이어가기
  state.broadcastStatus();
}

export async function fetchTranslationsForUrl(url: string): Promise<TranslationRecord[] | null> {
  try {
    const fetchUrl = `http://127.0.0.1:8001/translations?url=${encodeURIComponent(url)}&limit=5000`;
    const response = await serverFetch(fetchUrl);
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
    const response = await serverFetch(fetchUrl);
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
    const response = await serverFetch('http://127.0.0.1:8001/translations/upsert', {
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

/**
 * 전체 재번역(🔄 버튼 또는 원격 재번역 명령) 실행 시 기존 캐시와 테이블을 초기화하고 고성능 모델로 재번역을 시작합니다.
 */
export function startFullRetranslation(): void {
  logToSidebar('번역을 처음부터 다시 시작합니다.');
  const tableBody = document.getElementById('translation-table-body');
  if (tableBody) tableBody.innerHTML = '';
  state.translationCache.clear();
  state.userDeletedTranslationPids.clear();
  state.translationsLoadedPromise = null;
  state.hasScannedForPTags = false;
  translateAllPTags(true);
  showSidebar();
}

let isTranslatingInProgress = false;

export async function translateAllPTags(isRetranslation = false): Promise<void> {
  if (isTranslatingInProgress) {
    console.log('[translateAllPTags] 이미 번역 작업이 진행 중이므로 중복 실행을 차단합니다.');
    return;
  }
  if (state.turboAbortedOnLoad) {
    console.log('[translateAllPTags] 쾌속모드 정각 도달로 번역이 차단되었습니다.');
    return;
  }
  isTranslatingInProgress = true;
  state.hasScannedForPTags = true;
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

    const prepScraper = getScraper();
    if (prepScraper.prepareContent) {
      prepScraper.prepareContent();
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
    if (sepAnalysis.topSeparator) {
      logToSidebar(
        `[상단 구분선 감지] '${sepAnalysis.topSeparator.sep}' 이전 잡글 ${sepAnalysis.prefacePids.size}개 문단(구분선 포함)을 번역에서 자동 제외합니다.`
      );
    }
    if (sepAnalysis.bottomSeparator) {
      logToSidebar(
        `[하단 구분선 감지] '${sepAnalysis.bottomSeparator.sep}' 이후 후기 ${sepAnalysis.afterwordPids.size}개 문단(구분선 포함)을 번역에서 자동 제외합니다.`
      );
    }

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
      // sortSidebar deferred until completion
      if (state.isPageApplied) {
        applyTranslationsToPage(instantPunctuationItems, false);
      }
      await saveAllTranslations(instantPunctuationItems);
      logToSidebar(`[즉시 대입] 문자 없는 문장부호 문장 ${instantPunctuationItems.length}개를 즉시 적용했습니다.`);
    }

    if (textsToTranslate.length === 0) {
      if (instantPunctuationItems.length > 0) {
        sortSidebar(allParagraphs.map((p) => p.id));
        logToSidebar('모든 번역 작업이 완료되었습니다. (순수 문장부호 즉시 대입 완료)');
        showLanovelHud(`기호/문장부호 ${instantPunctuationItems.length}문장 즉시 적용 완료`, '⚡', 2500);
        onNothingToTranslate(validParagraphs.length);
      } else {
        sortSidebar(allParagraphs.map((p) => p.id));
        logToSidebar('번역할 새로운 내용이 없습니다.');
        showLanovelHud('번역할 새로운 문장이 없습니다 (이미 번역 완료됨)', '✅', 2500);
        onNothingToTranslate(validParagraphs.length);
      }
      if (stopBtn) stopBtn.style.display = 'none';
      if (retryBtn) retryBtn.style.display = 'inline-block';
      return;
    }

    const sepCount = state.activeSeparators ? state.activeSeparators.length : 0;
    const sepPreview = sepCount > 0 ? state.activeSeparators.slice(0, 3).join(', ') + (sepCount > 3 ? ` 외 ${sepCount - 3}개` : '') : '없음';
    const modelDesc = isRetranslation ? '고성능 모델(Gemini 3.0 Flash)' : '기본 엔진';
    const turboDesc = state.isTurboMode ? ' ⚡쾌속모드' : '';
    const chunks = createBudgetChunks(textsToTranslate, CHUNK_BUDGET_CHARACTERS, CHUNK_BUDGET_MAX_ITEMS);
    const totalChars = textsToTranslate.reduce((sum, item) => sum + (item.text ? item.text.length : 0), 0);
    logToSidebar(
      `[소설: ${state.currentNovelTitle || '기본'}] 총 ${textsToTranslate.length}개 문장(약 ${totalChars.toLocaleString()}자) 글자 수·토큰 예산 기반 ${chunks.length}개 최적 묶음으로 번역을 시작합니다. (${modelDesc}${turboDesc}, 구분선: ${sepPreview})`
    );

    showLanovelProgressHud({
      title: state.isTurboMode ? '번역 시작 (⚡쾌속)' : '번역 시작',
      current: 0,
      total: textsToTranslate.length,
      chunkIndex: 0,
      chunkTotal: chunks.length,
      icon: '⚡',
      subtext: `총 ${textsToTranslate.length}문장 (${chunks.length}개 묶음, 약 ${totalChars.toLocaleString()}자)`,
    });

    addPlaceholderRows(textsToTranslate);
    sortSidebarDescending(allParagraphs.map((p) => p.id));

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
              items.forEach((item) => {
                const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
                if (row) {
                  const cell = row.querySelector('.translated-text');
                  if (cell && cell.textContent?.includes('번역 중')) {
                    cell.textContent = '';
                  }
                }
              });
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
            const censoredItems = response.translations.filter(
              (t: any) => t.censored || (t.translated && t.translated.includes('[검열로 인해 번역 생략]'))
            );
            if (censoredItems.length > 0) {
              censoredItems.forEach((item: any) => {
                const preview = item.original ? (item.original.length > 25 ? item.original.slice(0, 25) + '...' : item.original) : '';
                logToSidebar(`⚠️ [검열 감지] 문장(ID: ${item.id}) 번역이 검열로 인해 생략되었습니다. (원문: ${preview})`, 'log-error');
              });
            }

            const verbatimItems = response.translations.filter(
              (t: any) => Boolean(t.verbatim) || (t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated))
            );
            if (verbatimItems.length > 0) {
              verbatimItems.forEach((item: any) => {
                const preview = item.original ? (item.original.length > 25 ? item.original.slice(0, 25) + '...' : item.original) : '';
                logToSidebar(
                  `⚠️ [원문 복제·변형 감지] 문장(ID: ${item.id})이 원문과 동일/변형되어 자동 삭제 및 휴지통으로 이전되었습니다. (원문: ${preview})`,
                  'log-error'
                );
                state.translationCache.delete(item.id);
                if (state.isPageApplied) {
                  const pTag = document.getElementById(item.id);
                  if (pTag && pTag.dataset.lanovelOriginalHtml) {
                    pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
                    pTag.classList.remove('lanovel-applied-text');
                    pTag.removeAttribute('style');
                    if (pTag.dataset.lanovelOriginalStyle) {
                      pTag.setAttribute('style', pTag.dataset.lanovelOriginalStyle);
                    }
                  }
                }
                const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
                if (row) {
                  const cell = row.querySelector('.translated-text');
                  if (cell) {
                    cell.textContent = '';
                    cell.setAttribute('contenteditable', 'true');
                  }
                  const saveBtnEl = row.querySelector<HTMLButtonElement>('.save-btn');
                  if (saveBtnEl) saveBtnEl.disabled = false;
                  const retransBtnEl = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
                  if (retransBtnEl) retransBtnEl.disabled = false;
                }
                if (state.reviewTargetPids && state.reviewTargetPids.has(item.id)) {
                  updateReviewCardTranslation(item.id, '번역: (원문 복제·변형 감지되어 자동 삭제됨)', true);
                }
              });
              updateApplyButtonUI(state.isPageApplied);
            }
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

    logToSidebar(
      state.isTurboMode
        ? recentEpCount >= 4
          ? `⚡ [쾌속모드] 최근 번역 회차(${recentEpCount}화) 과열 방지: 묶음 간 대기 시간을 ${(chunkDelay / 1000).toFixed(1)}초로 완충합니다.`
          : `⚡ [쾌속모드] 번역 묶음 간 대기 시간을 ${(chunkDelay / 1000).toFixed(1)}초로 설정합니다.`
        : `RPM 제한을 피하기 위해 묶음 간 대기 시간을 ${(chunkDelay / 1000).toFixed(1)}초로 설정합니다.`
    );

    let progress = 0;
    for (const [index, chunk] of chunks.entries()) {
      if (state.isTranslationCancelled) break;

      let currentChunk = chunk;
      const isLastChunk = index === chunks.length - 1;

      // [번역 완료 한스텝전: 이전 꾸러미 빈칸 번역 통합]
      if (isLastChunk) {
        const currentChunkIdSet = new Set(chunk.map((c) => String(c.id)));
        const emptyItems = getPendingEmptyItems(
          textsToTranslate,
          currentChunkIdSet,
          state.translationCache,
          state.userDeletedTranslationPids,
          state.exclusionSet,
          state.activeSeparators
        );
        if (emptyItems.length > 0) {
          logToSidebar(
            `[마지막 꾸러미 포함] 번역 완료 한스텝전, 이전 번역 중 빈칸(미완료) 문장 ${emptyItems.length}개를 마지막 번역꾸러미에 포함하여 함께 번역합니다.`
          );
          emptyItems.forEach((item) => {
            const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
            if (row) {
              const cell = row.querySelector('.translated-text');
              if (cell) {
                cell.textContent = '⏳ 번역 중...';
                (cell as HTMLElement).style.color = '';
              }
            }
          });
          currentChunk = [...chunk, ...emptyItems];
        }
      }

      const currentChunkChars = currentChunk.reduce((sum, it) => sum + (it.text ? it.text.length : 0), 0);
      const prevProgress = progress;
      progress += chunk.length;
      logToSidebar(
        `(${progress}/${textsToTranslate.length}문장, 묶음 ${index + 1}/${chunks.length} [약 ${currentChunkChars.toLocaleString()}자]) 번역 진행 중...${
          currentChunk.length > chunk.length ? ` (빈칸 문장 ${currentChunk.length - chunk.length}개 추가 포함)` : ''
        }`
      );

      showLanovelProgressHud({
        title: state.isTurboMode ? '번역 진행 중 (⚡쾌속)' : '번역 진행 중',
        current: prevProgress,
        total: textsToTranslate.length,
        chunkIndex: index + 1,
        chunkTotal: chunks.length,
        icon: '📖',
        subtext: `묶음 ${index + 1}/${chunks.length} 요청 중 (약 ${currentChunkChars.toLocaleString()}자)`,
      });

      await translateChunk(currentChunk, currentChunk.length);

      showLanovelProgressHud({
        title: state.isTurboMode ? '번역 진행 중 (⚡쾌속)' : '번역 진행 중',
        current: Math.min(progress, textsToTranslate.length),
        total: textsToTranslate.length,
        chunkIndex: index + 1,
        chunkTotal: chunks.length,
        icon: '📖',
        subtext: `${progress}/${textsToTranslate.length}문장 번역 완료`,
      });

      if (index < chunks.length - 1 && !state.isTranslationCancelled) {
        const currentDelay = calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode);
        const chunkDelaySec = Math.round(currentDelay / 1000);
        logToSidebar(`${(currentDelay / 1000).toFixed(1)}초 후 다음 묶음을 번역합니다.`);

        let cancelChunkCountdown = null;
        if (chunkDelaySec >= 2) {
          cancelChunkCountdown = startLanovelCountdownHud({
            title: '다음 묶음 대기 중',
            totalSeconds: chunkDelaySec,
            icon: '⏳',
            subtext: `묶음 ${index + 1}/${chunks.length} 완료 (${chunkDelaySec}초 대기)`,
          });
        }
        await sleepResponsive(() => calculateAdaptiveChunkDelay(recentEpCount, state.isTurboMode));
        if (cancelChunkCountdown) cancelChunkCountdown();

        if (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
          await abortTurboMode('초기화 시간 도달');
          break;
        }
      }
    }

    // [번역 완료 직전 최종 빈칸 확인 및 보완 마지막 번역꾸러미]
    if (!state.isTranslationCancelled) {
      const remainingEmptyItems = getPendingEmptyItems(
        textsToTranslate,
        new Set(),
        state.translationCache,
        state.userDeletedTranslationPids,
        state.exclusionSet,
        state.activeSeparators
      );
      if (remainingEmptyItems.length > 0) {
        logToSidebar(
          `[보완 번역꾸러미] 번역 완료 직전, 미완료 빈칸 번역 ${remainingEmptyItems.length}개가 감지되어 마지막 번역꾸러미로 추가 번역을 진행합니다.`
        );
        showLanovelProgressHud({
          title: '보완 번역 진행 중',
          current: textsToTranslate.length,
          total: textsToTranslate.length,
          icon: '⏳',
          subtext: `미완료 빈칸 ${remainingEmptyItems.length}문장 보완 번역 중`,
        });
        remainingEmptyItems.forEach((item) => {
          const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
          if (row) {
            const cell = row.querySelector('.translated-text');
            if (cell) {
              cell.textContent = '⏳ 번역 중...';
              (cell as HTMLElement).style.color = '';
            }
          }
        });
        await translateChunk(remainingEmptyItems, remainingEmptyItems.length);
      }
    }

    // sortSidebar deferred until completion
    sortSidebar(allParagraphs.map((p) => p.id));
    logToSidebar('모든 번역 작업이 완료되었습니다.');

    // 번역 완료 후 다음 화 자동 이동 및 알림 처리
    if (!state.isTranslationCancelled) {
      if (
        state.isReviewSession ||
        window.location.hash.includes('lanovel_review') ||
        (state.reviewTargetPids && state.reviewTargetPids.size > 0)
      ) {
        logToSidebar('🔔 [알림 센터 검수 모드] 재번역 검수 회차이므로 다음 페이지 자동 넘기기가 비활성화되었습니다.');
        return;
      }

      const currentUrl = getCleanUrl();
      const scraper = getScraper();
      const episodeTitle = scraper.extractEpisodeTitle() || document.title || '';

      // [10화 단위 번역 진행 알림 (100% 완료 시에만)]
      // 30분 세션 타임아웃, 중복 방지, 이번 연속 번역 및 일일 누적 통계 조회
      const batchStats = await updateAndGetBatchCount(
        currentUrl,
        logToSidebar,
        state.currentNovelTitle,
        state.turboCutoffHour
      );
      const consecutiveCount = batchStats.consecutiveCount;
      const novelTodayCount = batchStats.novelTodayCount;
      const totalTodayCount = batchStats.totalTodayCount;

      const totalTodayMsg = totalTodayCount ? ` / 전체: ${totalTodayCount}화` : '';
      logToSidebar(
        `[번역 진행 카운터] 현재 소설 이번 연속: ${consecutiveCount}화 완료 (오늘 이 소설: ${novelTodayCount}화${totalTodayMsg})`
      );
      showLanovelHud(
        `번역 완료! (총 ${textsToTranslate.length}문장 / 이번 연속 ${consecutiveCount}화)`,
        '🎉',
        3000
      );

      // 10의 배수(10, 20, 30, ...) 화가 100% 완료되었을 때만 진행 알림 발송!
      if (consecutiveCount > 0 && consecutiveCount % 10 === 0) {
        logToSidebar(`🔔 [알림] 이번 연속 ${consecutiveCount}화 달성! 10화 단위 번역 진행 알림을 발송합니다.`);
        sendProgressNotification(
          state.currentNovelTitle,
          episodeTitle,
          textsToTranslate.length,
          textsToTranslate.length,
          100,
          currentUrl,
          consecutiveCount
        );
      } else {
        logToSidebar(
          `[알림] 10화 단위 알림 정책 적용 중 (현재 이번 연속: ${consecutiveCount}화, 다음 알림: ${Math.ceil(consecutiveCount / 10) * 10}화)`
        );
      }

      await recordRecentEpisode(currentUrl);
      const completedRecentCount = await getRecentEpisodeCount(5);

      const targetDelay = calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode);
      const delaySec = Math.round(targetDelay / 1000);

      if (state.isTurboMode) {
        if (completedRecentCount >= 3) {
          logToSidebar(
            `⚡ [RPM 적응형 보호] 최근 5분간 번역 회차: ${completedRecentCount}화 감지 (과열 방지 구간) → 다음 회차 대기 시간을 ${delaySec}초로 자동 연장합니다.`
          );
        } else {
          logToSidebar(
            `⚡ [쾌속모드] 번역 완료 (최근 5분: ${completedRecentCount}화, 안전 구간). ${delaySec}초 후 다음 페이지로 이동합니다.`
          );
        }
      } else {
        if (completedRecentCount >= 5) {
          logToSidebar(
            `[RPM 적응형 보호] 최근 5분간 번역 회차: ${completedRecentCount}화 감지 → 다음 회차 대기 시간을 ${delaySec}초로 연장합니다.`
          );
        } else {
          logToSidebar(`번역 완료. ${delaySec}초 후 페이지 끝으로 자동 스크롤합니다.`);
        }
      }

      const isRpmWarning = state.isTurboMode ? completedRecentCount >= 3 : completedRecentCount >= 5;
      const cancelEpisodeCountdown = startLanovelCountdownHud({
        title: state.isTurboMode ? '다음 화 자동 이동 대기' : '페이지 스크롤 대기',
        totalSeconds: delaySec,
        icon: isRpmWarning ? '🛡️' : '⏳',
        subtext: isRpmWarning
          ? `RPM 과열 방지 지연 (최근 5분: ${completedRecentCount}화)`
          : `최근 5분: ${completedRecentCount}화 (안전 구간)`,
      });

      await sleepResponsive(() => calculateAdaptiveEpisodeDelay(completedRecentCount, state.isTurboMode));
      cancelEpisodeCountdown();

      if (state.isTranslationCancelled) {
        hideLanovelHud();
        return;
      }

      if (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp)) {
        await abortTurboMode('초기화 시간 도달');
        return;
      }

      logToSidebar('페이지 끝으로 스크롤 후 다음 페이지 액션을 실행합니다.');
      showLanovelHud('페이지 끝으로 이동 중...', '📜', 1500);
      const scrollTarget = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      window.scrollTo({ top: scrollTarget, behavior: 'smooth' });

      await new Promise<void>((resolve) => {
        let scrollCheckAttempts = 0;
        const checkScrollEndInterval = setInterval(() => {
          if (state.isTranslationCancelled) {
            clearInterval(checkScrollEndInterval);
            resolve();
            return;
          }
          scrollCheckAttempts++;
          const currentScroll = window.innerHeight + window.scrollY;
          const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
          if (currentScroll >= maxScroll - 50 || scrollCheckAttempts >= 30) {
            clearInterval(checkScrollEndInterval);
            resolve();
          }
        }, 100);
      });

      if (state.isTranslationCancelled) return;

      const nextLink = scraper.findNextEpisodeLink();
      if (nextLink && nextLink.href) {
        const navDelay = Math.floor(Math.random() * 1000) + 1500;
        logToSidebar(`다음 페이지로 이동합니다 (${(navDelay / 1000).toFixed(1)}초 대기): ${nextLink.href}`);
        sessionStorage.setItem('lanovel_auto_translate_next', '1');
        showLanovelHud('다음 화로 자동 이동...', '⚡');
        setTimeout(() => {
          window.location.href = nextLink.href;
        }, navDelay);
      } else {
        logToSidebar('다음 페이지 버튼을 찾을 수 없습니다. (소설 연속 번역 종료)');
        reportNovelFinished('마지막 화');
        sendCompleteNotification(
          state.currentNovelTitle,
          episodeTitle,
          textsToTranslate.length,
          currentUrl,
          consecutiveCount
        );
      }
    }
  } finally {
    isTranslatingInProgress = false;
    state.notifyInflightEnd();
    if (stopBtn) stopBtn.style.display = 'none';
    if (retryBtn) retryBtn.style.display = 'inline-block';
  }
}
