// separator_panel.ts: 소설별 구분선 설정 패널 및 구분선 기반 자동 제외/복원 검수 패널 모듈
import { state } from '../core/state';
import { ParagraphItem, SeparatorExcludedItem } from '../types/novel';
import {
  DEFAULT_GLOBAL_SEPARATORS,
  PRESET_SEPARATORS,
  analyzeSeparatorSections,
  checkSeparatorMatch,
  loadNovelSeparators,
  saveNovelSeparators,
  resetNovelSeparators,
} from '../core/separators';
import {
  getCleanUrl,
  getTargetParagraphs,
  applyTranslationsToPage,
  ensureTranslationsLoaded,
} from '../core/page_translator';
import {
  escapeHtml,
  logToSidebar,
  showSidebar,
  addEntryToSidebar,
  sortSidebar,
  updateApplyButtonUI,
} from './sidebar';
import { focusAndScrollToPid } from './review_panel';

export function toggleSeparatorPanel(): void {
  const panel = document.getElementById('separator-settings-panel');
  if (!panel) return;
  if (panel.style.display === 'none' || !panel.style.display) {
    panel.style.display = 'block';
    renderSeparatorSettingsPanel();
  } else {
    panel.style.display = 'none';
  }
}

export function renderSeparatorSettingsPanel(): void {
  const panel = document.getElementById('separator-settings-panel');
  if (!panel) return;

  const novelNameDisplay = document.getElementById('panel-novel-name-display');
  if (novelNameDisplay) {
    novelNameDisplay.textContent = `'${state.currentNovelTitle || '기본 소설'}'`;
  }

  const useDefaultsCheck = document.getElementById('use-global-defaults-check') as HTMLInputElement | null;
  if (useDefaultsCheck) {
    useDefaultsCheck.checked = state.separatorConfig.useDefaults !== false;
  }

  const tagsContainer = document.getElementById('active-separators-container');
  if (tagsContainer) {
    tagsContainer.innerHTML = '';
    if (state.activeSeparators.length === 0) {
      tagsContainer.innerHTML =
        '<span style="color:#94a3b8; font-style:italic; font-size:11px;">설정된 구분선이 없습니다.</span>';
    } else {
      state.activeSeparators.forEach((sep) => {
        const isDefault = DEFAULT_GLOBAL_SEPARATORS.includes(sep);
        const tag = document.createElement('span');
        tag.className = 'sep-tag' + (isDefault ? '' : ' is-custom');
        tag.innerHTML = `<span>${escapeHtml(sep)}</span><span class="sep-tag-remove" title="제거">&times;</span>`;
        tag.querySelector('.sep-tag-remove')?.addEventListener('click', () => {
          removeSeparatorTag(sep);
        });
        tagsContainer.appendChild(tag);
      });
    }
  }

  const presetsContainer = document.getElementById('preset-buttons-container');
  if (presetsContainer) {
    presetsContainer.innerHTML = '';
    PRESET_SEPARATORS.forEach((preset) => {
      const isAdded = state.activeSeparators.includes(preset.sep);
      const btn = document.createElement('button');
      btn.className = 'sep-preset-btn';
      btn.textContent = (isAdded ? '✓ ' : '+ ') + preset.name;
      if (isAdded) {
        btn.style.opacity = '0.6';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#059669';
      }
      btn.addEventListener('click', () => {
        if (!isAdded) {
          addSeparatorTag(preset.sep);
        } else {
          removeSeparatorTag(preset.sep);
        }
      });
      presetsContainer.appendChild(btn);
    });
  }
}

export function addSeparatorTag(sep: string): void {
  const trimmed = sep.trim();
  if (!trimmed) return;
  if (!state.activeSeparators.includes(trimmed)) {
    state.activeSeparators.push(trimmed);
    if (!state.separatorConfig.customSeparators.includes(trimmed)) {
      state.separatorConfig.customSeparators.push(trimmed);
    }
    renderSeparatorSettingsPanel();
  }
}

export function removeSeparatorTag(sep: string): void {
  state.activeSeparators = state.activeSeparators.filter((s) => s !== sep);
  state.separatorConfig.customSeparators = state.separatorConfig.customSeparators.filter((s) => s !== sep);
  renderSeparatorSettingsPanel();
}

/**
 * 구분선으로 인해 자동 제외된 문장 목록을 사이드바 상단 배너(#separator-exclude-panel)에 렌더링합니다.
 */
export function renderSeparatorExcludePanel(excludedItems: SeparatorExcludedItem[]): void {
  const panel = document.getElementById('separator-exclude-panel');
  if (!panel) return;

  if (!excludedItems || excludedItems.length === 0) {
    panel.style.display = 'none';
    return;
  }

  let cardsHtml = '';
  excludedItems.forEach((item, idx) => {
    const typeLabel = item.isPreface
      ? '상단 구분선 이전 잡글'
      : item.isSubsequent
        ? '구분선 이후 후기 단락'
        : '구분선 직접 일치';
    cardsHtml += `
      <div class="separator-exclude-card" data-pid="${escapeHtml(item.pid || '')}" data-idx="${idx}">
        <div class="sep-card-pid">
          <span>ID: ${escapeHtml(item.pid || '-')} (${typeLabel})</span>
          <span class="sep-card-match">매칭: '${escapeHtml(item.matchedSep || '')}'</span>
        </div>
        <div class="sep-card-ori">원문: ${escapeHtml(item.original || '')}</div>
        <div class="sep-card-tra">제외된 번역: <del>${escapeHtml(item.translated || '(번역문 없음 — 제외 규칙 적용 중)')}</del></div>
        <div class="sep-card-footer">
          <span class="sep-card-hint">클릭 시 본문 위치 확인</span>
          <button class="sep-card-restore-btn" data-idx="${idx}" title="이 단락의 번역 제외를 취소하고 다시 복원합니다">↩️ 복원</button>
        </div>
      </div>
    `;
  });

  panel.innerHTML = `
    <div class="separator-exclude-header">
      <div class="separator-exclude-title">
        <span>✂️ 구분선 기준 번역 자동 제외 (${excludedItems.length}건)</span>
      </div>
      <div class="separator-exclude-actions">
        <button id="sep-exclude-restore-all-btn" class="sep-exclude-restore-all-btn" title="제외된 ${excludedItems.length}건을 모두 번역 상태로 복원합니다">↩️ 전체 복원</button>
        <button id="sep-exclude-panel-close-btn" class="sep-exclude-close-btn" title="패널 닫기">&times;</button>
      </div>
    </div>
    <div class="separator-exclude-desc">
      설정된 구분선과 일치하거나 구분선 이후(후기)에 위치하여 기존 번역이 제외(원문 복원)되었습니다. 잘못 제외된 경우 [복원]을 눌러 되돌릴 수 있습니다.
    </div>
    <div class="separator-exclude-body">
      ${cardsHtml}
    </div>
  `;
  panel.style.display = 'block';

  panel.querySelectorAll('.separator-exclude-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target && target.closest('.sep-card-restore-btn')) return;
      const pid = card.getAttribute('data-pid');
      if (pid) focusAndScrollToPid(pid);
    });
  });

  panel.querySelectorAll('.sep-card-restore-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
      const targetItem = excludedItems[idx];
      if (!targetItem) return;
      const btnEl = btn as HTMLButtonElement;
      btnEl.disabled = true;
      btnEl.textContent = '복원 중...';
      await restoreExcludedItems([targetItem]);
    });
  });

  const restoreAllBtn = document.getElementById('sep-exclude-restore-all-btn') as HTMLButtonElement | null;
  if (restoreAllBtn) {
    restoreAllBtn.addEventListener('click', async () => {
      restoreAllBtn.disabled = true;
      restoreAllBtn.textContent = '전체 복원 중...';
      await restoreExcludedItems([...excludedItems]);
    });
  }

  const closeBtn = document.getElementById('sep-exclude-panel-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }
}

/**
 * 이미 번역된 문장 중 구분선과 일치하거나 구분선 전/후에 위치한 문장을 감지하여 서버에 제외 처리하고 패널에 표시합니다.
 */
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
  const excludedPidMap = sepAnalysis.excludedPidMap;
  const targetsToExclude: SeparatorExcludedItem[] = [];
  const targetIds: Array<number | string> = [];

  translationsList.forEach((t) => {
    if (!t || !t.id) return;
    if (state.exclusionSet.has(t.original)) return;

    let matchedInfo: { matchedSep: string; isSubsequent: boolean; isPreface: boolean } | null = null;
    if (t.pid && excludedPidMap.has(t.pid)) {
      matchedInfo = excludedPidMap.get(t.pid)!;
    } else if (t.original) {
      const matchedSep = checkSeparatorMatch(t.original.trim(), state.activeSeparators);
      if (matchedSep) {
        matchedInfo = { matchedSep, isSubsequent: false, isPreface: false };
      }
    }

    if (matchedInfo && t.translated && t.translated.trim()) {
      targetsToExclude.push({
        id: t.id,
        pid: t.pid,
        original: t.original,
        translated: t.translated,
        matchedSep: matchedInfo.matchedSep,
        isSubsequent: matchedInfo.isSubsequent,
        isPreface: matchedInfo.isPreface,
      });
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

    if (!response.ok) return;

    targetsToExclude.forEach((item) => {
      if (item.pid) {
        state.userDeletedTranslationPids.add(String(item.pid));
        state.translationCache.delete(item.pid);
      }
      if (item.original) {
        state.exclusionSet.add(item.original);
      }

      const idx = translationsList.findIndex((t) => t.id === item.id);
      if (idx !== -1) {
        translationsList.splice(idx, 1);
      }

      if (item.pid) {
        const row = document.querySelector(`tr[data-pid="${item.pid}"]`);
        if (row) row.remove();

        const pTag = document.getElementById(item.pid);
        if (pTag && pTag.dataset.lanovelOriginalHtml) {
          pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
          pTag.classList.remove('lanovel-applied-text');
          if (pTag.dataset.lanovelOriginalStyle) {
            pTag.setAttribute('style', pTag.dataset.lanovelOriginalStyle);
          } else {
            pTag.removeAttribute('style');
          }
        }
      }
    });

    updateApplyButtonUI(state.isPageApplied);
    state.separatorExcludedItems = targetsToExclude;
    renderSeparatorExcludePanel(targetsToExclude);
    showSidebar();
  } catch (e) {
    console.warn('[checkAndExcludeSeparatorTranslations] Server call failed:', e);
  }
}

/**
 * 제외된 단락을 서버 및 현재 화면(캐시, 사이드바, 본문 DOM)에 다시 복원합니다.
 */
export async function restoreExcludedItems(itemsToRestore: SeparatorExcludedItem[]): Promise<void> {
  if (!itemsToRestore || itemsToRestore.length === 0) return;
  const cleanUrl = getCleanUrl();

  try {
    const response = await fetch('http://127.0.0.1:8001/translations/restore_excluded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: cleanUrl,
        items: itemsToRestore.map((it) => ({
          id: it.id,
          pid: it.pid,
          original: it.original,
          translated: it.translated,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const allParagraphs = getTargetParagraphs();

    itemsToRestore.forEach((item) => {
      if (item.original) {
        state.exclusionSet.delete(item.original);
      }
      if (item.pid) {
        state.userDeletedTranslationPids.delete(String(item.pid));
        if (item.translated && item.translated.trim()) {
          const restoredEntry = {
            id: item.id,
            pid: item.pid,
            original: item.original,
            translated: item.translated,
          };
          state.translationCache.set(item.pid, restoredEntry);
          addEntryToSidebar(restoredEntry);
        }
      }
    });

    sortSidebar(allParagraphs.map((p) => p.id));

    if (state.isPageApplied) {
      const validRestored = itemsToRestore.filter(
        (it) => it.pid && it.translated && it.translated.trim()
      );
      if (validRestored.length > 0) {
        applyTranslationsToPage(validRestored, false);
      }
    }
    updateApplyButtonUI(state.isPageApplied);

    const restoredOriginals = new Set(itemsToRestore.map((it) => it.original));
    state.separatorExcludedItems = state.separatorExcludedItems.filter(
      (it) => !restoredOriginals.has(it.original)
    );
    renderSeparatorExcludePanel(state.separatorExcludedItems);

    logToSidebar(`✓ 제외되었던 단락 ${itemsToRestore.length}건을 다시 복원했습니다.`);
  } catch (err: any) {
    console.error('[restoreExcludedItems] Failed to restore:', err);
    logToSidebar(`제외 단락 복원 실패: ${err.message}`, 'log-error');
    renderSeparatorExcludePanel(state.separatorExcludedItems);
  }
}

/**
 * 언제든 현재 URL의 제외된 단락 목록을 서버에서 조회하여 복원 패널을 엽니다.
 */
export async function openExcludedManager(): Promise<void> {
  const cleanUrl = getCleanUrl();
  try {
    const resp = await fetch(
      `http://127.0.0.1:8001/translations/excluded_details?url=${encodeURIComponent(cleanUrl)}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const items = data.excluded_items || [];

    if (items.length === 0) {
      alert('현재 페이지(회차)에서 번역 제외된 단락이 없습니다.');
      return;
    }

    state.separatorExcludedItems = items.map((it: any) => ({
      id: it.id,
      pid: it.pid,
      original: it.original,
      translated: it.translated,
      matchedSep: '제외됨',
      isSubsequent: false,
    }));

    renderSeparatorExcludePanel(state.separatorExcludedItems);

    const sepSettingsPanel = document.getElementById('separator-settings-panel');
    if (sepSettingsPanel) sepSettingsPanel.style.display = 'none';
    showSidebar();
  } catch (e: any) {
    console.error('[openExcludedManager] Error:', e);
    logToSidebar(`제외 단락 목록 조회 실패: ${e.message}`, 'log-error');
  }
}

/**
 * 사이드바 내 구분선 설정 패널 및 제외 관리 버튼 이벤트를 바인딩합니다.
 */
export function bindSeparatorPanelEvents(): void {
  const sepBtn1 = document.getElementById('separator-settings-btn');
  const sepBtn2 = document.getElementById('toggle-sep-panel-btn');
  const closeSepBtn = document.getElementById('close-sep-panel-btn');
  if (sepBtn1) sepBtn1.addEventListener('click', toggleSeparatorPanel);
  if (sepBtn2) sepBtn2.addEventListener('click', toggleSeparatorPanel);
  if (closeSepBtn) {
    closeSepBtn.addEventListener('click', () => {
      const panel = document.getElementById('separator-settings-panel');
      if (panel) panel.style.display = 'none';
    });
  }

  const useDefaultsCheck = document.getElementById('use-global-defaults-check') as HTMLInputElement | null;
  if (useDefaultsCheck) {
    useDefaultsCheck.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      state.separatorConfig.useDefaults = checked;
      if (checked) {
        DEFAULT_GLOBAL_SEPARATORS.forEach((d) => {
          if (!state.activeSeparators.includes(d)) state.activeSeparators.unshift(d);
        });
      } else {
        state.activeSeparators = state.activeSeparators.filter(
          (s) => !DEFAULT_GLOBAL_SEPARATORS.includes(s) || state.separatorConfig.customSeparators.includes(s)
        );
      }
      renderSeparatorSettingsPanel();
    });
  }

  const addSepBtn = document.getElementById('add-separator-btn');
  const newSepInput = document.getElementById('new-separator-input') as HTMLInputElement | null;
  if (addSepBtn && newSepInput) {
    const handleAdd = () => {
      const val = newSepInput.value.trim();
      if (val) {
        addSeparatorTag(val);
        newSepInput.value = '';
      }
    };
    addSepBtn.addEventListener('click', handleAdd);
    newSepInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
  }

  const saveSepBtn = document.getElementById('save-separators-btn');
  if (saveSepBtn) {
    saveSepBtn.addEventListener('click', async () => {
      const useDefaults = useDefaultsCheck ? useDefaultsCheck.checked : true;
      const customList = state.activeSeparators.filter((s) => !DEFAULT_GLOBAL_SEPARATORS.includes(s));
      const saved = await saveNovelSeparators(
        state.currentNovelTitle,
        useDefaults ? customList : state.activeSeparators,
        useDefaults
      );
      if (saved) {
        state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
        state.activeSeparators = state.separatorConfig.effectiveSeparators;
        renderSeparatorSettingsPanel();
        logToSidebar(
          `[구분선 저장 완료] '${state.currentNovelTitle}' 소설의 구분선 설정(${state.activeSeparators.length}개)이 저장되었습니다.`
        );
        const panel = document.getElementById('separator-settings-panel');
        if (panel) panel.style.display = 'none';

        const currentTranslations = await ensureTranslationsLoaded();
        if (currentTranslations && currentTranslations.length > 0) {
          await checkAndExcludeSeparatorTranslations(currentTranslations);
        }
      } else {
        logToSidebar('[오류] 구분선 설정 저장에 실패했습니다.', 'log-error');
      }
    });
  }

  const resetSepBtn = document.getElementById('reset-separators-btn');
  if (resetSepBtn) {
    resetSepBtn.addEventListener('click', async () => {
      const ok = await resetNovelSeparators(state.currentNovelTitle);
      if (ok) {
        state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
        state.activeSeparators = state.separatorConfig.effectiveSeparators;
        renderSeparatorSettingsPanel();
        logToSidebar(
          `[구분선 초기화] '${state.currentNovelTitle || '기본 소설'}'의 구분선이 기본값으로 복원되었습니다.`
        );
      } else {
        logToSidebar('[오류] 구분선 초기화에 실패했습니다.', 'log-error');
      }
    });
  }

  const openExcludedBtn = document.getElementById('open-excluded-manager-btn');
  if (openExcludedBtn) {
    openExcludedBtn.addEventListener('click', () => {
      openExcludedManager();
    });
  }

  const headerExcludedBtn = document.getElementById('sidebar-excluded-list-btn');
  if (headerExcludedBtn) {
    headerExcludedBtn.addEventListener('click', () => {
      openExcludedManager();
    });
  }
}
