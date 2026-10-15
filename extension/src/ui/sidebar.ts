// sidebar.ts: 번역 워크스페이스 사이드바 UI 및 뷰어 렌더링 모듈
import { state } from '../core/state';
import { TranslationRecord } from '../types/novel';
import { PRESET_SEPARATORS, saveNovelSeparators } from '../core/separators';
import { detectCutoffInfo } from '../core/turbo';

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
  if (level === 'log-error') p.className = 'log-error';
  p.innerHTML = `<span class="log-time">[${timeStr}]</span>${escapeHtml(message)}`;

  // 진행 순서대로 하단에 누적 스택 (오래된 순 -> 최신 순)
  consoleEl.appendChild(p);

  // 최대 80개 보관, 초과 시 상단 오래된 로그 제거
  if (consoleEl.children.length > 80) {
    consoleEl.removeChild(consoleEl.firstChild!);
  }

  // 스크롤을 가진 상위 컨테이너(.sidebar-footer)를 항상 최신 위치(최하단)로 자동 스크롤
  const scrollContainer = (consoleEl.closest('.sidebar-footer') || consoleEl) as HTMLElement;
  scrollContainer.scrollTop = scrollContainer.scrollHeight;

  // 상태 머신에 기록 (검열감지, 지연시간 추출 및 원격 제어 자동 디스패치)
  state.recordLog(message);
}

export function showSidebar(): void {
  const sidebar = document.getElementById('jp-translator-sidebar');
  if (sidebar) {
    sidebar.classList.add('visible');
    updateEmptyState();
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

export function injectSidebarStyles(): void {
  if (document.getElementById('lanovel-sidebar-style')) return;
  const style = document.createElement('style');
  style.id = 'lanovel-sidebar-style';
  style.textContent = `
    #jp-translator-sidebar {
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 460px !important;
      max-width: 90vw !important;
      min-width: 320px !important;
      height: 100% !important;
      background-color: #f8f9fa !important;
      border-left: 1px solid #dee2e6 !important;
      box-shadow: -2px 0 8px rgba(0,0,0,0.1) !important;
      z-index: 9999 !important;
      transform: translateX(100%) !important;
      transition: transform 0.3s ease-in-out !important;
      display: flex !important;
      flex-direction: column !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box !important;
    }
    #jp-translator-sidebar.visible {
      transform: translateX(0) !important;
    }
    #jp-translator-toggle-btn {
      position: fixed !important;
      top: 50% !important;
      left: 0 !important;
      transform: translateY(-50%) !important;
      background-color: #667eea !important;
      color: white !important;
      border: none !important;
      border-top-right-radius: 5px !important;
      border-bottom-right-radius: 5px !important;
      padding: 10px 5px !important;
      cursor: pointer !important;
      z-index: 9998 !important;
      font-size: 18px !important;
      writing-mode: vertical-rl !important;
      box-sizing: border-box !important;
    }
  `;
  document.head.appendChild(style);
}

export function updateEmptyState(): void {
  const tableBody = document.getElementById('translation-table-body');
  const emptyState = document.getElementById('sidebar-empty-state');
  if (!tableBody || !emptyState) return;
  emptyState.style.display = tableBody.children.length === 0 ? 'block' : 'none';
}

export function updateTurboModeUI(enabled: boolean): void {
  const toggle = document.getElementById('sidebar-turbo-toggle') as HTMLInputElement | null;
  const desc = document.getElementById('turbo-desc-text');
  if (toggle) toggle.checked = enabled;
  if (desc) {
    desc.textContent = enabled ? '⚡ 2초 / 8초 (쾌속)' : '일반 모드 (RPM 보수적)';
  }
}

export function updateTurboBadgeUI(): void {
  const badge = document.getElementById('turbo-cutoff-badge');
  if (!badge) return;
  const info = detectCutoffInfo(state.turboCutoffHour);
  badge.textContent = `기준 ${info.label}`;
}

export function updateApplyButtonUI(applied: boolean, totalTargetCount = 0): void {
  const dot = document.getElementById('apply-status-dot');
  const text = document.getElementById('apply-status-text');
  const count = document.getElementById('apply-stats-count');
  const btn = document.getElementById('sidebar-apply-toggle-btn');
  const btnIcon = document.getElementById('apply-btn-icon');
  const btnText = document.getElementById('apply-btn-text');

  const translatedCount = state.translationCache.size;

  if (count) {
    count.textContent = `(번역 ${translatedCount}개 / 본문 ${totalTargetCount}개)`;
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

export function updateNovelTitleUI(title: string): void {
  const el = document.getElementById('current-novel-title-display');
  const panelNovel = document.getElementById('panel-novel-name-display');
  if (el) el.textContent = title || '기본 소설';
  if (panelNovel) panelNovel.textContent = title || '기본 소설';
}

export function toggleSeparatorPanel(): void {
  const panel = document.getElementById('separator-settings-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    renderSeparatorSettingsPanel();
  }
}

export function renderSeparatorSettingsPanel(): void {
  const container = document.getElementById('active-separators-container');
  const presetsContainer = document.getElementById('preset-buttons-container');
  const defaultCheck = document.getElementById('use-global-defaults-check') as HTMLInputElement | null;
  if (!container || !presetsContainer) return;

  if (defaultCheck) {
    defaultCheck.checked = state.separatorConfig.useDefaults;
  }

  container.innerHTML = '';
  state.activeSeparators.forEach((sep) => {
    const isCustom = state.separatorConfig.customSeparators.includes(sep);
    const tag = document.createElement('span');
    tag.className = `sep-tag ${isCustom ? 'is-custom' : ''}`;
    tag.innerHTML = `<span>${escapeHtml(sep)}</span><span class="sep-tag-remove" title="삭제">&times;</span>`;

    const removeBtn = tag.querySelector('.sep-tag-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        state.activeSeparators = state.activeSeparators.filter((s) => s !== sep);
        state.separatorConfig.customSeparators = state.separatorConfig.customSeparators.filter((s) => s !== sep);
        renderSeparatorSettingsPanel();
      });
    }
    container.appendChild(tag);
  });

  presetsContainer.innerHTML = '';
  PRESET_SEPARATORS.forEach((p) => {
    const btn = document.createElement('button');
    btn.className = 'sep-preset-btn';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      if (!state.activeSeparators.includes(p.sep)) {
        state.activeSeparators.push(p.sep);
        if (!state.separatorConfig.customSeparators.includes(p.sep)) {
          state.separatorConfig.customSeparators.push(p.sep);
        }
        renderSeparatorSettingsPanel();
      }
    });
    presetsContainer.appendChild(btn);
  });
}

export function renderReviewTargetPanel(): void {
  const panel = document.getElementById('review-target-panel');
  if (!panel) return;

  if (!state.reviewTargetsData || !state.reviewTargetsData.targets || state.reviewTargetsData.targets.length === 0) {
    panel.style.display = 'none';
    return;
  }

  const targets = state.reviewTargetsData.targets;
  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="review-panel-header">
      <div class="review-panel-title">
        <span>⚡ 재번역 검수 대상 (${targets.length}개)</span>
      </div>
      <button class="review-panel-close-btn" id="close-review-panel-btn">&times;</button>
    </div>
    <div class="review-panel-list">
      ${targets
        .map(
          (t: any) => `
        <div class="review-target-card" data-pid="${t.pid}">
          <div class="card-top">
            <span class="pid-badge">#${t.pid}</span>
            <span class="reason-badge">${escapeHtml(t.reason || '품질 재검수')}</span>
          </div>
          <div class="card-body">
            <div class="orig-text">원문: ${escapeHtml(t.original)}</div>
            <div class="trans-text" id="review-tra-${t.pid}">번역: ${escapeHtml(t.translated || '(미번역)')}</div>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  const closeBtn = document.getElementById('close-review-panel-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }
}

export function populateSidebar(translations: TranslationRecord[]): void {
  const tableBody = document.getElementById('translation-table-body');
  if (!tableBody) return;
  tableBody.innerHTML = '';
  translations.forEach((t) => {
    addEntryToSidebar(t);
  });
  updateEmptyState();
}

export function addPlaceholderRows(items: Array<{ id: string; text: string }>): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  if (!tableBody) return;

  items.forEach((item) => {
    let row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
    if (!row) {
      const newRow = tableBody.insertRow();
      newRow.setAttribute('data-pid', item.id);
      newRow.innerHTML = `
        <td><div class="original-text">${escapeHtml(item.text)}</div></td>
        <td><div class="translated-text">⏳ 번역 중...</div></td>
        <td>
          <div class="action-btns">
            <button class="save-btn" disabled>저장</button>
            <button class="retranslate-row-btn" disabled title="고성능 모델로 재번역">🔄</button>
          </div>
        </td>
      `;
    } else {
      const cell = row.querySelector('.translated-text');
      if (cell) cell.textContent = '⏳ 번역 중...';
    }
  });
  updateEmptyState();
}

export function updateSidebarWithTranslations(translations: any[]): void {
  translations.forEach((t) => {
    const pid = t.id || t.pid;
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row) {
      const cell = row.querySelector('.translated-text');
      if (cell) {
        cell.textContent = t.translated || '';
        cell.removeAttribute('style');
      }
      const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
      if (saveBtn) saveBtn.disabled = false;
      const retransBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
      if (retransBtn) retransBtn.disabled = false;
    } else {
      addEntryToSidebar({
        pid: pid,
        original: t.original,
        translated: t.translated,
      });
    }
  });
  state.broadcastStatus();
}

export function addEntryToSidebar(translation: TranslationRecord): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  if (!tableBody || !translation.pid) return;

  if (document.querySelector(`tr[data-pid="${translation.pid}"]`)) return;

  const row = tableBody.insertRow();
  row.setAttribute('data-pid', translation.pid);
  const isReviewTarget = state.reviewTargetPids.has(translation.pid);
  if (isReviewTarget) {
    row.classList.add('review-target-row');
    const p = document.getElementById(translation.pid);
    if (p) p.classList.add('review-target-dom');
  }
  const badgeHtml = isReviewTarget ? '<span class="review-badge" title="알림 센터 연계 재번역 검수 문장">⚡재검수</span>' : '';

  row.innerHTML = `
    <td><div class="original-text" title="클릭하면 본문의 해당 문단으로 이동합니다">${badgeHtml}${escapeHtml(translation.original)}</div></td>
    <td><div class="translated-text" contenteditable="true">${escapeHtml(translation.translated)}</div></td>
    <td>
      <div class="action-btns">
        <button class="save-btn">저장</button>
        <button class="retranslate-row-btn" title="고성능 모델로 재번역">🔄</button>
      </div>
    </td>
  `;

  const saveBtn = row.querySelector<HTMLButtonElement>('.save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e: MouseEvent) => {
      e.stopPropagation();
      const cell = row.querySelector('.translated-text');
      const editedText = cell ? (cell.textContent || '').trim() : '';
      if (!editedText) {
        state.userDeletedTranslationPids.add(String(translation.pid));
        row.setAttribute('data-user-deleted', 'true');
      } else {
        state.userDeletedTranslationPids.delete(String(translation.pid));
        row.removeAttribute('data-user-deleted');
      }

      // 서버 저장 및 캐시 업데이트
      const record = {
        url: window.location.href.split('#')[0].trim(),
        pid: translation.pid,
        original: translation.original,
        translated: editedText,
        timestamp: Math.floor(Date.now() / 1000),
        folderName: null,
        title: (state.onExtractEpisodeTitle && state.onExtractEpisodeTitle()) || document.title,
      };
      state.translationCache.set(translation.pid!, { pid: translation.pid, original: translation.original, translated: editedText });

      try {
        await fetch('http://127.0.0.1:8001/translations/upsert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([record]),
        });
        saveBtn.textContent = '저장됨!';
        setTimeout(() => {
          saveBtn.textContent = '저장';
        }, 1500);
      } catch (err: any) {
        logToSidebar(`번역 저장 실패: ${err.message}`, 'log-error');
      }
    });
  }

  const retransBtn = row.querySelector<HTMLButtonElement>('.retranslate-row-btn');
  if (retransBtn) {
    retransBtn.addEventListener('click', async (e: MouseEvent) => {
      e.stopPropagation();
      retransBtn.disabled = true;
      const cell = row.querySelector('.translated-text');
      if (cell) {
        cell.textContent = '⏳ 재번역 중...';
      }
      logToSidebar(`(pid: ${translation.pid}) 고성능 모델로 재번역 요청 중...`);
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'batchTranslate',
          items: [{ id: translation.pid, text: translation.original }],
          isRetranslation: true,
        });
        if (response && response.translations && response.translations.length > 0) {
          const item = response.translations[0];
          updateSidebarWithTranslations([item]);
          logToSidebar(`(pid: ${translation.pid}) 재번역 완료!`);
        }
      } catch (err: any) {
        logToSidebar(`재번역 실패: ${err.message}`, 'log-error');
      } finally {
        retransBtn.disabled = false;
      }
    });
  }

  updateEmptyState();
}

export function sortSidebar(orderedPids: string[]): void {
  const tableBody = document.getElementById('translation-table-body');
  if (!tableBody) return;
  const rows = Array.from(tableBody.querySelectorAll<HTMLTableRowElement>('tr[data-pid]'));
  const pidOrderMap = new Map(orderedPids.map((id, idx) => [id, idx]));

  rows.sort((a, b) => {
    const pidA = a.dataset.pid || '';
    const pidB = b.dataset.pid || '';
    const idxA = pidOrderMap.has(pidA) ? pidOrderMap.get(pidA)! : 999999;
    const idxB = pidOrderMap.has(pidB) ? pidOrderMap.get(pidB)! : 999999;
    return idxA - idxB;
  });

  rows.forEach((r) => tableBody.appendChild(r));
}

export function updateSidebarWithErrors(items: any[], errorMessage: string): void {
  items.forEach((item) => {
    const pid = item.id || item.pid;
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row) {
      const cell = row.querySelector('.translated-text');
      if (cell) cell.textContent = `번역 실패: ${errorMessage}`;
    }
  });
}

export function updateSidebarWithCancelled(): void {
  const tableBody = document.getElementById('translation-table-body');
  if (!tableBody) return;
  const cells = tableBody.querySelectorAll('.translated-text');
  cells.forEach((cell) => {
    if ((cell.textContent || '').includes('번역 중')) {
      cell.textContent = '번역 취소됨';
    }
  });
}

export function injectSidebar(): void {
  if (document.getElementById('jp-translator-sidebar')) return;
  injectSidebarStyles();
  const sidebar = document.createElement('div');
  sidebar.id = 'jp-translator-sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-header">
      <h3>🗾 번역 워크스페이스</h3>
      <div class="sidebar-controls">
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
      <button id="toggle-sep-panel-btn" class="novel-banner-sep-toggle" title="이 소설의 구분선 설정">⚙️ 구분선 설정</button>
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
      <div id="sidebar-log-console"></div>
    </div>
  `;
  document.body.appendChild(sidebar);

  const toggleButton = document.createElement('button');
  toggleButton.id = 'jp-translator-toggle-btn';
  toggleButton.innerHTML = '文';
  document.body.appendChild(toggleButton);

  // 이벤트 리스너 연결
  toggleButton.addEventListener('click', toggleSidebar);
  const closeBtn = document.getElementById('sidebar-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', hideSidebar);

  const toggleSepBtn = document.getElementById('toggle-sep-panel-btn');
  if (toggleSepBtn) toggleSepBtn.addEventListener('click', toggleSeparatorPanel);

  const sepSettingsBtn = document.getElementById('separator-settings-btn');
  if (sepSettingsBtn) sepSettingsBtn.addEventListener('click', toggleSeparatorPanel);

  const closeSepBtn = document.getElementById('close-sep-panel-btn');
  if (closeSepBtn) closeSepBtn.addEventListener('click', toggleSeparatorPanel);

  const addSepBtn = document.getElementById('add-separator-btn');
  const newSepInput = document.getElementById('new-separator-input') as HTMLInputElement | null;
  if (addSepBtn && newSepInput) {
    addSepBtn.addEventListener('click', () => {
      const val = newSepInput.value.trim();
      if (val && !state.activeSeparators.includes(val)) {
        state.activeSeparators.push(val);
        state.separatorConfig.customSeparators.push(val);
        newSepInput.value = '';
        renderSeparatorSettingsPanel();
      }
    });
  }

  const saveSepBtn = document.getElementById('save-separators-btn');
  const defaultCheck = document.getElementById('use-global-defaults-check') as HTMLInputElement | null;
  if (saveSepBtn) {
    saveSepBtn.addEventListener('click', async () => {
      const useDefaults = defaultCheck ? defaultCheck.checked : true;
      await saveNovelSeparators(state.currentNovelTitle, state.separatorConfig.customSeparators, useDefaults);
      logToSidebar(`[구분선 설정] '${state.currentNovelTitle || '기본 소설'}'의 구분선 설정이 저장되었습니다.`);
      toggleSeparatorPanel();
    });
  }

  const turboToggle = document.getElementById('sidebar-turbo-toggle') as HTMLInputElement | null;
  if (turboToggle) {
    turboToggle.addEventListener('change', () => {
      const isChecked = turboToggle.checked;
      if (state.onToggleTurboMode) {
        state.onToggleTurboMode(isChecked, true);
      }
    });
  }

  const turboBadge = document.getElementById('turbo-cutoff-badge');
  if (turboBadge) {
    turboBadge.addEventListener('click', () => {
      if (state.turboCutoffHour === null) {
        state.turboCutoffHour = 16;
      } else if (state.turboCutoffHour === 16) {
        state.turboCutoffHour = 17;
      } else {
        state.turboCutoffHour = null;
      }
      chrome.storage.local.set({ lanovel_turbo_cutoff: state.turboCutoffHour });
      updateTurboBadgeUI();
    });
  }
}
