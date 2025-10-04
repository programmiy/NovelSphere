// Global state
let pageTranslations = [];

// UI state
let isLoading = false;
let currentSearch = '';
let translationStatuses = {}; // Holds the apply-status for each URL

// DOM element cache
let historyContainer, emptyState, searchBox, darkModeToggle, fetchAllTitlesBtn, bulkActionsPanel, selectionCount, deleteSelectedBtn, moveSelectedToFolderDropdown, findReplaceModal, closeFindReplaceModalBtn, cancelFindReplaceBtn, executeFindReplaceBtn, openGlobalFindReplaceBtn, paginationContainer;

// Debounce timer

// Debounce timer
let searchTimeout;

// Main initialization
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    loadDarkModePreference();
    loadAndRenderPage(1); // Load the first page
});

function cacheDOMElements() {
    historyContainer = document.getElementById('history-container');
    paginationContainer = document.getElementById('pagination-container');
    emptyState = document.getElementById('emptyState');
    searchBox = document.getElementById('searchBox');
    darkModeToggle = document.getElementById('darkModeToggle');
    fetchAllTitlesBtn = document.getElementById('fetchAllTitlesBtn');
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
}

async function loadAndRenderPage(page = 1) {
    if (isLoading) return;
    isLoading = true;
    document.getElementById('loading-skeleton').style.display = 'block';
    historyContainer.innerHTML = '';
    paginationContainer.innerHTML = '';

    // Fetch stats in parallel
    updateStatistics();

    try {
        const res = await fetch(`http://127.0.0.1:8001/paged_translations?page=${page}`);
        if (!res.ok) throw new Error(`Server error: ${res.statusText}`);
        
        const data = await res.json();
        pageTranslations = data.translations;

        // Manually group by URL on the client side
        const groupedByUrl = pageTranslations.reduce((acc, t) => {
            if (!acc[t.url]) {
                acc[t.url] = [];
            }
            acc[t.url].push(t);
            return acc;
        }, {});

        // Create a structure compatible with renderGroupedHistory
        const groupedForRender = {
            "All Items": groupedByUrl
        };

        // Fetch statuses from storage
        const storageData = await chrome.storage.local.get(null);
        translationStatuses = {};
        for (const key in storageData) {
            if (key.startsWith('status-')) {
                translationStatuses[key] = storageData[key];
            }
        }

        renderGroupedHistory(groupedForRender);
        renderPagination(data.total_count, data.page, data.per_page);
        
    } catch (error) {
        console.error("Failed to load data:", error);
        showToast("Failed to load data. Is the server running?", "error");
    } finally {
        isLoading = false;
        document.getElementById('loading-skeleton').style.display = 'none';
        emptyState.style.display = pageTranslations.length === 0 ? 'block' : 'none';
        updateBulkActionPanel();
    }
}

async function updateStatistics() {
    const statsContainer = document.getElementById('stats-container');
    if (!statsContainer) return;

    try {
        const res = await fetch('http://127.0.0.1:8001/statistics');
        if (!res.ok) throw new Error(`Server error: ${res.statusText}`);
        const stats = await res.json();

        let html = '<div class="stats-grid">';

        // General Stats
        html += createStatItem('총 번역 수', stats.total_count.toLocaleString());
        html += createStatItem('오늘 번역 수', stats.today_count.toLocaleString());
        html += createStatItem('원문 총 글자 수', stats.total_chars_original.toLocaleString());
        html += createStatItem('번역문 총 글자 수', stats.total_chars_translated.toLocaleString());

        html += '</div>';

        // Folder Stats
        if (stats.folder_stats && stats.folder_stats.length > 0) {
            html += '<h4 class="stats-subtitle">폴더별 통계</h4>';
            html += '<table class="stats-table"><thead><tr><th>폴더명</th><th>번역 수</th><th>원문 글자 수</th><th>번역문 글자 수</th></tr></thead><tbody>';
            stats.folder_stats.forEach(folder => {
                html += `<tr>
                    <td>${escapeHtml(folder.folderName)}</td>
                    <td>${folder.count.toLocaleString()}</td>
                    <td>${folder.chars_original.toLocaleString()}</td>
                    <td>${folder.chars_translated.toLocaleString()}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }

        statsContainer.innerHTML = html;
    } catch (error) {
        statsContainer.innerHTML = '<p style="color: var(--danger-color);">통계 정보를 불러오는 데 실패했습니다.</p>';
        console.error("Failed to update statistics:", error);
    }
}

function createStatItem(label, value) {
    return `<div class="stat-item">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
    </div>`;
}

function populateFolderDropdowns(folders) {
    if (!moveSelectedToFolderDropdown) return;
    moveSelectedToFolderDropdown.innerHTML = '<option value="">폴더로 이동...</option><option value="__no_folder__">폴더 없음</option>';
    folders.forEach(folderName => {
        const option = `<option value="${escapeHtml(folderName)}">${escapeHtml(folderName)}</option>`;
        moveSelectedToFolderDropdown.insertAdjacentHTML('beforeend', option);
    });
}

function sortUrlsNumerically(urls) {
    const getUrlParts = (url) => {
        const match = url.match(/(.*\/)(\d+)\/?$/); // Capture base path and number
        if (match && match[1] && match[2]) {
            return { base: match[1], episode: parseInt(match[2], 10) };
        }
        // Fallback for URLs that don't match the pattern
        return { base: url, episode: null };
    };

    return urls.sort((a, b) => {
        const partsA = getUrlParts(a);
        const partsB = getUrlParts(b);

        // If base paths are different, group by base path first
        if (partsA.base !== partsB.base) {
            return partsA.base.localeCompare(partsB.base);
        }

        // If base paths are the same, sort by episode number
        if (partsA.episode !== null && partsB.episode !== null) {
            return partsA.episode - partsB.episode;
        }
        
        // Handle cases where one has an episode number and the other doesn't
        if (partsA.episode !== null) return -1; // a comes first
        if (partsB.episode !== null) return 1;  // b comes first

        // If no episode numbers, sort by full url
        return a.localeCompare(b);
    });
}

function renderGroupedHistory() {
    historyContainer.innerHTML = '';
    const sortedFolderNames = Object.keys(groupedTranslations).sort();

    for (const folderName of sortedFolderNames) {
        const urlGroups = groupedTranslations[folderName];
        const folderContainer = document.createElement('div');
        folderContainer.className = 'history-folder-group';

        let urlGroupsHtml = '';
        let totalTranslationsInFolder = 0;
        const sortedUrls = sortUrlsNumerically(Object.keys(urlGroups));

        for (const url of sortedUrls) {
            const translations = urlGroups[url];
            const filteredTranslations = translations.filter(t => 
                !currentSearch || 
                t.original.toLowerCase().includes(currentSearch) || 
                (t.translated && t.translated.toLowerCase().includes(currentSearch))
            );

            if (filteredTranslations.length === 0) continue;

            // Sort by pid using natural sort to ensure correct chapter order
            filteredTranslations.sort((a, b) => (a.pid || '').localeCompare(b.pid || '', undefined, { numeric: true, sensitivity: 'base' }));
            
            totalTranslationsInFolder += filteredTranslations.length;
            const groupItemsHtml = filteredTranslations.map(t => renderItem(t)).join('');
            const title = filteredTranslations[0]?.title || url;
            
            // Check the applied status for the current URL
            const statusKey = `status-${url}`;
            const isApplied = translationStatuses[statusKey]?.applied || false;

            urlGroupsHtml += `
                <div class="list-group fade-in" data-url="${url}">
                    <div class="list-group-header">
                        <span class="list-group-toggle collapsed material-icons">chevron_right</span>
                        <a href="${url}" target="_blank" class="list-group-title-link"><h3 class="list-group-title">${escapeHtml(title)} (${filteredTranslations.length})</h3></a>
                        <button class="btn btn-outline btn-icon edit-title-btn" data-url="${url}" title="제목 수정">✏️</button>
                        <div class="list-group-actions">
                            <button class="btn btn-secondary btn-apply ${isApplied ? 'applied' : ''}" data-url="${url}">${isApplied ? '적용 해제' : '페이지에 적용'}</button>
                            <label class="btn"><input type="checkbox" class="group-select-all-checkbox"> 전체 선택</label>
                        </div>
                    </div>
                    <div class="list-group-content collapsed">
                        <div class="history-list">
                            <div class="history-list-header">
                                <div style="width: 40px;"></div>
                                <div style="width: 80px;">PID</div>
                                <div>원문</div>
                                <div>번역</div>
                                <div style="width: 120px;">액션</div>
                            </div>
                            <div class="history-list-body">${groupItemsHtml}</div>
                        </div>
                    </div>
                </div>
            `;
        }

        if (totalTranslationsInFolder > 0) {
            folderContainer.innerHTML = `
                <div class="folder-group-header">
                    <span class="folder-group-toggle material-icons collapsed">expand_more</span>
                    <h2 class="folder-group-title">${escapeHtml(folderName)} (${totalTranslationsInFolder})</h2>
                    <div class="list-group-actions">
                        <label class="btn"><input type="checkbox" class="folder-select-all-checkbox"> 폴더 전체 선택</label>
                    </div>
                </div>
                <div class="folder-group-content collapsed">${urlGroupsHtml}</div>
            `;
            historyContainer.appendChild(folderContainer);
        }
    }
}

function renderItem(t) {
    const date = new Date(t.timestamp * 1000);
    const dateStr = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    return `
        <div class="history-item" data-id="${t.id}">
            <div class="item-cell" style="width: 40px; text-align: center;"><input type="checkbox" class="item-checkbox" data-id="${t.id}"></div>
            <div class="item-cell" style="width: 80px;">${escapeHtml(t.pid)}</div>
            <div class="item-cell original-cell"><div class="item-text-block"><div class="text-content original-text">${escapeHtml(t.original)}</div></div></div>
            <div class="item-cell translated-cell"><div class="item-text-block"><div class="text-content translated-text" contenteditable="true">${escapeHtml(t.translated)}</div></div></div>
            <div class="item-cell actions-cell" style="width: 120px;">
                <div class="item-actions-container">
                    <div class="item-date">${dateStr}</div>
                    <div class="item-actions">
                        <button class="btn btn-outline save-item-btn" title="Save">💾</button>
                        <button class="btn btn-outline copy-btn" title="Copy">📋</button>
                        <button class="btn btn-outline exclude-btn" title="Exclude">🚫</button>
                        <button class="btn btn-outline delete-btn" title="Delete">🗑️</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupEventListeners() {
    searchBox.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value.toLowerCase();
            renderGroupedHistory();
        }, 300);
    });

    historyContainer.addEventListener('click', handleHistoryClick);
    historyContainer.addEventListener('change', handleCheckboxChange);

    darkModeToggle.addEventListener('click', toggleDarkMode);
    fetchAllTitlesBtn.addEventListener('click', fetchAllTitles);
    deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    moveSelectedToFolderDropdown.addEventListener('change', moveSelectedTranslationsToFolder);

    // Find & Replace Listeners
    openGlobalFindReplaceBtn.addEventListener('click', openFindReplaceModal);
    closeFindReplaceModalBtn.addEventListener('click', closeFindReplaceModal);
    cancelFindReplaceBtn.addEventListener('click', closeFindReplaceModal);
    executeFindReplaceBtn.addEventListener('click', executeGlobalFindReplace);
}

function openFindReplaceModal() {
    if (!findReplaceModal) return;
    document.getElementById('findText').value = '';
    document.getElementById('replaceText').value = '';
    findReplaceModal.style.display = 'flex';
    document.getElementById('findText').focus();
}

function closeFindReplaceModal() {
    if (!findReplaceModal) return;
    findReplaceModal.style.display = 'none';
}

async function executeGlobalFindReplace() {
    const findText = document.getElementById('findText').value;
    const replaceText = document.getElementById('replaceText').value;

    if (!findText) {
        showToast('찾을 내용을 입력하세요.', 'error');
        return;
    }

    if (!confirm(`모든 번역 기록에서 "${findText}"을(를) "${replaceText}"(으)로 바꾸시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }

    try {
        const response = await fetch('http://127.0.0.1:8001/translations/find_replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ find_text: findText, replace_text: replaceText })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        const result = await response.json();
        showToast(result.message, 'success');
        closeFindReplaceModal();
        loadAndRenderGrouped(); // Reload data to show changes

    } catch (error) {
        console.error("Global find and replace failed:", error);
        showToast(`오류: ${error.message}`, 'error');
    }
}

function handleCheckboxChange(e) {
    const target = e.target;
    if (!target.matches('input[type="checkbox"]')) return;

    if (target.classList.contains('folder-select-all-checkbox')) {
        const folderGroup = target.closest('.history-folder-group');
        if (!folderGroup) return;

        // Programmatically click the group-level checkboxes
        const groupCheckboxes = folderGroup.querySelectorAll('.group-select-all-checkbox');
        groupCheckboxes.forEach(cb => {
            if (cb.checked !== target.checked) {
                cb.click(); // Triggering a click will invoke its own change handler
            }
        });

        // Fallback: Directly set all item checkboxes as well to ensure consistency
        const itemCheckboxes = folderGroup.querySelectorAll('.item-checkbox');
        itemCheckboxes.forEach(cb => {
            cb.checked = target.checked;
        });
    }

    if (target.classList.contains('group-select-all-checkbox')) {
        const urlGroup = target.closest('.list-group');
        const itemCheckboxes = urlGroup.querySelectorAll('.item-checkbox');
        itemCheckboxes.forEach(cb => cb.checked = target.checked);
    }

    updateBulkActionPanel();
}

function findTranslationById(id) {
    for (const folderName in groupedTranslations) {
        for (const url in groupedTranslations[folderName]) {
            const item = groupedTranslations[folderName][url].find(t => t.id === id);
            if (item) return item;
        }
    }
    return null;
}

async function handleHistoryClick(e) {
    const target = e.target;

    // If a checkbox was clicked, do nothing. The `change` event will handle it.
    if (target.matches('input[type="checkbox"]')) {
        return;
    }

    // Logic for buttons inside .list-group-actions (Apply, Edit Title)
    if (target.closest('.list-group-actions') || target.classList.contains('edit-title-btn')) {
        if (target.classList.contains('btn-apply')) {
            const url = target.dataset.url;
            toggleApplyStatus(url);
        } else if (target.classList.contains('edit-title-btn')) {
            const url = target.dataset.url;
            const titleElement = target.closest('.list-group-header').querySelector('.list-group-title');
            const currentTitle = titleElement.textContent.split(' (')[0];
            const newTitle = prompt("Enter new title:", currentTitle);
            if (newTitle && newTitle !== currentTitle) {
                const countMatch = titleElement.textContent.match(/\(\d+\)/);
                const count = countMatch ? countMatch[0] : '';
                titleElement.textContent = `${newTitle} ${count}`;
                try {
                    await fetch('http://127.0.0.1:8001/translations/url_title', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url, title: newTitle })
                    });
                    showToast('Title updated successfully!', 'success');
                } catch (error) {
                    showToast('Failed to update title.', 'error');
                    titleElement.textContent = `${currentTitle} ${count}`;
                }
            }
        }
        return; // Prevent other handlers from firing
    }

    // Logic for toggling folder collapse/expand
    const folderHeader = target.closest('.folder-group-header');
    if (folderHeader && !target.closest('.list-group-actions')) { // Exclude clicks on checkbox/label
        folderHeader.nextElementSibling.classList.toggle('collapsed');
        folderHeader.querySelector('.folder-group-toggle').classList.toggle('collapsed');
        return;
    }

    // Logic for toggling URL group collapse/expand
    const urlHeader = target.closest('.list-group-header');
    if (urlHeader) {
        urlHeader.nextElementSibling.classList.toggle('collapsed');
        const icon = urlHeader.querySelector('.list-group-toggle');
        icon.classList.toggle('collapsed');
        icon.textContent = icon.classList.contains('collapsed') ? 'chevron_right' : 'expand_more';
        return;
    }

    // Logic for buttons inside a history item row (Save, Copy, Delete)
    const itemRow = target.closest('.history-item');
    if (!itemRow) return;

    const id = parseInt(itemRow.dataset.id);

    if (target.classList.contains('delete-btn')) {
        if (!confirm('Delete this translation?')) return;
        await fetch(`http://127.0.0.1:8001/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
        itemRow.remove();
        showToast('Deleted.');
    } else if (target.classList.contains('exclude-btn')) {
        if (!confirm('Permanently exclude this sentence from translation?')) return;
        try {
            const response = await fetch(`http://127.0.0.1:8001/translations/exclude`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ ids: [id] }) 
            });
            if (!response.ok) throw new Error('Server responded with an error');
            itemRow.remove();
            showToast('Sentence excluded and deleted.', 'success');
        } catch (error) {
            console.error('Failed to exclude translation:', error);
            showToast('Failed to exclude sentence.', 'error');
        }
    } else if (target.classList.contains('save-item-btn')) {
        const newTranslatedText = itemRow.querySelector('.translated-text').textContent;
        const originalItem = findTranslationById(id);

        if (!originalItem) {
            showToast('Error: Could not find original item to save.', 'error');
            return;
        }

        const updatedItemPayload = {
            ...originalItem,
            translated: newTranslatedText,
            timestamp: Math.floor(Date.now() / 1000)
        };
        delete updatedItemPayload.id; // The upsert model does not take 'id'

        try {
            const response = await fetch('http://127.0.0.1:8001/translations/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([updatedItemPayload])
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`Server error: ${response.status} - ${errorData.detail || 'Unknown error'}`);
            }

            showToast('Saved.');
            
            // Update local state to reflect change immediately
            originalItem.translated = newTranslatedText;
            originalItem.timestamp = updatedItemPayload.timestamp;
            
            // Update the date in the UI
            const dateElement = itemRow.querySelector('.item-date');
            if(dateElement) {
                 const date = new Date(updatedItemPayload.timestamp * 1000);
                 dateElement.textContent = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
            }

        } catch (error) {
            console.error('Failed to save translation:', error);
            showToast(`Save failed: ${error.message}`, 'error');
        }

    } else if (target.classList.contains('copy-btn')) {
        navigator.clipboard.writeText(itemRow.querySelector('.translated-text').textContent);
        showToast('Copied to clipboard.');
    }
}

async function toggleApplyStatus(url) {
    const statusKey = 'status-' + url;
    try {
        const result = await chrome.storage.local.get(statusKey);
        const currentStatus = result[statusKey] || {};
        const newStatus = { applied: !currentStatus.applied, timestamp: Date.now() };
        await chrome.storage.local.set({ [statusKey]: newStatus });
        
        // Update local state and re-render to show button change
        translationStatuses[statusKey] = newStatus;
        renderGroupedHistory();

        showToast(newStatus.applied ? '설정 완료: 이제 해당 페이지에서 번역이 적용됩니다.' : '설정 해제: 페이지에서 번역이 더 이상 적용되지 않습니다.');
    } catch (error) {
        console.error('Failed to toggle apply status:', error);
        showToast('상태 변경에 실패했습니다.', 'error');
    }
}

function updateBulkActionPanel() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    const hasSelection = checkedItems.length > 0;

    if (hasSelection) {
        bulkActionsPanel.style.display = 'flex';
        selectionCount.textContent = `${checkedItems.length}개 항목 선택됨`;
    } else {
        bulkActionsPanel.style.display = 'none';
    }
    
    // Enable/disable buttons based on selection
    deleteSelectedBtn.disabled = !hasSelection;
    moveSelectedToFolderDropdown.disabled = !hasSelection;
}

async function deleteSelectedTranslations() {
    const checkedItems = Array.from(document.querySelectorAll('.item-checkbox:checked'));
    if (checkedItems.length === 0 || !confirm(`정말로 ${checkedItems.length}개의 번역을 삭제하시겠습니까?`)) return;
    
    const idsToDelete = checkedItems.map(item => parseInt(item.dataset.id));
    await fetch('http://127.0.0.1:8001/translations/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToDelete }) });
    showToast(`${idsToDelete.length} items deleted.`, 'success');
    loadAndRenderGrouped();
}

async function moveSelectedTranslationsToFolder(event) {
    const checkedItems = Array.from(document.querySelectorAll('.item-checkbox:checked'));
    if (checkedItems.length === 0) return;
    const newFolderName = event.target.value;
    if (newFolderName === "") return;

    const idsToMove = checkedItems.map(item => parseInt(item.dataset.id));
    const folderForAPI = newFolderName === "__no_folder__" ? null : newFolderName;

    if (!confirm(`${idsToMove.length}개의 항목을 '${newFolderName}' 폴더로 이동하시겠습니까?`)) return;

    await fetch('http://127.0.0.1:8001/translations/move', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToMove, folder_name: folderForAPI }) });
    showToast(`${idsToMove.length} items moved.`, 'success');
    loadAndRenderGrouped();
}

// Utility functions (escapeHtml, showToast, etc.) remain the same
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString().replace(/[&<>"'/]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','/':'&#x2F;'})[s]);
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Slide in
    setTimeout(() => {
        toast.style.transform = 'translateX(0)';
    }, 100);

    // Slide out and remove
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    chrome.storage.local.set({ darkMode: document.body.classList.contains('dark-mode') });
}

async function loadDarkModePreference() {
    const { darkMode } = await chrome.storage.local.get('darkMode');
    if (darkMode) document.body.classList.add('dark-mode');
}

async function fetchAllTitles() {
    if (!confirm('제목이 없는 모든 항목의 제목을 가져오시겠습니까? 이 작업은 시간이 오래 걸릴 수 있습니다.')) return;
    showToast('백그라운드에서 제목 가져오기를 시작합니다...', 'info');
    try {
        const response = await fetch('http://127.0.0.1:8001/fetch_missing_titles', { method: 'POST' });
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        const result = await response.json();
        showToast(result.message, 'success');
        setTimeout(() => { showToast('새로고침하여 새 제목을 확인하세요.', 'info'); loadAndRenderGrouped(); }, 5000);
    } catch (error) {
        showToast('제목 가져오기 작업을 시작하지 못했습니다.', 'error');
    }
}

function renderPagination(totalCount, currentPage, perPage) {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';
    const totalPages = Math.ceil(totalCount / perPage);

    if (totalPages <= 1) return;

    // Previous Button
    const prevButton = document.createElement('button');
    prevButton.textContent = '이전';
    prevButton.className = 'pagination-btn';
    if (currentPage === 1) {
        prevButton.classList.add('disabled');
    }
    prevButton.addEventListener('click', () => {
        if (currentPage > 1) {
            loadAndRenderPage(currentPage - 1);
        }
    });
    paginationContainer.appendChild(prevButton);

    // Page Number Buttons (simplified for now)
    for (let i = 1; i <= totalPages; i++) {
        const pageButton = document.createElement('button');
        pageButton.textContent = i;
        pageButton.className = 'pagination-btn';
        if (i === currentPage) {
            pageButton.classList.add('active');
        }
        pageButton.addEventListener('click', () => {
            loadAndRenderPage(i);
        });
        paginationContainer.appendChild(pageButton);
    }

    // Next Button
    const nextButton = document.createElement('button');
    nextButton.textContent = '다음';
    nextButton.className = 'pagination-btn';
    if (currentPage === totalPages) {
        nextButton.classList.add('disabled');
    }
    nextButton.addEventListener('click', () => {
        if (currentPage < totalPages) {
            loadAndRenderPage(currentPage + 1);
        }
    });
    paginationContainer.appendChild(nextButton);
}