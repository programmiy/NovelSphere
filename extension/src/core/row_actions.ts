// row_actions.ts: 사이드바 개별 행 저장(saveSingleTranslation) 및 단일 문장 즉시 재번역(retranslateSingleRow) 모듈
import { state } from './state';
import { checkIsVerbatimOrParaphrased } from './filters';
import { getCleanUrl } from './page_translator';
import { getScraper } from '../scrapers';
import { logToSidebar, updateApplyButtonUI } from '../ui/sidebar';
import { updateReviewCardTranslation } from '../ui/review_panel';

/**
 * 단일 행 번역을 캐시, 본문 DOM, 검수 카드 및 서버에 즉시 저장합니다.
 */
export async function saveSingleTranslation(
  pid: string,
  originalText: string,
  newTranslatedText: string
): Promise<void> {
  const url = getCleanUrl();
  const scraper = getScraper();
  const title = scraper.extractEpisodeTitle() || document.title;
  const record = {
    url: url,
    pid: pid,
    original: originalText,
    translated: newTranslatedText,
    timestamp: Math.floor(Date.now() / 1000),
    folderName: null,
    title: title,
  };

  if (!newTranslatedText || !newTranslatedText.trim()) {
    state.userDeletedTranslationPids.add(String(pid));
    state.translationCache.delete(pid);
    if (state.isPageApplied) {
      const pTag = document.getElementById(pid);
      if (pTag && pTag.dataset.lanovelOriginalHtml) {
        pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
        pTag.classList.remove('lanovel-applied-text');
        pTag.removeAttribute('style');
        if (pTag.dataset.lanovelOriginalStyle) {
          pTag.setAttribute('style', pTag.dataset.lanovelOriginalStyle);
        }
      }
    }
  } else {
    state.userDeletedTranslationPids.delete(String(pid));
    state.translationCache.set(pid, {
      pid: pid,
      original: originalText,
      translated: newTranslatedText,
    });
    if (state.isPageApplied) {
      const pTag = document.getElementById(pid);
      if (pTag) {
        if (!pTag.dataset.lanovelOriginalHtml) {
          pTag.dataset.lanovelOriginalHtml = pTag.innerHTML;
          pTag.dataset.lanovelOriginalStyle = pTag.getAttribute('style') || '';
        }
        pTag.innerHTML = newTranslatedText;
        pTag.classList.add('lanovel-applied-text');
        Object.assign(pTag.style, { color: '#E2E8F0', fontFamily: 'TwoCon' });
      }
    }
  }
  updateApplyButtonUI(state.isPageApplied);

  if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
    if (newTranslatedText && newTranslatedText.trim()) {
      updateReviewCardTranslation(pid, `번역: ${newTranslatedText}`, false);
    } else {
      updateReviewCardTranslation(pid, '⏳ 번역 대기 또는 재번역 진행 중...', true);
    }
  }

  try {
    const response = await fetch('http://127.0.0.1:8001/translations/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([record]),
    });
    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }
    logToSidebar(`번역(ID: ${pid})을 서버에 저장했습니다.`);
  } catch (error: any) {
    console.error(`Error saving single translation for ${pid} to server:`, error);
    logToSidebar(`서버에 저장 실패 (ID: ${pid}): ${error.message}`, 'log-error');
  }
}

/**
 * 사이드바 특정 행(단일 문장)만 즉시 재번역합니다.
 */
export async function retranslateSingleRow(pid: string, originalText: string): Promise<void> {
  if (!pid || !originalText) return;

  const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
  const translatedCell = row ? row.querySelector<HTMLElement>('.translated-text') : null;
  const retranslateBtn = row ? row.querySelector<HTMLButtonElement>('.retranslate-row-btn') : null;
  const saveBtn = row ? row.querySelector<HTMLButtonElement>('.save-btn') : null;

  if (retranslateBtn) retranslateBtn.disabled = true;
  if (saveBtn) saveBtn.disabled = true;
  if (translatedCell) {
    translatedCell.textContent = '⏳ 재번역 중...';
    translatedCell.style.color = '#64748b';
  }

  const cleanedText = originalText.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
  logToSidebar(`단일 문장 재번역 요청 중... (ID: ${pid})`);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'batchTranslate',
      items: [{ id: pid, text: cleanedText }],
      isRetranslation: true,
    });

    if (chrome.runtime.lastError) {
      throw new Error(chrome.runtime.lastError.message);
    }

    if (response && response.error) {
      throw new Error(response.error);
    }

    if (response && response.notification) {
      logToSidebar(response.notification, 'log-error');
      if (translatedCell) {
        const cached = state.translationCache.get(pid);
        translatedCell.textContent = cached ? cached.translated : '⚠️ 재번역 일시 중단됨';
        translatedCell.style.color = '';
      }
      return;
    }

    if (response && response.translations && response.translations.length > 0) {
      const result = response.translations[0];
      const newTranslation = result.translated;
      const isVerbatim =
        Boolean(result.verbatim) ||
        (newTranslation && checkIsVerbatimOrParaphrased(originalText, newTranslation));

      if (isVerbatim) {
        logToSidebar(
          `⚠️ [원문 복제·변형 감지] 단일 재번역 문장(ID: ${pid})이 원문과 동일/변형되어 자동 삭제 및 휴지통으로 이전되었습니다.`,
          'log-error'
        );
        state.translationCache.delete(pid);
        if (translatedCell) {
          translatedCell.textContent = '';
          translatedCell.style.color = '';
          translatedCell.setAttribute('contenteditable', 'true');
        }
        if (saveBtn) saveBtn.disabled = false;
        if (state.isPageApplied) {
          const pTag = document.getElementById(pid);
          if (pTag && pTag.dataset.lanovelOriginalHtml) {
            pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
            pTag.classList.remove('lanovel-applied-text');
            pTag.removeAttribute('style');
            if (pTag.dataset.lanovelOriginalStyle) {
              pTag.setAttribute('style', pTag.dataset.lanovelOriginalStyle);
            }
          }
        }
        updateApplyButtonUI(state.isPageApplied);
        if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
          updateReviewCardTranslation(pid, '번역: (원문 복제·변형 감지되어 자동 삭제됨)', true);
        }
        await saveSingleTranslation(pid, originalText, '');
      } else if (newTranslation && !newTranslation.includes('번역 실패')) {
        if (translatedCell) {
          translatedCell.textContent = newTranslation;
          translatedCell.style.color = '';
          translatedCell.setAttribute('contenteditable', 'true');
        }
        state.userDeletedTranslationPids.delete(String(pid));
        state.translationCache.set(pid, {
          pid: pid,
          original: originalText,
          translated: newTranslation,
        });
        if (state.isPageApplied) {
          const pTag = document.getElementById(pid);
          if (pTag) {
            if (!pTag.dataset.lanovelOriginalHtml) {
              pTag.dataset.lanovelOriginalHtml = pTag.innerHTML;
              pTag.dataset.lanovelOriginalStyle = pTag.getAttribute('style') || '';
            }
            pTag.innerHTML = newTranslation;
            pTag.classList.add('lanovel-applied-text');
            Object.assign(pTag.style, { color: '#E2E8F0', fontFamily: 'TwoCon' });
          }
        }
        updateApplyButtonUI(state.isPageApplied);
        if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
          updateReviewCardTranslation(pid, `번역: ${newTranslation}`, false);
        }
        await saveSingleTranslation(pid, originalText, newTranslation);
        logToSidebar(`단일 문장 재번역 완료 (ID: ${pid})`);
      } else {
        throw new Error(newTranslation || '번역 실패');
      }
    } else {
      throw new Error('번역 결과를 받지 못했습니다.');
    }
  } catch (err: any) {
    console.error(`[retranslateSingleRow] Error for ${pid}:`, err);
    logToSidebar(`단일 재번역 실패 (ID: ${pid}): ${err.message}`, 'log-error');
    if (translatedCell) {
      const cached = state.translationCache.get(pid);
      translatedCell.textContent = cached ? cached.translated : `❌ 재번역 실패: ${err.message}`;
      translatedCell.style.color = cached ? '' : '#ef4444';
    }
  } finally {
    if (retranslateBtn) retranslateBtn.disabled = false;
  }
}
