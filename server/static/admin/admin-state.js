/**
 * admin-state.js
 * Centralized state management, DOM cache, constants, and shared utilities for LANOVEL Admin.
 */

// Japanese characters detection regex
export const JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/;

// Unclassified paragraphs cache map
export const unclassifiedParagraphsMap = new Map();

// Centralized state container
export const state = {
    // Core data
    groupedTranslations: {},
    allFolders: [],
    selectedIds: new Set(),
    translationStatuses: {}, // Holds the apply-status for each URL
    appliedUrlsSet: new Set(),
    rawAbnormalData: null,
    rawCleanupData: null,
    latestQuotaSummary: null,

    // UI state flags
    isLoading: false,
    isFindingEmpty: false,
    isCleanupQueue: false,
    currentAbnormalFilter: 'all',
    activeTargetInput: null,
    currentSearch: '',
    currentRestoreTab: 'notifications',
    isRecommendCollapsed: false,

    // Unclassified novels state
    unclassifiedData: null,
    currentSelectedUnclassifiedNovel: null,

    // App release state
    selectedApkFile: null,

    // Analytics state
    analyticsDataCache: null,
    currentActivityPeriod: '14',
    currentActivityMetric: 'count',
    currentActivityTrendMode: 'daily',

    // Timers
    modalAutoRefreshTimer: null,
    searchTimeout: null,
    findReplaceCountTimeout: null,
    dragSearchTimeout: null,

    // Search Jump Navigation state
    matchedFolders: [],
    currentMatchFolderIndex: -1
};

// DOM elements cache
export const dom = {};

export function cacheDOMElements() {
    dom.historyContainer = document.getElementById('history-container');
    dom.emptyState = document.getElementById('emptyState');
    dom.searchBox = document.getElementById('searchBox');
    dom.searchJumpControls = document.getElementById('searchJumpControls');
    dom.searchMatchCountBadge = document.getElementById('searchMatchCountBadge');
    dom.jumpFirstNovelBtn = document.getElementById('jumpFirstNovelBtn');
    dom.searchSubmitBtn = document.getElementById('searchSubmitBtn');
    dom.searchClearBtn = document.getElementById('searchClearBtn');
    dom.darkModeToggle = document.getElementById('darkModeToggle');
    dom.bulkActionsPanel = document.getElementById('bulk-actions');
    dom.selectionCount = document.getElementById('selection-count');
    dom.deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    dom.moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown');
    dom.folderFilterDropdown = document.getElementById('folderFilterDropdown');

    // Find & Replace Modal Elements
    dom.findReplaceModal = document.getElementById('findReplaceModal');
    dom.closeFindReplaceModalBtn = document.getElementById('closeFindReplaceModal');
    dom.cancelFindReplaceBtn = document.getElementById('cancelFindReplace');
    dom.executeFindReplaceBtn = document.getElementById('executeFindReplace');
    dom.openGlobalFindReplaceBtn = document.getElementById('openGlobalFindReplaceBtn');
    dom.findText = document.getElementById('findText');
    dom.replaceText = document.getElementById('replaceText');
    dom.findCount = document.getElementById('findCount');
    dom.conditionText = document.getElementById('conditionText');
    dom.folderScope = document.getElementById('folderScope');
    dom.useRegex = document.getElementById('useRegex');
    dom.caseSensitive = document.getElementById('caseSensitive');
    dom.createFolderButton = document.getElementById('createFolderButton');
    dom.newFolderNameInput = document.getElementById('newFolderNameInput');
    dom.findEmptyBtn = document.getElementById('findEmptyBtn');
    dom.autoStartCheckbox = document.getElementById('autoStartCheckbox');
    dom.enableDragDropCheckbox = document.getElementById('enableDragDropCheckbox');

    // Cleanup & abnormal & restore center elements
    dom.cleanupQueueBtn = document.getElementById('cleanupQueueBtn');
    dom.openRestoreCenterBtn = document.getElementById('openRestoreCenterBtn');
    dom.notifBadge = document.getElementById('notifBadge');
    dom.abnormalFilterBar = document.getElementById('abnormalFilterBar');
    dom.filterAbnormalAll = document.getElementById('filterAbnormalAll');
    dom.filterAbnormalPartial = document.getElementById('filterAbnormalPartial');
    dom.filterAbnormalOther = document.getElementById('filterAbnormalOther');
    dom.moveToCleanupBtn = document.getElementById('moveToCleanupBtn');
    dom.whitelistSelectedAbnormalBtn = document.getElementById('whitelistSelectedAbnormalBtn');
    dom.cleanupSectionBar = document.getElementById('cleanupSectionBar');
    dom.cleanupSummaryText = document.getElementById('cleanupSummaryText');
    dom.deleteSelectedCleanupBtn = document.getElementById('deleteSelectedCleanupBtn');
    dom.deleteAllCleanupBtn = document.getElementById('deleteAllCleanupBtn');
    dom.cleanupRestoreModal = document.getElementById('cleanupRestoreModal');
    dom.closeRestoreCenterModalBtn = document.getElementById('closeRestoreCenterModal');
    dom.closeRestoreCenterBottomBtn = document.getElementById('closeRestoreCenterBottomBtn');
    dom.tabBtnNotifications = document.getElementById('tabBtnNotifications');
    dom.tabBtnTrash = document.getElementById('tabBtnTrash');
    dom.tabBtnAbnormalWhitelist = document.getElementById('tabBtnAbnormalWhitelist');
    dom.modalNotifBadge = document.getElementById('modalNotifBadge');
    dom.modalTrashBadge = document.getElementById('modalTrashBadge');
    dom.modalWhitelistBadge = document.getElementById('modalWhitelistBadge');
    dom.tabContentNotifications = document.getElementById('tabContentNotifications');
    dom.tabContentTrash = document.getElementById('tabContentTrash');
    dom.tabContentAbnormalWhitelist = document.getElementById('tabContentAbnormalWhitelist');
    dom.notificationsTableBody = document.getElementById('notificationsTableBody');
    dom.trashTableBody = document.getElementById('trashTableBody');
    dom.whitelistTableBody = document.getElementById('whitelistTableBody');
    dom.clearAllWhitelistBtn = document.getElementById('clearAllWhitelistBtn');
    dom.dismissAllNotifsBtn = document.getElementById('dismissAllNotifsBtn');
    dom.refreshNotifsBtn = document.getElementById('refreshNotifsBtn');
    dom.restoreAllTrashBtn = document.getElementById('restoreAllTrashBtn');
    dom.toggleDismissedHistory = document.getElementById('toggleDismissedHistory');
    dom.dismissedHistoryContainer = document.getElementById('dismissedHistoryContainer');
    dom.dismissedTableBody = document.getElementById('dismissedTableBody');
    dom.dismissedNotifsCount = document.getElementById('dismissedNotifsCount');

    // Similar recommend panel elements
    dom.similarRecommendPanel = document.getElementById('similarRecommendPanel');
    dom.recommendKeyword = document.getElementById('recommendKeyword');
    dom.recommendCardsContainer = document.getElementById('recommendCardsContainer');
    dom.closeRecommendPanelBtn = document.getElementById('closeRecommendPanel');
    dom.toggleRecommendPanelBtn = document.getElementById('toggleRecommendPanel');
    dom.recommendToggleIcon = document.getElementById('recommendToggleIcon');
    dom.recommendToggleText = document.getElementById('recommendToggleText');
    dom.recommendHeader = document.getElementById('recommendHeader');
    dom.recommendBodyWrapper = document.getElementById('recommendBodyWrapper');

    // Bulk actions floating dock elements
    dom.deselectAllBtn = document.getElementById('deselectAllBtn');
    dom.retranslateSelectedBtn = document.getElementById('retranslateSelectedBtn');
    dom.copySelectedOriginalBtn = document.getElementById('copySelectedOriginalBtn');
    dom.bulkFindReplaceBtn = document.getElementById('bulkFindReplaceBtn');
    dom.bulkWhitelistAbnormalBtn = document.getElementById('bulkWhitelistAbnormalBtn');
    dom.bulkMoveToCleanupBtn = document.getElementById('bulkMoveToCleanupBtn');
    dom.excludeSelectedBtn = document.getElementById('excludeSelectedBtn');
}

// Visual loaders
export function showCyberLoader() {
    if (window.CyberLoader && typeof window.CyberLoader.start === 'function') {
        window.CyberLoader.start();
    } else {
        const el = document.getElementById('loading-skeleton');
        if (el) el.style.display = 'flex';
    }
}

export async function hideCyberLoader() {
    if (window.CyberLoader && typeof window.CyberLoader.finish === 'function') {
        await window.CyberLoader.finish();
    } else {
        const el = document.getElementById('loading-skeleton');
        if (el) el.style.display = 'none';
    }
}

// Data access helpers
export function getCurrentDataSource() {
    if (state.isFindingEmpty) return state.rawAbnormalData || {};
    if (state.isCleanupQueue) return state.rawCleanupData || {};
    return state.groupedTranslations || {};
}

export function findTranslationById(id) {
    if (unclassifiedParagraphsMap.has(id)) {
        return unclassifiedParagraphsMap.get(id);
    }
    const sources = [state.groupedTranslations, state.rawAbnormalData, state.rawCleanupData];
    for (const data of sources) {
        if (!data) continue;
        for (const folderName in data) {
            const urlGroups = data[folderName];
            if (!Array.isArray(urlGroups)) continue;

            for (const urlGroup of urlGroups) {
                const items = urlGroup.items;
                if (!Array.isArray(items)) continue;

                const item = items.find(t => t.id === id);
                if (item) return item;
            }
        }
    }
    return null;
}

export function getTranslationsList(selectedOnly = false) {
    const list = [];
    const source = getCurrentDataSource();
    if (!source) return list;

    for (const folderName in source) {
        if (folderName.startsWith('_')) continue;
        const groups = source[folderName];
        if (!Array.isArray(groups)) continue;
        for (const grp of groups) {
            for (const item of (grp.items || [])) {
                if (!selectedOnly || state.selectedIds.has(item.id)) {
                    list.push({
                        ...item,
                        folderName: item.folderName || folderName,
                        title: item.title || grp.title || grp.url
                    });
                }
            }
        }
    }
    return list;
}

export function getQuotaWindowStartMs(summary) {
    const resetTimeIso = summary?.period_reset_time_kst;
    if (resetTimeIso) {
        const resetMs = new Date(resetTimeIso).getTime();
        if (!Number.isNaN(resetMs)) {
            return resetMs - (24 * 60 * 60 * 1000);
        }
    }

    const now = new Date();
    const utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
    const kstDate = new Date(utcMs + (9 * 60 * 60 * 1000));
    kstDate.setHours(16, 0, 0, 0);

    const kstNow = new Date(utcMs + (9 * 60 * 60 * 1000));
    if (kstNow.getTime() < kstDate.getTime()) {
        kstDate.setDate(kstDate.getDate() - 1);
    }

    return kstDate.getTime() - (9 * 60 * 60 * 1000);
}

// Utilities
export function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString().replace(/[&<>"'/]/g, s => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
        '/': '&#x2F;'
    })[s]);
}

export function showToast(message, type = 'success', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    while (container.children.length >= 5) {
        container.removeChild(container.firstChild);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = '✓';
    if (type === 'error') icon = '✕';
    else if (type === 'info') icon = 'ℹ';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icon;

    const textSpan = document.createElement('span');
    textSpan.className = 'toast-text';
    textSpan.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = '닫기';

    toast.appendChild(iconSpan);
    toast.appendChild(textSpan);
    toast.appendChild(closeBtn);

    container.appendChild(toast);

    let isDismissed = false;
    const dismiss = () => {
        if (isDismissed) return;
        isDismissed = true;
        toast.classList.remove('show');
        toast.classList.add('removing');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
            if (container && container.children.length === 0) {
                container.remove();
            }
        }, 260);
    };

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismiss();
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
    });

    if (duration > 0) {
        setTimeout(dismiss, duration);
    }
}

export async function fetchAllTitles() {
    if (!confirm('제목이 없는 모든 항목의 제목을 가져오시겠습니까? 이 작업은 시간이 오래 걸릴 수 있습니다.')) return;
    showToast('백그라운드에서 제목 가져오기를 시작합니다...', 'info');
    try {
        const response = await fetch('/fetch_missing_titles', { method: 'POST' });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const result = await response.json();
        showToast(result.message, 'success');
        setTimeout(() => {
            showToast('새로고침하여 새 제목을 확인하세요.', 'info');
            window.dispatchEvent(new CustomEvent('lanovel:refresh-grouped'));
        }, 5000);
    } catch (error) {
        showToast('제목 가져오기 작업을 시작하지 못했습니다.', 'error');
    }
}

export function showConnectionStatus(isOnline) {
    let toast = document.getElementById('connection-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'connection-toast';
        document.body.appendChild(toast);
    }

    if (isOnline) {
        toast.textContent = '온라인 상태입니다.';
        toast.className = 'online';
    } else {
        toast.textContent = '오프라인 상태입니다. 일부 기능이 제한될 수 있습니다.';
        toast.className = 'offline';
    }

    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

export async function saveAutoStartState() {
    if (!dom.autoStartCheckbox) return;
    const isChecked = dom.autoStartCheckbox.checked;
    try {
        const response = await fetch('/api/settings/autostart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ autostart: isChecked })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        showToast(`자동 실행 설정이 ${isChecked ? '활성화' : '비활성화'}되었습니다.`, 'success');
    } catch (error) {
        console.error("Failed to save auto-start setting:", error);
        showToast(`자동 실행 설정 저장 실패: ${error.message}`, 'error');
        dom.autoStartCheckbox.checked = !isChecked;
    }
}
