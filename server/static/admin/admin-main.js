/**
 * admin-main.js
 * Master orchestrator and application entry point for LANOVEL Admin Dashboard.
 * Integrates modular ES sub-systems and coordinates DOM lifecycle.
 */

import {
    state,
    dom,
    cacheDOMElements,
    getCurrentDataSource,
    showConnectionStatus,
    saveAutoStartState
} from './admin-state.js';

import {
    loadAndRenderGrouped,
    handleCheckboxChange,
    handleHistoryClick,
    deleteSelectedTranslations,
    moveSelectedTranslationsToFolder,
    retranslateSelectedTranslations,
    copySelectedOriginals,
    excludeSelectedTranslations,
    deselectAll,
    createFolder,
    renderGroupedHistory
} from './admin-tree.js';

import {
    closeRecommendPanel,
    toggleRecommendCollapse,
    handleTranslatedFocus,
    loadSimilarRecommendations,
    handleRecommendCardClick,
    handleDocumentMouseUp
} from './admin-dock.js';

import {
    initStatsAnalyticsModal
} from './admin-analytics.js';

import {
    openFindReplaceModal,
    closeFindReplaceModal,
    executeGlobalFindReplace,
    countOccurrences
} from './admin-find-replace.js';

import {
    setAbnormalFilter,
    toggleFindEmpty,
    toggleCleanupQueue,
    deleteSelectedCleanup,
    deleteAllCleanup,
    moveToCleanupQueueSelected,
    whitelistSelectedAbnormal,
    loadNotificationsAndBadge,
    openRestoreCenterModal,
    closeRestoreCenterModal,
    switchRestoreTab,
    dismissNotification,
    dismissAllNotifications,
    toggleDismissedHistoryView,
    restoreTrashItem,
    restoreAllTrash,
    loadAndRenderNotifications,
    clearAllAbnormalWhitelist,
    removeSingleWhitelist
} from './admin-restore.js';

import {
    initAppReleaseModal,
    initUnclassifiedDrawer,
    checkAndLoadUnclassifiedNovels
} from './admin-drawer.js';

// Theme toggling
export function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    try {
        localStorage.setItem('lanovel_dark_mode', isDark ? 'true' : 'false');
    } catch (_) {}
}

export function loadDarkModePreference() {
    try {
        if (localStorage.getItem('lanovel_dark_mode') === 'true') {
            document.body.classList.add('dark-mode');
        }
    } catch (_) {}
}

// Master event listeners
export function setupEventListeners() {
    if (dom.searchBox) {
        dom.searchBox.addEventListener('input', (e) => {
            clearTimeout(state.searchTimeout);
            state.searchTimeout = setTimeout(() => {
                state.currentSearch = e.target.value.toLowerCase();
                const selectedFolder = dom.folderFilterDropdown ? dom.folderFilterDropdown.value : '';
                if (state.isFindingEmpty && state.rawAbnormalData) {
                    renderGroupedHistory(state.rawAbnormalData, selectedFolder);
                } else if (state.isCleanupQueue && state.rawCleanupData) {
                    renderGroupedHistory(state.rawCleanupData, selectedFolder);
                } else {
                    renderGroupedHistory(state.groupedTranslations, selectedFolder);
                }
            }, 300);
        });
    }

    // 소설/폴더 필터 드롭다운 선택 시 해당 소설만 즉시 표시하고 자동으로 회차 목록 펼침
    if (dom.folderFilterDropdown) {
        dom.folderFilterDropdown.addEventListener('change', (e) => {
            const selectedFolder = e.target.value;
            const currentData = getCurrentDataSource();
            renderGroupedHistory(currentData, selectedFolder);
        });
    }

    if (dom.findEmptyBtn) dom.findEmptyBtn.addEventListener('click', toggleFindEmpty);

    if (dom.historyContainer) {
        dom.historyContainer.addEventListener('click', handleHistoryClick);
        dom.historyContainer.addEventListener('change', handleCheckboxChange);
        dom.historyContainer.addEventListener('focusin', (e) => {
            if (e.target.classList.contains('translated-text')) {
                handleTranslatedFocus(e.target);
            }
        });
    }

    if (dom.darkModeToggle) dom.darkModeToggle.addEventListener('click', toggleDarkMode);
    if (dom.deleteSelectedBtn) dom.deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    if (dom.moveSelectedToFolderDropdown) dom.moveSelectedToFolderDropdown.addEventListener('change', moveSelectedTranslationsToFolder);

    // Find & Replace Listeners
    if (dom.openGlobalFindReplaceBtn) dom.openGlobalFindReplaceBtn.addEventListener('click', openFindReplaceModal);
    if (dom.closeFindReplaceModalBtn) dom.closeFindReplaceModalBtn.addEventListener('click', closeFindReplaceModal);
    if (dom.cancelFindReplaceBtn) dom.cancelFindReplaceBtn.addEventListener('click', closeFindReplaceModal);
    if (dom.executeFindReplaceBtn) dom.executeFindReplaceBtn.addEventListener('click', executeGlobalFindReplace);

    if (dom.findText) {
        dom.findText.addEventListener('input', () => {
            clearTimeout(state.findReplaceCountTimeout);
            state.findReplaceCountTimeout = setTimeout(countOccurrences, 400);
        });
    }

    [dom.conditionText, dom.useRegex, dom.caseSensitive, dom.folderScope].forEach(element => {
        if (!element) return;
        element.addEventListener('input', () => {
            clearTimeout(state.findReplaceCountTimeout);
            state.findReplaceCountTimeout = setTimeout(countOccurrences, 300);
        });
        if (element.type === 'checkbox' || element.tagName === 'SELECT') {
            element.addEventListener('change', () => {
                clearTimeout(state.findReplaceCountTimeout);
                state.findReplaceCountTimeout = setTimeout(countOccurrences, 300);
            });
        }
    });

    if (dom.createFolderButton) dom.createFolderButton.addEventListener('click', createFolder);
    if (dom.autoStartCheckbox) dom.autoStartCheckbox.addEventListener('change', saveAutoStartState);

    // Floating bulk actions dock
    if (dom.deselectAllBtn) dom.deselectAllBtn.addEventListener('click', deselectAll);
    if (dom.retranslateSelectedBtn) dom.retranslateSelectedBtn.addEventListener('click', retranslateSelectedTranslations);
    if (dom.copySelectedOriginalBtn) dom.copySelectedOriginalBtn.addEventListener('click', copySelectedOriginals);
    if (dom.bulkFindReplaceBtn) dom.bulkFindReplaceBtn.addEventListener('click', openFindReplaceModal);
    if (dom.bulkWhitelistAbnormalBtn) dom.bulkWhitelistAbnormalBtn.addEventListener('click', whitelistSelectedAbnormal);
    if (dom.bulkMoveToCleanupBtn) dom.bulkMoveToCleanupBtn.addEventListener('click', moveToCleanupQueueSelected);
    if (dom.excludeSelectedBtn) dom.excludeSelectedBtn.addEventListener('click', excludeSelectedTranslations);

    // Cleanup queue toolbar & actions
    if (dom.cleanupQueueBtn) dom.cleanupQueueBtn.addEventListener('click', toggleCleanupQueue);
    if (dom.deleteSelectedCleanupBtn) dom.deleteSelectedCleanupBtn.addEventListener('click', deleteSelectedCleanup);
    if (dom.deleteAllCleanupBtn) dom.deleteAllCleanupBtn.addEventListener('click', deleteAllCleanup);

    // Abnormal sub-filters & actions
    if (dom.filterAbnormalAll) dom.filterAbnormalAll.addEventListener('click', () => setAbnormalFilter('all'));
    if (dom.filterAbnormalPartial) dom.filterAbnormalPartial.addEventListener('click', () => setAbnormalFilter('partial_untranslated'));
    if (dom.filterAbnormalOther) dom.filterAbnormalOther.addEventListener('click', () => setAbnormalFilter('other_language'));
    if (dom.moveToCleanupBtn) dom.moveToCleanupBtn.addEventListener('click', moveToCleanupQueueSelected);
    if (dom.whitelistSelectedAbnormalBtn) dom.whitelistSelectedAbnormalBtn.addEventListener('click', whitelistSelectedAbnormal);

    // Restore Center Modal & Tabs
    if (dom.openRestoreCenterBtn) dom.openRestoreCenterBtn.addEventListener('click', () => openRestoreCenterModal('notifications'));
    if (dom.closeRestoreCenterModalBtn) dom.closeRestoreCenterModalBtn.addEventListener('click', closeRestoreCenterModal);
    if (dom.closeRestoreCenterBottomBtn) dom.closeRestoreCenterBottomBtn.addEventListener('click', closeRestoreCenterModal);
    if (dom.tabBtnNotifications) dom.tabBtnNotifications.addEventListener('click', () => switchRestoreTab('notifications'));
    if (dom.tabBtnTrash) dom.tabBtnTrash.addEventListener('click', () => switchRestoreTab('trash'));
    if (dom.tabBtnAbnormalWhitelist) dom.tabBtnAbnormalWhitelist.addEventListener('click', () => switchRestoreTab('whitelist'));
    if (dom.dismissAllNotifsBtn) dom.dismissAllNotifsBtn.addEventListener('click', dismissAllNotifications);
    if (dom.refreshNotifsBtn) dom.refreshNotifsBtn.addEventListener('click', () => loadAndRenderNotifications(false));
    if (dom.restoreAllTrashBtn) dom.restoreAllTrashBtn.addEventListener('click', restoreAllTrash);
    if (dom.clearAllWhitelistBtn) dom.clearAllWhitelistBtn.addEventListener('click', clearAllAbnormalWhitelist);
    if (dom.toggleDismissedHistory) dom.toggleDismissedHistory.addEventListener('click', toggleDismissedHistoryView);

    // Delegated actions for modal tables
    if (dom.notificationsTableBody) {
        dom.notificationsTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.dismiss-notif-btn');
            if (btn && btn.dataset.id) {
                dismissNotification(parseInt(btn.dataset.id));
            }
        });
    }
    if (dom.trashTableBody) {
        dom.trashTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.restore-trash-btn');
            if (btn && btn.dataset.id) {
                restoreTrashItem(parseInt(btn.dataset.id));
            }
        });
    }
    if (dom.whitelistTableBody) {
        dom.whitelistTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-whitelist-btn');
            if (btn && btn.dataset.id) {
                removeSingleWhitelist(parseInt(btn.dataset.id));
            }
        });
    }

    // Recommendation panel actions
    if (dom.closeRecommendPanelBtn) dom.closeRecommendPanelBtn.addEventListener('click', closeRecommendPanel);
    if (dom.toggleRecommendPanelBtn) {
        dom.toggleRecommendPanelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRecommendCollapse();
        });
    }
    if (dom.recommendHeader) {
        dom.recommendHeader.addEventListener('click', (e) => {
            if (e.target.closest('#closeRecommendPanel') || e.target.closest('#toggleRecommendPanel') || e.target.closest('a') || e.target.closest('.kw-chip')) {
                return;
            }
            toggleRecommendCollapse();
        });
    }
    if (dom.recommendCardsContainer) {
        dom.recommendCardsContainer.addEventListener('click', handleRecommendCardClick);
    }
    if (dom.recommendKeyword) {
        dom.recommendKeyword.addEventListener('click', (e) => {
            const chip = e.target.closest('.kw-chip');
            if (chip && chip.dataset.kw) {
                const folder = state.activeTargetInput ? (state.activeTargetInput.dataset.folder || '') : '';
                loadSimilarRecommendations(chip.dataset.kw, folder);
            }
        });
    }

    // Translation drag / text selection listener for similar recommendations
    document.addEventListener('mouseup', handleDocumentMouseUp);
    document.addEventListener('keyup', (e) => {
        if (e.key && (e.key.startsWith('Arrow') || e.key === 'Shift')) {
            handleDocumentMouseUp(e);
        }
    });

    // Subsystem initializations
    initStatsAnalyticsModal();
    initAppReleaseModal();
    initUnclassifiedDrawer();

    // 키워드 칩 클릭 → 찾아바꾸기 모달 열기
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.keyword-chip');
        if (!chip) return;
        const keyword = chip.dataset.keyword;
        const folder = chip.dataset.folder;
        openFindReplaceModal();
        if (dom.findText) dom.findText.value = keyword;
        // 폴더가 있으면 folderScope 자동 선택 (dropdown 렌더링 이후)
        if (folder && dom.folderScope) {
            setTimeout(() => {
                const opt = Array.from(dom.folderScope.options).find(o => o.value === folder);
                if (opt) dom.folderScope.value = folder;
            }, 50);
        }
        // 카운트 자동 갱신
        if (dom.findText) {
            setTimeout(() => {
                dom.findText.dispatchEvent(new Event('input'));
            }, 100);
        }
    });
}

// Online / Offline listener
window.addEventListener('online', () => showConnectionStatus(true));
window.addEventListener('offline', () => showConnectionStatus(false));

// --- URL Deep Linking (Auto-search & Novel Filter from Context Viewer) ---
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const searchVal = params.get('search');
    const folderVal = params.get('folder');
    if (searchVal || folderVal) {
        const tryApplyParams = () => {
            const folderDropdown = document.getElementById('folderFilterDropdown');
            const searchInput = document.getElementById('searchBox');
            if (folderVal && folderDropdown) {
                folderDropdown.value = folderVal;
                folderDropdown.dispatchEvent(new Event('change'));
            }
            if (searchVal && searchInput) {
                searchInput.value = searchVal;
                searchInput.dispatchEvent(new Event('input'));
                searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                searchInput.focus();
            }
        };
        setTimeout(tryApplyParams, 600);
        setTimeout(tryApplyParams, 1200);
    }
});

// Main bootstrap
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    loadDarkModePreference();
    loadAndRenderGrouped();
    loadNotificationsAndBadge();
    checkAndLoadUnclassifiedNovels();
});
