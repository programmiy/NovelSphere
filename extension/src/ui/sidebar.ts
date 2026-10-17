// sidebar.ts: 번역 워크스페이스 사이드바 UI 및 뷰어 렌더링 모듈
import { state } from '../core/state';
import { TranslationRecord } from '../types/novel';
import { PRESET_SEPARATORS, saveNovelSeparators, loadNovelSeparators } from '../core/separators';
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
      color: #212529 !important;
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
    .sidebar-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 10px 15px !important;
      background-color: #667eea !important;
      color: white !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .sidebar-header h3 {
      margin: 0 !important;
      font-size: 16px !important;
      color: white !important;
      font-weight: 600 !important;
    }
    .sidebar-controls {
      display: flex !important;
      align-items: center !important;
      gap: 4px !important;
    }
    .sidebar-controls button {
      background: none !important;
      border: none !important;
      color: white !important;
      font-size: 18px !important;
      cursor: pointer !important;
      margin-left: 4px !important;
      padding: 2px 4px !important;
      line-height: 1 !important;
      border-radius: 4px !important;
      transition: background-color 0.2s !important;
    }
    .sidebar-controls button:hover {
      background-color: rgba(255, 255, 255, 0.2) !important;
    }
    .sidebar-novel-banner {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 7px 12px !important;
      background: #eef2ff !important;
      border-bottom: 1px solid #c7d2fe !important;
      font-size: 12px !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .novel-banner-info {
      display: flex !important;
      align-items: center !important;
      gap: 5px !important;
      overflow: hidden !important;
      flex: 1 !important;
    }
    .novel-banner-icon {
      font-size: 14px !important;
    }
    .novel-banner-title {
      font-weight: 600 !important;
      color: #3730a3 !important;
      max-width: 220px !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      border-bottom: 1px dashed #6366f1 !important;
    }
    .novel-banner-title:hover {
      color: #4338ca !important;
      background: #e0e7ff !important;
    }
    .novel-banner-btn {
      background: none !important;
      border: none !important;
      cursor: pointer !important;
      font-size: 12px !important;
      padding: 0 2px !important;
      line-height: 1 !important;
    }
    .novel-banner-sep-toggle {
      background: #4f46e5 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 3px 8px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      font-weight: 500 !important;
      white-space: nowrap !important;
      transition: background-color 0.2s !important;
    }
    .novel-banner-sep-toggle:hover {
      background: #4338ca !important;
    }
    .sidebar-apply-banner {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 8px 12px !important;
      background: #ffffff !important;
      border-bottom: 1px solid #e2e8f0 !important;
      font-size: 12px !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .apply-status-info {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
    }
    .status-dot {
      width: 8px !important;
      height: 8px !important;
      border-radius: 50% !important;
      background-color: #94a3b8 !important;
      display: inline-block !important;
      transition: background-color 0.3s !important;
    }
    .status-dot.applied {
      background-color: #10b981 !important;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.6) !important;
    }
    .apply-status-text {
      font-weight: 600 !important;
      color: #475569 !important;
    }
    .apply-status-text.applied {
      color: #059669 !important;
    }
    .apply-stats-count {
      font-size: 11px !important;
      color: #64748b !important;
    }
    .sidebar-apply-btn {
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      border: 1px solid #cbd5e1 !important;
      background: #f8fafc !important;
      color: #334155 !important;
      padding: 4px 10px !important;
      border-radius: 5px !important;
      font-size: 11.5px !important;
      font-weight: 500 !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
    }
    .sidebar-apply-btn:hover {
      background: #f1f5f9 !important;
      border-color: #94a3b8 !important;
    }
    .sidebar-apply-btn.applied {
      background: #10b981 !important;
      border-color: #059669 !important;
      color: white !important;
    }
    .sidebar-apply-btn.applied:hover {
      background: #059669 !important;
    }
    .separator-settings-panel {
      background: #ffffff !important;
      border-bottom: 2px solid #6366f1 !important;
      padding: 12px 14px !important;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1) !important;
      font-size: 12px !important;
      max-height: 380px !important;
      overflow-y: auto !important;
      flex-shrink: 0 !important;
      box-sizing: border-box !important;
    }
    .sep-panel-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-bottom: 8px !important;
    }
    .sep-panel-title {
      font-weight: 600 !important;
      color: #1e1b4b !important;
      font-size: 13px !important;
    }
    .sep-close-btn {
      background: none !important;
      border: none !important;
      font-size: 18px !important;
      cursor: pointer !important;
      color: #64748b !important;
      line-height: 1 !important;
    }
    .sep-info-box {
      background: #f8f9fa !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 4px !important;
      padding: 6px 10px !important;
      margin-bottom: 8px !important;
      color: #475569 !important;
      font-size: 11px !important;
      line-height: 1.4 !important;
    }
    .sep-novel-name {
      font-weight: 600 !important;
      color: #4f46e5 !important;
    }
    .sep-form-group {
      margin-bottom: 8px !important;
    }
    .sep-checkbox-label {
      display: flex !important;
      align-items: center !important;
      gap: 6px !important;
      cursor: pointer !important;
      color: #334155 !important;
      font-size: 11.5px !important;
    }
    .sep-section-title {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #475569 !important;
      margin: 8px 0 4px !important;
    }
    .sep-tags-wrap {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 5px !important;
      margin-bottom: 8px !important;
      min-height: 26px !important;
    }
    .sep-tag {
      display: inline-flex !important;
      align-items: center !important;
      background: #e0e7ff !important;
      color: #3730a3 !important;
      padding: 2px 7px !important;
      border-radius: 12px !important;
      font-size: 11px !important;
      font-weight: 500 !important;
    }
    .sep-tag.is-custom {
      background: #fef3c7 !important;
      color: #92400e !important;
      border: 1px solid #fde68a !important;
    }
    .sep-tag-remove {
      margin-left: 4px !important;
      cursor: pointer !important;
      color: #ef4444 !important;
      font-weight: bold !important;
      font-size: 13px !important;
    }
    .sep-tag-remove:hover {
      color: #b91c1c !important;
    }
    .sep-presets-wrap {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 4px !important;
      margin-bottom: 8px !important;
    }
    .sep-preset-btn {
      background: #f1f5f9 !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px !important;
      padding: 2px 6px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      color: #334155 !important;
      transition: background 0.2s !important;
    }
    .sep-preset-btn:hover {
      background: #e2e8f0 !important;
    }
    .sep-input-row {
      display: flex !important;
      gap: 4px !important;
      margin-bottom: 10px !important;
    }
    .sep-input {
      flex: 1 !important;
      padding: 4px 8px !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px !important;
      font-size: 12px !important;
      outline: none !important;
    }
    .sep-input:focus {
      border-color: #6366f1 !important;
    }
    .sep-add-btn {
      background: #6366f1 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 4px 10px !important;
      font-size: 12px !important;
      cursor: pointer !important;
    }
    .sep-add-btn:hover {
      background: #4f46e5 !important;
    }
    .sep-panel-footer {
      display: flex !important;
      justify-content: flex-end !important;
      gap: 6px !important;
      border-top: 1px solid #f1f5f9 !important;
      padding-top: 8px !important;
    }
    .sep-save-btn {
      background: #10b981 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 5px 12px !important;
      font-size: 12px !important;
      cursor: pointer !important;
      font-weight: 500 !important;
    }
    .sep-save-btn:hover {
      background: #059669 !important;
    }
    .sep-reset-btn {
      background: #94a3b8 !important;
      color: white !important;
      border: none !important;
      border-radius: 4px !important;
      padding: 5px 10px !important;
      font-size: 12px !important;
      cursor: pointer !important;
    }
    .sep-reset-btn:hover {
      background: #64748b !important;
    }
    .sidebar-content {
      flex-grow: 1 !important;
      overflow-y: auto !important;
      box-sizing: border-box !important;
    }
    #translation-table {
      width: 100% !important;
      border-collapse: collapse !important;
      table-layout: fixed !important;
    }
    #translation-table th, #translation-table td {
      padding: 8px 10px !important;
      text-align: left !important;
      border-bottom: 1px solid #e9ecef !important;
      box-sizing: border-box !important;
      vertical-align: top !important;
    }
    #translation-table th:nth-child(1) {
      width: 40% !important;
    }
    #translation-table th:nth-child(2) {
      width: 42% !important;
    }
    #translation-table th:nth-child(3) {
      width: 18% !important;
    }
    #translation-table th {
      background-color: #f1f3f5 !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #495057 !important;
    }
    #translation-table tbody tr {
      cursor: pointer !important;
      transition: background-color 0.2s !important;
    }
    #translation-table tbody tr:hover {
      background-color: #f1f5f9 !important;
    }
    #translation-table .original-text {
      font-size: 13px !important;
      color: #495057 !important;
      word-break: break-all !important;
      line-height: 1.5 !important;
    }
    #translation-table .translated-text {
      font-size: 13px !important;
      color: #212529 !important;
      outline: none !important;
      width: 100% !important;
      word-break: break-all !important;
      line-height: 1.5 !important;
      -webkit-user-modify: read-write-plaintext-only !important;
    }
    #translation-table .translated-text:focus {
      background-color: #e9f7fd !important;
      border-radius: 3px !important;
    }
    #translation-table .action-btns {
      display: flex !important;
      gap: 4px !important;
      align-items: center !important;
    }
    #translation-table .save-btn {
      background-color: #4CAF50 !important;
      color: white !important;
      border: none !important;
      padding: 4px 6px !important;
      border-radius: 4px !important;
      cursor: pointer !important;
      font-size: 11px !important;
      white-space: nowrap !important;
      transition: background-color 0.2s !important;
    }
    #translation-table .save-btn:hover {
      background-color: #45a049 !important;
    }
    #translation-table .save-btn:disabled {
      background-color: #cccccc !important;
      cursor: not-allowed !important;
    }
    #translation-table .retranslate-row-btn {
      background: #ffffff !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px !important;
      padding: 3px 5px !important;
      cursor: pointer !important;
      font-size: 11px !important;
      line-height: 1 !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.2s !important;
    }
    #translation-table .retranslate-row-btn:hover {
      background: #f1f5f9 !important;
      border-color: #94a3b8 !important;
    }
    #translation-table .retranslate-row-btn:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
    }
    .lanovel-row-highlight {
      animation: lanovelRowPulse 1.5s ease-out !important;
    }
    @keyframes lanovelRowPulse {
      0% { background-color: #fef08a !important; }
      100% { background-color: transparent !important; }
    }
    @keyframes lanovelPulse {
      0% { background-color: rgba(99, 102, 241, 0.4) !important; outline: 2px solid #6366f1 !important; outline-offset: 2px !important; }
      50% { background-color: rgba(99, 102, 241, 0.18) !important; outline: 2px solid #818cf8 !important; outline-offset: 2px !important; }
      100% { background-color: transparent !important; outline: none !important; }
    }
    .lanovel-highlight-pulse {
      animation: lanovelPulse 1.5s ease-out !important;
      border-radius: 4px !important;
    }
    .review-target-card {
      background: #ffffff !important;
      border: 1px solid #fde68a !important;
      border-left: 3px solid #f59e0b !important;
      border-radius: 6px !important;
      padding: 6px 8px !important;
      margin-bottom: 6px !important;
      cursor: pointer !important;
      transition: all 0.2s !important;
    }
    .review-target-card:hover {
      background: #fffdf5 !important;
      border-color: #f59e0b !important;
      transform: translateX(2px) !important;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05) !important;
    }
    .review-target-card .card-top {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin-bottom: 4px !important;
    }
    .review-target-card .pid-badge {
      font-size: 10px !important;
      font-weight: 700 !important;
      color: #b45309 !important;
    }
    .review-target-card .reason-badge {
      font-size: 10px !important;
      background: #fef3c7 !important;
      color: #92400e !important;
      padding: 1px 5px !important;
      border-radius: 4px !important;
    }
    .review-target-card .card-body .orig-text {
      color: #4b5563 !important;
      font-size: 11px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      margin-bottom: 2px !important;
    }
    .review-target-card .card-body .trans-text {
      color: #1f2937 !important;
      font-weight: 600 !important;
      font-size: 12px !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .review-panel-close-btn {
      background: none !important;
      border: none !important;
      font-size: 18px !important;
      cursor: pointer !important;
      color: #b45309 !important;
      line-height: 1 !important;
    }
    .sidebar-footer {
      flex-shrink: 0 !important;
      border-top: 1px solid #334155 !important;
      background-color: #0f172a !important;
      color: #e2e8f0 !important;
      font-family: Consolas, "Fira Code", Menlo, Monaco, monospace !important;
      font-size: 11px !important;
      max-height: 145px !important;
      display: flex !important;
      flex-direction: column !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
    }
    .sidebar-footer-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      padding: 4px 10px !important;
      background: #1e293b !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
      flex-shrink: 0 !important;
      user-select: none !important;
    }
    .footer-header-title {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #94a3b8 !important;
      letter-spacing: -0.2px !important;
    }
    .footer-clear-btn {
      background: none !important;
      border: 1px solid rgba(255, 255, 255, 0.15) !important;
      color: #94a3b8 !important;
      border-radius: 3px !important;
      font-size: 10px !important;
      padding: 1px 6px !important;
      cursor: pointer !important;
      line-height: 1.2 !important;
      transition: all 0.15s ease !important;
    }
    .footer-clear-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
      color: #f1f5f9 !important;
      border-color: rgba(255, 255, 255, 0.3) !important;
    }
    #sidebar-log-console {
      padding: 6px 10px !important;
      overflow-y: auto !important;
      flex: 1 !important;
      box-sizing: border-box !important;
    }
    #sidebar-log-console::-webkit-scrollbar {
      width: 5px !important;
    }
    #sidebar-log-console::-webkit-scrollbar-thumb {
      background: #334155 !important;
      border-radius: 3px !important;
    }
    #sidebar-log-console p, #sidebar-log-console .log-entry {
      margin: 0 0 4px !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
      padding-bottom: 3px !important;
      line-height: 1.45 !important;
      word-break: break-all !important;
      display: flex !important;
      align-items: baseline !important;
      gap: 6px !important;
      font-size: 11px !important;
    }
    .log-time {
      color: #64748b !important;
      font-size: 10.5px !important;
      flex-shrink: 0 !important;
      user-select: none !important;
      font-family: inherit !important;
    }
    .log-msg {
      color: #e2e8f0 !important;
      flex: 1 !important;
      font-family: inherit !important;
    }
    .log-error, .log-error .log-msg {
      color: #f87171 !important;
    }
    .log-info, .log-info .log-msg {
      color: #38bdf8 !important;
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

  const cardList = panel.querySelector<HTMLElement>('.review-panel-list');
  if (cardList) {
    cardList.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target ? target.closest<HTMLElement>('.review-target-card') : null;
      if (card && card.dataset.pid) {
        handleSidebarRowClick(card.dataset.pid);
      }
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

export function handleSidebarRowClick(pid: string, e?: MouseEvent): void {
  if (e) {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.closest('button') ||
        target.closest('.translated-text') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA')
    ) {
      return;
    }
  }

  // 1. 사이드바 테이블 내 해당 행 하이라이트
  const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
  if (row) {
    row.classList.remove('lanovel-row-highlight');
    void row.offsetWidth;
    row.classList.add('lanovel-row-highlight');
    setTimeout(() => {
      row.classList.remove('lanovel-row-highlight');
    }, 1600);
  }

  // 2. 소설 웹페이지 본문 문단으로 부드럽게 스크롤 & 형광 테두리 강조
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

export function addPlaceholderRows(items: Array<{ id: string; text: string }>): void {
  const tableBody = document.getElementById('translation-table-body') as HTMLTableSectionElement | null;
  if (!tableBody) return;

  items.forEach((item) => {
    let row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${item.id}"]`);
    if (!row) {
      const newRow = tableBody.insertRow(0);
      newRow.setAttribute('data-pid', item.id);
      newRow.addEventListener('click', (e) => handleSidebarRowClick(item.id, e));
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
      tableBody.prepend(row);
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

  const pid = String(translation.pid);
  const row = tableBody.insertRow();
  row.setAttribute('data-pid', pid);
  row.addEventListener('click', (e) => handleSidebarRowClick(pid, e));
  const isReviewTarget = state.reviewTargetPids.has(pid);
  if (isReviewTarget) {
    row.classList.add('review-target-row');
    const p = document.getElementById(pid);
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
      <div class="sidebar-footer-header">
        <span class="footer-header-title">📡 시스템 알림 및 진행 로그</span>
        <button id="clear-sidebar-log-btn" class="footer-clear-btn" title="로그 지우기">비우기</button>
      </div>
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

  const clearLogBtn = document.getElementById('clear-sidebar-log-btn');
  if (clearLogBtn) {
    clearLogBtn.addEventListener('click', () => {
      const consoleEl = document.getElementById('sidebar-log-console');
      if (consoleEl) consoleEl.innerHTML = '';
    });
  }

  const editNovelTitleBtn = document.getElementById('edit-novel-title-btn');
  const novelTitleDisplay = document.getElementById('current-novel-title-display');
  const handleEditNovelTitle = async () => {
    const newTitle = prompt('현재 소설의 제목을 입력하세요 (소설별 구분선 및 폴더 기준이 됩니다):', state.currentNovelTitle);
    if (newTitle && newTitle.trim() && newTitle.trim() !== state.currentNovelTitle) {
      state.currentNovelTitle = newTitle.trim();
      updateNovelTitleUI(state.currentNovelTitle);
      state.separatorConfig = await loadNovelSeparators(state.currentNovelTitle);
      state.activeSeparators = state.separatorConfig.effectiveSeparators;
      renderSeparatorSettingsPanel();
      logToSidebar(`소설 제목이 '${state.currentNovelTitle}'(으)로 변경되었습니다.`);
    }
  };
  if (editNovelTitleBtn) editNovelTitleBtn.addEventListener('click', handleEditNovelTitle);
  if (novelTitleDisplay) novelTitleDisplay.addEventListener('click', handleEditNovelTitle);

  const excludedBtn = document.getElementById('sidebar-excluded-list-btn');
  if (excludedBtn) {
    excludedBtn.addEventListener('click', () => {
      const panel = document.getElementById('separator-exclude-panel');
      if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }
    });
  }

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

  const tableBody = document.getElementById('translation-table-body');
  if (tableBody) {
    tableBody.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('button') ||
        target.closest('.translated-text') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA'
      ) {
        return;
      }
      const row = target.closest<HTMLTableRowElement>('tr[data-pid]');
      if (row && row.dataset.pid) {
        handleSidebarRowClick(row.dataset.pid, e);
      }
    });
  }
}
