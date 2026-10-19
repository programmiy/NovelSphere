// sidebar.ts: 번역 워크스페이스 사이드바 셸, 로그 콘솔 및 번역 테이블 행 렌더링 모듈
import { state } from '../core/state';
import { TranslationRecord } from '../types/novel';
import { detectCutoffInfo, calculateNextCutoffTimestamp } from '../core/turbo';
import { checkIsVerbatimOrParaphrased } from '../core/filters';
import { saveSingleTranslation, retranslateSingleRow } from '../core/row_actions';
import { updateReviewCardTranslation } from './review_panel';
import { bindSeparatorPanelEvents } from './separator_panel';
import { toggleQuickJumpFromSidebar } from './toc_quick_jump';

export function escapeHtml(text: string): string {
  if (!text) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export function logToSidebar(message: string, level: 'log' | 'log-error' | 'info' = 'log'): void {
  const consoleEl = document.getElementById('sidebar-log-console');
  if (!consoleEl) return;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const p = document.createElement('p');
  p.className = `log-entry ${level === 'log-error' ? 'log-error' : level === 'info' ? 'log-info' : ''}`;
  p.innerHTML = `<span class="log-time">[${timeStr}]</span><span class="log-msg">${escapeHtml(message)}</span>`;

  // 최신 알림이 맨 위로 오도록 상단 누적 (내림차순)
  consoleEl.prepend(p);

  // 최대 60개 보관, 초과 시 하단 오래된 로그 제거
  if (consoleEl.children.length > 60) {
    consoleEl.removeChild(consoleEl.lastChild!);
  }

  // 항상 최신 위치(최상단)로 스크롤 갱신 유지
  const scrollContainer = (consoleEl.closest('.sidebar-footer') || consoleEl) as HTMLElement;
  scrollContainer.scrollTop = 0;
  consoleEl.scrollTop = 0;

  // 상태 머신에 기록 (검열감지, 지연시간 추출 및 원격 제어 자동 디스패치)
  state.recordLog(message);
}

export function showSidebar(): void {
  const sidebar = document.getElementById('jp-translator-sidebar');
  if (sidebar) {
    sidebar.classList.add('visible');
    updateEmptyState();
    if (!state.hasScannedForPTags && state.onStartTranslation) {
      state.hasScannedForPTags = true;
      state.onStartTranslation(false);
    }
    state.broadcastStatus();
  }
}

export function hideSidebar(): void {
  const sidebar = document.getElementById('jp-translator-sidebar');
  if (sidebar) {
    sidebar.classList.remove('visible');
  }
}

export function toggleSidebar(): void {
  const sidebar = document.getElementById('jp-translator-sidebar');
  if (sidebar && sidebar.classList.contains('visible')) {
    hideSidebar();
  } else {
    showSidebar();
  }
}

export function injectSidebar(): void {
  if (document.getElementById('jp-translator-sidebar')) return;

  const sidebar = document.createElement('div');
  sidebar.id = 'jp-translator-sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <h3>🗾 번역 워크스페이스</h3>
      <div class="sidebar-controls">
        <button id="sidebar-quick-jump-toggle-btn" title="미번역 회차 목록(퀵 점프 서랍) 띄우기/닫기">⚡</button>
        <button id="sidebar-excluded-list-btn" title="제외된 단락 확인 및 복원">🛡️</button>
        <button id="separator-settings-btn" title="소설별 구분선 설정">⚙️</button>
        <button id="stop-translation-btn" title="번역 중지" style="display:none;">⏹️</button>
        <button id="resume-translation-btn" title="번역 재개" style="display:none;">▶️</button>
        <button id="retry-translation-btn" title="다시 시도" style="display:none;">🔄</button>
        <button id="sidebar-close-btn" title="닫기">&times;</button>
      </div>
    </div>
    <div id="sidebar-novel-banner" class="sidebar-novel-banner">
      <div class="novel-banner-info">
        <span class="novel-banner-icon">📖</span>
        <span id="current-novel-title-display" class="novel-banner-title" title="클릭하여 소설 제목 수정">소설 감지 중...</span>
        <button id="edit-novel-title-btn" class="novel-banner-btn" title="소설 제목 직접 변경">✏️</button>
      </div>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button id="banner-quick-jump-btn" class="novel-banner-btn" style="background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.4); color: #f59e0b; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer;" title="미번역 회차 목록 띄우기/닫기">⚡ 미번역 목록</button>
        <button id="toggle-sep-panel-btn" class="novel-banner-sep-toggle" title="이 소설의 구분선 설정">⚙️ 구분선 설정</button>
      </div>
    </div>
    <div id="separator-settings-panel" class="separator-settings-panel" style="display: none;">
      <div class="sep-panel-header">
        <span class="sep-panel-title">⚙️ 소설별 번역 구분선(작가의 말) 설정</span>
        <button id="close-sep-panel-btn" class="sep-close-btn">&times;</button>
      </div>
      <div class="sep-panel-body">
        <div class="sep-info-box">
          <span class="sep-novel-name" id="panel-novel-name-display"></span>의 작가의 말 구분선 설정입니다. 본문 맥락선과 겹치지 않게 주의하세요.
        </div>
        <div class="sep-form-group">
          <label class="sep-checkbox-label">
            <input type="checkbox" id="use-global-defaults-check" checked>
            <span>공통 후기 키워드 포함 (＜あとがき＞, 【大事なお知らせ】 등)</span>
          </label>
        </div>
        <div class="sep-section-title">적용 중인 구분선 목록:</div>
        <div id="active-separators-container" class="sep-tags-wrap"></div>
        <div class="sep-section-title">자주 쓰는 기호 빠른 추가:</div>
        <div id="preset-buttons-container" class="sep-presets-wrap"></div>
        <div class="sep-section-title">새 구분선 직접 추가:</div>
        <div class="sep-input-row">
          <input type="text" id="new-separator-input" placeholder="추가할 기호/문자열 입력 (예: ◎◎◎)" class="sep-input">
          <button id="add-separator-btn" class="sep-add-btn">추가</button>
        </div>
        <div class="sep-panel-footer">
          <button id="save-separators-btn" class="sep-save-btn">💾 설정 저장</button>
          <button id="reset-separators-btn" class="sep-reset-btn">기본값 복원</button>
          <button id="open-excluded-manager-btn" class="sep-manage-excluded-btn" title="현재 페이지에서 제외된 모든 단락을 조회하고 복원합니다">🛡️ 제외 단락 확인/복원</button>
        </div>
      </div>
    </div>
    <div id="sidebar-turbo-banner" class="sidebar-turbo-banner">
      <div class="turbo-info">
        <span class="turbo-icon">⚡</span>
        <span class="turbo-label">쾌속모드</span>
        <span class="turbo-desc" id="turbo-desc-text">대기: 2초 / 8초</span>
      </div>
      <div class="turbo-controls">
        <span id="turbo-cutoff-badge" class="turbo-cutoff-badge" title="클릭하여 기준 시간 변경 (자동 / 16:00 / 17:00)">기준 16:00 (써머타임)</span>
        <label class="turbo-switch" title="쾌속모드 ON/OFF (초기화 정각까지 빠른 번역)">
          <input type="checkbox" id="sidebar-turbo-toggle">
          <span class="turbo-slider round"></span>
        </label>
      </div>
    </div>
    <div id="sidebar-apply-banner" class="sidebar-apply-banner">
      <div class="apply-status-info">
        <span id="apply-status-dot" class="status-dot"></span>
        <span id="apply-status-text" class="apply-status-text">원문 표시 중</span>
        <span id="apply-stats-count" class="apply-stats-count">(0개 적용)</span>
      </div>
      <button id="sidebar-apply-toggle-btn" class="sidebar-apply-btn" title="웹페이지 본문에 번역을 즉시 적용하거나 원문으로 복원합니다">
        <span id="apply-btn-icon" class="apply-btn-icon">📄</span>
        <span id="apply-btn-text" class="apply-btn-text">페이지에 적용</span>
      </button>
    </div>
    <div id="review-target-panel" class="review-target-panel" style="display: none;"></div>
    <div id="separator-exclude-panel" class="separator-exclude-panel" style="display: none;"></div>
    <div class="sidebar-content">
      <table id="translation-table">
        <thead>
          <tr>
            <th>원문 (일본어)</th>
            <th>번역 (한국어)</th>
            <th>관리</th>
          </tr>
        </thead>
        <tbody id="translation-table-body"></tbody>
      </table>
      <div id="sidebar-empty-state" style="display: none; text-align: center; padding: 20px; color: #888;">
        <p>페이지의 &lt;p&gt; 태그에서 일본어를 스캔하여 번역합니다.</p>
      </div>
    </div>
    <div class="sidebar-footer">
      <div class="sidebar-footer-header">
        <span class="footer-header-title">📋 실시간 알림 로그</span>
        <button id="clear-sidebar-log-btn" class="footer-clear-btn" title="알림 로그 비우기">비우기</button>
      </div>
      <div id="sidebar-log-console"></div>
    </div>
  `;
  document.body.appendChild(sidebar);

  const toggleButton = document.createElement('button');
  toggleButton.id = 'jp-translator-toggle-btn';
  toggleButton.innerHTML = '文';
  document.body.appendChild(toggleButton);

  // 기본 이벤트 바인딩
  document.getElementById('sidebar-close-btn')?.addEventListener('click', hideSidebar);
  toggleButton.addEventListener('click', toggleSidebar);

  document.getElementById('clear-sidebar-log-btn')?.addEventListener('click', () => {
    const consoleEl = document.getElementById('sidebar-log-console');
    if (consoleEl) consoleEl.innerHTML = '';
  });

  document.getElementById('sidebar-quick-jump-toggle-btn')?.addEventListener('click', () => {
    toggleQuickJumpFromSidebar();
  });
  document.getElementById('banner-quick-jump-btn')?.addEventListener('click', () => {
    toggleQuickJumpFromSidebar();
  });

  bindSeparatorPanelEvents();

  const editTitleBtn = document.getElementById('edit-novel-title-btn');
  const titleDisplay = document.getElementById('current-novel-title-display');
  if (editTitleBtn) editTitleBtn.addEventListener('click', promptEditNovelTitle);
  if (titleDisplay) titleDisplay.addEventListener('click', promptEditNovelTitle);

  const turboToggle = document.getElementById('sidebar-turbo-toggle') as HTMLInputElement | null;
  if (turboToggle) {
    turboToggle.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (state.onToggleTurboMode) {
        state.onToggleTurboMode(checked, true);
      }
    });
  }

  const turboCutoffBadge = document.getElementById('turbo-cutoff-badge');
  if (turboCutoffBadge) {
    turboCutoffBadge.addEventListener('click', () => {
      cycleTurboCutoff();
    });
  }
}

export function updateEmptyState(): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  const emptyState = document.getElementById('sidebar-empty-state');
  if (tableBody && emptyState) {
    emptyState.style.display = tableBody.rows.length === 0 ? 'block' : 'none';
  }
}

export function updateNovelTitleUI(title: string): void {
  const display = document.getElementById('current-novel-title-display');
  if (display) {
    display.textContent = title || '제목 미감지';
    display.title = `현재 소설: ${title}\n(클릭하여 소설 제목 직접 지정 가능)`;
  }
}

async function promptEditNovelTitle(): Promise<void> {
  const nextTitle = prompt('이 소설의 제목(식별자)을 입력하세요:', state.currentNovelTitle || '');
  if (nextTitle !== null && nextTitle.trim() !== '') {
    state.currentNovelTitle = nextTitle.trim();
    updateNovelTitleUI(state.currentNovelTitle);
    const { loadNovelSeparators } = await import('../core/separators');
    const { renderSeparatorSettingsPanel } = await import('./separator_panel');
    state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
    state.activeSeparators = state.separatorConfig.effectiveSeparators;
    renderSeparatorSettingsPanel();
    logToSidebar(`[소설 전환] '${state.currentNovelTitle}'의 구분선 설정을 불러왔습니다.`);
  }
}

export function updateTurboModeUI(enabled: boolean): void {
  const toggle = document.getElementById('sidebar-turbo-toggle') as HTMLInputElement | null;
  const banner = document.getElementById('sidebar-turbo-banner');
  const desc = document.getElementById('turbo-desc-text');

  if (toggle) toggle.checked = !!enabled;
  if (banner) {
    if (enabled) {
      banner.classList.add('active');
    } else {
      banner.classList.remove('active');
    }
  }
  if (desc) {
    if (enabled) {
      const targetDate = state.turboTargetTimestamp ? new Date(state.turboTargetTimestamp) : null;
      const timeStr = targetDate
        ? `${targetDate.getHours()}:${String(targetDate.getMinutes()).padStart(2, '0')} 정각 중단`
        : '대기: 2초 / 8초';
      desc.textContent = `ON (${timeStr})`;
    } else {
      desc.textContent = 'OFF (기본 지연)';
    }
  }
}

export function updateTurboBadgeUI(): void {
  const badge = document.getElementById('turbo-cutoff-badge');
  if (!badge) return;
  const info = detectCutoffInfo(state.turboCutoffHour);
  badge.textContent = `기준 ${info.label}`;
}

export async function cycleTurboCutoff(): Promise<void> {
  if (state.turboCutoffHour === null) {
    state.turboCutoffHour = 16;
  } else if (state.turboCutoffHour === 16) {
    state.turboCutoffHour = 17;
  } else {
    state.turboCutoffHour = null;
  }

  const info = detectCutoffInfo(state.turboCutoffHour);
  if (state.isTurboMode) {
    state.turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
  }

  try {
    await chrome.storage.local.set({
      lanovel_turbo_cutoff: state.turboCutoffHour,
      lanovel_turbo_target: state.turboTargetTimestamp,
    });
  } catch (e) {}

  updateTurboBadgeUI();
  updateTurboModeUI(state.isTurboMode);
  logToSidebar(`⏰ 쾌속모드 정각 중단 기준이 [${info.label}]으로 변경되었습니다.`);
}

export function updateApplyButtonUI(applied: boolean, totalTargetCount?: number): void {
  const dot = document.getElementById('apply-status-dot');
  const text = document.getElementById('apply-status-text');
  const count = document.getElementById('apply-stats-count');
  const btn = document.getElementById('sidebar-apply-toggle-btn');
  const btnIcon = document.getElementById('apply-btn-icon');
  const btnText = document.getElementById('apply-btn-text');

  const totalTarget =
    totalTargetCount ?? document.querySelectorAll('p[id]:not(.blank)').length;
  const translatedCount = state.translationCache.size;

  if (count) {
    count.textContent = `(번역 ${translatedCount}개 / 본문 ${totalTarget}개)`;
  }

  if (applied) {
    if (dot) dot.className = 'status-dot applied';
    if (text) {
      text.className = 'apply-status-text applied';
      text.textContent = '본문 번역 적용 중';
    }
    if (btn) {
      btn.className = 'sidebar-apply-btn applied';
      btn.title = '클릭하면 웹페이지 본문을 원문으로 복원합니다.';
    }
    if (btnIcon) btnIcon.textContent = '✅';
    if (btnText) btnText.textContent = '적용 중 (원문 복원)';
  } else {
    if (dot) dot.className = 'status-dot';
    if (text) {
      text.className = 'apply-status-text';
      text.textContent = '원문 표시 중';
    }
    if (btn) {
      btn.className = 'sidebar-apply-btn';
      btn.title = '클릭하면 번역문을 웹페이지 본문에 적용합니다.';
    }
    if (btnIcon) btnIcon.textContent = '📄';
    if (btnText) btnText.textContent = '페이지에 적용';
  }
}

/**
 * 사이드바 행(tr) 내부의 번역 셀 편집, 저장 버튼, 단건 재번역 버튼 및 행 클릭 이벤트를 바인딩합니다.
 */
function bindRowEvents(row: HTMLTableRowElement, pid: string, originalText: string): void {
  const translatedCell = row.querySelector<HTMLElement>('.translated-text');
  const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
  const retranslateBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');

  if (translatedCell && saveBtn) {
    translatedCell.addEventListener('input', () => {
      saveBtn.disabled = false;
    });

    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newTranslatedText = translatedCell.textContent || '';
      saveSingleTranslation(pid, originalText, newTranslatedText);
      saveBtn.disabled = true;
    });
  }

  if (retranslateBtn) {
    retranslateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      retranslateSingleRow(pid, originalText);
    });
  }

  row.addEventListener('click', (e) => {
    handleSidebarRowClick(pid, e);
  });
}

export function populateSidebar(translations: TranslationRecord[]): void {
  const tableBody = document.getElementById('translation-table-body');
  if (!tableBody) return;
  tableBody.innerHTML = '';

  const seenPids = new Set<string>();
  const uniqueTranslations: TranslationRecord[] = [];
  for (let i = translations.length - 1; i >= 0; i--) {
    const t = translations[i];
    if (t.pid && !seenPids.has(t.pid)) {
      seenPids.add(t.pid);
      uniqueTranslations.unshift(t);
    }
  }

  uniqueTranslations.forEach((t) => {
    addEntryToSidebar(t);
  });
  updateEmptyState();
}

export function addEntryToSidebar(t: TranslationRecord): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  if (!tableBody) return;
  const pid = t.pid || (t.id !== undefined ? String(t.id) : '');
  if (!pid) return;

  let isAutoDeleted = false;
  if (t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated)) {
    isAutoDeleted = true;
    state.translationCache.delete(pid);
  }

  const existingRow = tableBody.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
  const isReviewTarget = state.reviewTargetPids && state.reviewTargetPids.has(pid);
  const reviewBadgeHtml = isReviewTarget ? `<span class="review-badge">⚡재검수</span>` : '';
  const displayTranslation = isAutoDeleted ? '' : escapeHtml(t.translated || '');

  if (existingRow) {
    if (isReviewTarget) existingRow.classList.add('review-target-row');
    const oriCell = existingRow.querySelector('.original-text');
    if (oriCell && isReviewTarget && !oriCell.querySelector('.review-badge')) {
      oriCell.innerHTML = `${reviewBadgeHtml}${escapeHtml(t.original)}`;
    }
    const transCell = existingRow.querySelector('.translated-text');
    if (transCell) {
      transCell.innerHTML = displayTranslation;
      transCell.setAttribute('contenteditable', 'true');
    }
    const saveBtn = existingRow.querySelector<HTMLButtonElement>('.save-btn');
    if (saveBtn) saveBtn.disabled = !isAutoDeleted;
    const retranslateBtn = existingRow.querySelector<HTMLButtonElement>('.retranslate-row-btn');
    if (retranslateBtn) retranslateBtn.disabled = false;
    return;
  }

  const row = tableBody.insertRow();
  row.dataset.pid = pid;
  if (isReviewTarget) row.classList.add('review-target-row');

  row.innerHTML = `
    <td class="original-text">${reviewBadgeHtml}${escapeHtml(t.original)}</td>
    <td class="translated-text" contenteditable="true">${displayTranslation}</td>
    <td>
      <div class="action-btns">
        <button class="save-btn" disabled title="수정한 번역 저장">저장</button>
        <button class="retranslate-row-btn" title="이 문장만 즉시 재번역">🔄</button>
      </div>
    </td>
  `;

  bindRowEvents(row, pid, t.original);
}

export function addPlaceholderRows(items: Array<{ id: string; text: string }>): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  if (!tableBody) return;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (tableBody.querySelector(`tr[data-pid="${item.id}"]`)) continue;

    const row = tableBody.insertRow(0);
    row.dataset.pid = item.id;
    const isReviewTarget = state.reviewTargetPids && state.reviewTargetPids.has(item.id);
    if (isReviewTarget) row.classList.add('review-target-row');
    const reviewBadgeHtml = isReviewTarget ? `<span class="review-badge">⚡재검수</span>` : '';

    row.innerHTML = `
      <td class="original-text">${reviewBadgeHtml}${escapeHtml(item.text)}</td>
      <td class="translated-text">⏳ 번역 중...</td>
      <td>
        <div class="action-btns">
          <button class="save-btn" disabled title="수정한 번역 저장">저장</button>
          <button class="retranslate-row-btn" disabled title="이 문장만 즉시 재번역">🔄</button>
        </div>
      </td>
    `;

    bindRowEvents(row, item.id, item.text);
  }
  updateEmptyState();
}

export function updateSidebarWithTranslations(
  translations: Array<{ id: string; original: string; translated: string }>
): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  if (!tableBody || !translations || translations.length === 0) return;

  const rowsToPrepend: HTMLTableRowElement[] = [];

  translations.forEach((item) => {
    let row = tableBody.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
    const isReviewTarget = state.reviewTargetPids && state.reviewTargetPids.has(item.id);
    const reviewBadgeHtml = isReviewTarget ? `<span class="review-badge">⚡재검수</span>` : '';

    if (!row) {
      row = document.createElement('tr');
      row.dataset.pid = item.id;
      if (isReviewTarget) row.classList.add('review-target-row');
      row.innerHTML = `
        <td class="original-text">${reviewBadgeHtml}${escapeHtml(item.original)}</td>
        <td class="translated-text" contenteditable="true">${escapeHtml(item.translated)}</td>
        <td>
          <div class="action-btns">
            <button class="save-btn" disabled title="수정한 번역 저장">저장</button>
            <button class="retranslate-row-btn" title="이 문장만 즉시 재번역">🔄</button>
          </div>
        </td>
      `;
      bindRowEvents(row, item.id, item.original);
    } else {
      const cell = row.querySelector('.translated-text');
      if (cell) {
        cell.textContent = item.translated;
        cell.setAttribute('contenteditable', 'true');
        (cell as HTMLElement).style.color = '';
      }
      const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
      if (saveBtn) saveBtn.disabled = true;
      const retranslateBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
      if (retranslateBtn) retranslateBtn.disabled = false;
    }

    if (isReviewTarget) {
      updateReviewCardTranslation(item.id, `번역: ${item.translated}`, false);
    }

    rowsToPrepend.push(row);
  });

  // 번역 완료된 묶음을 사이드바 최상단에 올리되, 묶음 내부 단락들은 원문 순서(1->2->3)를 유지하도록 역순 prepend
  for (let i = rowsToPrepend.length - 1; i >= 0; i--) {
    tableBody.prepend(rowsToPrepend[i]);
  }
}

export function updateSidebarWithCancelled(): void {
  const tableBody = document.getElementById('translation-table-body');
  if (!tableBody) return;

  const rows = tableBody.querySelectorAll('tr');
  rows.forEach((row) => {
    const translatedCell = row.querySelector<HTMLElement>('.translated-text');
    if (translatedCell && translatedCell.textContent?.includes('번역 중')) {
      translatedCell.textContent = '';
      translatedCell.setAttribute('contenteditable', 'true');
      const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
      if (saveBtn) saveBtn.disabled = false;
      const retranslateBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
      if (retranslateBtn) retranslateBtn.disabled = false;
    }
  });
}

export function sortSidebar(paragraphOrderPids: string[]): void {
  const tableBody = document.getElementById('translation-table-body');
  if (!tableBody) return;

  const rows = Array.from(tableBody.querySelectorAll<HTMLTableRowElement>('tr[data-pid]'));
  const pidMap = new Map(rows.map((row) => [row.dataset.pid!, row]));

  tableBody.innerHTML = '';
  paragraphOrderPids.forEach((pid) => {
    const row = pidMap.get(pid);
    if (row) {
      tableBody.appendChild(row);
      pidMap.delete(pid);
    }
  });
  pidMap.forEach((row) => tableBody.appendChild(row));
}

export function handleSidebarRowClick(pid: string, e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (target && (target.closest('button') || target.closest('.translated-text') || target.tagName === 'INPUT')) {
    return;
  }
  const targetP = document.getElementById(pid);
  if (targetP) {
    targetP.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetP.classList.remove('lanovel-highlight-pulse');
    void targetP.offsetWidth;
    targetP.classList.add('lanovel-highlight-pulse');
    setTimeout(() => {
      targetP.classList.remove('lanovel-highlight-pulse');
    }, 1600);
  }
}
