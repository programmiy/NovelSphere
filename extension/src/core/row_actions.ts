import { serverFetch } from './api_client';
// row_actions.ts: 사이드바 개별 행 저장(saveSingleTranslation) 및 단일 문장 즉시 재번역(retranslateSingleRow) 모듈
import { state } from './state';
import { checkIsVerbatimOrParaphrased } from './filters';
import { getCleanUrl } from './page_translator';
import { getScraper } from '../scrapers';
import { logToSidebar, updateApplyButtonUI } from '../ui/sidebar';
import { updateReviewCardTranslation } from '../ui/review_panel';
import { showLanovelHud } from '../ui/hud';
import { getTargetParagraphs } from './dom_applier';

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
  const novelFolder = (state.currentNovelTitle && state.currentNovelTitle !== '기본 소설') ? state.currentNovelTitle : null;
  const record = {
    url: url,
    pid: pid,
    original: originalText,
    translated: newTranslatedText,
    timestamp: Math.floor(Date.now() / 1000),
    folderName: novelFolder,
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
    const response = await serverFetch('http://127.0.0.1:8001/translations/upsert', {
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


/**
 * 지정된 문단 목록(targets)을 번역 제외 처리하는 공통 엔진입니다.
 */
async function applyExclusionToParagraphs(
  targets: HTMLElement[],
  pivotPid: string,
  directionLabel: string,
  icon: string
): Promise<void> {
  if (!targets || targets.length === 0) return;
  const url = getCleanUrl();
  const allParagraphs = getTargetParagraphs();

  const targetPids: string[] = [];
  const targetOriginals: string[] = [];
  const existingTranslationIds: number[] = [];

  targets.forEach((p) => {
    const pid = p.id;
    targetPids.push(pid);

    // 1. 상태 머신 즉시 등록 (실시간 번역 차단)
    state.manualExcludedPids.add(pid);
    state.userDeletedTranslationPids.add(pid);

    const rawText = p.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
    const cached = state.translationCache.get(pid);
    const originalText = (cached && cached.original) || rawText;

    if (originalText) {
      const cleanedText = originalText.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
      state.exclusionSet.add(cleanedText);
      state.exclusionSet.add(originalText);
      targetOriginals.push(originalText);
    }

    if (cached && (cached as any).id) {
      existingTranslationIds.push((cached as any).id);
    }

    // 2. 캐시 삭제
    state.translationCache.delete(pid);

    // 3. 본문 DOM 원문 복원 및 제외 스타일 적용
    if (p.dataset.lanovelOriginalHtml) {
      p.innerHTML = p.dataset.lanovelOriginalHtml;
      p.classList.remove('lanovel-applied-text');
      if (p.dataset.lanovelOriginalStyle) {
        p.setAttribute('style', p.dataset.lanovelOriginalStyle);
      } else {
        p.removeAttribute('style');
      }
    }
    p.classList.add('lanovel-excluded-paragraph');

    // 4. 사이드바 행 UI 제외 갱신
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row) {
      row.classList.add('lanovel-excluded-row');
      row.dataset.userDeleted = 'true';
      const cell = row.querySelector('.translated-text');
      if (cell) {
        cell.textContent = '🚫 [번역 제외됨]';
        (cell as HTMLElement).style.color = '#ef4444';
        cell.setAttribute('contenteditable', 'false');
      }
      const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
      if (saveBtn) saveBtn.disabled = true;
      const retransBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
      if (retransBtn) retransBtn.disabled = true;

      const excludeAfterBtn = row.querySelector<HTMLButtonElement>('.exclude-after-btn');
      if (excludeAfterBtn) {
        excludeAfterBtn.classList.add('is-excluded');
        excludeAfterBtn.textContent = '↩️';
        excludeAfterBtn.title = '이 문단 번역 제외 해제 (복원)';
      }
      const excludeBeforeBtn = row.querySelector<HTMLButtonElement>('.exclude-before-btn');
      if (excludeBeforeBtn) {
        excludeBeforeBtn.style.display = 'none';
      }
    }

    if (state.reviewTargetPids && state.reviewTargetPids.has(pid)) {
      updateReviewCardTranslation(pid, '🚫 [사용자에 의해 번역 제외됨]', true);
    }
  });

  updateApplyButtonUI(state.isPageApplied, allParagraphs.length);

  showLanovelHud(
    `문단(${pivotPid}) 기준 ${directionLabel} ${targets.length}개 문단을 제외했습니다. (차례 시 건너뜀)`,
    icon,
    3000
  );
  logToSidebar(
    `${icon} [문단 ${directionLabel} 제외] 문단(${pivotPid}) 기준 ${targets.length}개 문단을 번역 대상에서 제외했습니다. (진행 중 차례 시 자동 건너뜀)`
  );

  // 서버 동기화: 백엔드에 excluded_sentences 및 휴지통 보관 요청
  try {
    await serverFetch('http://127.0.0.1:8001/translations/exclude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        originals: targetOriginals,
        ids: existingTranslationIds,
      }),
    });
  } catch (e: any) {
    console.warn('[applyExclusionToParagraphs] Server sync failed:', e);
  }
}

/**
 * 지정된 문단(endPid) 및 그 이전(첫 문단부터 endPid까지)의 모든 문단을 번역 제외 처리합니다. (상단 머리말/공지 제외)
 */
export async function excludeParagraphAndBefore(endPid: string): Promise<void> {
  if (!endPid) return;
  const allParagraphs = getTargetParagraphs();
  const endIndex = allParagraphs.findIndex((p) => p.id === endPid);
  if (endIndex === -1) {
    logToSidebar(`[제외 실패] 대상 문단(${endPid})을 본문에서 찾을 수 없습니다.`, 'log-error');
    return;
  }
  const targets = allParagraphs.slice(0, endIndex + 1);
  await applyExclusionToParagraphs(targets, endPid, '위쪽(머리말)', '⬆️');
}

/**
 * 지정된 문단(startPid)부터 본문 끝까지의 모든 문단을 번역 제외 처리합니다. (하단 후기/사설 제외)
 */
export async function excludeParagraphAndAfter(startPid: string): Promise<void> {
  if (!startPid) return;
  const allParagraphs = getTargetParagraphs();
  const startIndex = allParagraphs.findIndex((p) => p.id === startPid);
  if (startIndex === -1) {
    logToSidebar(`[제외 실패] 대상 문단(${startPid})을 본문에서 찾을 수 없습니다.`, 'log-error');
    return;
  }
  const targets = allParagraphs.slice(startIndex);
  await applyExclusionToParagraphs(targets, startPid, '아래쪽(후기)', '⬇️');
}

/**
 * 지정된 문단(startPid)의 번역 제외 상태를 해제(복원)합니다.
 */
export async function restoreExcludedParagraphAndAfter(startPid: string): Promise<void> {
  if (!startPid) return;
  const url = getCleanUrl();
  const allParagraphs = getTargetParagraphs();

  const targetIndex = allParagraphs.findIndex((p) => p.id === startPid);
  if (targetIndex === -1) return;

  // 연속된 제외 영역 탐색 (위/아래 방향으로 이어진 제외 단락들 함께 복원)
  let startIdx = targetIndex;
  while (startIdx > 0 && state.manualExcludedPids.has(allParagraphs[startIdx - 1].id)) {
    startIdx--;
  }
  let endIdx = targetIndex;
  while (endIdx < allParagraphs.length - 1 && state.manualExcludedPids.has(allParagraphs[endIdx + 1].id)) {
    endIdx++;
  }

  const targets = allParagraphs.slice(startIdx, endIdx + 1);
  if (targets.length === 0) return;

  const restoredOriginals: string[] = [];

  targets.forEach((p) => {
    const pid = p.id;
    state.manualExcludedPids.delete(pid);
    state.userDeletedTranslationPids.delete(pid);

    const rawText = p.innerHTML.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
    if (rawText) {
      const cleanedText = rawText.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
      state.exclusionSet.delete(cleanedText);
      state.exclusionSet.delete(rawText);
      restoredOriginals.push(rawText);
    }

    p.classList.remove('lanovel-excluded-paragraph');

    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row) {
      row.classList.remove('lanovel-excluded-row');
      delete row.dataset.userDeleted;
      row.removeAttribute('data-user-deleted');

      const cell = row.querySelector('.translated-text');
      if (cell) {
        cell.textContent = '';
        (cell as HTMLElement).style.color = '';
        cell.setAttribute('contenteditable', 'true');
      }
      const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
      if (saveBtn) saveBtn.disabled = true;
      const retransBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
      if (retransBtn) retransBtn.disabled = false;

      const excludeAfterBtn = row.querySelector<HTMLButtonElement>('.exclude-after-btn');
      if (excludeAfterBtn) {
        excludeAfterBtn.classList.remove('is-excluded');
        excludeAfterBtn.textContent = '⬇️';
        excludeAfterBtn.title = '이 문단부터 본문 끝까지 번역 제외';
      }
      const excludeBeforeBtn = row.querySelector<HTMLButtonElement>('.exclude-before-btn');
      if (excludeBeforeBtn) {
        excludeBeforeBtn.style.display = 'inline-block';
      }
    }
  });

  updateApplyButtonUI(state.isPageApplied, allParagraphs.length);

  showLanovelHud(`문단(${startPid}) 주변 ${targets.length}개 문단의 제외를 해제했습니다.`, '↩️', 2500);
  logToSidebar(`↩️ [제외 해제] 문단(${startPid}) 주변 ${targets.length}개 문단의 번역 제외를 해제했습니다.`);

  try {
    await serverFetch('http://127.0.0.1:8001/translations/restore_excluded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: url,
        originals: restoredOriginals,
      }),
    });
  } catch (e: any) {
    console.warn('[restoreExcludedParagraphAndAfter] Server sync failed:', e);
  }
}
