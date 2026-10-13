// Global state
const JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/;
let groupedTranslations = {};
let allFolders = [];
let selectedIds = new Set();

// UI state
let isLoading = false;
let isFindingEmpty = false;
let isCleanupQueue = false;
let currentAbnormalFilter = 'all';
let activeTargetInput = null;
let currentSearch = '';
let translationStatuses = {}; // Holds the apply-status for each URL
let appliedUrlsSet = new Set();
let rawAbnormalData = null;
let rawCleanupData = null;
let latestQuotaSummary = null;


// DOM element cache
let historyContainer, emptyState, searchBox, darkModeToggle, bulkActionsPanel, selectionCount, deleteSelectedBtn, moveSelectedToFolderDropdown, findReplaceModal, closeFindReplaceModalBtn, cancelFindReplaceBtn, executeFindReplaceBtn, openGlobalFindReplaceBtn, createFolderButton, newFolderNameInput, findEmptyBtn, findText, replaceText, findCount, conditionText, folderScope, useRegex, caseSensitive, autoStartCheckbox, enableDragDropCheckbox;
let cleanupQueueBtn, openRestoreCenterBtn, notifBadge, abnormalFilterBar, filterAbnormalAll, filterAbnormalPartial, filterAbnormalOther, moveToCleanupBtn, whitelistSelectedAbnormalBtn, cleanupSectionBar, cleanupSummaryText, deleteSelectedCleanupBtn, deleteAllCleanupBtn, cleanupRestoreModal, closeRestoreCenterModalBtn, closeRestoreCenterBottomBtn, tabBtnNotifications, tabBtnTrash, tabBtnAbnormalWhitelist, modalNotifBadge, modalTrashBadge, modalWhitelistBadge, tabContentNotifications, tabContentTrash, tabContentAbnormalWhitelist, notificationsTableBody, trashTableBody, whitelistTableBody, clearAllWhitelistBtn, dismissAllNotifsBtn, refreshNotifsBtn, restoreAllTrashBtn, toggleDismissedHistory, dismissedHistoryContainer, dismissedTableBody, dismissedNotifsCount, similarRecommendPanel, recommendKeyword, recommendCardsContainer, closeRecommendPanelBtn, toggleRecommendPanelBtn, recommendToggleIcon, recommendToggleText, recommendHeader, recommendBodyWrapper;
let isRecommendCollapsed = false;
let modalAutoRefreshTimer = null;
let currentRestoreTab = 'notifications';
let deselectAllBtn, retranslateSelectedBtn, copySelectedOriginalBtn, bulkFindReplaceBtn, bulkWhitelistAbnormalBtn, bulkMoveToCleanupBtn, excludeSelectedBtn;
let openNtfySettingsBtn, ntfySettingsModal, closeNtfySettingsBtn, closeNtfySettingsBottomBtn, ntfyEnabledCheckbox, ntfyServerInput, ntfyTopicInput, ntfyProgressStepSelect, sendNtfyTestBtn, saveNtfySettingsBtn, ntfyTopicLink, ntfyTestResult;

// Debounce timer
let searchTimeout;
let findReplaceCountTimeout;

// SortableJS instances
let sortableInstances = [];

// Main initialization
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    loadDarkModePreference();
    loadAndRenderGrouped();
    loadNotificationsAndBadge();
});

function cacheDOMElements() {
    historyContainer = document.getElementById('history-container');
    emptyState = document.getElementById('emptyState');
    searchBox = document.getElementById('searchBox');
    darkModeToggle = document.getElementById('darkModeToggle');
    bulkActionsPanel = document.getElementById('bulk-actions');
    selectionCount = document.getElementById('selection-count');
    deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown');
    // Find & Replace Modal Elements
    findReplaceModal = document.getElementById('findReplaceModal');
    closeFindReplaceModalBtn = document.getElementById('closeFindReplaceModal');
    cancelFindReplaceBtn = document.getElementById('cancelFindReplace');
    executeFindReplaceBtn = document.getElementById('executeFindReplace');
    openGlobalFindReplaceBtn = document.getElementById('openGlobalFindReplaceBtn');
    findText = document.getElementById('findText');
    replaceText = document.getElementById('replaceText');
    findCount = document.getElementById('findCount');
    conditionText = document.getElementById('conditionText');
    folderScope = document.getElementById('folderScope');
    useRegex = document.getElementById('useRegex');
    caseSensitive = document.getElementById('caseSensitive');
    createFolderButton = document.getElementById('createFolderButton');
    newFolderNameInput = document.getElementById('newFolderNameInput');
    findEmptyBtn = document.getElementById('findEmptyBtn');
    autoStartCheckbox = document.getElementById('autoStartCheckbox'); // Cache the auto-start checkbox
    enableDragDropCheckbox = document.getElementById('enableDragDropCheckbox');

    // New cleanup & abnormal & restore center elements
    cleanupQueueBtn = document.getElementById('cleanupQueueBtn');
    openRestoreCenterBtn = document.getElementById('openRestoreCenterBtn');
    notifBadge = document.getElementById('notifBadge');
    abnormalFilterBar = document.getElementById('abnormalFilterBar');
    filterAbnormalAll = document.getElementById('filterAbnormalAll');
    filterAbnormalPartial = document.getElementById('filterAbnormalPartial');
    filterAbnormalOther = document.getElementById('filterAbnormalOther');
    moveToCleanupBtn = document.getElementById('moveToCleanupBtn');
    whitelistSelectedAbnormalBtn = document.getElementById('whitelistSelectedAbnormalBtn');
    cleanupSectionBar = document.getElementById('cleanupSectionBar');
    cleanupSummaryText = document.getElementById('cleanupSummaryText');
    deleteSelectedCleanupBtn = document.getElementById('deleteSelectedCleanupBtn');
    deleteAllCleanupBtn = document.getElementById('deleteAllCleanupBtn');
    cleanupRestoreModal = document.getElementById('cleanupRestoreModal');
    closeRestoreCenterModalBtn = document.getElementById('closeRestoreCenterModal');
    closeRestoreCenterBottomBtn = document.getElementById('closeRestoreCenterBottomBtn');
    tabBtnNotifications = document.getElementById('tabBtnNotifications');
    tabBtnTrash = document.getElementById('tabBtnTrash');
    tabBtnAbnormalWhitelist = document.getElementById('tabBtnAbnormalWhitelist');
    modalNotifBadge = document.getElementById('modalNotifBadge');
    modalTrashBadge = document.getElementById('modalTrashBadge');
    modalWhitelistBadge = document.getElementById('modalWhitelistBadge');
    tabContentNotifications = document.getElementById('tabContentNotifications');
    tabContentTrash = document.getElementById('tabContentTrash');
    tabContentAbnormalWhitelist = document.getElementById('tabContentAbnormalWhitelist');
    notificationsTableBody = document.getElementById('notificationsTableBody');
    trashTableBody = document.getElementById('trashTableBody');
    whitelistTableBody = document.getElementById('whitelistTableBody');
    clearAllWhitelistBtn = document.getElementById('clearAllWhitelistBtn');
    dismissAllNotifsBtn = document.getElementById('dismissAllNotifsBtn');
    refreshNotifsBtn = document.getElementById('refreshNotifsBtn');
    restoreAllTrashBtn = document.getElementById('restoreAllTrashBtn');
    toggleDismissedHistory = document.getElementById('toggleDismissedHistory');
    dismissedHistoryContainer = document.getElementById('dismissedHistoryContainer');
    dismissedTableBody = document.getElementById('dismissedTableBody');
    dismissedNotifsCount = document.getElementById('dismissedNotifsCount');
    similarRecommendPanel = document.getElementById('similarRecommendPanel');
    recommendKeyword = document.getElementById('recommendKeyword');
    recommendCardsContainer = document.getElementById('recommendCardsContainer');
    closeRecommendPanelBtn = document.getElementById('closeRecommendPanel');
    toggleRecommendPanelBtn = document.getElementById('toggleRecommendPanel');
    recommendToggleIcon = document.getElementById('recommendToggleIcon');
    recommendToggleText = document.getElementById('recommendToggleText');
    recommendHeader = document.getElementById('recommendHeader');
    recommendBodyWrapper = document.getElementById('recommendBodyWrapper');

    // Bulk actions floating dock elements
    deselectAllBtn = document.getElementById('deselectAllBtn');
    retranslateSelectedBtn = document.getElementById('retranslateSelectedBtn');
    copySelectedOriginalBtn = document.getElementById('copySelectedOriginalBtn');
    bulkFindReplaceBtn = document.getElementById('bulkFindReplaceBtn');
    bulkWhitelistAbnormalBtn = document.getElementById('bulkWhitelistAbnormalBtn');
    bulkMoveToCleanupBtn = document.getElementById('bulkMoveToCleanupBtn');
    excludeSelectedBtn = document.getElementById('excludeSelectedBtn');

    // ntfy settings modal elements
    openNtfySettingsBtn = document.getElementById('openNtfySettingsBtn');
    ntfySettingsModal = document.getElementById('ntfySettingsModal');
    closeNtfySettingsBtn = document.getElementById('closeNtfySettingsBtn');
    closeNtfySettingsBottomBtn = document.getElementById('closeNtfySettingsBottomBtn');
    ntfyEnabledCheckbox = document.getElementById('ntfyEnabledCheckbox');
    ntfyServerInput = document.getElementById('ntfyServerInput');
    ntfyTopicInput = document.getElementById('ntfyTopicInput');
    ntfyProgressStepSelect = document.getElementById('ntfyProgressStepSelect');
    sendNtfyTestBtn = document.getElementById('sendNtfyTestBtn');
    saveNtfySettingsBtn = document.getElementById('saveNtfySettingsBtn');
    ntfyTopicLink = document.getElementById('ntfyTopicLink');
    ntfyTestResult = document.getElementById('ntfyTestResult');
}

function showCyberLoader() {
    if (window.CyberLoader && typeof window.CyberLoader.start === 'function') {
        window.CyberLoader.start();
    } else {
        const el = document.getElementById('loading-skeleton');
        if (el) el.style.display = 'flex';
    }
}

async function hideCyberLoader() {
    if (window.CyberLoader && typeof window.CyberLoader.finish === 'function') {
        await window.CyberLoader.finish();
    } else {
        const el = document.getElementById('loading-skeleton');
        if (el) el.style.display = 'none';
    }
}

async function loadAndRenderGrouped() {
    if (isLoading) return;
    isLoading = true;
    showCyberLoader();
    historyContainer.innerHTML = '';
    selectedIds.clear();
    updateBulkActionPanel();

    try {
        // Fetch all data from the server
        const [translationsRes, foldersRes] = await Promise.all([
            fetch(`/translations_by_folder?t=${Date.now()}`),
            fetch(`/folders?t=${Date.now()}`)
        ]);

        if (!translationsRes.ok) throw new Error(`Server error (translations): ${translationsRes.statusText}`);
        if (!foldersRes.ok) throw new Error(`Server error (folders): ${foldersRes.statusText}`);
        
        const responseData = await translationsRes.json();
        allFolders = await foldersRes.json(); // Assign to global allFolders

        // Populate the set of applied URLs from the server response
        appliedUrlsSet = new Set(responseData._applied_urls || []);
        delete responseData._applied_urls; // Clean up the metadata key
        groupedTranslations = responseData; // Assign clean data to global

        // Load auto-start setting
        const autoStartRes = await fetch('/api/settings/autostart');
        if (autoStartRes.ok) {
            const autoStartData = await autoStartRes.json();
            autoStartCheckbox.checked = autoStartData.autostart;
        } else {
            console.error("Failed to load auto-start setting.");
        }

        // NOTE: translationStatuses logic is removed
        translationStatuses = {};

        // Load quota & status summary for accurate daily stats (4 PM/5 PM reset)
        try {
            const summaryRes = await fetch('/api/notifications/summary');
            if (summaryRes.ok) {
                latestQuotaSummary = await summaryRes.json();
            }
        } catch (e) {
            console.warn("Quota summary fetch failed:", e);
        }

        renderGroupedHistory(groupedTranslations); // Pass data to render
        populateFolderDropdowns(allFolders);
        updateStatistics(groupedTranslations);
        checkAndLoadUnclassifiedNovels();
        
    } catch (error) {
        console.error("Failed to load data:", error);
        showToast("데이터 로딩 실패. 서버가 실행중인지 확인하세요.", "error");
    } finally {
        isLoading = false;
        await hideCyberLoader();
        emptyState.style.display = Object.keys(groupedTranslations).length === 0 ? 'block' : 'none';
        updateBulkActionPanel();
    }
}

function getQuotaWindowStartMs(summary) {
    if (summary && summary.quota_window_start_ts) {
        return summary.quota_window_start_ts * 1000;
    }
    const now = new Date();
    // US DST check (March 2nd Sun to Nov 1st Sun)
    const year = now.getFullYear();
    const mar1 = new Date(year, 2, 1);
    const firstSunMar = (7 - mar1.getDay()) % 7 + 1;
    const dstStart = new Date(year, 2, firstSunMar + 7, 2, 0, 0);
    const nov1 = new Date(year, 10, 1);
    const firstSunNov = (7 - nov1.getDay()) % 7 + 1;
    const dstEnd = new Date(year, 10, firstSunNov, 2, 0, 0);
    const isDst = (now >= dstStart && now < dstEnd);
    const resetHour = isDst ? 16 : 17;

    const todayReset = new Date(now.getFullYear(), now.getMonth(), now.getDate(), resetHour, 0, 0, 0);
    if (now >= todayReset) {
        return todayReset.getTime();
    } else {
        return todayReset.getTime() - (24 * 60 * 60 * 1000);
    }
}

function updateStatistics(groupedData) {
    let totalCount = 0;
    let todayCount = 0;
    let todayEpisodes = 0;
    let totalLength = 0;
    let totalEpisodes = 0;
    const folders = Object.keys(groupedData || {});
    const totalBooks = folders.length;
    
    const quotaWindowStartMs = getQuotaWindowStartMs(latestQuotaSummary);

    for (const folderName in groupedData) {
        const urlGroups = groupedData[folderName]; // This is an array of urlGroup objects
        if (Array.isArray(urlGroups)) {
            totalEpisodes += urlGroups.length;
            for (const urlGroup of urlGroups) {
                const items = urlGroup.items || [];
                let hasTodayItem = false;
                for (const item of items) {
                    totalCount++;
                    totalLength += item.translated ? item.translated.length : 0;
                    
                    if ((item.timestamp * 1000) >= quotaWindowStartMs) {
                        todayCount++;
                        hasTodayItem = true;
                    }
                }
                if (hasTodayItem) {
                    todayEpisodes++;
                }
            }
        }
    }

    // 서버(/api/notifications/summary)에서 제공하는 미분류 포함 전체 DB 기준 오늘 실적이 있다면 최우선 적용
    if (latestQuotaSummary && typeof latestQuotaSummary.today_episodes_count === 'number') {
        todayEpisodes = latestQuotaSummary.today_episodes_count;
    }
    if (latestQuotaSummary && typeof latestQuotaSummary.today_translations_count === 'number') {
        todayCount = latestQuotaSummary.today_translations_count;
    }

    const avgLength = totalCount > 0 ? Math.round(totalLength / totalCount) : 0;

    const statTotalBooksEl = document.getElementById('statTotalBooks');
    if (statTotalBooksEl) statTotalBooksEl.textContent = totalBooks.toLocaleString();

    const statTotalEpisodesEl = document.getElementById('statTotalEpisodes');
    if (statTotalEpisodesEl) statTotalEpisodesEl.textContent = totalEpisodes.toLocaleString();

    const statTotalCharsEl = document.getElementById('statTotalChars');
    if (statTotalCharsEl) statTotalCharsEl.textContent = totalLength.toLocaleString();

    const totalCountEl = document.getElementById('totalCount');
    if (totalCountEl) totalCountEl.textContent = totalCount.toLocaleString();

    const todayEpisodesStatEl = document.getElementById('todayEpisodesStat');
    if (todayEpisodesStatEl) todayEpisodesStatEl.textContent = `${todayEpisodes.toLocaleString()}화`;

    const todayCountEl = document.getElementById('todayCount');
    if (todayCountEl) todayCountEl.textContent = todayCount.toLocaleString();

    const avgLengthEl = document.getElementById('avgLength');
    if (avgLengthEl) avgLengthEl.textContent = avgLength.toLocaleString();

    const currentResetHour = latestQuotaSummary ? (latestQuotaSummary.quota_reset_hour || 16) : 16;
    const currentResetHourStr = currentResetHour > 12 ? `오후 ${currentResetHour - 12}시` : `${currentResetHour}시`;
    const todayStatItem = document.getElementById('todayStatItem');
    if (todayStatItem) {
        todayStatItem.title = `오늘 번역된 회차(페이지) 및 문단 수 (API 리셋 기준: 매일 ${currentResetHourStr} 초기화)`;
    }
    const todayCountLabel = document.getElementById('todayCountLabel');
    if (todayCountLabel) {
        todayCountLabel.innerHTML = `오늘 번역 (<span id="todayCount">${todayCount.toLocaleString()}</span>문단) <span style="font-size: 11px; opacity: 0.85; font-weight: normal;">(${currentResetHourStr} 리셋)</span>`;
    }

    // API 쿼터 통계 갱신
    if (latestQuotaSummary) {
        const apiQuotaCountEl = document.getElementById('apiQuotaCount');
        const apiQuotaLabelEl = document.getElementById('apiQuotaLabel');
        const apiQuotaStatItem = document.getElementById('apiQuotaStatItem');
        const calls = latestQuotaSummary.api_calls_today || 0;
        const limit = latestQuotaSummary.api_quota_limit || 500;
        const pct = latestQuotaSummary.percentage || 0;
        const resetHour = latestQuotaSummary.quota_reset_hour || 16;
        
        if (apiQuotaCountEl) {
            apiQuotaCountEl.textContent = `${calls} / ${limit}`;
        }
        if (apiQuotaLabelEl) {
            apiQuotaLabelEl.textContent = `API 쿼터 (${pct}%)`;
        }
        if (apiQuotaStatItem) {
            apiQuotaStatItem.title = `오늘 Gemini API 쿼터 사용량: ${calls} / ${limit}회 (${pct}%)\n매일 오후 ${resetHour > 12 ? resetHour - 12 : resetHour}시(KST) 초기화`;
            if (pct >= 90) {
                apiQuotaStatItem.style.borderColor = 'rgba(239, 68, 68, 0.7)';
            } else if (pct >= 70) {
                apiQuotaStatItem.style.borderColor = 'rgba(245, 158, 11, 0.7)';
            }
        }

        const apiQuotaMiniFill = document.getElementById('apiQuotaMiniFill');
        if (apiQuotaMiniFill) {
            apiQuotaMiniFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
            if (pct >= 90) apiQuotaMiniFill.style.background = 'linear-gradient(90deg, #ef4444, #f87171)';
            else if (pct >= 70) apiQuotaMiniFill.style.background = 'linear-gradient(90deg, #f59e0b, #fbbf24)';
            else apiQuotaMiniFill.style.background = 'linear-gradient(90deg, #0284c7, #38bdf8)';
        }
    }
}


function populateFolderDropdowns(folders) {
    const folderFilterDropdown = document.getElementById('folderFilterDropdown');

    if (moveSelectedToFolderDropdown) {
        moveSelectedToFolderDropdown.innerHTML = '<option value="">폴더로 이동...</option>';
        folders.forEach(folder => {
            const option = `<option value="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</option>`;
            moveSelectedToFolderDropdown.insertAdjacentHTML('beforeend', option);
        });
    }

    if (folderFilterDropdown) {
        const currentValue = folderFilterDropdown.value; // Preserve selection
        folderFilterDropdown.innerHTML = '<option value="">모든 폴더</option>';
        folders.forEach(folder => {
            const option = `<option value="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</option>`;
            folderFilterDropdown.insertAdjacentHTML('beforeend', option);
        });
        folderFilterDropdown.value = currentValue; // Restore selection if possible
    }
}



function renderGroupedHistory(dataToRender, selectedFolder = '') {
    historyContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();
    sortableInstances = []; // Clear instances on re-render
    
    let folderNames = Array.from(new Set([...allFolders.map(f => f.name), ...Object.keys(dataToRender)])).sort();

    if (selectedFolder && selectedFolder !== '__all__') {
        folderNames = folderNames.filter(f => f === selectedFolder);
    }

    for (const folderName of folderNames) {
        const urlGroups = dataToRender[folderName] || []; // This is now an array of urlGroup objects
        const folderContainer = document.createElement('div');
        folderContainer.className = 'history-folder-group';
        folderContainer.dataset.folderName = folderName;

        let urlGroupsHtml = '';
        let totalTranslationsInFolder = 0;
        let validEpisodeCount = 0;

        for (const urlGroup of urlGroups) {
            const url = urlGroup.url;
            const translations = urlGroup.items || [];
            const sortOrder = urlGroup.sort_order;

            let filteredTranslations = translations.filter(t => {
                const matchesSearch = !currentSearch || 
                    (t.original && t.original.toLowerCase().includes(currentSearch)) || 
                    (t.translated && t.translated.toLowerCase().includes(currentSearch));
                if (!matchesSearch) return false;

                if (isFindingEmpty && currentAbnormalFilter !== 'all') {
                    return t.category === currentAbnormalFilter;
                }
                return true;
            });

            if (filteredTranslations.length === 0) continue;

            validEpisodeCount++;
            totalTranslationsInFolder += filteredTranslations.length;
            const title = filteredTranslations[0]?.title || url;
            const isApplied = appliedUrlsSet.has(url.split('#')[0].replace(/\/$/, ''));

            const shouldRenderImmediately = Boolean(currentSearch);
            const isUrlGroupCollapsed = shouldRenderImmediately ? false : true;
            const groupItemsHtml = shouldRenderImmediately ? filteredTranslations.map(t => renderItem(t)).join('') : '';

            urlGroupsHtml += `
                <div class="list-group fade-in" data-url="${escapeHtml(url)}" data-folder-name="${escapeHtml(folderName)}">
                    <div class="list-group-header">
                        <span class="list-group-toggle ${isUrlGroupCollapsed ? 'collapsed' : ''} material-icons">${isUrlGroupCollapsed ? 'chevron_right' : 'expand_more'}</span>
                        <div class="list-group-title-container">
                            <h3 class="list-group-title">${escapeHtml(title)}</h3>
                            <span class="episode-count-badge">${filteredTranslations.length}개 단락</span>
                        </div>
                        <div class="list-group-actions">
                            <a href="${url}" target="_blank" class="btn btn-outline btn-sm ext-link-btn" title="소설 원본 웹페이지 새 창으로 열기">🔗 원본 ↗</a>
                            <button class="btn btn-outline btn-sm edit-title-btn" data-url="${escapeHtml(url)}" title="회차 제목 수정">✏️ 수정</button>
                            <button class="btn btn-secondary btn-sm btn-apply ${isApplied ? 'applied' : ''}" data-url="${escapeHtml(url)}">${isApplied ? '적용 해제' : '적용'}</button>
                            <label class="checkbox-container select-all-label">
                                <input type="checkbox" class="group-select-all-checkbox">
                                <span class="checkmark"></span>
                                전체 선택
                            </label>
                        </div>
                    </div>
                    <div class="list-group-content ${isUrlGroupCollapsed ? 'collapsed' : ''}">
                        ${groupItemsHtml ? `
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th style="width: 44px; text-align: center;">선택</th>
                                    <th style="width: 75px;">PID</th>
                                    <th style="width: 42%;">원문 (일본어)</th>
                                    <th style="width: 42%;">번역 (한국어)</th>
                                    <th style="width: 150px; text-align: center;">관리</th>
                                </tr>
                            </thead>
                            <tbody>${groupItemsHtml}</tbody>
                        </table>
                        ` : ''}
                    </div>
                </div>
            `;
        }

        if ((isFindingEmpty || isCleanupQueue) && totalTranslationsInFolder === 0) {
            continue;
        }

        // 특정 폴더 선택 시 자동 펼침, 그 외 기본 접힘
        const isFolderCollapsed = (selectedFolder && selectedFolder !== '__all__') ? false : (Boolean(currentSearch) ? false : true);

        folderContainer.innerHTML = `
            <div class="folder-group-header">
                <span class="folder-group-toggle material-icons ${isFolderCollapsed ? 'collapsed' : ''}">expand_more</span>
                <div class="folder-title-wrapper">
                    <h2 class="folder-group-title">${escapeHtml(folderName)}</h2>
                    <span class="folder-stats-badge">${validEpisodeCount}개 회차 / ${totalTranslationsInFolder.toLocaleString()}개 단락</span>
                </div>
                <div class="list-group-actions">
                    <button class="btn btn-outline btn-sm toggle-all-episodes-btn" title="이 소설의 모든 회차를 한 번에 펼치거나 접습니다.">모든 회차 펼치기</button>
                    <label class="checkbox-container select-all-label">
                        <input type="checkbox" class="folder-select-all-checkbox">
                        <span class="checkmark"></span>
                        폴더 전체 선택
                    </label>
                </div>
            </div>
            <div class="folder-group-content ${isFolderCollapsed ? 'collapsed' : ''}">
                ${urlGroupsHtml || '<div class="empty-folder-notice">번역된 회차가 없습니다.</div>'}
            </div>
        `;
        fragment.appendChild(folderContainer);
    }
    historyContainer.appendChild(fragment);
}

function renderUrlGroupContent(listGroupEl) {
    const contentEl = listGroupEl.querySelector('.list-group-content');
    if (!contentEl || contentEl.querySelector('.history-table')) return; // Already rendered

    const url = listGroupEl.dataset.url;
    const folderName = listGroupEl.dataset.folderName;
    const currentDataSource = isFindingEmpty ? rawAbnormalData : (isCleanupQueue ? rawCleanupData : groupedTranslations);
    const urlGroups = (currentDataSource && currentDataSource[folderName]) || [];
    const urlGroup = urlGroups.find(g => g.url === url);
    if (!urlGroup) return;

    let items = (urlGroup.items || []).slice();
    if (currentSearch) {
        items = items.filter(t => 
            (t.original && t.original.toLowerCase().includes(currentSearch)) || 
            (t.translated && t.translated.toLowerCase().includes(currentSearch))
        );
    }
    if (isFindingEmpty && currentAbnormalFilter !== 'all') {
        items = items.filter(t => t.category === currentAbnormalFilter);
    }
    items.sort((a, b) => (a.pid || '').localeCompare(b.pid || '', undefined, { numeric: true, sensitivity: 'base' }));

    const itemsHtml = items.map(t => renderItem(t)).join('');
    contentEl.innerHTML = `
        <table class="history-table">
            <thead>
                <tr>
                    <th style="width: 44px; text-align: center;">선택</th>
                    <th style="width: 75px;">PID</th>
                    <th style="width: 42%;">원문 (일본어)</th>
                    <th style="width: 42%;">번역 (한국어)</th>
                    <th style="width: 150px; text-align: center;">관리</th>
                </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
        </table>
    `;
}

function renderItem(t) {
    const date = new Date(t.timestamp * 1000);
    const dateStr = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    const isChecked = selectedIds.has(t.id);

    let badgeHtml = '';
    if (isFindingEmpty && t.category) {
        const badgeClass = t.category === 'partial_untranslated' ? 'badge-partial' : 'badge-other-lang';
        const label = t.category_label || (t.category === 'partial_untranslated' ? '일부 미번역' : '다른 언어로 번역');
        let queuedBadge = '';
        if (t.is_queued_for_cleanup) {
            queuedBadge = ' <span class="category-badge badge-moved" title="원문 정리 섹션으로 이동된 상태입니다.">정리 대기</span>';
        }
        badgeHtml = `<div class="badge-wrapper"><span class="category-badge ${badgeClass}">${escapeHtml(label)}</span>${queuedBadge}</div>`;
    } else if (isCleanupQueue && t.category) {
        let badgeClass = 'badge-verbatim';
        if (t.category === 'paraphrased_jp' || t.category === 'paraphrased_zh') badgeClass = 'badge-paraphrased';
        else if (t.category === 'moved') badgeClass = 'badge-moved';
        badgeHtml = `<div class="badge-wrapper"><span class="category-badge ${badgeClass}">${escapeHtml(t.category_label || t.category)}</span></div>`;
    }

    const kwList = Array.isArray(t.untranslated_keywords) ? t.untranslated_keywords.join(',') : '';

    // 미번역 키워드 칩 (이상번역 모드 + partial_untranslated 또는 other_language 카테고리)
    let keywordChipsHtml = '';
    if (isFindingEmpty && (t.category === 'partial_untranslated' || t.category === 'other_language') && Array.isArray(t.untranslated_keywords) && t.untranslated_keywords.length > 0) {
        const chips = t.untranslated_keywords.map(kw =>
            `<button class="keyword-chip" data-keyword="${escapeHtml(kw)}" data-folder="${escapeHtml(t.folderName || '')}" title="'${escapeHtml(kw)}'을(를) 찾아 바꾸기">🔍 ${escapeHtml(kw)}</button>`
        ).join('');
        keywordChipsHtml = `<div class="keyword-chips-container">${chips}</div>`;
    }

    return `
        <tr class="history-item" data-id="${t.id}">
            <td class="item-checkbox-cell">
                <input type="checkbox" class="item-checkbox" data-id="${t.id}" ${isChecked ? 'checked' : ''}>
            </td>
            <td class="item-pid-cell">
                <span class="pid-badge">${escapeHtml(t.pid)}</span>
            </td>
            <td class="item-original-cell">
                <div class="original-cell-container">
                    <div class="text-content original-text" title="클릭 또는 드래그하여 원문을 복사할 수 있습니다.">${escapeHtml(t.original)}</div>
                    <div class="original-actions">
                        <button class="btn btn-sm btn-copy-orig copy-orig-btn" title="원문 일본어 복사" data-original="${escapeHtml(t.original)}">
                            📋 원문 복사
                        </button>
                    </div>
                </div>
            </td>
            <td class="item-translated-cell">
                <div class="translated-cell-container">
                    ${badgeHtml}
                    ${keywordChipsHtml}
                    <div class="text-content translated-text" contenteditable="true" data-id="${t.id}" data-folder="${escapeHtml(t.folderName || '')}" data-keywords="${escapeHtml(kwList)}" data-original="${escapeHtml(t.original)}">${escapeHtml(t.translated)}</div>
                    <div class="translated-actions">
                        <span class="edit-status-hint">✏️ 수정 가능</span>
                        <button class="btn btn-sm btn-save-inline save-item-btn" title="번역 수정 내용 저장">
                            💾 저장
                        </button>
                    </div>
                </div>
            </td>
            <td class="item-actions-container">
                <div class="item-date">${dateStr}</div>
                <div class="action-btn-clusters">
                    <!-- 1. AI 재번역 및 이상 제외 클러스터 (작업) -->
                    <div class="action-cluster work-cluster">
                        <button class="btn btn-sm btn-action retranslate-item-btn" title="고성능 AI 모델로 재번역">🔄 AI 재번역</button>
                        ${isFindingEmpty ? `
                            <button class="btn btn-sm btn-action-whitelist whitelist-item-btn" title="이 단락은 의도된 원문/외국어(일본어/영어/스페인어 등) 표기이므로 이상번역 찾기에서 제외합니다." data-id="${t.id}">🛡️ 이상 제외</button>
                        ` : ''}
                    </div>
                    <!-- 분리선: 오클릭 방지를 위한 시각적/물리적 격리 -->
                    <div class="action-divider"></div>
                    <!-- 2. 관리/위험 클러스터 (제외, 삭제) -->
                    <div class="action-cluster danger-cluster">
                        <button class="btn btn-sm btn-action-danger exclude-btn" title="번역에서 영구 제외">❌ 제외</button>
                        <button class="btn btn-sm btn-action-danger delete-btn" title="이 번역 항목 삭제">🗑️ 삭제</button>
                    </div>
                </div>
            </td>
        </tr>
    `;
}

function setupEventListeners() {
    searchBox.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value.toLowerCase();
            const selectedFolder = folderFilterDropdown ? folderFilterDropdown.value : '';
            if (isFindingEmpty && rawAbnormalData) {
                renderGroupedHistory(rawAbnormalData, selectedFolder);
            } else if (isCleanupQueue && rawCleanupData) {
                renderGroupedHistory(rawCleanupData, selectedFolder);
            } else {
                renderGroupedHistory(groupedTranslations, selectedFolder);
            }
        }, 300);
    });

    // 소설/폴더 필터 드롭다운 선택 시 해당 소설만 즉시 표시하고 자동으로 회차 목록 펼침
    const folderFilterDropdown = document.getElementById('folderFilterDropdown');
    if (folderFilterDropdown) {
        folderFilterDropdown.addEventListener('change', (e) => {
            const selectedFolder = e.target.value;
            const currentData = getCurrentDataSource();
            renderGroupedHistory(currentData, selectedFolder);
        });
    }

    findEmptyBtn.addEventListener('click', toggleFindEmpty);

    historyContainer.addEventListener('click', handleHistoryClick);
    historyContainer.addEventListener('change', handleCheckboxChange);
    historyContainer.addEventListener('focusin', (e) => {
        if (e.target.classList.contains('translated-text')) {
            handleTranslatedFocus(e.target);
        }
    });

    darkModeToggle.addEventListener('click', toggleDarkMode);
    deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    moveSelectedToFolderDropdown.addEventListener('change', moveSelectedTranslationsToFolder);

    // Find & Replace Listeners
    openGlobalFindReplaceBtn.addEventListener('click', openFindReplaceModal);
    closeFindReplaceModalBtn.addEventListener('click', closeFindReplaceModal);
    cancelFindReplaceBtn.addEventListener('click', closeFindReplaceModal);
    executeFindReplaceBtn.addEventListener('click', executeGlobalFindReplace);

    findText.addEventListener('input', () => {
        clearTimeout(findReplaceCountTimeout);
        findReplaceCountTimeout = setTimeout(countOccurrences, 400);
    });

    [conditionText, useRegex, caseSensitive, folderScope].forEach(element => {
        if (!element) return;
        element.addEventListener('input', () => {
            clearTimeout(findReplaceCountTimeout);
            findReplaceCountTimeout = setTimeout(countOccurrences, 300);
        });
        if (element.type === 'checkbox' || element.tagName === 'SELECT') {
             element.addEventListener('change', () => {
                clearTimeout(findReplaceCountTimeout);
                findReplaceCountTimeout = setTimeout(countOccurrences, 300);
            });
        }
    });

    createFolderButton.addEventListener('click', createFolder);
    autoStartCheckbox.addEventListener('change', saveAutoStartState);

    // Floating bulk actions dock
    if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAll);
    if (retranslateSelectedBtn) retranslateSelectedBtn.addEventListener('click', retranslateSelectedTranslations);
    if (copySelectedOriginalBtn) copySelectedOriginalBtn.addEventListener('click', copySelectedOriginals);
    if (bulkFindReplaceBtn) bulkFindReplaceBtn.addEventListener('click', openFindReplaceModal);
    if (bulkWhitelistAbnormalBtn) bulkWhitelistAbnormalBtn.addEventListener('click', whitelistSelectedAbnormal);
    if (bulkMoveToCleanupBtn) bulkMoveToCleanupBtn.addEventListener('click', moveToCleanupQueueSelected);
    if (excludeSelectedBtn) excludeSelectedBtn.addEventListener('click', excludeSelectedTranslations);

    // Cleanup queue toolbar & actions
    if (cleanupQueueBtn) cleanupQueueBtn.addEventListener('click', toggleCleanupQueue);
    if (deleteSelectedCleanupBtn) deleteSelectedCleanupBtn.addEventListener('click', deleteSelectedCleanup);
    if (deleteAllCleanupBtn) deleteAllCleanupBtn.addEventListener('click', deleteAllCleanup);

    // Abnormal sub-filters & actions
    if (filterAbnormalAll) filterAbnormalAll.addEventListener('click', () => setAbnormalFilter('all'));
    if (filterAbnormalPartial) filterAbnormalPartial.addEventListener('click', () => setAbnormalFilter('partial_untranslated'));
    if (filterAbnormalOther) filterAbnormalOther.addEventListener('click', () => setAbnormalFilter('other_language'));
    if (moveToCleanupBtn) moveToCleanupBtn.addEventListener('click', moveToCleanupQueueSelected);
    if (whitelistSelectedAbnormalBtn) whitelistSelectedAbnormalBtn.addEventListener('click', whitelistSelectedAbnormal);

    // Restore Center Modal & Tabs
    if (openRestoreCenterBtn) openRestoreCenterBtn.addEventListener('click', () => openRestoreCenterModal('notifications'));
    if (closeRestoreCenterModalBtn) closeRestoreCenterModalBtn.addEventListener('click', closeRestoreCenterModal);
    if (closeRestoreCenterBottomBtn) closeRestoreCenterBottomBtn.addEventListener('click', closeRestoreCenterBottomBtn);
    if (tabBtnNotifications) tabBtnNotifications.addEventListener('click', () => switchRestoreTab('notifications'));
    if (tabBtnTrash) tabBtnTrash.addEventListener('click', () => switchRestoreTab('trash'));
    if (tabBtnAbnormalWhitelist) tabBtnAbnormalWhitelist.addEventListener('click', () => switchRestoreTab('whitelist'));
    if (dismissAllNotifsBtn) dismissAllNotifsBtn.addEventListener('click', dismissAllNotifications);
    if (refreshNotifsBtn) refreshNotifsBtn.addEventListener('click', () => loadAndRenderNotifications(false));
    if (restoreAllTrashBtn) restoreAllTrashBtn.addEventListener('click', restoreAllTrash);
    if (clearAllWhitelistBtn) clearAllWhitelistBtn.addEventListener('click', clearAllAbnormalWhitelist);
    if (toggleDismissedHistory) toggleDismissedHistory.addEventListener('click', toggleDismissedHistoryView);

    // Delegated actions for modal tables
    if (notificationsTableBody) {
        notificationsTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.dismiss-notif-btn');
            if (btn && btn.dataset.id) {
                dismissNotification(parseInt(btn.dataset.id));
            }
        });
    }
    if (trashTableBody) {
        trashTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.restore-trash-btn');
            if (btn && btn.dataset.id) {
                restoreTrashItem(parseInt(btn.dataset.id));
            }
        });
    }
    if (whitelistTableBody) {
        whitelistTableBody.addEventListener('click', (e) => {
            const btn = e.target.closest('.remove-whitelist-btn');
            if (btn && btn.dataset.id) {
                removeSingleWhitelist(parseInt(btn.dataset.id));
            }
        });
    }

    // Recommendation panel actions
    if (closeRecommendPanelBtn) closeRecommendPanelBtn.addEventListener('click', closeRecommendPanel);
    if (toggleRecommendPanelBtn) {
        toggleRecommendPanelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleRecommendCollapse();
        });
    }
    if (recommendHeader) {
        recommendHeader.addEventListener('click', (e) => {
            if (e.target.closest('#closeRecommendPanel') || e.target.closest('#toggleRecommendPanel') || e.target.closest('a') || e.target.closest('.kw-chip')) {
                return;
            }
            toggleRecommendCollapse();
        });
    }
    if (recommendCardsContainer) {
        recommendCardsContainer.addEventListener('click', handleRecommendCardClick);
    }
    if (recommendKeyword) {
        recommendKeyword.addEventListener('click', (e) => {
            const chip = e.target.closest('.kw-chip');
            if (chip && chip.dataset.kw) {
                const folder = activeTargetInput ? (activeTargetInput.dataset.folder || '') : '';
                loadSimilarRecommendations(chip.dataset.kw, folder);
            }
        });
    }

    // ntfy settings modal listeners
    if (openNtfySettingsBtn) openNtfySettingsBtn.addEventListener('click', openNtfyModal);
    if (closeNtfySettingsBtn) closeNtfySettingsBtn.addEventListener('click', closeNtfyModal);
    if (closeNtfySettingsBottomBtn) closeNtfySettingsBottomBtn.addEventListener('click', closeNtfyModal);
    if (saveNtfySettingsBtn) saveNtfySettingsBtn.addEventListener('click', saveNtfySettings);
    if (sendNtfyTestBtn) sendNtfyTestBtn.addEventListener('click', sendNtfyTest);
    if (ntfyTopicInput) ntfyTopicInput.addEventListener('input', updateNtfyTopicLink);
    if (ntfyServerInput) ntfyServerInput.addEventListener('input', updateNtfyTopicLink);

    // Translation drag / text selection listener for similar recommendations
    document.addEventListener('mouseup', handleDocumentMouseUp);
    document.addEventListener('keyup', (e) => {
        if (e.key && (e.key.startsWith('Arrow') || e.key === 'Shift')) {
            handleDocumentMouseUp(e);
        }
    });

    // Stats analytics modal & app release modal & unclassified drawer
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
        if (findText) findText.value = keyword;
        // 폴더가 있으면 folderScope 자동 선택 (dropdown 렌더링 이후)
        if (folder && folderScope) {
            setTimeout(() => {
                const opt = Array.from(folderScope.options).find(o => o.value === folder);
                if (opt) folderScope.value = folder;
            }, 50);
        }
        // 카운트 자동 갱신
        if (findText) {
            setTimeout(() => {
                findText.dispatchEvent(new Event('input'));
            }, 100);
        }
    });
}

// --- ntfy Push Notification Modal & Actions ---
function updateNtfyTopicLink() {
    if (!ntfyTopicLink) return;
    const server = (ntfyServerInput ? ntfyServerInput.value : 'https://ntfy.sh').trim().replace(/\/+$/, '');
    const topic = (ntfyTopicInput ? ntfyTopicInput.value : 'NovelSphere').trim();
    ntfyTopicLink.href = topic ? `${server}/${encodeURIComponent(topic)}` : server;
}

async function openNtfyModal() {
    if (!ntfySettingsModal) return;
    if (ntfyTestResult) ntfyTestResult.innerHTML = '';
    
    try {
        const res = await fetch('/api/notifications/config');
        if (res.ok) {
            const config = await res.json();
            if (ntfyEnabledCheckbox) ntfyEnabledCheckbox.checked = !!config.ntfy_enabled;
            if (ntfyServerInput) ntfyServerInput.value = config.ntfy_server || 'https://ntfy.sh';
            if (ntfyTopicInput) ntfyTopicInput.value = config.ntfy_topic || 'NovelSphere';
            if (ntfyProgressStepSelect) ntfyProgressStepSelect.value = String(config.ntfy_progress_step || 100);
            updateNtfyTopicLink();
        }
    } catch (e) {
        console.warn('Failed to load ntfy config:', e);
    }
    ntfySettingsModal.style.display = 'block';
}

function closeNtfyModal() {
    if (ntfySettingsModal) ntfySettingsModal.style.display = 'none';
}

async function saveNtfySettings() {
    const payload = {
        ntfy_enabled: ntfyEnabledCheckbox ? ntfyEnabledCheckbox.checked : true,
        ntfy_server: ntfyServerInput ? ntfyServerInput.value.trim() : 'https://ntfy.sh',
        ntfy_topic: ntfyTopicInput ? ntfyTopicInput.value.trim() : 'NovelSphere',
        ntfy_progress_step: ntfyProgressStepSelect ? parseInt(ntfyProgressStepSelect.value, 10) : 100
    };

    try {
        const res = await fetch('/api/notifications/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('설정 저장 실패');
        showToast('ntfy 알림 설정이 저장되었습니다.', 'success');
        closeNtfyModal();
    } catch (err) {
        showToast(`설정 저장 중 오류: ${err.message}`, 'error');
    }
}

async function sendNtfyTest() {
    if (!sendNtfyTestBtn || !ntfyTestResult) return;
    const topic = (ntfyTopicInput ? ntfyTopicInput.value : '').trim();
    const server = (ntfyServerInput ? ntfyServerInput.value : '').trim();

    if (!topic) {
        ntfyTestResult.innerHTML = '<span style="color: var(--danger-color, #dc3545);">토픽명을 입력해주세요.</span>';
        return;
    }

    sendNtfyTestBtn.disabled = true;
    ntfyTestResult.innerHTML = '<span style="color: var(--primary-color, #0d6efd);">알림 발송 중...</span>';

    try {
        const res = await fetch('/api/notifications/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, server })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            ntfyTestResult.innerHTML = `<span style="color: var(--success-color, #28a745);">✅ 발송 성공! 스마트폰 ntfy 앱이나 웹 피드를 확인하세요.</span>`;
            showToast('테스트 알림이 성공적으로 발송되었습니다.', 'success');
        } else {
            throw new Error(data.detail || '전송 실패');
        }
    } catch (err) {
        ntfyTestResult.innerHTML = `<span style="color: var(--danger-color, #dc3545);">❌ 실패: ${err.message}</span>`;
        showToast(`테스트 알림 발송 실패: ${err.message}`, 'error');
    } finally {
        sendNtfyTestBtn.disabled = false;
    }
}

async function loadAndRenderAbnormal() {
    if (isLoading) return;
    isLoading = true;
    showToast('이상 번역 기록을 불러오는 중...', 'info');
    showCyberLoader();
    historyContainer.innerHTML = '';
    selectedIds.clear();
    updateBulkActionPanel();

    try {
        const response = await fetch(`/translations/abnormal?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const abnormalData = await response.json();
        
        appliedUrlsSet = new Set(abnormalData._applied_urls || []);
        delete abnormalData._applied_urls;

        const catCounts = abnormalData._category_counts || { total: 0, partial_untranslated: 0, other_language: 0 };
        delete abnormalData._category_counts;

        rawAbnormalData = abnormalData;

        if (filterAbnormalAll) filterAbnormalAll.textContent = `전체 이상번역 (${catCounts.total || 0})`;
        if (filterAbnormalPartial) filterAbnormalPartial.textContent = `일부 번역 안 함 (${catCounts.partial_untranslated || 0})`;
        if (filterAbnormalOther) filterAbnormalOther.textContent = `다른 언어로 번역 (${catCounts.other_language || 0})`;

        renderGroupedHistory(abnormalData);

        const totalItems = catCounts.total || 0;
        if (totalItems === 0) {
            showToast("이상 번역 기록이 없습니다.", "info");
        }

    } catch (error) {
        console.error("Failed to load abnormal translations:", error);
        showToast("이상 번역 기록 로딩 실패.", "error");
    } finally {
        isLoading = false;
        await hideCyberLoader();
        updateBulkActionPanel();
    }
}

function setAbnormalFilter(filterType) {
    currentAbnormalFilter = filterType;
    [filterAbnormalAll, filterAbnormalPartial, filterAbnormalOther].forEach(btn => {
        if (!btn) return;
        btn.classList.toggle('active', btn.dataset.filter === filterType);
    });
    if (rawAbnormalData) {
        renderGroupedHistory(rawAbnormalData);
    }
}

function toggleFindEmpty() {
    isFindingEmpty = !isFindingEmpty;
    findEmptyBtn.classList.toggle('active', isFindingEmpty);
    searchBox.value = '';
    currentSearch = '';

    if (isFindingEmpty) {
        if (isCleanupQueue) {
            isCleanupQueue = false;
            cleanupQueueBtn.classList.remove('active');
            cleanupSectionBar.style.display = 'none';
        }
        abnormalFilterBar.style.display = 'flex';
        loadAndRenderAbnormal();
    } else {
        abnormalFilterBar.style.display = 'none';
        closeRecommendPanel();
        loadAndRenderGrouped();
    }
}

function toggleCleanupQueue() {
    isCleanupQueue = !isCleanupQueue;
    cleanupQueueBtn.classList.toggle('active', isCleanupQueue);
    searchBox.value = '';
    currentSearch = '';

    if (isCleanupQueue) {
        if (isFindingEmpty) {
            isFindingEmpty = false;
            findEmptyBtn.classList.remove('active');
            abnormalFilterBar.style.display = 'none';
            closeRecommendPanel();
        }
        cleanupSectionBar.style.display = 'flex';
        loadAndRenderCleanupQueue();
    } else {
        cleanupSectionBar.style.display = 'none';
        loadAndRenderGrouped();
    }
}

async function loadAndRenderCleanupQueue() {
    if (isLoading) return;
    isLoading = true;
    showToast('원문 복제·변형 정리 대기열을 불러오는 중...', 'info');
    showCyberLoader();
    historyContainer.innerHTML = '';
    selectedIds.clear();
    updateBulkActionPanel();

    try {
        const response = await fetch(`/translations/cleanup_queue?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const cleanupData = await response.json();

        const summary = cleanupData._summary || { total: 0, verbatim_count: 0, paraphrased_count: 0, moved_count: 0 };
        delete cleanupData._summary;
        rawCleanupData = cleanupData;

        if (cleanupSummaryText) {
            cleanupSummaryText.textContent = `원문 그대로 반환 ${summary.verbatim_count || 0}건 / 원문 변형 ${summary.paraphrased_count || 0}건 / 이동된 항목 ${summary.moved_count || 0}건 (총 ${summary.total || 0}건)`;
        }

        renderGroupedHistory(cleanupData);

        if (summary.total === 0) {
            showToast("정리할 원문 복제·변형 기록이 없습니다.", "info");
        }

    } catch (error) {
        console.error("Failed to load cleanup queue:", error);
        showToast("원문 정리 대기열 로딩 실패.", "error");
    } finally {
        isLoading = false;
        await hideCyberLoader();
        updateBulkActionPanel();
    }
}

async function deleteSelectedCleanup() {
    if (selectedIds.size === 0) {
        showToast('삭제할 항목을 먼저 선택하세요.', 'error');
        return;
    }
    const count = selectedIds.size;
    if (!confirm(`선택한 ${count}개 항목을 삭제하시겠습니까?\n\n(삭제된 항목은 휴지통에 보관되며 '알림 및 복원 센터'에서 언제든 되돌릴 수 있습니다.)`)) {
        return;
    }

    try {
        const response = await fetch('/translations/cleanup_queue/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        if (!response.ok) throw new Error('삭제 요청 실패');
        const res = await response.json();
        showToast(res.message || `${count}개 항목이 삭제되었습니다.`, 'success');
        selectedIds.clear();
        loadAndRenderCleanupQueue();
        loadNotificationsAndBadge();
    } catch (err) {
        console.error('정리 삭제 실패:', err);
        showToast('삭제 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function deleteAllCleanup() {
    if (!confirm('정리 대기열의 모든 항목을 일괄 삭제하시겠습니까?\n\n(삭제된 모든 항목은 휴지통에 보관되며 알림 및 복원 센터에서 회차별 확인 및 복원이 가능합니다.)')) {
        return;
    }

    try {
        const response = await fetch('/translations/cleanup_queue/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all_queue: true })
        });
        if (!response.ok) throw new Error('전체 삭제 요청 실패');
        const res = await response.json();
        showToast(res.message || '정리 대기열 전체가 삭제되었습니다.', 'success');
        selectedIds.clear();
        loadAndRenderCleanupQueue();
        loadNotificationsAndBadge();
    } catch (err) {
        console.error('대기열 전체 삭제 실패:', err);
        showToast('대기열 삭제 중 오류가 발생했습니다.', 'error');
    }
}

async function moveToCleanupQueueSelected() {
    if (selectedIds.size === 0) {
        showToast('원문 정리 섹션으로 이동할 항목을 먼저 선택하세요.', 'error');
        return;
    }
    const count = selectedIds.size;
    if (!confirm(`선택한 ${count}개 항목을 [원문 복제·변형 정리] 섹션(삭제 대기열)으로 이동하시겠습니까?`)) {
        return;
    }

    try {
        const response = await fetch('/translations/move_to_cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        if (!response.ok) throw new Error('이동 실패');
        const res = await response.json();
        showToast(res.message || `${count}개 항목이 원문 정리 섹션으로 이동되었습니다.`, 'success');
        selectedIds.clear();
        loadAndRenderAbnormal();
    } catch (err) {
        console.error('원문 정리 섹션 이동 실패:', err);
        showToast('이동 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function whitelistSelectedAbnormal() {
    if (selectedIds.size === 0) {
        showToast('이상번역 검사에서 제외할 항목을 먼저 선택하세요.', 'error');
        return;
    }
    const count = selectedIds.size;
    if (!confirm(`선택한 ${count}개 항목을 이상번역 검사에서 제외하시겠습니까?\n(의도적으로 외국어(일본어/영어/스페인어 등)를 남겨둔 문장으로 처리되며, 복원 센터의 [이상번역 예외 목록] 탭에서 언제든지 다시 포함할 수 있습니다.)`)) {
        return;
    }

    try {
        const response = await fetch('/translations/abnormal_whitelist/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        if (!response.ok) throw new Error('서버 응답 오류');
        const res = await response.json();
        showToast(res.message || `${count}개 항목이 이상번역 검사에서 제외되었습니다.`, 'success');
        selectedIds.clear();
        loadAndRenderAbnormal();
        loadNotificationsAndBadge();
    } catch (err) {
        console.error('이상번역 제외 실패:', err);
        showToast(`이상번역 제외 실패: ${err.message}`, 'error');
    }
}

async function loadNotificationsAndBadge() {
    try {
        const [notifsRes, trashRes, whitelistRes] = await Promise.all([
            fetch(`/cleanup/notifications?t=${Date.now()}`),
            fetch(`/translations/trash?t=${Date.now()}`),
            fetch(`/translations/abnormal_whitelist?t=${Date.now()}`)
        ]);

        if (notifsRes.ok) {
            const data = await notifsRes.json();
            const activeCount = (data.active_notifications || []).length;
            if (notifBadge) {
                notifBadge.textContent = activeCount;
                notifBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
            }
            if (modalNotifBadge) {
                modalNotifBadge.textContent = activeCount;
            }
        }

        if (trashRes.ok) {
            const trashData = await trashRes.json();
            const trashCount = (trashData.trash || []).length;
            if (modalTrashBadge) {
                modalTrashBadge.textContent = trashCount;
            }
        }

        if (whitelistRes && whitelistRes.ok) {
            const wlData = await whitelistRes.json();
            const wlCount = (wlData.whitelist || []).length;
            if (modalWhitelistBadge) {
                modalWhitelistBadge.textContent = wlCount;
            }
        }
    } catch (err) {
        console.warn('알림 및 휴지통 뱃지 로딩 실패:', err);
    }
}

function openRestoreCenterModal(defaultTab = 'notifications') {
    if (!cleanupRestoreModal) return;
    cleanupRestoreModal.style.display = 'flex';
    switchRestoreTab(defaultTab);
    startModalAutoRefresh();
}

function closeRestoreCenterModal() {
    if (!cleanupRestoreModal) return;
    cleanupRestoreModal.style.display = 'none';
    stopModalAutoRefresh();
}

function startModalAutoRefresh() {
    stopModalAutoRefresh();
    modalAutoRefreshTimer = setInterval(() => {
        if (!cleanupRestoreModal || cleanupRestoreModal.style.display === 'none') {
            stopModalAutoRefresh();
            return;
        }
        if (currentRestoreTab === 'notifications') {
            loadAndRenderNotifications(true);
        }
    }, 4000);
}

function stopModalAutoRefresh() {
    if (modalAutoRefreshTimer) {
        clearInterval(modalAutoRefreshTimer);
        modalAutoRefreshTimer = null;
    }
}

function refreshRestoreCenterIfVisible() {
    if (cleanupRestoreModal && cleanupRestoreModal.style.display !== 'none') {
        if (currentRestoreTab === 'notifications') {
            loadAndRenderNotifications(true);
        }
    }
}

async function updateGlobalNotifBadge() {
    try {
        const res = await fetch(`/cleanup/notifications?t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        const activeCount = (data.active_notifications || []).length;
        if (modalNotifBadge) modalNotifBadge.textContent = activeCount;
        if (notifBadge) {
            notifBadge.textContent = activeCount;
            notifBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
        }
    } catch (e) {
        // silent fail
    }
}

function switchRestoreTab(tab) {
    currentRestoreTab = tab;
    if (tab === 'notifications') {
        if (tabBtnNotifications) tabBtnNotifications.classList.add('active');
        if (tabBtnTrash) tabBtnTrash.classList.remove('active');
        if (tabBtnAbnormalWhitelist) tabBtnAbnormalWhitelist.classList.remove('active');
        if (tabContentNotifications) tabContentNotifications.style.display = 'block';
        if (tabContentTrash) tabContentTrash.style.display = 'none';
        if (tabContentAbnormalWhitelist) tabContentAbnormalWhitelist.style.display = 'none';
        loadAndRenderNotifications(false);
        startModalAutoRefresh();
    } else if (tab === 'trash') {
        stopModalAutoRefresh();
        if (tabBtnNotifications) tabBtnNotifications.classList.remove('active');
        if (tabBtnTrash) tabBtnTrash.classList.add('active');
        if (tabBtnAbnormalWhitelist) tabBtnAbnormalWhitelist.classList.remove('active');
        if (tabContentNotifications) tabContentNotifications.style.display = 'none';
        if (tabContentTrash) tabContentTrash.style.display = 'block';
        if (tabContentAbnormalWhitelist) tabContentAbnormalWhitelist.style.display = 'none';
        loadAndRenderTrash();
    } else if (tab === 'whitelist') {
        stopModalAutoRefresh();
        if (tabBtnNotifications) tabBtnNotifications.classList.remove('active');
        if (tabBtnTrash) tabBtnTrash.classList.remove('active');
        if (tabBtnAbnormalWhitelist) tabBtnAbnormalWhitelist.classList.add('active');
        if (tabContentNotifications) tabContentNotifications.style.display = 'none';
        if (tabContentTrash) tabContentTrash.style.display = 'none';
        if (tabContentAbnormalWhitelist) tabContentAbnormalWhitelist.style.display = 'block';
        loadAndRenderAbnormalWhitelist();
    }
}

async function loadAndRenderNotifications(silent = false) {
    if (!notificationsTableBody) return;
    if (!silent) {
        notificationsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">알림 불러오는 중...</td></tr>';
    }

    try {
        const res = await fetch(`/cleanup/notifications?t=${Date.now()}`);
        if (!res.ok) throw new Error('알림 조회 실패');
        const data = await res.json();
        const activeList = data.active_notifications || [];
        const dismissedList = data.recent_dismissed || [];

        if (modalNotifBadge) modalNotifBadge.textContent = activeList.length;
        if (notifBadge) {
            notifBadge.textContent = activeList.length;
            notifBadge.style.display = activeList.length > 0 ? 'inline-flex' : 'none';
        }

        if (activeList.length === 0) {
            notificationsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">활성화된 삭제 알림이 없습니다.</td></tr>';
        } else {
            notificationsTableBody.innerHTML = activeList.map(n => {
                const baseCleanUrl = (n.url || '').split('#')[0];
                const reviewUrl = `${baseCleanUrl}#lanovel_review=${encodeURIComponent(n.batch_id || n.id)}`;
                return `
                <tr>
                    <td style="font-weight: 500;">${escapeHtml(n.novel_title || '미분류')}</td>
                    <td>${escapeHtml(n.episode_title || n.url)}</td>
                    <td style="text-align: center;"><span style="color: var(--danger-color); font-weight: 600;">${n.deleted_count}건</span></td>
                    <td>
                        <a href="${escapeHtml(reviewUrl)}" target="_blank" class="btn btn-sm btn-primary" style="text-decoration: none;">🔍 검수 회차 열기 ↗</a>
                    </td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-outline dismiss-notif-btn" data-id="${n.id}">해제</button>
                    </td>
                </tr>
            `;
            }).join('');
        }

        if (dismissedNotifsCount) dismissedNotifsCount.textContent = dismissedList.length;
        if (dismissedTableBody) {
            if (dismissedList.length === 0) {
                dismissedTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 16px;">최근 7일간 해제된 이력이 없습니다.</td></tr>';
            } else {
                dismissedTableBody.innerHTML = dismissedList.map(d => {
                    const dismissedDate = d.dismissed_at ? new Date(d.dismissed_at * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
                    const baseCleanUrl = (d.url || '').split('#')[0];
                    const reviewUrl = `${baseCleanUrl}#lanovel_review=${encodeURIComponent(d.batch_id || d.id)}`;
                    return `
                        <tr>
                            <td>${escapeHtml(d.novel_title || '미분류')}</td>
                            <td>${escapeHtml(d.episode_title || d.url)}</td>
                            <td>${d.deleted_count}건</td>
                            <td>${dismissedDate}</td>
                            <td><a href="${escapeHtml(reviewUrl)}" target="_blank" style="color: var(--primary-color);">열기 ↗</a></td>
                        </tr>
                    `;
                }).join('');
            }
        }

    } catch (err) {
        console.error('알림 로딩 실패:', err);
        if (!silent) {
            notificationsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger-color); padding: 20px;">알림 로딩 실패</td></tr>';
        }
    }
}

// 브라우저 창 포커스 또는 가시성 변경 시 알림 및 뱃지 자동 동기화
window.addEventListener('focus', () => {
    refreshRestoreCenterIfVisible();
    updateGlobalNotifBadge();
});
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        refreshRestoreCenterIfVisible();
        updateGlobalNotifBadge();
    }
});

async function dismissNotification(id) {
    try {
        const res = await fetch(`/cleanup/notifications/${id}/dismiss`, { method: 'POST' });
        if (!res.ok) throw new Error('해제 실패');
        showToast('삭제 알림이 해제되었습니다. (7일간 보존 이력에 보관됩니다)', 'info');
        loadAndRenderNotifications();
    } catch (err) {
        console.error('알림 해제 실패:', err);
        showToast('알림 해제 중 오류가 발생했습니다.', 'error');
    }
}

async function dismissAllNotifications() {
    if (!confirm('모든 삭제 알림을 해제하시겠습니까?')) return;
    try {
        const res = await fetch('/cleanup/notifications/dismiss_all', { method: 'POST' });
        if (!res.ok) throw new Error('전체 해제 실패');
        showToast('모든 알림이 해제되었습니다.', 'info');
        loadAndRenderNotifications();
    } catch (err) {
        console.error('전체 해제 실패:', err);
        showToast('알림 전체 해제 중 오류가 발생했습니다.', 'error');
    }
}

function toggleDismissedHistoryView() {
    if (!dismissedHistoryContainer) return;
    const isHidden = dismissedHistoryContainer.style.display === 'none';
    dismissedHistoryContainer.style.display = isHidden ? 'block' : 'none';
    const icon = document.getElementById('dismissedToggleIcon');
    if (icon) icon.textContent = isHidden ? '▼' : '▶';
}

async function loadAndRenderTrash() {
    if (!trashTableBody) return;
    trashTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">휴지통 목록 불러오는 중...</td></tr>';

    try {
        const res = await fetch(`/translations/trash?t=${Date.now()}`);
        if (!res.ok) throw new Error('휴지통 조회 실패');
        const data = await res.json();
        const trashList = data.trash || [];

        if (modalTrashBadge) modalTrashBadge.textContent = trashList.length;

        if (trashList.length === 0) {
            trashTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">휴지통이 비어 있습니다. (7일 경과 항목은 자동 영구 정리됩니다)</td></tr>';
            return;
        }

        trashTableBody.innerHTML = trashList.map(item => {
            const delDate = item.deleted_at ? new Date(item.deleted_at * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
            let catBadge = '';
            if (item.reason_category === 'verbatim_or_empty' || item.reason_category === 'verbatim') {
                catBadge = '<span class="category-badge badge-verbatim">원문 그대로</span>';
            } else if (item.reason_category === 'paraphrased_jp' || item.reason_category === 'paraphrased_zh' || item.reason_category === 'paraphrased') {
                catBadge = '<span class="category-badge badge-paraphrased">원문 변형</span>';
            } else {
                catBadge = '<span class="category-badge badge-moved">다른 언어</span>';
            }

            return `
                <tr>
                    <td style="font-size: 12px;">
                        <div><strong>${escapeHtml(item.folderName || '미분류')}</strong></div>
                        <div style="color: var(--text-muted);">${escapeHtml(item.title || item.url)}</div>
                    </td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.original)}</div></td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.translated || '(없음)')}</div></td>
                    <td>${catBadge}</td>
                    <td style="font-size: 12px; color: var(--text-muted);">${delDate}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-primary restore-trash-btn" data-id="${item.id}">복원</button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('휴지통 로딩 실패:', err);
        trashTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--danger-color); padding: 20px;">휴지통 로딩 실패</td></tr>';
    }
}

async function restoreTrashItem(trashId) {
    try {
        const res = await fetch('/translations/trash/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trash_ids: [trashId] })
        });
        if (!res.ok) throw new Error('복원 실패');
        const data = await res.json();
        showToast(data.message || '항목이 원래 번역 목록으로 복원되었습니다.', 'success');
        loadAndRenderTrash();
        loadNotificationsAndBadge();
        if (!isFindingEmpty && !isCleanupQueue) {
            loadAndRenderGrouped();
        } else if (isCleanupQueue) {
            loadAndRenderCleanupQueue();
        }
    } catch (err) {
        console.error('복원 실패:', err);
        showToast('복원 중 오류가 발생했습니다.', 'error');
    }
}

async function restoreAllTrash() {
    if (!confirm('휴지통의 모든 항목을 일괄 복원하시겠습니까?')) return;
    try {
        const res = await fetch('/translations/trash/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all_trash: true })
        });
        if (!res.ok) throw new Error('전체 복원 실패');
        const data = await res.json();
        showToast(data.message || '모든 항목이 복원되었습니다.', 'success');
        loadAndRenderTrash();
        loadNotificationsAndBadge();
        if (!isFindingEmpty && !isCleanupQueue) {
            loadAndRenderGrouped();
        } else if (isCleanupQueue) {
            loadAndRenderCleanupQueue();
        }
    } catch (err) {
        console.error('휴지통 전체 복원 실패:', err);
        showToast('전체 복원 처리 중 오류가 발생했습니다.', 'error');
    }
}

async function loadAndRenderAbnormalWhitelist() {
    if (!whitelistTableBody) return;
    whitelistTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 20px;">예외 목록 불러오는 중...</td></tr>';

    try {
        const res = await fetch(`/translations/abnormal_whitelist?t=${Date.now()}`);
        if (!res.ok) throw new Error('예외 목록 조회 실패');
        const data = await res.json();
        const wlList = data.whitelist || [];

        if (modalWhitelistBadge) modalWhitelistBadge.textContent = wlList.length;

        if (wlList.length === 0) {
            whitelistTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 24px;">이상번역에서 제외된 단락이 없습니다.</td></tr>';
            return;
        }

        whitelistTableBody.innerHTML = wlList.map(item => {
            const dateStr = item.created_at ? new Date(item.created_at * 1000).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '-';
            return `
                <tr>
                    <td style="font-size: 12px;">
                        <div><strong>${escapeHtml(item.folderName || '미분류')}</strong></div>
                        <div style="color: var(--text-muted);">${escapeHtml(item.title || item.url || '')}</div>
                    </td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.original)}</div></td>
                    <td style="max-width: 250px; font-size: 12px;"><div style="max-height: 60px; overflow-y: auto;">${escapeHtml(item.translated || '(없음)')}</div></td>
                    <td style="font-size: 12px; color: var(--text-muted);">${dateStr}</td>
                    <td style="text-align: center;">
                        <button class="btn btn-sm btn-outline remove-whitelist-btn" data-id="${item.translation_id}">해제</button>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error('예외 목록 로딩 실패:', err);
        whitelistTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--danger-color); padding: 20px;">예외 목록 로딩 실패</td></tr>';
    }
}

async function removeSingleWhitelist(translationId) {
    try {
        const res = await fetch('/translations/abnormal_whitelist/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [translationId] })
        });
        if (!res.ok) throw new Error('해제 실패');
        const data = await res.json();
        showToast(data.message || '이상번역 제외가 해제되었습니다.', 'success');
        loadAndRenderAbnormalWhitelist();
        loadNotificationsAndBadge();
        if (isFindingEmpty) {
            loadAndRenderAbnormal();
        }
    } catch (err) {
        console.error('예외 해제 실패:', err);
        showToast('예외 해제 중 오류가 발생했습니다.', 'error');
    }
}

async function clearAllAbnormalWhitelist() {
    if (!confirm('등록된 모든 이상번역 예외 항목을 일괄 해제하시겠습니까?\n해제 시 다시 이상번역 찾기 검사 대상에 포함됩니다.')) return;
    try {
        const res = await fetch('/translations/abnormal_whitelist/clear', {
            method: 'POST'
        });
        if (!res.ok) throw new Error('전체 해제 실패');
        const data = await res.json();
        showToast(data.message || '모든 이상번역 예외 항목이 해제되었습니다.', 'success');
        loadAndRenderAbnormalWhitelist();
        loadNotificationsAndBadge();
        if (isFindingEmpty) {
            loadAndRenderAbnormal();
        }
    } catch (err) {
        console.error('전체 예외 해제 실패:', err);
        showToast('전체 예외 해제 중 오류가 발생했습니다.', 'error');
    }
}

function closeRecommendPanel() {
    if (!similarRecommendPanel) return;
    similarRecommendPanel.style.display = 'none';
}

function toggleRecommendCollapse() {
    if (!similarRecommendPanel) return;
    isRecommendCollapsed = !isRecommendCollapsed;
    similarRecommendPanel.classList.toggle('is-collapsed', isRecommendCollapsed);
    if (recommendToggleIcon) {
        recommendToggleIcon.textContent = isRecommendCollapsed ? '▲' : '▼';
    }
    if (recommendToggleText) {
        recommendToggleText.textContent = isRecommendCollapsed ? '펼치기' : '접기';
    }
}

function handleTranslatedFocus(el) {
    activeTargetInput = el;
    if (!isFindingEmpty && !el.dataset.keywords) {
        return;
    }
    const kwString = el.dataset.keywords || '';
    const keywords = kwString.split(',').map(s => s.trim()).filter(Boolean);
    let keywordToSearch = keywords[0];

    if (!keywordToSearch) {
        const orig = el.dataset.original || '';
        const match = orig.match(/[\u30a0-\u30ff]{2,}|[\u4e00-\u9faf]{2,}/);
        if (match) {
            keywordToSearch = match[0];
        }
    }

    if (keywordToSearch) {
        const folder = el.dataset.folder || '';
        loadSimilarRecommendations(keywordToSearch, folder, keywords);
    }
}

async function loadSimilarRecommendations(keyword, folder = '', allKeywords = []) {
    if (!similarRecommendPanel) return;
    similarRecommendPanel.style.display = 'flex';
    similarRecommendPanel.classList.toggle('is-collapsed', isRecommendCollapsed);
    if (recommendToggleIcon) {
        recommendToggleIcon.textContent = isRecommendCollapsed ? '▲' : '▼';
    }
    if (recommendToggleText) {
        recommendToggleText.textContent = isRecommendCollapsed ? '펼치기' : '접기';
    }

    recommendKeyword.textContent = `"${keyword}" 검색 중...`;
    recommendCardsContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted);">유사 단락 검색 중...</div>';

    try {
        const url = `/translations/similar_examples?keyword=${encodeURIComponent(keyword)}&folder=${encodeURIComponent(folder)}&limit=8`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('추천 검색 실패');
        const data = await res.json();
        const examples = data.examples || [];

        renderSimilarRecommendations(keyword, examples, allKeywords);
    } catch (err) {
        console.error('추천 로딩 실패:', err);
        recommendCardsContainer.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--danger-color);">추천 불러오기 실패</div>';
    }
}

function renderSimilarRecommendations(keyword, examples, allKeywords = []) {
    if (!similarRecommendPanel) return;

    let kwHeaderHtml = `<strong>"${escapeHtml(keyword)}"</strong> <span style="font-size: 12px; font-weight: normal; color: var(--text-muted);">(${examples.length}건)</span>`;
    if (allKeywords && allKeywords.length > 1) {
        kwHeaderHtml = allKeywords.map(k => `
            <span class="kw-chip ${k === keyword ? 'active' : ''}" style="cursor: pointer; text-decoration: underline; margin-right: 4px;" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</span>
        `).join(' ');
    }

    const encKw = encodeURIComponent(keyword);
    const dictLinksHtml = `
        <span class="recommend-dict-links" style="display: inline-flex; gap: 6px; margin-left: 8px; align-items: center; flex-wrap: wrap;">
            <a href="https://ja.dict.naver.com/#/search?range=all&q=${encKw}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" style="font-size: 11px; padding: 1px 6px; color: #03c75a; border-color: #03c75a; text-decoration: none;">네이버 사전 ↗</a>
            <a href="https://www.weblio.jp/content/${encKw}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" style="font-size: 11px; padding: 1px 6px; color: #0f6fec; border-color: #0f6fec; text-decoration: none;">Weblio ↗</a>
            <a href="https://jisho.org/search/${encKw}" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-outline" style="font-size: 11px; padding: 1px 6px; color: #7952b3; border-color: #7952b3; text-decoration: none;">Jisho ↗</a>
        </span>
    `;

    recommendKeyword.innerHTML = kwHeaderHtml + dictLinksHtml;

    if (!examples || examples.length === 0) {
        recommendCardsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-muted);">'${escapeHtml(keyword)}'에 대한 다른 번역 사례를 찾지 못했습니다.</div>`;
        return;
    }

    const cardsHtml = examples.map(ex => {
        const novelTitle = ex.folderName || '소설';
        const epTitle = ex.title || '회차';
        const escOri = escapeHtml(ex.original || '');
        const escTra = escapeHtml(ex.translated || '');
        const highlightedOri = highlightKeyword(escOri, keyword);
        const highlightedTra = highlightKeyword(escTra, keyword);
        const pidBadge = ex.pid ? `<span class="recommend-card-pid">${escapeHtml(ex.pid)}</span>` : '';

        const baseCleanUrl = (ex.url || '').split('#')[0];
        const targetUrl = ex.pid ? `${baseCleanUrl}#${ex.pid}` : baseCleanUrl;

        return `
            <div class="recommend-card" data-url="${escapeHtml(targetUrl)}" data-id="${ex.id}" title="클릭 시 새 창에서 해당 단락 열기">
                <div class="recommend-card-header">
                    <span class="recommend-card-novel">[${escapeHtml(novelTitle)}]</span>
                    <span class="recommend-card-ep" title="${escapeHtml(epTitle)}">${escapeHtml(epTitle)}</span>
                    ${pidBadge}
                    <span class="recommend-card-ext-icon">🔗 새 창 ↗</span>
                </div>
                <div class="recommend-card-ori">${highlightedOri}</div>
                <div class="recommend-card-tra">${highlightedTra}</div>
                <div class="recommend-card-actions">
                    <button type="button" class="btn btn-sm btn-outline recommend-copy-btn" data-text="${escTra}" title="번역문 복사 또는 현재 셀에 적용">📋 번역 복사</button>
                    <button type="button" class="btn btn-sm btn-primary recommend-open-btn" data-url="${escapeHtml(targetUrl)}" title="새 창에서 원본 웹소설의 해당 단락으로 이동">🔗 해당 단락 열기 ↗</button>
                </div>
            </div>
        `;
    }).join('');

    recommendCardsContainer.innerHTML = cardsHtml;
}

function highlightKeyword(text, keyword) {
    if (!keyword) return text;
    const escapedKw = escapeRegExp(keyword);
    return text.replace(new RegExp(`(${escapedKw})`, 'gi'), '<mark style="background-color: #ffec99; padding: 0 2px; border-radius: 2px;">$1</mark>');
}

function handleRecommendCardClick(e) {
    const copyBtn = e.target.closest('.recommend-copy-btn');
    if (copyBtn) {
        e.stopPropagation();
        const text = copyBtn.dataset.text || '';
        if (activeTargetInput) {
            activeTargetInput.textContent = text;
            showToast('추천 번역문이 입력창에 적용되었습니다. (💾 저장 버튼을 눌러 확정하세요)', 'success');
        } else {
            navigator.clipboard.writeText(text);
            showToast('추천 번역문이 클립보드에 복사되었습니다.', 'success');
        }
        return;
    }

    const openBtn = e.target.closest('.recommend-open-btn');
    const card = e.target.closest('.recommend-card');
    const targetUrl = openBtn ? openBtn.dataset.url : (card ? card.dataset.url : null);

    if (targetUrl) {
        window.open(targetUrl, '_blank');
    }
}

let dragSearchTimeout = null;
let dragSearchAbortController = null;

function handleDocumentMouseUp(e) {
    // If clicking or selecting inside the recommendation panel or any modal, ignore
    if (e.target && (e.target.closest('#similarRecommendPanel') || e.target.closest('.modal-content') || e.target.closest('.master-controls'))) {
        return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    // Only search meaningful terms: length between 2 and 80 characters
    if (selectedText.length < 2 || selectedText.length > 80) return;

    // Check if selection is within translated-text or translated-cell
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    const translatedEl = (anchorNode ? (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement).closest('.translated-text') : null) ||
                         (focusNode ? (focusNode.nodeType === 1 ? focusNode : focusNode.parentElement).closest('.translated-text') : null);

    if (!translatedEl) return;

    activeTargetInput = translatedEl;
    const currentId = parseInt(translatedEl.dataset.id, 10) || null;
    const folder = translatedEl.dataset.folder || '';

    // Debounce to allow natural mouse release
    if (dragSearchTimeout) clearTimeout(dragSearchTimeout);
    dragSearchTimeout = setTimeout(() => {
        handleDragTranslationSearch(selectedText, currentId, folder);
    }, 200);
}

async function handleDragTranslationSearch(keyword, excludeId, folder) {
    if (dragSearchAbortController) {
        dragSearchAbortController.abort();
    }
    dragSearchAbortController = new AbortController();

    try {
        const url = `/translations/similar_examples?keyword=${encodeURIComponent(keyword)}&exclude_id=${excludeId || ''}&folder=${encodeURIComponent(folder || '')}&limit=8`;
        const res = await fetch(url, { signal: dragSearchAbortController.signal });
        if (!res.ok) return;
        const data = await res.json();
        const examples = data.examples || [];

        // If other translations exist with this keyword, show the recommendation panel!
        if (examples.length > 0) {
            renderSimilarRecommendations(keyword, examples, [keyword]);
            if (similarRecommendPanel) {
                similarRecommendPanel.style.display = 'flex';
                similarRecommendPanel.classList.toggle('is-collapsed', isRecommendCollapsed);
                if (recommendToggleIcon) recommendToggleIcon.textContent = isRecommendCollapsed ? '▲' : '▼';
                if (recommendToggleText) recommendToggleText.textContent = isRecommendCollapsed ? '펼치기' : '접기';
            }
        } else {
            // If panel is ALREADY open, show message; if closed, do not disturb the user
            if (similarRecommendPanel && similarRecommendPanel.style.display === 'flex') {
                recommendKeyword.textContent = `"${keyword}" (0건)`;
                recommendCardsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-muted);">'${escapeHtml(keyword)}'을(를) 포함하는 다른 번역문을 찾지 못했습니다.</div>`;
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('드래그 단어 검색 오류:', err);
        }
    }
}

function openFindReplaceModal() {
    if (!findReplaceModal) return;

    // Reset form
    findText.value = '';
    replaceText.value = '';
    conditionText.value = '';
    useRegex.checked = false;
    caseSensitive.checked = false;
    findCount.textContent = '(0개)';

    // Populate folder scope dropdown
    folderScope.innerHTML = '';
    if (selectedIds && selectedIds.size > 0) {
        const selectedOption = document.createElement('option');
        selectedOption.value = '__selected__';
        selectedOption.textContent = `선택된 ${selectedIds.size}개 항목`;
        folderScope.appendChild(selectedOption);
    }

    const allOption = document.createElement('option');
    allOption.value = '__all__';
    allOption.textContent = '모든 폴더';
    folderScope.appendChild(allOption);

    allFolders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder.name;
        option.textContent = folder.name;
        folderScope.appendChild(option);
    });

    findReplaceModal.style.display = 'flex';
    findText.focus();
}

function closeFindReplaceModal() {
    if (!findReplaceModal) return;
    findReplaceModal.style.display = 'none';
}

function countOccurrences() {
    const findTextValue = findText.value;
    const conditionTextValue = conditionText.value;
    const selectedFolder = folderScope.value;
    const useRegexValue = useRegex.checked;
    const caseSensitiveValue = caseSensitive.checked;

    if (!findTextValue) {
        findCount.textContent = '(0개)';
        return;
    }

    let count = 0;
    const flags = caseSensitiveValue ? 'g' : 'gi';
    let findRegex;
    try {
        findRegex = new RegExp(useRegexValue ? findTextValue : escapeRegExp(findTextValue), flags);
    } catch (e) {
        findCount.textContent = '(유효하지 않은 정규식)';
        return;
    }

    const isSelectedScope = selectedFolder === '__selected__';
    const dataSources = [groupedTranslations, rawAbnormalData, rawCleanupData].filter(Boolean);
    const countedIds = new Set();

    for (const source of dataSources) {
        for (const folderName in source) {
            if (!isSelectedScope && selectedFolder !== '__all__' && folderName !== selectedFolder) {
                continue;
            }

            const urlGroups = source[folderName];
            if (!Array.isArray(urlGroups)) continue;

            for (const urlGroup of urlGroups) {
                const items = urlGroup.items;
                if (!Array.isArray(items)) continue;

                for (const item of items) {
                    if (countedIds.has(item.id)) continue;
                    if (isSelectedScope && !selectedIds.has(item.id)) continue;

                    // Check conditionText in original (null-safe)
                    if (conditionTextValue) {
                        const originalContent = caseSensitiveValue ? (item.original || '') : (item.original || '').toLowerCase();
                        const conditionContent = caseSensitiveValue ? conditionTextValue : conditionTextValue.toLowerCase();
                        if (!originalContent.includes(conditionContent)) {
                            continue;
                        }
                    }

                    // Check findText in translated
                    if (item.translated) {
                        const matches = item.translated.match(findRegex);
                        if (matches) {
                            count += matches.length;
                            countedIds.add(item.id);
                        }
                    }
                }
            }
        }
    }
    findCount.textContent = `(${count}개)`;
}

// Helper function to escape special characters for regex
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function applyFindReplaceToLocalData(findTextValue, replaceTextValue, conditionTextValue, selectedFolder, useRegexValue, caseSensitiveValue, targetIds = null) {
    let regex;
    const flags = caseSensitiveValue ? 'g' : 'gi';
    try {
        regex = new RegExp(useRegexValue ? findTextValue : escapeRegExp(findTextValue), flags);
    } catch (e) {
        console.error("Regex build error in local update:", e);
        return;
    }

    const targetIdSet = targetIds && targetIds.length > 0 ? new Set(targetIds) : null;
    const isSelectedScope = selectedFolder === '__selected__' || Boolean(targetIdSet);

    // 1. 메모리 상의 모든 활성 데이터 소스 (groupedTranslations, rawAbnormalData, rawCleanupData) 동기화
    const sourcesToUpdate = [groupedTranslations, rawAbnormalData, rawCleanupData].filter(Boolean);

    for (const source of sourcesToUpdate) {
        for (const folderName in source) {
            if (!isSelectedScope && selectedFolder !== '__all__' && folderName !== selectedFolder) {
                continue;
            }

            const urlGroups = source[folderName];
            if (!Array.isArray(urlGroups)) continue;

            for (const urlGroup of urlGroups) {
                const items = urlGroup.items;
                if (!Array.isArray(items)) continue;

                for (const item of items) {
                    if (targetIdSet && !targetIdSet.has(item.id)) {
                        continue;
                    }

                    if (conditionTextValue) {
                        const originalContent = caseSensitiveValue ? (item.original || '') : (item.original || '').toLowerCase();
                        const conditionContent = caseSensitiveValue ? conditionTextValue : conditionTextValue.toLowerCase();
                        if (!originalContent.includes(conditionContent)) {
                            continue;
                        }
                    }

                    if (item.translated) {
                        item.translated = item.translated.replace(regex, () => replaceTextValue);
                    }
                }
            }
        }
    }

    // 2. 현재 화면에 이미 렌더링된 번역 텍스트 요소들 즉시 갱신
    document.querySelectorAll('.translated-text').forEach(el => {
        const itemId = parseInt(el.dataset.id, 10);
        if (targetIdSet && !targetIdSet.has(itemId)) {
            return;
        }

        const itemFolder = el.dataset.folder || '';
        if (!isSelectedScope && selectedFolder !== '__all__' && itemFolder !== selectedFolder) {
            return;
        }

        if (conditionTextValue) {
            const itemOrig = caseSensitiveValue ? (el.dataset.original || '') : (el.dataset.original || '').toLowerCase();
            const conditionContent = caseSensitiveValue ? conditionTextValue : conditionTextValue.toLowerCase();
            if (!itemOrig.includes(conditionContent)) {
                return;
            }
        }

        if (el.textContent && regex.test(el.textContent)) {
            el.textContent = el.textContent.replace(regex, () => replaceTextValue);
        }
    });

    // 3. 통계 갱신
    updateStatistics(groupedTranslations);
}

async function executeGlobalFindReplace() {
    const findTextValue = findText.value;
    const replaceTextValue = replaceText.value;
    const conditionTextValue = conditionText.value;
    const selectedFolder = folderScope.value;
    const useRegexValue = useRegex.checked;
    const caseSensitiveValue = caseSensitive.checked;

    if (!findTextValue) {
        showToast('찾을 내용을 입력하세요.', 'error');
        return;
    }

    const isSelectedScope = selectedFolder === '__selected__';
    const targetIds = isSelectedScope ? Array.from(selectedIds) : null;
    const scopeLabel = isSelectedScope 
        ? `선택된 ${targetIds.length}개 항목` 
        : (selectedFolder === '__all__' ? '전체 번역 기록' : `'${selectedFolder}' 폴더`);

    if (!confirm(`[${scopeLabel}] 범위에서 "${findTextValue}"을(를) "${replaceTextValue}"(으)로 바꾸시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }

    const originalBtnText = executeFindReplaceBtn.textContent;
    executeFindReplaceBtn.disabled = true;
    executeFindReplaceBtn.textContent = '치환 중...';

    try {
        const payload = {
            find_text: findTextValue,
            replace_text: replaceTextValue,
            condition_text: conditionTextValue || null,
            folder_scope: isSelectedScope ? null : selectedFolder,
            use_regex: useRegexValue,
            case_sensitive: caseSensitiveValue
        };
        if (targetIds && targetIds.length > 0) {
            payload.target_ids = targetIds;
        }

        const response = await fetch('/translations/find_replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        const result = await response.json();
        showToast(result.message, 'success');
        closeFindReplaceModal();

        // 192MB 전체 재로드(loadAndRenderGrouped) 대신 로컬 데이터와 화면 DOM에 즉시 반영
        applyFindReplaceToLocalData(findTextValue, replaceTextValue, conditionTextValue, selectedFolder, useRegexValue, caseSensitiveValue, targetIds);

    } catch (error) {
        console.error("Global find and replace failed:", error);
        showToast(`오류: ${error.message}`, 'error');
    } finally {
        executeFindReplaceBtn.disabled = false;
        executeFindReplaceBtn.textContent = originalBtnText;
    }
}

async function createFolder() {
    const newName = newFolderNameInput.value.trim();
    if (!newName) {
        showToast('폴더 이름을 입력하세요.', 'error');
        return;
    }

    try {
        const response = await fetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_name: newName })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.message || `Server error: ${response.status}`);
        }

        showToast(result.message, 'success');
        newFolderNameInput.value = '';
        
        // Fetch the updated folder list and repopulate the dropdown.
        const foldersRes = await fetch(`/folders?t=${Date.now()}`);
        if (foldersRes.ok) {
            const allFolders = await foldersRes.json();
            populateFolderDropdowns(allFolders);
        }
        
        loadAndRenderGrouped(); // Reload all data to show the new folder
    } catch (error) {
        console.error("Failed to create folder:", error);
        showToast(`폴더 생성 실패: ${error.message}`, 'error');
    }
}

function getCurrentDataSource() {
    if (isFindingEmpty) return rawAbnormalData || {};
    if (isCleanupQueue) return rawCleanupData || {};
    return groupedTranslations || {};
}

function handleCheckboxChange(e) {
    const target = e.target;
    if (!target.matches('input[type="checkbox"]')) return;

    const currentData = getCurrentDataSource();

    if (target.classList.contains('folder-select-all-checkbox')) {
        const folderGroup = target.closest('.history-folder-group');
        if (!folderGroup) return;

        const folderTitleEl = folderGroup.querySelector('.folder-group-title');
        const folderName = folderTitleEl ? folderTitleEl.textContent.split(' (')[0].trim() : '';
        const urlGroups = currentData[folderName] || [];
        for (const ug of urlGroups) {
            for (const item of ug.items || []) {
                if (target.checked) {
                    selectedIds.add(item.id);
                } else {
                    selectedIds.delete(item.id);
                }
            }
        }

        const groupCheckboxes = folderGroup.querySelectorAll('.group-select-all-checkbox');
        groupCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });

        const itemCheckboxes = folderGroup.querySelectorAll('.item-checkbox');
        itemCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });
    } else if (target.classList.contains('group-select-all-checkbox')) {
        const urlGroup = target.closest('.list-group');
        if (!urlGroup) return;

        const url = urlGroup.dataset.url;
        const folderName = urlGroup.dataset.folderName;
        const urlGroups = currentData[folderName] || [];
        const foundGroup = urlGroups.find(g => g.url === url);
        if (foundGroup) {
            for (const item of foundGroup.items || []) {
                if (target.checked) {
                    selectedIds.add(item.id);
                } else {
                    selectedIds.delete(item.id);
                }
            }
        }
        
        const itemCheckboxes = urlGroup.querySelectorAll('.item-checkbox');
        itemCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });
    } else if (target.classList.contains('item-checkbox')) {
        const id = parseInt(target.dataset.id);
        if (target.checked) {
            selectedIds.add(id);
        } else {
            selectedIds.delete(id);
        }
    }

    updateBulkActionPanel();
}

const unclassifiedParagraphsMap = new Map();

function findTranslationById(id) {
    if (unclassifiedParagraphsMap.has(id)) {
        return unclassifiedParagraphsMap.get(id);
    }
    const sources = [groupedTranslations, rawAbnormalData, rawCleanupData];
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

async function handleHistoryClick(e) {
    const target = e.target;

    // Ignore clicks on checkboxes, they are handled by a different listener
    if (target.matches('input[type="checkbox"]')) {
        return;
    }

    // 1. Handle Folder Name Edit
    if (target.classList.contains('edit-folder-name-btn')) {
        const oldFolderName = target.dataset.folderName;
        const newFolderName = prompt(`'${oldFolderName}' 폴더의 새 이름을 입력하세요:`);
        if (newFolderName && newFolderName.trim() !== '' && newFolderName !== oldFolderName) {
            renameFolder(oldFolderName, newFolderName.trim());
        }
        return; // Action handled
    }

    // 2. Handle URL-level actions (Title Edit, Apply, Episode toggle)
    const urlHeader = target.closest('.list-group-header');
    if (urlHeader) {
        if (target.closest('.edit-title-btn')) {
            const btn = target.closest('.edit-title-btn');
            const url = btn.dataset.url;
            const titleElement = urlHeader.querySelector('.list-group-title');
            const currentTitle = titleElement ? titleElement.textContent : '';
            const newTitle = prompt("새 회차 제목을 입력하세요:", currentTitle);
            if (newTitle && newTitle !== currentTitle) {
                if (titleElement) titleElement.textContent = newTitle;
                try {
                    await fetch('/translations/url_title', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url, title: newTitle })
                    });
                    showToast('회차 제목이 수정되었습니다.', 'success');
                } catch (error) {
                    showToast('제목 수정에 실패했습니다.', 'error');
                    if (titleElement) titleElement.textContent = currentTitle;
                }
            }
            return; // Action handled
        }

        if (target.closest('.btn-apply')) {
            const btn = target.closest('.btn-apply');
            const url = btn.dataset.url;
            toggleApplyStatus(url, btn); // Pass button for optimistic UI update
            return; // Action handled
        }

        if (target.closest('.ext-link-btn')) {
            // Let the browser open the external novel link naturally in new tab
            return;
        }

        if (target.closest('.group-select-all-checkbox') || target.closest('.checkbox-container')) {
            return; // Handled by change listener
        }

        // 미분류 소설 보관함(드로어) 내부의 회차 토글은 renderUnclassifiedEpisodes 자체 핸들러가 처리
        if (urlHeader.closest('#unclassifiedEpisodeListContainer')) {
            return;
        }

        // Clicking anywhere else in the episode header (title, chevron, or row background) toggles the episode
        const listGroupEl = urlHeader.closest('.list-group');
        const contentEl = urlHeader.nextElementSibling;
        const isExpanding = contentEl.classList.contains('collapsed');

        if (isExpanding) {
            renderUrlGroupContent(listGroupEl);
            contentEl.classList.remove('collapsed');
            const icon = urlHeader.querySelector('.list-group-toggle');
            if (icon) {
                icon.classList.remove('collapsed');
                icon.textContent = 'expand_more';
            }
        } else {
            contentEl.classList.add('collapsed');
            const icon = urlHeader.querySelector('.list-group-toggle');
            if (icon) {
                icon.classList.add('collapsed');
                icon.textContent = 'chevron_right';
            }
        }
        return;
    }

    // 3. Handle Item-level actions (Save, Copy, Exclude, Delete)
    const itemRow = target.closest('.history-item');
    if (itemRow) {
        const id = parseInt(itemRow.dataset.id);

        // 원문 복사 버튼 처리 (원문 텍스트 복사 및 시각 피드백)
        const copyOrigBtn = target.closest('.copy-orig-btn') || (target.classList.contains('copy-btn') ? target : null);
        if (copyOrigBtn) {
            const originalText = copyOrigBtn.dataset.original || itemRow.querySelector('.original-text')?.textContent;
            if (originalText) {
                navigator.clipboard.writeText(originalText);
                showToast('원문이 클립보드에 복사되었습니다.', 'success');
                const origHtml = copyOrigBtn.innerHTML;
                copyOrigBtn.innerHTML = '✅ 복사 완료!';
                copyOrigBtn.classList.add('copied');
                setTimeout(() => {
                    copyOrigBtn.innerHTML = origHtml;
                    copyOrigBtn.classList.remove('copied');
                }, 1500);
            }
            return;
        }

        const whitelistBtn = target.closest('.whitelist-item-btn');
        if (whitelistBtn) {
            try {
                const res = await fetch('/translations/abnormal_whitelist/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [id] })
                });
                if (!res.ok) throw new Error('서버 응답 오류');
                itemRow.style.transition = 'opacity 0.25s, transform 0.25s';
                itemRow.style.opacity = '0';
                itemRow.style.transform = 'translateX(20px)';
                setTimeout(() => itemRow.remove(), 250);
                showToast('해당 단락이 이상번역 검사에서 제외되었습니다.', 'success');
                loadNotificationsAndBadge();
            } catch (err) {
                console.error('이상번역 제외 실패:', err);
                showToast(`이상번역 제외 실패: ${err.message}`, 'error');
            }
            return;
        }

        const deleteBtn = target.closest('.delete-btn');
        if (deleteBtn) {
            if (!confirm('이 번역을 삭제하시겠습니까?')) return;
            await fetch(`/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
            itemRow.remove();
            showToast('삭제되었습니다.');
            return;
        }

        const excludeBtn = target.closest('.exclude-btn');
        if (excludeBtn) {
            if (!confirm('이 문장을 번역에서 영구적으로 제외하시겠습니까?')) return;
            try {
                const response = await fetch(`/translations/exclude`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: [id] })
                });
                if (!response.ok) throw new Error('Server responded with an error');
                itemRow.remove();
                showToast('문장이 제외되고 삭제되었습니다.', 'success');
            } catch (error) {
                console.error('Failed to exclude translation:', error);
                showToast('문장 제외에 실패했습니다.', 'error');
            }
            return;
        }

        const retransBtn = target.closest('.retranslate-item-btn');
        if (retransBtn) {
            const originalItem = findTranslationById(id);
            if (!originalItem) {
                showToast('오류: 재번역할 항목을 찾을 수 없습니다.', 'error');
                return;
            }
            if (!confirm(`이 문장을 고성능 모델로 재번역하시겠습니까?\n\n원문: ${originalItem.original}`)) return;

            const translatedCell = itemRow.querySelector('.translated-text');
            const prevText = translatedCell.textContent;
            retransBtn.disabled = true;
            translatedCell.textContent = '⏳ 고성능 모델로 재번역 중...';

            try {
                const response = await fetch('/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: [{ id: String(originalItem.pid || id), text: originalItem.original }],
                        url: originalItem.url || '',
                        is_retranslation: true
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
                    throw new Error(errData.detail || '재번역 API 호출 실패');
                }

                const data = await response.json();
                if (data.translations && data.translations.length > 0) {
                    const newTranslated = data.translations[0].translated;
                    translatedCell.textContent = newTranslated;

                    // DB 저장
                    const updatedItemPayload = {
                        ...originalItem,
                        translated: newTranslated,
                        timestamp: Math.floor(Date.now() / 1000)
                    };
                    delete updatedItemPayload.id;

                    await fetch('/translations/upsert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([updatedItemPayload])
                    });

                    originalItem.translated = newTranslated;
                    originalItem.timestamp = updatedItemPayload.timestamp;

                    const dateElement = itemRow.querySelector('.item-date');
                    if (dateElement) {
                        const date = new Date(updatedItemPayload.timestamp * 1000);
                        dateElement.textContent = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
                    }
                    showToast('고성능 모델로 재번역 및 저장되었습니다.', 'success');
                } else {
                    throw new Error('재번역 결과를 받지 못했습니다.');
                }
            } catch (error) {
                console.error('재번역 실패:', error);
                translatedCell.textContent = prevText;
                showToast(`재번역 실패: ${error.message}`, 'error');
            } finally {
                retransBtn.disabled = false;
            }
            return;
        }

        const saveBtn = target.closest('.save-item-btn');
        if (saveBtn) {
            const newTranslatedText = itemRow.querySelector('.translated-text').textContent;
            const originalItem = findTranslationById(id);
            if (!originalItem) {
                showToast('오류: 저장할 원본 항목을 찾을 수 없습니다.', 'error');
                return;
            }
            const updatedItemPayload = {
                ...originalItem,
                translated: newTranslatedText,
                timestamp: Math.floor(Date.now() / 1000)
            };
            delete updatedItemPayload.id;
            try {
                const response = await fetch('/translations/upsert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([updatedItemPayload])
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(`Server error: ${response.status} - ${errorData.detail || 'Unknown error'}`);
                }
                showToast('저장되었습니다.');
                originalItem.translated = newTranslatedText;
                originalItem.timestamp = updatedItemPayload.timestamp;
                const dateElement = itemRow.querySelector('.item-date');
                if(dateElement) {
                     const date = new Date(updatedItemPayload.timestamp * 1000);
                     dateElement.textContent = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
                }
            } catch (error) {
                console.error('Failed to save translation:', error);
                showToast(`저장 실패: ${error.message}`, 'error');
            }
            return;
        }
        return; // Action handled
    }

    // 4. Handle Folder expand/collapse & Toggle All Episodes
    const folderHeader = target.closest('.folder-group-header');
    if (folderHeader) {
        if (target.closest('.folder-select-all-checkbox') || target.closest('.checkbox-container')) {
            return; // Handled by change listener
        }

        // Toggle all episodes button in this folder
        const toggleAllBtn = target.closest('.toggle-all-episodes-btn');
        if (toggleAllBtn) {
            const folderContent = folderHeader.nextElementSibling;
            if (folderContent.classList.contains('collapsed')) {
                folderContent.classList.remove('collapsed');
                folderHeader.querySelector('.folder-group-toggle')?.classList.remove('collapsed');
            }
            const isExpandingAll = toggleAllBtn.textContent.includes('펼치기');
            const listGroups = folderContent.querySelectorAll('.list-group');
            listGroups.forEach(lg => {
                const content = lg.querySelector('.list-group-content');
                const toggle = lg.querySelector('.list-group-toggle');
                if (isExpandingAll) {
                    renderUrlGroupContent(lg);
                    content?.classList.remove('collapsed');
                    if (toggle) {
                        toggle.classList.remove('collapsed');
                        toggle.textContent = 'expand_more';
                    }
                } else {
                    content?.classList.add('collapsed');
                    if (toggle) {
                        toggle.classList.add('collapsed');
                        toggle.textContent = 'chevron_right';
                    }
                }
            });
            toggleAllBtn.textContent = isExpandingAll ? '모든 회차 접기' : '모든 회차 펼치기';
            return;
        }

        // Toggle novel folder
        const folderContent = folderHeader.nextElementSibling;
        const toggle = folderHeader.querySelector('.folder-group-toggle');
        const isExpanding = folderContent.classList.contains('collapsed');
        if (isExpanding) {
            folderContent.classList.remove('collapsed');
            if (toggle) toggle.classList.remove('collapsed');
        } else {
            folderContent.classList.add('collapsed');
            if (toggle) toggle.classList.add('collapsed');
        }
        return;
    }
}
async function toggleApplyStatus(url, button) {
    const cleanUrl = url.split('#')[0].replace(/\/$/, '');
    const shouldApply = !button.classList.contains('applied');

    try {
        const response = await fetch('/api/urls/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl, apply: shouldApply })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        // Update UI optimistically
        if (shouldApply) {
            appliedUrlsSet.add(cleanUrl);
            button.textContent = '해제';
            button.classList.add('applied');
        } else {
            appliedUrlsSet.delete(cleanUrl);
            button.textContent = '적용';
            button.classList.remove('applied');
        }
        showToast(shouldApply ? '적용 설정 완료' : '적용 설정 해제', 'success');

    } catch (error) {
        console.error('Failed to toggle apply status:', error);
        showToast('상태 변경에 실패했습니다.', 'error');
    }
}

function updateBulkActionPanel() {
    const hasSelection = selectedIds.size > 0;

    if (hasSelection) {
        bulkActionsPanel.style.display = 'flex';
        selectionCount.textContent = `${selectedIds.size}개 선택됨`;
    } else {
        bulkActionsPanel.style.display = 'none';
    }

    if (bulkWhitelistAbnormalBtn) {
        bulkWhitelistAbnormalBtn.style.display = (hasSelection && isFindingEmpty) ? 'inline-flex' : 'none';
    }
    if (bulkMoveToCleanupBtn) {
        bulkMoveToCleanupBtn.style.display = (hasSelection && isFindingEmpty) ? 'inline-flex' : 'none';
    }

    if (deleteSelectedBtn) deleteSelectedBtn.disabled = !hasSelection;
    if (moveSelectedToFolderDropdown) moveSelectedToFolderDropdown.disabled = !hasSelection;
    if (retranslateSelectedBtn) retranslateSelectedBtn.disabled = !hasSelection;
    if (copySelectedOriginalBtn) copySelectedOriginalBtn.disabled = !hasSelection;
    if (bulkFindReplaceBtn) bulkFindReplaceBtn.disabled = !hasSelection;
    if (excludeSelectedBtn) excludeSelectedBtn.disabled = !hasSelection;
}

function deselectAll() {
    selectedIds.clear();
    const checkboxes = historyContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => { cb.checked = false; });
    updateBulkActionPanel();
    showToast('선택이 해제되었습니다.', 'info');
}

function copySelectedOriginals() {
    if (selectedIds.size === 0) return;
    const originals = [];
    for (const id of selectedIds) {
        const item = findTranslationById(id);
        if (item && item.original) {
            originals.push(item.original);
        }
    }
    if (originals.length === 0) {
        showToast('복사할 원문이 없습니다.', 'error');
        return;
    }
    const text = originals.join('\n\n');
    navigator.clipboard.writeText(text);
    showToast(`선택한 ${originals.length}개 단락의 원문이 클립보드에 복사되었습니다.`, 'success');
}

async function excludeSelectedTranslations() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`선택한 ${count}개 문장을 번역에서 영구적으로 제외하시겠습니까?\n(제외된 문장은 삭제되며, 이후 웹페이지 번역 시에도 자동으로 건너뜁니다.)`)) return;

    try {
        const response = await fetch('/translations/exclude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        if (!response.ok) throw new Error('서버 응답 오류');
        showToast(`${count}개의 문장이 제외되고 삭제되었습니다.`, 'success');
        selectedIds.clear();
        if (isFindingEmpty) {
            loadAndRenderAbnormal();
        } else if (isCleanupQueue) {
            loadAndRenderCleanupQueue();
        } else {
            loadAndRenderGrouped();
        }
    } catch (err) {
        console.error('문장 일괄 제외 실패:', err);
        showToast(`문장 제외 실패: ${err.message}`, 'error');
    }
}

async function retranslateSelectedTranslations() {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`선택한 ${count}개의 단락을 고성능 AI 모델로 일괄 재번역하시겠습니까?`)) return;

    const itemsToRetranslate = [];
    for (const id of selectedIds) {
        const item = findTranslationById(id);
        if (item && item.original) {
            itemsToRetranslate.push(item);
        }
    }

    if (itemsToRetranslate.length === 0) {
        showToast('재번역할 문장을 찾을 수 없습니다.', 'error');
        return;
    }

    showToast(`${count}개 단락 재번역을 시작합니다...`, 'info');
    if (retranslateSelectedBtn) retranslateSelectedBtn.disabled = true;

    const CHUNK_SIZE = 10;
    let successCount = 0;
    let failCount = 0;

    try {
        for (let i = 0; i < itemsToRetranslate.length; i += CHUNK_SIZE) {
            const chunk = itemsToRetranslate.slice(i, i + CHUNK_SIZE);
            const reqPayload = {
                items: chunk.map(it => ({ id: String(it.pid || it.id), text: it.original })),
                url: chunk[0].url || '',
                is_retranslation: true
            };

            try {
                const res = await fetch('/translate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(reqPayload)
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const translations = data.translations || [];

                const upsertPayload = [];
                const now = Math.floor(Date.now() / 1000);

                for (const t of translations) {
                    const matched = chunk.find(it => String(it.pid || it.id) === String(t.id));
                    if (matched) {
                        matched.translated = t.translated;
                        matched.timestamp = now;

                        const p = { ...matched, translated: t.translated, timestamp: now };
                        delete p.id;
                        upsertPayload.push(p);
                        successCount++;
                    }
                }

                if (upsertPayload.length > 0) {
                    await fetch('/translations/upsert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(upsertPayload)
                    });
                }
            } catch (err) {
                console.error('청크 재번역 실패:', err);
                failCount += chunk.length;
            }
        }

        showToast(`재번역 완료: ${successCount}건 성공${failCount > 0 ? `, ${failCount}건 실패` : ''}`, successCount > 0 ? 'success' : 'error');
        selectedIds.clear();
        if (isFindingEmpty) {
            loadAndRenderAbnormal();
        } else if (isCleanupQueue) {
            loadAndRenderCleanupQueue();
        } else {
            loadAndRenderGrouped();
        }
    } finally {
        if (retranslateSelectedBtn) retranslateSelectedBtn.disabled = false;
    }
}

function getTranslationsList(selectedOnly = false) {
    const list = [];
    const source = isFindingEmpty ? rawAbnormalData : (isCleanupQueue ? rawCleanupData : groupedTranslations);
    if (!source) return list;

    for (const folderName in source) {
        if (folderName.startsWith('_')) continue;
        const groups = source[folderName];
        if (!Array.isArray(groups)) continue;
        for (const grp of groups) {
            for (const item of (grp.items || [])) {
                if (!selectedOnly || selectedIds.has(item.id)) {
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

async function deleteSelectedTranslations() {
    if (selectedIds.size === 0 || !confirm(`정말로 ${selectedIds.size}개의 번역을 삭제하시겠습니까?`)) return;
    
    const idsToDelete = Array.from(selectedIds);
    await fetch(`/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToDelete }) });
    showToast(`${idsToDelete.length}개의 항목이 삭제되었습니다.`, 'success');
    selectedIds.clear();
    loadAndRenderGrouped();
}

async function moveSelectedTranslationsToFolder(event) {
    if (selectedIds.size === 0) return;
    const newFolderName = event.target.value;
    if (newFolderName === "") return;

    const idsToMove = Array.from(selectedIds);
    const folderForAPI = newFolderName === "__no_folder__" ? null : newFolderName;

    if (!confirm(`${idsToMove.length}개의 항목을 '${newFolderName}' 폴더로 이동하시겠습니까?`)) return;

    await fetch('/translations/move', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToMove, folder_name: folderForAPI }) });
    showToast(`${idsToMove.length}개의 항목이 이동되었습니다.`, 'success');
    selectedIds.clear();
    loadAndRenderGrouped();
}

async function renameFolder(oldName, newName) {
    try {
        const response = await fetch(`/api/folders/${encodeURIComponent(oldName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_name: newName })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.detail || `Server error: ${response.status}`);
        }

        showToast(result.message, 'success');
        loadAndRenderGrouped(); // Reload data to show changes
    } catch (error) {
        console.error("Failed to rename folder:", error);
        showToast(`폴더 이름 변경 실패: ${error.message}`, 'error');
    }
}

async function saveAutoStartState() {
    const isChecked = autoStartCheckbox.checked;
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
        autoStartCheckbox.checked = !isChecked; // Revert checkbox state on error
    }
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString().replace(/[&<>"'/]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','/':'&#x2F;'})[s]);
}

function showToast(message, type = 'success', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    // Limit maximum stacked toasts to 5
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

    // Animate in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
    });

    if (duration > 0) {
        setTimeout(dismiss, duration);
    }
}

function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-mode');
    try {
        localStorage.setItem('lanovel_dark_mode', isDark ? 'true' : 'false');
    } catch (_) {}
}

function loadDarkModePreference() {
    try {
        if (localStorage.getItem('lanovel_dark_mode') === 'true') {
            document.body.classList.add('dark-mode');
        }
    } catch (_) {}
}

async function fetchAllTitles() {
    if (!confirm('제목이 없는 모든 항목의 제목을 가져오시겠습니까? 이 작업은 시간이 오래 걸릴 수 있습니다.')) return;
    showToast('백그라운드에서 제목 가져오기를 시작합니다...', 'info');
    try {
        const response = await fetch('/fetch_missing_titles', { method: 'POST' });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const result = await response.json();
        showToast(result.message, 'success');
        setTimeout(() => { showToast('새로고침하여 새 제목을 확인하세요.', 'info'); loadAndRenderGrouped(); }, 5000);
    } catch (error) {
        showToast('제목 가져오기 작업을 시작하지 못했습니다.', 'error');
    }
}

// --- Connection Status ---
function showConnectionStatus(isOnline) {
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

    // Show the toast
    toast.classList.add('show');

    // Hide after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

window.addEventListener('online', () => showConnectionStatus(true));
window.addEventListener('offline', () => showConnectionStatus(false));

/* ==========================================================================
   통계 & 품질 심층 분석 대시보드 컨트롤러 (Stats Analytics Controller)
   ========================================================================== */

let analyticsDataCache = null;
let currentActivityPeriod = '14';
let currentActivityMetric = 'count';
let currentActivityTrendMode = 'daily';

function initStatsAnalyticsModal() {
    const openBtn = document.getElementById('openStatsModalBtn');
    const modal = document.getElementById('statsAnalyticsModal');
    const closeBtn = document.getElementById('closeStatsModalBtn');
    const closeBottomBtn = document.getElementById('closeStatsModalBottomBtn');
    const scopeFilter = document.getElementById('modalNovelFilter');

    if (!openBtn || !modal) return;

    // 모달 열기
    openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        populateStatsScopeFilter();
        const currentSelected = scopeFilter ? scopeFilter.value : '__all__';
        loadAdminAnalytics(currentSelected);
    });

    // 모달 닫기
    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // 작품 스코프 변경 필터
    if (scopeFilter) {
        scopeFilter.addEventListener('change', (e) => {
            loadAdminAnalytics(e.target.value);
        });
    }

    // 탭 전환 이벤트
    const tabButtons = modal.querySelectorAll('.stats-tabs .modal-tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetPaneId = btn.dataset.tab;
            modal.querySelectorAll('.stats-tab-pane').forEach(pane => {
                pane.style.display = (pane.id === targetPaneId) ? 'block' : 'none';
            });
        });
    });

    // 활동 추이 모드 버튼 토글 (일일 번역량, 7일 이동평균, 누적 성장량)
    const trendModeButtons = document.querySelectorAll('#activityTrendModeButtons button');
    trendModeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            trendModeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentActivityTrendMode = btn.dataset.mode;
            if (analyticsDataCache && analyticsDataCache.activity) {
                renderDailyTrendSvg(analyticsDataCache.activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
            }
        });
    });

    // 활동 추이 기간 버튼 토글 (7일, 14일, 30일, 전체)
    const periodButtons = document.querySelectorAll('#activityPeriodButtons button');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            periodButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentActivityPeriod = btn.dataset.period;
            if (analyticsDataCache && analyticsDataCache.activity) {
                renderDailyTrendSvg(analyticsDataCache.activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
            }
        });
    });

    // 활동 추이 지표 버튼 토글 (문단 수 vs 글자 수)
    const metricButtons = document.querySelectorAll('#activityMetricButtons button');
    metricButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            metricButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentActivityMetric = btn.dataset.metric;
            if (analyticsDataCache && analyticsDataCache.activity) {
                renderDailyTrendSvg(analyticsDataCache.activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
            }
        });
    });

    // 작품 심층 분석 패널 닫기 버튼
    const closeDrilldownBtn = document.getElementById('closeNovelDrilldownBtn');
    if (closeDrilldownBtn) {
        closeDrilldownBtn.addEventListener('click', () => {
            const panel = document.getElementById('novelDrilldownPanel');
            if (panel) panel.style.display = 'none';
        });
    }

    // 품질 탭 내 바로가기 카드 연결
    const abnormalBtn = document.getElementById('openAbnormalFromStatsBtn');
    if (abnormalBtn) {
        abnormalBtn.addEventListener('click', () => {
            closeModal();
            const findEmpty = document.getElementById('findEmptyBtn');
            if (findEmpty) findEmpty.click();
        });
    }

    const whitelistBtn = document.getElementById('openWhitelistFromStatsBtn');
    if (whitelistBtn) {
        whitelistBtn.addEventListener('click', () => {
            closeModal();
            const restoreBtn = document.getElementById('openRestoreCenterBtn');
            if (restoreBtn) {
                restoreBtn.click();
                setTimeout(() => {
                    const tab = document.getElementById('tabBtnAbnormalWhitelist');
                    if (tab) tab.click();
                }, 100);
            }
        });
    }

    const trashBtn = document.getElementById('openTrashFromStatsBtn');
    if (trashBtn) {
        trashBtn.addEventListener('click', () => {
            closeModal();
            const restoreBtn = document.getElementById('openRestoreCenterBtn');
            if (restoreBtn) {
                restoreBtn.click();
                setTimeout(() => {
                    const tab = document.getElementById('tabBtnTrash');
                    if (tab) tab.click();
                }, 100);
            }
        });
    }

    // 작품별 랭킹 테이블에서 특정 소설로 즉시 필터 이동 또는 회차별 스파크라인 상세 분석 열기
    const novelTableBody = document.getElementById('novelStatsTableBody');
    if (novelTableBody) {
        novelTableBody.addEventListener('click', (e) => {
            const jumpBtn = e.target.closest('.jump-to-novel-btn');
            if (jumpBtn && jumpBtn.dataset.novel) {
                const targetNovel = jumpBtn.dataset.novel;
                closeModal();
                if (targetNovel === '미분류' || targetNovel === '폴더 추가 대기 상태') {
                    openUnclassifiedDrawer();
                    return;
                }
                const folderFilter = document.getElementById('folderFilterDropdown');
                if (folderFilter) {
                    folderFilter.value = targetNovel;
                    folderFilter.dispatchEvent(new Event('change'));
                }
                return;
            }

            const drillBtn = e.target.closest('.drilldown-novel-btn') || e.target.closest('tr');
            if (drillBtn && drillBtn.dataset.novel) {
                openNovelDrilldown(drillBtn.dataset.novel);
            }
        });
    }
}

function populateStatsScopeFilter() {
    const scopeFilter = document.getElementById('modalNovelFilter');
    if (!scopeFilter) return;

    const curVal = scopeFilter.value;
    scopeFilter.innerHTML = '<option value="__all__">🌐 전체 작품 종합</option>';
    
    // allFolders 기반 옵션 채우기
    if (Array.isArray(allFolders)) {
        allFolders.forEach(folder => {
            const opt = document.createElement('option');
            opt.value = folder.name;
            opt.textContent = `📖 ${folder.name}`;
            scopeFilter.appendChild(opt);
        });
    }
    scopeFilter.value = curVal || '__all__';
}

async function loadAdminAnalytics(folderScope = '__all__') {
    const scopeBadge = document.getElementById('modalStatsCurrentScope');
    if (scopeBadge) {
        scopeBadge.textContent = folderScope === '__all__' ? '전체 통계' : folderScope;
    }

    try {
        const query = (folderScope && folderScope !== '__all__') ? `?folder_name=${encodeURIComponent(folderScope)}` : '';
        const res = await fetch(`/admin/analytics${query}`);
        if (!res.ok) throw new Error(`Analytics API error: ${res.statusText}`);

        const data = await res.json();
        analyticsDataCache = data;

        renderActivityTab(data.activity);
        renderQualityTab(data.quality, data.summary);
        renderNovelsTab(data.novels);
        renderScaleTab(data.scale);
    } catch (err) {
        console.error("통계 분석 로딩 실패:", err);
        showToast("통계 데이터를 불러오지 못했습니다.", "error");
    }
}

// 탭 1: 활동 & 생산성 추이 렌더러
function renderActivityTab(activity) {
    if (!activity) return;

    // KPI 카드 업데이트
    const resetH = activity.quota_reset_hour || 16;
    const resetHStr = resetH > 12 ? `오후 ${resetH - 12}시` : `${resetH}시`;

    const todayEpisodes = document.getElementById('kpiTodayEpisodes');
    if (todayEpisodes) {
        const eps = activity.today_episodes || 0;
        todayEpisodes.innerHTML = `${eps.toLocaleString()}<span class="kpi-unit">화</span>`;
        const todayLabelEl = todayEpisodes.parentElement ? todayEpisodes.parentElement.querySelector('.kpi-label') : null;
        if (todayLabelEl) {
            todayLabelEl.innerHTML = `⚡ 오늘 번역 회차 <span style="font-size: 11px; font-weight: normal; opacity: 0.85;">(${resetHStr} 초기화)</span>`;
        }
    }

    const todaySub = document.getElementById('kpiTodaySub');
    if (todaySub) {
        const chars = (activity.today_kr_chars || 0).toLocaleString();
        const paras = (activity.today_paragraphs || 0).toLocaleString();
        todaySub.textContent = `${chars}자 / ${paras}문단`;
    }

    const dailyAvgCount = document.getElementById('kpiDailyAvgCount');
    if (dailyAvgCount) dailyAvgCount.innerHTML = `${activity.daily_avg_count.toLocaleString()}<span class="kpi-unit">건</span>`;

    const dailyAvgChars = document.getElementById('kpiDailyAvgChars');
    if (dailyAvgChars) dailyAvgChars.textContent = `${activity.daily_avg_chars.toLocaleString()}자 / 일`;

    const peakCount = document.getElementById('kpiPeakCount');
    if (peakCount) peakCount.innerHTML = `${activity.peak_count.toLocaleString()}<span class="kpi-unit">건</span>`;

    const peakDate = document.getElementById('kpiPeakDate');
    if (peakDate) peakDate.textContent = activity.peak_date || '-';

    const streakDays = document.getElementById('kpiStreakDays');
    if (streakDays) streakDays.innerHTML = `${activity.streak_days}<span class="kpi-unit">일 연속</span>`;

    const last7dCount = document.getElementById('kpiLast7dCount');
    if (last7dCount) last7dCount.innerHTML = `${activity.last_7d_count.toLocaleString()}<span class="kpi-unit">건</span>`;

    const last7dChars = document.getElementById('kpiLast7dChars');
    if (last7dChars) last7dChars.textContent = `${activity.last_7d_chars.toLocaleString()}자`;

    // 피크 시간대 배지
    const peakBadge = document.getElementById('peakHourBadge');
    if (peakBadge) {
        peakBadge.textContent = `🔥 피크 시간대: ${activity.peak_hour}시 (${activity.peak_hour_count.toLocaleString()}건, API 주기 기준)`;
    }

    // SVG 차트 렌더링
    renderDailyTrendSvg(activity.daily_trends, currentActivityPeriod, currentActivityMetric, currentActivityTrendMode);
    renderHourlySvg(activity.hourly_distribution, activity.peak_hour);
    renderDowSvg(activity.dow_distribution, activity.peak_dow, activity.weekday_pct, activity.weekend_pct);
}

// 일별 추이 인터랙티브 SVG 차트 렌더링 (일일 번역량 / 7일 이동평균 / 누적 성장량 지원)
function renderDailyTrendSvg(dailyTrends, period, metric, mode = 'daily') {
    const svg = document.getElementById('dailyTrendSvg');
    const tooltip = document.getElementById('dailyTrendChartTooltip');
    if (!svg || !Array.isArray(dailyTrends)) return;

    // 기간 필터링
    let trends = [...dailyTrends];
    if (period !== 'all') {
        const days = parseInt(period, 10);
        trends = trends.slice(-days);
    }

    svg.innerHTML = '';
    const width = 800;
    const height = 240;
    const padLeft = 65;
    const padRight = 24;
    const padTop = 24;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    if (trends.length === 0) {
        svg.innerHTML = `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-muted)">표시할 번역 활동 데이터가 없습니다.</text>`;
        return;
    }

    // 값 산출 함수
    const getVal = (t) => {
        if (mode === 'cumulative') {
            return metric === 'chars' ? (t.cum_chars ?? t.kr_chars) : (t.cum_count ?? t.count);
        } else if (mode === 'ma7') {
            return metric === 'chars' ? (t.ma7_chars ?? t.kr_chars) : (t.ma7_count ?? t.count);
        } else {
            return metric === 'chars' ? t.kr_chars : t.count;
        }
    };

    const values = trends.map(getVal);
    const maxVal = Math.max(...values, 10);

    // 테마 컬러 및 그라디언트 설정
    let themeColor = '#4f46e5'; // indigo (daily)
    if (mode === 'ma7') themeColor = '#8b5cf6'; // violet (ma7)
    else if (mode === 'cumulative') themeColor = '#059669'; // emerald (cumulative)

    // Y축 가이드선 4단계
    for (let i = 0; i <= 3; i++) {
        const yVal = Math.round((maxVal / 3) * i);
        const yPos = padTop + plotH - (plotH * (i / 3));

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', padLeft);
        line.setAttribute('x2', padLeft + plotW);
        line.setAttribute('y1', yPos);
        line.setAttribute('y2', yPos);
        line.setAttribute('stroke', 'var(--border-color, #e2e8f0)');
        line.setAttribute('stroke-dasharray', '3 3');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', padLeft - 10);
        text.setAttribute('y', yPos + 4);
        text.setAttribute('text-anchor', 'end');
        text.setAttribute('fill', 'var(--text-muted, #64748b)');
        text.setAttribute('font-size', '10px');
        text.textContent = yVal.toLocaleString();
        svg.appendChild(text);
    }

    // 포인트 좌표 계산
    const n = trends.length;
    const points = trends.map((t, idx) => {
        const val = getVal(t);
        const x = padLeft + (n > 1 ? (plotW * (idx / (n - 1))) : (plotW / 2));
        const y = padTop + plotH - (plotH * (val / maxVal));
        return { x, y, val, raw: t, date: t.date };
    });

    // 그라디언트 정의
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
        <linearGradient id="trendGradient_${mode}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${themeColor}" stop-opacity="0.32"/>
            <stop offset="100%" stop-color="${themeColor}" stop-opacity="0.0"/>
        </linearGradient>
    `;
    svg.appendChild(defs);

    // Area & Line Path
    if (points.length > 1) {
        let areaD = `M ${points[0].x} ${points[0].y}`;
        points.slice(1).forEach(pt => { areaD += ` L ${pt.x} ${pt.y}`; });
        areaD += ` L ${points[points.length - 1].x} ${padTop + plotH} L ${points[0].x} ${padTop + plotH} Z`;

        const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        areaPath.setAttribute('d', areaD);
        areaPath.setAttribute('fill', `url(#trendGradient_${mode})`);
        svg.appendChild(areaPath);

        let lineD = `M ${points[0].x} ${points[0].y}`;
        points.slice(1).forEach(pt => { lineD += ` L ${pt.x} ${pt.y}`; });

        const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        linePath.setAttribute('d', lineD);
        linePath.setAttribute('fill', 'none');
        linePath.setAttribute('stroke', themeColor);
        linePath.setAttribute('stroke-width', '2.5');
        linePath.setAttribute('stroke-linejoin', 'round');
        linePath.setAttribute('stroke-linecap', 'round');
        svg.appendChild(linePath);
    }

    // 포인트 도트 및 인터랙션
    const stepLabel = Math.max(1, Math.floor(n / 8));
    points.forEach((pt, idx) => {
        // X축 날짜 라벨
        if (idx % stepLabel === 0 || idx === n - 1) {
            const dateText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            dateText.setAttribute('x', pt.x);
            dateText.setAttribute('y', padTop + plotH + 18);
            dateText.setAttribute('text-anchor', 'middle');
            dateText.setAttribute('fill', 'var(--text-muted, #64748b)');
            dateText.setAttribute('font-size', '10px');
            dateText.textContent = pt.date.slice(5); // MM-DD
            svg.appendChild(dateText);
        }

        // 도트 서클
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', pt.x);
        circle.setAttribute('cy', pt.y);
        circle.setAttribute('r', '3.5');
        circle.setAttribute('fill', themeColor);
        circle.setAttribute('stroke', '#ffffff');
        circle.setAttribute('stroke-width', '1.5');
        circle.style.cursor = 'pointer';
        circle.style.transition = 'r 0.15s, fill 0.15s';

        // 툴팁 이벤트
        circle.addEventListener('mouseenter', () => {
            circle.setAttribute('r', '6');
            circle.setAttribute('fill', '#f59e0b');
            if (tooltip) {
                tooltip.style.display = 'block';
                const unit = metric === 'chars' ? '자' : '문단';
                let modeTitle = '일일 번역량';
                let extraInfo = '';
                if (mode === 'ma7') {
                    modeTitle = '7일 이동평균';
                    const dailyVal = metric === 'chars' ? pt.raw.kr_chars : pt.raw.count;
                    extraInfo = `<br/><span style="color: #94a3b8; font-size: 11px;">(당일 실적: ${dailyVal.toLocaleString()}${unit})</span>`;
                } else if (mode === 'cumulative') {
                    modeTitle = '누적 번역량';
                    const dailyVal = metric === 'chars' ? pt.raw.kr_chars : pt.raw.count;
                    extraInfo = `<br/><span style="color: #94a3b8; font-size: 11px;">(당일 증가: +${dailyVal.toLocaleString()}${unit})</span>`;
                }

                tooltip.innerHTML = `<strong>${pt.date}</strong><br/>${modeTitle}: <strong>${pt.val.toLocaleString()}${unit}</strong>${extraInfo}`;
                const rect = svg.getBoundingClientRect();
                const scaleX = rect.width / width;
                const scaleY = rect.height / height;
                tooltip.style.left = `${(pt.x * scaleX)}px`;
                tooltip.style.top = `${(pt.y * scaleY)}px`;
            }
        });

        circle.addEventListener('mouseleave', () => {
            circle.setAttribute('r', '3.5');
            circle.setAttribute('fill', themeColor);
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(circle);
    });
}

// 24시간 시간대별 활동 분포 SVG 차트 렌더링
function renderHourlySvg(hourlyDistribution, peakHour) {
    const svg = document.getElementById('hourlySvg');
    const tooltip = document.getElementById('hourlyChartTooltip');
    if (!svg || !Array.isArray(hourlyDistribution)) return;

    svg.innerHTML = '';
    const width = 800;
    const height = 240;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 34;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const counts = hourlyDistribution.map(h => h.count);
    const maxVal = Math.max(...counts, 10);
    const barW = Math.max(12, (plotW / 24) - 6);

    hourlyDistribution.forEach((h, idx) => {
        const x = padLeft + (idx * (plotW / 24)) + ((plotW / 24 - barW) / 2);
        const barH = plotH * (h.count / maxVal);
        const y = padTop + plotH - barH;
        const isPeak = (h.hour === peakHour);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(barH, 2));
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', isPeak ? '#f59e0b' : '#4f46e5');
        rect.setAttribute('opacity', isPeak ? '1' : '0.8');
        rect.style.cursor = 'pointer';
        rect.style.transition = 'opacity 0.15s, y 0.15s';

        // 툴팁 이벤트
        rect.addEventListener('mouseenter', () => {
            rect.setAttribute('opacity', '1');
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<strong>${h.hour}:00 ~ ${h.hour}:59</strong><br/>번역량: ${h.count.toLocaleString()}문단 (${h.pct}%)${isPeak ? ' 🔥 피크' : ''}`;
                const svgRect = svg.getBoundingClientRect();
                const scaleX = svgRect.width / width;
                const scaleY = svgRect.height / height;
                tooltip.style.left = `${(x + barW/2) * scaleX}px`;
                tooltip.style.top = `${y * scaleY}px`;
            }
        });

        rect.addEventListener('mouseleave', () => {
            rect.setAttribute('opacity', isPeak ? '1' : '0.8');
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(rect);

        // X축 시간 라벨 (3시간 간격)
        if (h.hour % 3 === 0 || h.hour === 23) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', x + barW / 2);
            text.setAttribute('y', padTop + plotH + 18);
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', 'var(--text-muted, #64748b)');
            text.setAttribute('font-size', '10px');
            text.textContent = `${h.hour}시`;
            svg.appendChild(text);
        }
    });
}

// 요일별 활동 분포 SVG 차트 렌더링 (월~일)
function renderDowSvg(dowDistribution, peakDow, weekdayPct, weekendPct) {
    const svg = document.getElementById('dowSvg');
    const tooltip = document.getElementById('dowChartTooltip');
    const peakDowBadge = document.getElementById('peakDowBadge');
    const ratioBadge = document.getElementById('weekdayWeekendRatioBadge');

    if (peakDowBadge && peakDow) {
        peakDowBadge.textContent = `🔥 가장 활발한 요일: ${peakDow}`;
    }
    if (ratioBadge && weekdayPct !== undefined && weekendPct !== undefined) {
        ratioBadge.textContent = `평일 ${weekdayPct}% / 주말 ${weekendPct}%`;
    }

    if (!svg || !Array.isArray(dowDistribution)) return;

    svg.innerHTML = '';
    const width = 800;
    const height = 190;
    const padLeft = 40;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const counts = dowDistribution.map(d => d.count);
    const maxVal = Math.max(...counts, 10);
    const slotW = plotW / 7;
    const barW = Math.min(52, slotW - 20);

    dowDistribution.forEach((d, idx) => {
        const x = padLeft + (idx * slotW) + ((slotW - barW) / 2);
        const barH = plotH * (d.count / maxVal);
        const y = padTop + plotH - barH;
        const isPeak = (d.name === peakDow);
        const isWeekend = (d.dow === 0 || d.dow === 6);

        let barColor = '#4f46e5'; // 平日: indigo
        if (isPeak) barColor = '#f59e0b'; // 피크: gold
        else if (isWeekend) barColor = '#0ea5e9'; // 주말: sky

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(barH, 3));
        rect.setAttribute('rx', '4');
        rect.setAttribute('fill', barColor);
        rect.setAttribute('opacity', isPeak ? '1' : '0.85');
        rect.classList.add('dow-bar');

        rect.addEventListener('mouseenter', () => {
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.innerHTML = `<strong>${d.name}</strong><br/>번역량: <strong>${d.count.toLocaleString()}문단</strong> (${d.pct}%)<br/><span style="font-size: 11px; color: #94a3b8;">${d.chars.toLocaleString()}자</span>${isPeak ? ' 🔥 피크 요일' : ''}`;
                const svgRect = svg.getBoundingClientRect();
                const scaleX = svgRect.width / width;
                const scaleY = svgRect.height / height;
                tooltip.style.left = `${(x + barW/2) * scaleX}px`;
                tooltip.style.top = `${y * scaleY}px`;
            }
        });

        rect.addEventListener('mouseleave', () => {
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(rect);

        // X축 요일 라벨
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + barW / 2);
        text.setAttribute('y', padTop + plotH + 18);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', isWeekend ? '#0ea5e9' : 'var(--text-muted, #64748b)');
        text.setAttribute('font-weight', isWeekend ? '700' : '500');
        text.setAttribute('font-size', '11px');
        text.textContent = d.short_name;
        svg.appendChild(text);
    });
}

// 탭 2: 품질 & 데이터 건강도 렌더러
function renderQualityTab(quality, summary) {
    if (!quality || !summary) return;

    // 종합 건강도 점수 원형 링
    const scoreVal = document.getElementById('healthScoreValue');
    const ringFill = document.getElementById('scoreRingFill');
    const scoreGradePill = document.getElementById('scoreGradePill');
    const score = quality.health_score || 0;

    if (scoreVal) scoreVal.innerHTML = `${score}<span class="score-unit">점</span>`;
    if (ringFill) {
        const circumference = 314.159;
        const offset = circumference * (1 - (score / 100));
        ringFill.style.strokeDashoffset = offset;
        if (score >= 90) ringFill.style.stroke = '#10b981';
        else if (score >= 75) ringFill.style.stroke = '#3b82f6';
        else if (score >= 60) ringFill.style.stroke = '#f59e0b';
        else ringFill.style.stroke = '#ef4444';
    }

    if (scoreGradePill) {
        if (score >= 95) {
            scoreGradePill.textContent = 'GRADE S+';
            scoreGradePill.className = 'score-grade-pill grade-s';
        } else if (score >= 88) {
            scoreGradePill.textContent = 'GRADE A';
            scoreGradePill.className = 'score-grade-pill grade-a';
        } else if (score >= 75) {
            scoreGradePill.textContent = 'GRADE B';
            scoreGradePill.className = 'score-grade-pill grade-b';
        } else {
            scoreGradePill.textContent = 'ATTENTION';
            scoreGradePill.className = 'score-grade-pill grade-c';
        }
    }

    // 메트릭 리스트
    const metricNormal = document.getElementById('metricNormalRate');
    if (metricNormal) metricNormal.textContent = `${quality.normal_rate}%`;

    const metricEmpty = document.getElementById('metricEmptyCount');
    if (metricEmpty) metricEmpty.textContent = `${quality.empty_count.toLocaleString()}건 (${quality.empty_rate}%)`;

    const metricAbnormal = document.getElementById('metricAbnormalRate');
    if (metricAbnormal) metricAbnormal.textContent = `${quality.abnormal_rate}%`;

    const metricApplied = document.getElementById('metricAppliedRate');
    if (metricApplied) metricApplied.textContent = `${quality.applied_rate}%`;

    // 원문 대비 번역문 확장률
    const expNum = document.getElementById('expansionRatioNumber');
    if (expNum) expNum.innerHTML = `${summary.expansion_ratio}<span class="ratio-unit">x</span>`;

    const marker = document.getElementById('expansionMarker');
    if (marker) {
        // 0.5x ~ 1.8x 스케일 매핑
        const ratio = summary.expansion_ratio || 1.1;
        const pct = Math.max(0, Math.min(100, ((ratio - 0.5) / 1.3) * 100));
        marker.style.left = `${pct}%`;
    }

    const expOrig = document.getElementById('expansionOrigChars');
    if (expOrig) expOrig.textContent = summary.total_jp_chars.toLocaleString();

    const expTrans = document.getElementById('expansionTransChars');
    if (expTrans) expTrans.textContent = summary.total_kr_chars.toLocaleString();

    // 문단 길이 5구간 분포 리스트
    const lenList = document.getElementById('lengthDistributionList');
    if (lenList && Array.isArray(quality.length_distribution)) {
        lenList.innerHTML = quality.length_distribution.map((d, idx) => `
            <div class="length-dist-item phase-${idx + 1}">
                <div class="length-dist-header">
                    <div class="length-dist-title-group">
                        <span class="length-dist-badge">SEC 0${idx + 1}</span>
                        <span class="length-dist-label">${escapeHtml(d.label)}</span>
                        <span class="length-dist-desc">(${escapeHtml(d.desc)})</span>
                    </div>
                    <span class="length-dist-count">${d.count.toLocaleString()}건 <span class="dist-pct-tag">${d.pct}%</span></span>
                </div>
                <div class="length-dist-track">
                    <div class="length-dist-fill" style="width: ${d.pct}%;"></div>
                </div>
            </div>
        `).join('');
    }

    // 품질 위생 지표 카드
    const statAbnormal = document.getElementById('statAbnormalTotalCount');
    if (statAbnormal) statAbnormal.textContent = `${quality.abnormal_total_count.toLocaleString()}건`;

    const statWhitelist = document.getElementById('statWhitelistCount');
    if (statWhitelist) statWhitelist.textContent = `${quality.whitelist_count.toLocaleString()}건`;

    const statTrash = document.getElementById('statTrashTotalCount');
    if (statTrash) statTrash.textContent = `${quality.trash_total_count.toLocaleString()}건`;

    const statPending = document.getElementById('statPendingFolderCount');
    if (statPending) statPending.textContent = `${quality.pending_folder_count.toLocaleString()}건`;
}

// 탭 3: 작품별 심층 랭킹 렌더러
function renderNovelsTab(novels) {
    const tbody = document.getElementById('novelStatsTableBody');
    const badge = document.getElementById('novelTotalCountBadge');
    if (!tbody || !Array.isArray(novels)) return;

    if (badge) badge.textContent = `총 ${novels.length}개 작품`;

    if (novels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">작품 데이터가 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = novels.map(n => {
        let rankBadgeClass = 'novel-rank-badge';
        if (n.rank === 1) rankBadgeClass += ' novel-rank-1';
        else if (n.rank === 2) rankBadgeClass += ' novel-rank-2';
        else if (n.rank === 3) rankBadgeClass += ' novel-rank-3';

        return `
            <tr class="novel-stat-row" data-novel="${escapeHtml(n.name)}" style="cursor: pointer;" title="클릭하여 회차별 세부 분량 스파크라인 확인">
                <td style="text-align: center;"><span class="${rankBadgeClass}">${n.rank}</span></td>
                <td><strong>${escapeHtml(n.name)}</strong></td>
                <td style="text-align: right;">${n.episode_count.toLocaleString()}화</td>
                <td style="text-align: right;">${n.paragraph_count.toLocaleString()}문단</td>
                <td style="text-align: right;">${n.total_chars.toLocaleString()}자</td>
                <td style="text-align: right;">${n.avg_paragraphs_per_ep}</td>
                <td>
                    <div class="share-bar-container">
                        <div class="share-bar-track">
                            <div class="share-bar-fill" style="width: ${n.share_pct}%;"></div>
                        </div>
                        <span class="share-bar-pct">${n.share_pct}%</span>
                    </div>
                </td>
                <td style="text-align: center;" onclick="event.stopPropagation();">
                    <div style="display: inline-flex; gap: 4px;">
                        <button type="button" class="btn btn-sm btn-outline drilldown-novel-btn" data-novel="${escapeHtml(n.name)}" title="회차별 분량 스파크라인 분석">
                            <span class="material-icons" style="font-size: 14px;">analytics</span>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline jump-to-novel-btn" data-novel="${escapeHtml(n.name)}" title="해당 소설 필터로 이동">
                            <span class="material-icons" style="font-size: 14px;">filter_alt</span>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 작품 심층 분석 및 회차별 스파크라인 열기
async function openNovelDrilldown(folderName) {
    if (!folderName) return;
    const panel = document.getElementById('novelDrilldownPanel');
    const titleEl = document.getElementById('drilldownNovelTitle');
    if (!panel) return;

    if (titleEl) titleEl.textContent = `📖 ${folderName} 회차별 세부 분량 분석`;
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const res = await fetch(`/admin/analytics/novel?folder_name=${encodeURIComponent(folderName)}`);
        if (!res.ok) throw new Error('작품 상세 분석 데이터를 가져오지 못했습니다.');
        const data = await res.json();

        const totalEpsEl = document.getElementById('drilldownTotalEps');
        if (totalEpsEl) totalEpsEl.textContent = data.total_episodes.toLocaleString();

        const appliedRateEl = document.getElementById('drilldownAppliedRate');
        if (appliedRateEl) appliedRateEl.textContent = `${data.applied_pct}%`;

        const appliedEpsEl = document.getElementById('drilldownAppliedEps');
        if (appliedEpsEl) appliedEpsEl.textContent = data.applied_episodes.toLocaleString();

        const avgCharsEl = document.getElementById('drilldownAvgChars');
        if (avgCharsEl) avgCharsEl.textContent = data.avg_chars_per_ep.toLocaleString();

        const maxEpEl = document.getElementById('drilldownMaxEp');
        if (maxEpEl) {
            maxEpEl.textContent = data.max_episode ? `${data.max_episode.title} (${data.max_episode.char_count.toLocaleString()}자)` : '-';
        }

        const minEpEl = document.getElementById('drilldownMinEp');
        if (minEpEl) {
            minEpEl.textContent = data.min_episode ? `${data.min_episode.title} (${data.min_episode.char_count.toLocaleString()}자)` : '-';
        }

        renderNovelSparkline(data.episodes, data.avg_chars_per_ep);
    } catch (err) {
        console.error("작품 스파크라인 로딩 실패:", err);
        showToast("작품 회차 데이터를 불러오지 못했습니다.", "error");
    }
}

// 회차별 분량 인터랙티브 스파크라인 SVG 차트 렌더링
function renderNovelSparkline(episodes, avgChars) {
    const svg = document.getElementById('novelEpisodeSparklineSvg');
    const tooltip = document.getElementById('novelSparklineTooltip');
    if (!svg || !Array.isArray(episodes)) return;

    svg.innerHTML = '';
    const width = 800;
    const height = 190;
    const padLeft = 50;
    const padRight = 20;
    const padTop = 20;
    const padBottom = 30;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    if (episodes.length === 0) {
        svg.innerHTML = `<text x="${width/2}" y="${height/2}" text-anchor="middle" fill="var(--text-muted)">회차 분량 데이터가 없습니다.</text>`;
        return;
    }

    const charCounts = episodes.map(e => e.char_count);
    const maxVal = Math.max(...charCounts, avgChars, 100);

    // 평균 기준선 (Red Dashed Line)
    if (avgChars > 0) {
        const avgY = padTop + plotH - (plotH * (avgChars / maxVal));
        const avgLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        avgLine.setAttribute('x1', padLeft);
        avgLine.setAttribute('x2', padLeft + plotW);
        avgLine.setAttribute('y1', avgY);
        avgLine.setAttribute('y2', avgY);
        avgLine.setAttribute('stroke', '#ef4444');
        avgLine.setAttribute('stroke-dasharray', '4 4');
        avgLine.setAttribute('stroke-width', '1.5');
        svg.appendChild(avgLine);

        const avgText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        avgText.setAttribute('x', padLeft + plotW);
        avgText.setAttribute('y', avgY - 4);
        avgText.setAttribute('text-anchor', 'end');
        avgText.setAttribute('fill', '#ef4444');
        avgText.setAttribute('font-size', '10px');
        avgText.setAttribute('font-weight', '600');
        avgText.textContent = `화당 평균: ${avgChars.toLocaleString()}자`;
        svg.appendChild(avgText);
    }

    const n = episodes.length;
    const slotW = plotW / n;
    const barW = Math.max(3, Math.min(16, slotW - 2));

    episodes.forEach((ep, idx) => {
        const x = padLeft + (idx * slotW) + ((slotW - barW) / 2);
        const barH = plotH * (ep.char_count / maxVal);
        const y = padTop + plotH - barH;

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(barH, 2));
        rect.setAttribute('rx', '2');
        rect.setAttribute('fill', ep.is_applied ? '#10b981' : '#4f46e5');
        rect.setAttribute('opacity', ep.is_applied ? '0.9' : '0.7');
        rect.style.cursor = 'pointer';
        rect.style.transition = 'opacity 0.15s, fill 0.15s';

        rect.addEventListener('mouseenter', () => {
            rect.setAttribute('opacity', '1');
            rect.setAttribute('fill', '#f59e0b');
            if (tooltip) {
                tooltip.style.display = 'block';
                const statusTag = ep.is_applied ? '✅ 웹페이지 적용 완료' : '⏳ 미적용 상태';
                tooltip.innerHTML = `<strong>#${ep.index} ${escapeHtml(ep.title)}</strong><br/>글자 수: <strong>${ep.char_count.toLocaleString()}자</strong> (${ep.paragraph_count}문단)<br/><span style="font-size: 11px;">${statusTag}</span>`;
                const svgRect = svg.getBoundingClientRect();
                const scaleX = svgRect.width / width;
                const scaleY = svgRect.height / height;
                tooltip.style.left = `${(x + barW/2) * scaleX}px`;
                tooltip.style.top = `${y * scaleY}px`;
            }
        });

        rect.addEventListener('mouseleave', () => {
            rect.setAttribute('opacity', ep.is_applied ? '0.9' : '0.7');
            rect.setAttribute('fill', ep.is_applied ? '#10b981' : '#4f46e5');
            if (tooltip) tooltip.style.display = 'none';
        });

        svg.appendChild(rect);
    });

    // 1화 라벨 & 최신화 라벨
    if (n > 0) {
        const firstLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        firstLabel.setAttribute('x', padLeft);
        firstLabel.setAttribute('y', padTop + plotH + 18);
        firstLabel.setAttribute('fill', 'var(--text-muted, #64748b)');
        firstLabel.setAttribute('font-size', '10px');
        firstLabel.textContent = `1화 (${episodes[0].char_count.toLocaleString()}자)`;
        svg.appendChild(firstLabel);

        const lastLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        lastLabel.setAttribute('x', padLeft + plotW);
        lastLabel.setAttribute('y', padTop + plotH + 18);
        lastLabel.setAttribute('text-anchor', 'end');
        lastLabel.setAttribute('fill', 'var(--text-muted, #64748b)');
        lastLabel.setAttribute('font-size', '10px');
        lastLabel.textContent = `${n}화 (${episodes[n - 1].char_count.toLocaleString()}자)`;
        svg.appendChild(lastLabel);
    }
}

// 탭 4: 번역 규모 & 독서 환산 렌더러
function renderScaleTab(scale) {
    if (!scale) return;

    const scaleBig = document.getElementById('scaleKrCharsBig');
    if (scaleBig) scaleBig.innerHTML = `${scale.kr_chars.toLocaleString()}<span class="kpi-unit">자</span>`;

    const scaleSub = document.getElementById('scaleJpCharsSub');
    if (scaleSub) scaleSub.textContent = `원문 ${scale.jp_chars.toLocaleString()}자 대비 1.16배`;

    const scaleBooks = document.getElementById('scaleBooksCount');
    if (scaleBooks) scaleBooks.innerHTML = `${scale.books_count}<span class="kpi-unit">권</span>`;

    const scaleManuscript = document.getElementById('scaleManuscriptCount');
    if (scaleManuscript) scaleManuscript.innerHTML = `${scale.manuscript_count.toLocaleString()}<span class="kpi-unit">매</span>`;

    const scaleHours = document.getElementById('scaleReadingHours');
    if (scaleHours) scaleHours.innerHTML = `${scale.reading_hours}<span class="kpi-unit">시간</span>`;

    const scaleDays = document.getElementById('scaleReadingDays');
    if (scaleDays) scaleDays.textContent = `약 ${scale.reading_days}일 연속 완독`;

    const paceFast = document.getElementById('paceFastHours');
    if (paceFast) paceFast.textContent = `${scale.pace_fast_hours}시간`;

    const paceStd = document.getElementById('paceStandardHours');
    if (paceStd) paceStd.textContent = `${scale.pace_standard_hours}시간`;

    const paceSlow = document.getElementById('paceSlowHours');
    if (paceSlow) paceSlow.textContent = `${scale.pace_slow_hours}시간`;

    const avgChars = document.getElementById('avgCharsPerChapter');
    if (avgChars) avgChars.textContent = `${scale.avg_chars_per_chapter.toLocaleString()}자 / 화`;

    const avgParas = document.getElementById('avgParagraphsPerChapter');
    if (avgParas) avgParas.textContent = `${scale.avg_paragraphs_per_chapter}단락 / 화`;

    const fitBadge = document.getElementById('novelFitBadge');
    if (fitBadge) fitBadge.textContent = scale.novel_fit_badge;
}

/* ==========================================================================
   앱 릴리즈 관리 컨트롤러 (App Release Controller)
   ========================================================================== */

let selectedApkFile = null;

function initAppReleaseModal() {
    const openBtn = document.getElementById('openAppReleaseModalBtn');
    const modal = document.getElementById('appReleaseModal');
    const closeBtn = document.getElementById('closeAppReleaseModalBtn');
    const closeBottomBtn = document.getElementById('closeAppReleaseModalBottomBtn');
    const saveNotesBtn = document.getElementById('saveAppReleaseNotesBtn');
    const bumpVersionBtn = document.getElementById('bumpAppVersionBtn');
    const dropzone = document.getElementById('apkDropzone');
    const dropzoneInner = document.getElementById('apkDropzoneInner');
    const fileInput = document.getElementById('apkFileInput');
    const uploadBtn = document.getElementById('uploadApkBtn');

    if (!openBtn || !modal) return;

    // 모달 열기
    openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        fetchAppReleaseInfo();
    });

    // 모달 닫기
    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // 릴리즈 노트 저장
    if (saveNotesBtn) {
        saveNotesBtn.addEventListener('click', async () => {
            const notesInput = document.getElementById('appReleaseNotesInput');
            const notes = notesInput ? notesInput.value.trim() : '';
            saveNotesBtn.disabled = true;
            saveNotesBtn.textContent = '저장 중...';

            try {
                const res = await fetch('/api/app/release_notes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ release_notes: notes })
                });
                if (!res.ok) throw new Error(`릴리즈 노트 저장 실패: ${res.statusText}`);
                showToast('릴리즈 노트가 성공적으로 저장되었습니다.', 'success');
            } catch (err) {
                console.error(err);
                showToast('릴리즈 노트 저장 중 오류가 발생했습니다.', 'error');
            } finally {
                saveNotesBtn.disabled = false;
                saveNotesBtn.textContent = '릴리즈 노트 저장';
            }
        });
    }

    // 버전 및 빌드번호 범프
    if (bumpVersionBtn) {
        bumpVersionBtn.addEventListener('click', async () => {
            const verInput = document.getElementById('appVersionInput');
            const buildInput = document.getElementById('appBuildInput');
            const newVer = verInput ? verInput.value.trim() : null;
            const newBuild = buildInput ? (parseInt(buildInput.value.trim(), 10) + 1) : null;

            bumpVersionBtn.disabled = true;
            bumpVersionBtn.innerHTML = '<span class="material-icons" style="font-size: 15px;">hourglass_top</span> 처리 중...';

            try {
                const res = await fetch('/api/app/bump_version', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ version: newVer, build_number: newBuild })
                });
                if (!res.ok) throw new Error(`버전 갱신 실패: ${res.statusText}`);
                const data = await res.json();
                showToast(`버전이 v${data.version} (Build #${data.build_number})로 갱신되었습니다.`, 'success');
                fetchAppReleaseInfo();
            } catch (err) {
                console.error(err);
                showToast('버전 갱신 중 오류가 발생했습니다.', 'error');
            } finally {
                bumpVersionBtn.disabled = false;
                bumpVersionBtn.innerHTML = '<span class="material-icons" style="font-size: 15px;">trending_up</span> +1 빌드 올리기';
            }
        });
    }

    // APK 파일 선택 및 드래그 앤 드롭
    if (dropzoneInner && fileInput) {
        dropzoneInner.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleSelectedApkFile(e.target.files[0]);
            }
        });
    }

    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('dragover');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSelectedApkFile(e.dataTransfer.files[0]);
            }
        });
    }

    // 새 APK 업로드 시작
    if (uploadBtn) {
        uploadBtn.addEventListener('click', async () => {
            if (!selectedApkFile) return;

            uploadBtn.disabled = true;
            const statusText = document.getElementById('apkUploadStatusText');
            const progressWrap = document.getElementById('apkUploadProgressBarWrap');
            const progressBar = document.getElementById('apkUploadProgressBar');

            if (statusText) statusText.textContent = '업로드 스트리밍 전송 중...';
            if (progressWrap) progressWrap.style.display = 'block';
            if (progressBar) progressBar.style.width = '60%';

            try {
                const res = await fetch('/api/app/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: selectedApkFile
                });

                if (!res.ok) {
                    const errJson = await res.json().catch(() => ({}));
                    throw new Error(errJson.detail || `업로드 실패: ${res.statusText}`);
                }

                if (progressBar) progressBar.style.width = '100%';
                if (statusText) statusText.textContent = '업로드 완료 및 배포 적용 성공!';
                showToast('APK 바이너리가 성공적으로 업로드 및 배포되었습니다!', 'success');
                selectedApkFile = null;
                setTimeout(() => {
                    if (progressWrap) progressWrap.style.display = 'none';
                    if (progressBar) progressBar.style.width = '0%';
                    fetchAppReleaseInfo();
                }, 1000);
            } catch (err) {
                console.error(err);
                if (statusText) statusText.textContent = `업로드 실패: ${err.message}`;
                showToast(`업로드 실패: ${err.message}`, 'error');
            } finally {
                uploadBtn.disabled = true;
            }
        });
    }
}

function handleSelectedApkFile(file) {
    if (!file.name.toLowerCase().endsWith('.apk')) {
        showToast('.apk 파일만 업로드할 수 있습니다.', 'error');
        return;
    }

    selectedApkFile = file;
    const fileInfo = document.getElementById('selectedApkFileInfo');
    const uploadBtn = document.getElementById('uploadApkBtn');
    const statusText = document.getElementById('apkUploadStatusText');

    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    if (fileInfo) {
        fileInfo.textContent = `선택됨: ${file.name} (${sizeMb} MB)`;
    }
    if (statusText) {
        statusText.textContent = `업로드 준비 완료 (${sizeMb} MB)`;
    }
    if (uploadBtn) {
        uploadBtn.disabled = false;
    }
}

async function fetchAppReleaseInfo() {
    try {
        const res = await fetch('/api/app/version');
        if (!res.ok) throw new Error('앱 버전 정보를 가져오지 못했습니다.');

        const data = await res.json();

        const verBadge = document.getElementById('appCurrentVersionBadge');
        if (verBadge) verBadge.textContent = `v${data.version}`;

        const buildBadge = document.getElementById('appCurrentBuildBadge');
        if (buildBadge) buildBadge.textContent = `Build #${data.build_number}`;

        const statusBadge = document.getElementById('appApkStatusBadge');
        if (statusBadge) {
            if (data.has_apk) {
                statusBadge.textContent = 'APK 배포 완료';
                statusBadge.classList.remove('not-found');
            } else {
                statusBadge.textContent = 'APK 미등록 (빌드 필요)';
                statusBadge.classList.add('not-found');
            }
        }

        const fileNameEl = document.getElementById('appReleaseFileName');
        if (fileNameEl) fileNameEl.textContent = data.file_name;

        const fileSizeEl = document.getElementById('appReleaseFileSize');
        if (fileSizeEl) {
            const mb = (data.file_size / (1024 * 1024)).toFixed(1);
            fileSizeEl.textContent = `${mb} MB (${data.file_size.toLocaleString()} bytes)`;
        }

        const updatedAtEl = document.getElementById('appReleaseUpdatedAt');
        if (updatedAtEl) {
            if (data.updated_at) {
                const date = new Date(data.updated_at * 1000);
                updatedAtEl.textContent = date.toLocaleString();
            } else {
                updatedAtEl.textContent = '-';
            }
        }

        const verInput = document.getElementById('appVersionInput');
        if (verInput) verInput.value = data.base_version || '1.0.0';

        const buildInput = document.getElementById('appBuildInput');
        if (buildInput) buildInput.value = data.build_number || 1;

        const notesInput = document.getElementById('appReleaseNotesInput');
        if (notesInput) notesInput.value = data.release_notes || '';

    } catch (err) {
        console.error("앱 릴리즈 정보 조회 오류:", err);
    }
}

// =========================================================================
// Unclassified Novels Drawer & Floating Toggle Handle (content.js style)
// =========================================================================

let unclassifiedData = null;
let currentSelectedUnclassifiedNovel = null;

function initUnclassifiedDrawer() {
    const toggleBar = document.getElementById('unclassifiedToggleBar');
    const closeBtn = document.getElementById('closeUnclassifiedDrawerBtn');
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const refreshBtn = document.getElementById('refreshUnclassifiedBtn');
    const searchInput = document.getElementById('unclassifiedNovelSearchInput');
    const epListContainer = document.getElementById('unclassifiedEpisodeListContainer');

    if (toggleBar) toggleBar.addEventListener('click', openUnclassifiedDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeUnclassifiedDrawer);
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target.id === 'unclassifiedDrawerOverlay') {
                closeUnclassifiedDrawer();
            }
        });
    }
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await checkAndLoadUnclassifiedNovels();
            showToast('미분류 소설 목록을 새로고침했습니다.', 'info');
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderUnclassifiedNovelList();
        });
    }

    // Attach delegated handlers to episode list container for full paragraph table interactivity
    if (epListContainer) {
        epListContainer.addEventListener('click', handleHistoryClick);
        epListContainer.addEventListener('change', handleCheckboxChange);
        epListContainer.addEventListener('focusin', (e) => {
            if (e.target.classList.contains('translated-text')) {
                handleTranslatedFocus(e.target);
            }
        });
    }

    // Toolbar Action Listeners
    const smartMergeBtn = document.getElementById('smartMergeBtn');
    if (smartMergeBtn) {
        smartMergeBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel || !currentSelectedUnclassifiedNovel.matched_existing_folder) return;
            const novel = currentSelectedUnclassifiedNovel;
            const target = novel.matched_existing_folder;
            if (!confirm(`'${novel.novel_title}'의 모든 회차(${novel.total_episodes}개, ${novel.total_paragraphs.toLocaleString()}개 단락)를 기존 폴더 '${target}'(으)로 일괄 합치시겠습니까?`)) {
                return;
            }
            await executeAssignFolder(novel.work_id, target, novel.work_url);
        });
    }

    const assignNewFolderBtn = document.getElementById('assignNewFolderBtn');
    if (assignNewFolderBtn) {
        assignNewFolderBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const input = document.getElementById('assignNewFolderNameInput');
            const folderName = input ? input.value.trim() : '';
            if (!folderName) {
                showToast('등록할 새 폴더명을 입력해주세요.', 'warning');
                return;
            }
            const novel = currentSelectedUnclassifiedNovel;
            if (!confirm(`'${novel.novel_title}'의 모든 회차를 새 폴더 '${folderName}'(으)로 일괄 등록하시겠습니까?`)) {
                return;
            }
            await executeAssignFolder(novel.work_id, folderName, novel.work_url);
        });
    }

    const assignExistingFolderBtn = document.getElementById('assignExistingFolderBtn');
    if (assignExistingFolderBtn) {
        assignExistingFolderBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const select = document.getElementById('assignExistingFolderDropdown');
            const folderName = select ? select.value : '';
            if (!folderName) {
                showToast('이동할 기존 폴더를 선택해주세요.', 'warning');
                return;
            }
            const novel = currentSelectedUnclassifiedNovel;
            if (!confirm(`'${novel.novel_title}'의 모든 회차를 기존 폴더 '${folderName}'(으)로 이동하시겠습니까?`)) {
                return;
            }
            await executeAssignFolder(novel.work_id, folderName, novel.work_url);
        });
    }

    const deleteNovelBtn = document.getElementById('deleteUnclassifiedNovelBtn');
    if (deleteNovelBtn) {
        deleteNovelBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const novel = currentSelectedUnclassifiedNovel;
            if (!confirm(`정말로 '${novel.novel_title}'의 모든 미분류 번역(${novel.total_paragraphs.toLocaleString()}개 단락)을 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
                return;
            }
            try {
                const res = await fetch('/api/unclassified_novels/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ work_id: novel.work_id, work_url: novel.work_url })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || '삭제 실패');
                }
                const data = await res.json();
                showToast(data.message || '소설이 성공적으로 삭제되었습니다.', 'success');
                currentSelectedUnclassifiedNovel = null;
                await checkAndLoadUnclassifiedNovels();
                await loadAndRenderGrouped();
            } catch (e) {
                console.error('delete unclassified novel error:', e);
                showToast(`삭제 오류: ${e.message}`, 'error');
            }
        });
    }

    const editTitleBtn = document.getElementById('editNovelTitleBtn');
    if (editTitleBtn) {
        editTitleBtn.addEventListener('click', async () => {
            if (!currentSelectedUnclassifiedNovel) return;
            const novel = currentSelectedUnclassifiedNovel;
            const newTitle = prompt('수정할 소설 원제(제목)를 입력하세요:', novel.novel_title);
            if (!newTitle || !newTitle.trim() || newTitle.trim() === novel.novel_title) return;
            
            try {
                const res = await fetch('/api/unclassified_novels/rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ work_id: novel.work_id, new_title: newTitle.trim() })
                });
                if (!res.ok) throw new Error('제목 수정 실패');
                showToast('소설 제목이 수정되었습니다.', 'success');
                novel.novel_title = newTitle.trim();
                document.getElementById('detailNovelTitle').textContent = novel.novel_title;
                const newFolderInput = document.getElementById('assignNewFolderNameInput');
                if (newFolderInput) newFolderInput.value = novel.novel_title;
                renderUnclassifiedNovelList();
            } catch (e) {
                showToast(`수정 오류: ${e.message}`, 'error');
            }
        });
    }
}

async function checkAndLoadUnclassifiedNovels() {
    try {
        const res = await fetch(`/api/unclassified_novels?t=${Date.now()}`);
        if (!res.ok) return;
        unclassifiedData = await res.json();

        // 미분류 데이터 변동 시 상단 오늘 번역 실적 및 쿼터 현황도 최신화
        try {
            const summaryRes = await fetch(`/api/notifications/summary?t=${Date.now()}`);
            if (summaryRes.ok) {
                latestQuotaSummary = await summaryRes.json();
                updateStatistics(groupedTranslations);
            }
        } catch (e) {
            // silent
        }
        
        const toggleBar = document.getElementById('unclassifiedToggleBar');
        const badge = document.getElementById('unclassifiedToggleBadge');
        const headerBadge = document.getElementById('unclassifiedHeaderStatsBadge');
        
        const totalParas = unclassifiedData.total_unclassified_paragraphs || 0;
        const totalNovels = unclassifiedData.total_unclassified_novels || 0;
        
        // 미분류 데이터가 존재할 때만 우측에 플로팅 토글바 표시
        if (totalParas > 0) {
            if (toggleBar) toggleBar.style.display = 'flex';
            if (badge) badge.textContent = totalParas.toLocaleString();
            if (headerBadge) headerBadge.textContent = `${totalNovels}개 작품 / ${totalParas.toLocaleString()}개 문장`;
        } else {
            if (toggleBar) toggleBar.style.display = 'none';
            if (headerBadge) headerBadge.textContent = `0개 작품 / 0개 문장`;
            closeUnclassifiedDrawer();
        }

        // 드로어가 열려있는 상태라면 목록 갱신
        const overlay = document.getElementById('unclassifiedDrawerOverlay');
        if (overlay && overlay.classList.contains('active')) {
            renderUnclassifiedNovelList();
            if (currentSelectedUnclassifiedNovel) {
                const refreshed = (unclassifiedData.novels || []).find(n => n.work_id === currentSelectedUnclassifiedNovel.work_id);
                if (refreshed) {
                    selectUnclassifiedNovel(refreshed);
                } else {
                    currentSelectedUnclassifiedNovel = null;
                    const content = document.getElementById('unclassifiedDetailContent');
                    const emptyNotice = document.getElementById('unclassifiedDetailEmptyNotice');
                    if (content) content.style.display = 'none';
                    if (emptyNotice) emptyNotice.style.display = 'block';
                }
            }
        }
    } catch (e) {
        console.warn("[UnclassifiedNovels] Failed to check unclassified novels:", e);
    }
}

function openUnclassifiedDrawer() {
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const panel = document.getElementById('unclassifiedDrawerPanel');
    if (overlay && panel) {
        overlay.style.display = 'block';
        void overlay.offsetWidth; // Force layout
        overlay.classList.add('active');
        panel.classList.add('active');
        renderUnclassifiedNovelList();
    }
}

function closeUnclassifiedDrawer() {
    const overlay = document.getElementById('unclassifiedDrawerOverlay');
    const panel = document.getElementById('unclassifiedDrawerPanel');
    if (overlay && panel) {
        overlay.classList.remove('active');
        panel.classList.remove('active');
        setTimeout(() => {
            if (!overlay.classList.contains('active')) {
                overlay.style.display = 'none';
            }
        }, 350);
    }
}

function renderUnclassifiedNovelList() {
    const container = document.getElementById('unclassifiedNovelListContainer');
    if (!container) return;
    container.innerHTML = '';
    
    const searchVal = (document.getElementById('unclassifiedNovelSearchInput')?.value || '').trim().toLowerCase();
    const novels = (unclassifiedData?.novels || []).filter(n => {
        if (!searchVal) return true;
        return (n.novel_title && n.novel_title.toLowerCase().includes(searchVal)) ||
               (n.platform && n.platform.toLowerCase().includes(searchVal)) ||
               (n.work_url && n.work_url.toLowerCase().includes(searchVal));
    });

    if (novels.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; color: var(--text-muted); padding: 30px 10px; font-size: 13px;">
                ${searchVal ? '검색된 소설이 없습니다.' : '미분류 소설이 없습니다.'}
            </div>
        `;
        return;
    }

    novels.forEach(novel => {
        const card = document.createElement('div');
        card.className = 'unclassified-novel-card';
        if (currentSelectedUnclassifiedNovel && currentSelectedUnclassifiedNovel.work_id === novel.work_id) {
            card.classList.add('active');
        }
        
        let platformClass = 'other';
        const pLower = (novel.platform || '').toLowerCase();
        if (pLower.includes('kakuyomu')) platformClass = 'kakuyomu';
        else if (pLower.includes('syosetu')) platformClass = 'syosetu';
        else if (pLower.includes('novelup')) platformClass = 'novelup';

        const smartBadgeHtml = novel.matched_existing_folder ? `
            <span class="card-smart-badge" title="기존 등록 폴더 '${escapeHtml(novel.matched_existing_folder)}'와 일치">
                <span class="material-icons" style="font-size: 13px;">auto_awesome</span>
                ${escapeHtml(novel.matched_existing_folder)}
            </span>
        ` : '';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="card-platform-badge ${platformClass}">${escapeHtml(novel.platform)}</span>
                ${smartBadgeHtml}
            </div>
            <div class="card-title" title="${escapeHtml(novel.novel_title)}">${escapeHtml(novel.novel_title)}</div>
            <div class="card-meta">
                <span><strong style="color: var(--primary-color);">${novel.total_episodes}</strong>개 회차</span>
                <span><strong>${novel.total_paragraphs.toLocaleString()}</strong>단락</span>
            </div>
        `;

        card.addEventListener('click', () => {
            container.querySelectorAll('.unclassified-novel-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectUnclassifiedNovel(novel);
        });

        container.appendChild(card);
    });

    // 자동 선택: 아직 선택된 소설이 없으면 첫 번째 소설 선택
    if (!currentSelectedUnclassifiedNovel && novels.length > 0) {
        selectUnclassifiedNovel(novels[0]);
        const firstCard = container.querySelector('.unclassified-novel-card');
        if (firstCard) firstCard.classList.add('active');
    }
}

function selectUnclassifiedNovel(novel) {
    currentSelectedUnclassifiedNovel = novel;
    const emptyNotice = document.getElementById('unclassifiedDetailEmptyNotice');
    const content = document.getElementById('unclassifiedDetailContent');
    if (!emptyNotice || !content) return;

    emptyNotice.style.display = 'none';
    content.style.display = 'block';

    // 1. 헤더 정보 바인딩
    document.getElementById('detailNovelTitle').textContent = novel.novel_title;
    const badgeEl = document.getElementById('detailPlatformBadge');
    badgeEl.textContent = novel.platform;
    let platformClass = 'other';
    const pLower = (novel.platform || '').toLowerCase();
    if (pLower.includes('kakuyomu')) platformClass = 'kakuyomu';
    else if (pLower.includes('syosetu')) platformClass = 'syosetu';
    else if (pLower.includes('novelup')) platformClass = 'novelup';
    badgeEl.className = `card-platform-badge ${platformClass}`;

    const workLink = document.getElementById('detailWorkLink');
    if (workLink) workLink.href = novel.work_url || '#';

    document.getElementById('detailNovelStats').textContent = 
        `총 ${novel.total_episodes}개 회차 · ${novel.total_paragraphs.toLocaleString()}개 번역 단락`;

    // 2. 스마트 자동 병합 액션 버튼 (기존 동일 소설 폴더가 있을 때)
    const smartMergeContainer = document.getElementById('smartMergeContainer');
    const smartMergeLabel = document.getElementById('smartMergeLabel');
    if (novel.matched_existing_folder) {
        smartMergeContainer.style.display = 'block';
        smartMergeLabel.textContent = `기존 폴더 '${novel.matched_existing_folder}'(으)로 자동 합치기`;
    } else {
        smartMergeContainer.style.display = 'none';
    }

    // 새 폴더 입력창 기본값 채우기 (추출된 소설 원제)
    const newFolderInput = document.getElementById('assignNewFolderNameInput');
    if (newFolderInput) {
        newFolderInput.value = novel.novel_title;
    }

    // 기존 폴더 드롭다운 채우기
    const existingDropdown = document.getElementById('assignExistingFolderDropdown');
    if (existingDropdown) {
        existingDropdown.innerHTML = '<option value="">기존 폴더 선택...</option>';
        allFolders.forEach(f => {
            if (f.name && f.name !== '폴더 추가 대기 상태') {
                const opt = document.createElement('option');
                opt.value = f.name;
                opt.textContent = f.name;
                if (novel.matched_existing_folder === f.name) {
                    opt.selected = true;
                }
                existingDropdown.appendChild(opt);
            }
        });
    }

    // 3. 회차 및 단락 리스트 렌더링
    renderUnclassifiedEpisodes(novel);
}

function renderUnclassifiedEpisodes(novel) {
    const listContainer = document.getElementById('unclassifiedEpisodeListContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    (novel.episodes || []).forEach((ep, idx) => {
        const epEl = document.createElement('div');
        epEl.className = 'unclassified-episode-item list-group';
        epEl.dataset.url = ep.url;
        epEl.dataset.folderName = '미분류';

        const isApplied = appliedUrlsSet.has(ep.url.split('#')[0].replace(/\/$/, ''));

        epEl.innerHTML = `
            <div class="unclassified-episode-header list-group-header">
                <div class="unclassified-ep-title-wrap">
                    <span class="material-icons ep-toggle-icon">expand_more</span>
                    <h4 class="list-group-title">${escapeHtml(ep.title || `제 ${idx + 1}화`)}</h4>
                    <span class="episode-count-badge">${ep.paragraph_count}개 단락</span>
                </div>
                <div class="unclassified-ep-actions list-group-actions">
                    <a href="${ep.url}" target="_blank" class="btn btn-outline btn-sm ext-link-btn" title="원본 웹페이지 새 창으로 열기">🔗 원본 ↗</a>
                    <button type="button" class="btn btn-outline btn-sm edit-title-btn" data-url="${escapeHtml(ep.url)}" title="회차 제목 수정">✏️ 수정</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-apply ${isApplied ? 'applied' : ''}" data-url="${escapeHtml(ep.url)}">${isApplied ? '적용 해제' : '적용'}</button>
                </div>
            </div>
            <div class="unclassified-episode-content list-group-content">
                <!-- 아코디언 오픈 시 단락 테이블 로딩 -->
            </div>
        `;

        const header = epEl.querySelector('.unclassified-episode-header');
        const content = epEl.querySelector('.unclassified-episode-content');
        const icon = epEl.querySelector('.ep-toggle-icon');

        header.addEventListener('click', async (e) => {
            // 버튼 클릭 시 아코디언 토글 방지
            if (e.target.closest('.unclassified-ep-actions') || e.target.closest('button') || e.target.closest('a')) {
                return;
            }

            e.stopPropagation(); // 상위 이벤트 위임 핸들러로의 버블링 방지

            const isOpen = content.classList.contains('open');
            if (isOpen) {
                content.classList.remove('open');
                icon.textContent = 'expand_more';
            } else {
                content.classList.remove('collapsed');
                content.classList.add('open');
                icon.textContent = 'expand_less';

                // 아직 단락 테이블이 렌더링되지 않았으면 렌더링 수행
                if (!content.querySelector('.history-table')) {
                    content.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">단락 목록 불러오는 중...</div>';
                    
                    let items = null;
                    try {
                        const res = await fetch(`/api/unclassified_novels/paragraphs?url=${encodeURIComponent(ep.url)}`);
                        if (res.ok) {
                            const data = await res.json();
                            items = data.items;
                        }
                    } catch (err) {
                        console.error("Failed to fetch episode paragraphs:", err);
                    }

                    if (items && items.length > 0) {
                        items.forEach(t => unclassifiedParagraphsMap.set(t.id, t));
                        content.innerHTML = `
                            <table class="history-table">
                                <thead>
                                    <tr>
                                        <th style="width: 44px; text-align: center;">선택</th>
                                        <th style="width: 75px;">PID</th>
                                        <th style="width: 42%;">원문 (일본어)</th>
                                        <th style="width: 42%;">번역 (한국어)</th>
                                        <th style="width: 150px; text-align: center;">관리</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${items.map(t => renderItem(t)).join('')}
                                </tbody>
                            </table>
                        `;
                    } else {
                        content.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">표시할 번역 단락이 없습니다.</div>';
                    }
                }
            }
        });

        listContainer.appendChild(epEl);
    });
}

async function executeAssignFolder(work_id, target_folder, work_url) {
    try {
        const res = await fetch('/api/unclassified_novels/assign_folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work_id, target_folder, work_url })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '폴더 등록에 실패했습니다.');
        }
        const data = await res.json();
        showToast(data.message || `'${target_folder}' 등록 완료!`, 'success');
        currentSelectedUnclassifiedNovel = null;
        await checkAndLoadUnclassifiedNovels();
        await loadAndRenderGrouped();
    } catch (e) {
        console.error('executeAssignFolder error:', e);
        showToast(`오류 발생: ${e.message}`, 'error');
    }
}

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
