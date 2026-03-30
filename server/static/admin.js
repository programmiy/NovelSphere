// import Sortable, { MultiDrag } from "https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.esm.js";
// Sortable.mount(new MultiDrag());

// Global state
const JAPANESE_REGEX = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
let groupedTranslations = {};
let allFolders = [];

// UI state
let isLoading = false;
let isFindingEmpty = false;
let currentSearch = '';
let translationStatuses = {}; // Holds the apply-status for each URL
let appliedUrlsSet = new Set();

// DOM element cache
let historyContainer, emptyState, searchBox, darkModeToggle, fetchAllTitlesBtn, bulkActionsPanel, selectionCount, deleteSelectedBtn, moveSelectedToFolderDropdown, findReplaceModal, closeFindReplaceModalBtn, cancelFindReplaceBtn, executeFindReplaceBtn, openGlobalFindReplaceBtn, createFolderButton, newFolderNameInput, findEmptyBtn, findText, replaceText, findCount, conditionText, folderScope, useRegex, caseSensitive, autoStartCheckbox, enableDragDropCheckbox;

// Debounce timer
let searchTimeout;
let findReplaceCountTimeout;

// SortableJS instances
let sortableInstances = [];

// Main initialization
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    // loadDarkModePreference(); // Disabled: Chrome extension API not available
    loadAndRenderGrouped();
});

function cacheDOMElements() {
    historyContainer = document.getElementById('history-container');
    emptyState = document.getElementById('emptyState');
    searchBox = document.getElementById('searchBox');
    darkModeToggle = document.getElementById('darkModeToggle');
    // fetchAllTitlesBtn = document.getElementById('fetchAllTitlesBtn');
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
}

async function loadAndRenderGrouped() {
    if (isLoading) return;
    isLoading = true;
    showToast('Loading data...', 'info'); // DEBUG
    document.getElementById('loading-skeleton').style.display = 'block';
    historyContainer.innerHTML = '';

    try {
        // Fetch all data from the server
        const [translationsRes, foldersRes] = await Promise.all([
            fetch(`/translations_by_folder?t=${Date.now()}`),
            fetch(`/folders?t=${Date.now()}`)
        ]);

        showToast('Data fetched, processing...', 'info'); // DEBUG

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

        showToast('Rendering history...', 'info'); // DEBUG
        renderGroupedHistory(groupedTranslations); // Pass data to render
        populateFolderDropdowns(allFolders);
        updateStatistics(groupedTranslations);
        
    } catch (error) {
        console.error("Failed to load data:", error);
        showToast("데이터 로딩 실패. 서버가 실행중인지 확인하세요.", "error");
    } finally {
        isLoading = false;
        document.getElementById('loading-skeleton').style.display = 'none';
        emptyState.style.display = Object.keys(groupedTranslations).length === 0 ? 'block' : 'none';
        updateBulkActionPanel();
    }
}

function updateStatistics(groupedData) {
    let totalCount = 0;
    let todayCount = 0;
    let totalLength = 0;
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);

    for (const folderName in groupedData) {
        const urlGroups = groupedData[folderName]; // This is an array of urlGroup objects
        for (const urlGroup of urlGroups) {
            const items = urlGroup.items; // This is the array of translation items
            for (const item of items) {
                totalCount++;
                totalLength += item.translated ? item.translated.length : 0;
                
                if ((item.timestamp * 1000) >= twentyFourHoursAgo) {
                    todayCount++;
                }
            }
        }
    }

    const avgLength = totalCount > 0 ? Math.round(totalLength / totalCount) : 0;

    document.getElementById('totalCount').textContent = totalCount;
    document.getElementById('todayCount').textContent = todayCount;
    document.getElementById('avgLength').textContent = avgLength;
}

function populateFolderDropdowns(folders) {
    const folderFilterDropdown = document.getElementById('folderFilterDropdown');

    if (moveSelectedToFolderDropdown) {
        moveSelectedToFolderDropdown.innerHTML = '<option value="">폴더로 이동...</option><option value="__no_folder__">폴더 추가 대기 상태</option>';
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



function renderGroupedHistory(dataToRender) {
    historyContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();
    sortableInstances = []; // Clear instances on re-render
    
    const folderNames = allFolders.map(f => f.name).sort();

    for (const folderName of folderNames) {
        const urlGroups = dataToRender[folderName] || []; // This is now an array of urlGroup objects
        const folderContainer = document.createElement('div');
        folderContainer.className = 'history-folder-group';

        let urlGroupsHtml = '';
        let totalTranslationsInFolder = 0;

        for (const urlGroup of urlGroups) {
            const url = urlGroup.url;
            const translations = urlGroup.items;
            const sortOrder = urlGroup.sort_order;

            let filteredTranslations = translations.filter(t => 
                !currentSearch || 
                t.original.toLowerCase().includes(currentSearch) || 
                (t.translated && t.translated.toLowerCase().includes(currentSearch))
            );

            // This client-side filtering is now only for search, not for finding empty ones
            // if (isFindingEmpty) {
            //     filteredTranslations = filteredTranslations.filter(t => !t.translated || t.translated.trim() === '' || JAPANESE_REGEX.test(t.translated));
            // }

            if (filteredTranslations.length === 0) continue;

            filteredTranslations.sort((a, b) => (a.pid || '').localeCompare(b.pid || '', undefined, { numeric: true, sensitivity: 'base' }));
            
            totalTranslationsInFolder += filteredTranslations.length;
            const groupItemsHtml = filteredTranslations.map(t => renderItem(t)).join('');
            const title = filteredTranslations[0]?.title || url;
            
            const isApplied = appliedUrlsSet.has(url.split('#')[0].replace(/\/$/, ''));

            const isUrlGroupCollapsed = isFindingEmpty ? false : true;

            urlGroupsHtml += `
                <div class="list-group fade-in" data-url="${url}">
                    <div class="list-group-header">
                        <span class="list-group-toggle ${isUrlGroupCollapsed ? 'collapsed' : ''} material-icons">chevron_right</span>
                        <a href="${url}" target="_blank" class="list-group-title-link"><h3 class="list-group-title">${escapeHtml(title)} (${filteredTranslations.length})</h3></a>
                        <div class="list-group-actions">

                            <button class="btn btn-outline btn-icon edit-title-btn" data-url="${url}" title="제목 수정">✏️</button>
                            <button class="btn btn-secondary btn-apply ${isApplied ? 'applied' : ''}" data-url="${url}">🔄️ ${isApplied ? '해제' : '적용'}</button>
                            <label class="btn"><input type="checkbox" class="group-select-all-checkbox"> 전체 선택</label>
                        </div>
                    </div>
                    <div class="list-group-content ${isUrlGroupCollapsed ? 'collapsed' : ''}">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th style="width: 40px;"></th>
                                    <th style="width: 80px;">PID</th>
                                    <th>원문</th>
                                    <th>번역</th>
                                    <th style="width: 120px;">액션</th>
                                </tr>
                            </thead>
                            <tbody>${groupItemsHtml}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        if (isFindingEmpty && totalTranslationsInFolder === 0) {
            continue;
        }

        const isFolderCollapsed = isFindingEmpty ? (totalTranslationsInFolder === 0) : true;

        folderContainer.innerHTML = `
            <div class="folder-group-header">
                <span class="folder-group-toggle material-icons ${isFolderCollapsed ? 'collapsed' : ''}">expand_more</span>
                <h2 class="folder-group-title">${escapeHtml(folderName)} (${totalTranslationsInFolder})</h2>
                <div class="list-group-actions">
                    <label class="btn"><input type="checkbox" class="folder-select-all-checkbox"> 폴더 전체 선택</label>
                    <button class="btn btn-outline btn-icon edit-folder-name-btn" data-folder-name="${escapeHtml(folderName)}" title="폴더 이름 수정">✏️</button>
                </div>
            </div>
            <div class="folder-group-content ${isFolderCollapsed ? 'collapsed' : ''}" id="folder-content-${folderName.replace(/\s/g, '-')}">${urlGroupsHtml}</div>
        `;
        fragment.appendChild(folderContainer);
    }
    historyContainer.appendChild(fragment);
}

function renderItem(t) {
    const date = new Date(t.timestamp * 1000);
    const dateStr = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    return `
        <tr class="history-item" data-id="${t.id}">
            <td style="width: 40px; text-align: center;"><input type="checkbox" class="item-checkbox" data-id="${t.id}"></td>
            <td>${escapeHtml(t.pid)}</td>
            <td><div class="item-text-block"><div class="text-content original-text">${escapeHtml(t.original)}</div></div></td>
            <td><div class="item-text-block"><div class="text-content translated-text" contenteditable="true">${escapeHtml(t.translated)}</div></div></td>
            <td class="item-actions-container">
                <div class="item-date">${dateStr}</div>
                <div class="item-actions">
                    <button class="btn btn-outline save-item-btn" title="Save">💾</button>
                    <button class="btn btn-outline copy-btn" title="Copy">📋</button>
                    <button class="btn btn-outline exclude-btn" title="Exclude">❌</button>
                    <button class="btn btn-outline delete-btn" title="Delete">🗑️</button>
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
            // Deactivate find empty filter if user starts searching
            if (isFindingEmpty) {
                isFindingEmpty = false;
                document.getElementById('findEmptyBtn').classList.remove('active');
            }
            renderGroupedHistory(groupedTranslations);
        }, 300);
    });

    findEmptyBtn.addEventListener('click', toggleFindEmpty);

    historyContainer.addEventListener('click', handleHistoryClick);
    historyContainer.addEventListener('change', handleCheckboxChange);

    darkModeToggle.addEventListener('click', toggleDarkMode);
    // fetchAllTitlesBtn.addEventListener('click', fetchAllTitles);
    deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    moveSelectedToFolderDropdown.addEventListener('change', moveSelectedTranslationsToFolder);

    // Find & Replace Listeners
    openGlobalFindReplaceBtn.addEventListener('click', openFindReplaceModal);
    closeFindReplaceModalBtn.addEventListener('click', closeFindReplaceModal);
    cancelFindReplaceBtn.addEventListener('click', closeFindReplaceModal);
    executeFindReplaceBtn.addEventListener('click', executeGlobalFindReplace);

    // Live count for find & replace
    findText.addEventListener('input', countOccurrences); // No debounce for immediate feedback

    [conditionText, useRegex, caseSensitive, folderScope].forEach(element => {
        element.addEventListener('input', () => {
            clearTimeout(findReplaceCountTimeout);
            findReplaceCountTimeout = setTimeout(countOccurrences, 300);
        });
        if (element.type === 'checkbox') { // Also trigger on change for checkboxes
             element.addEventListener('change', () => {
                clearTimeout(findReplaceCountTimeout);
                findReplaceCountTimeout = setTimeout(countOccurrences, 300);
            });
        }
    });

    createFolderButton.addEventListener('click', createFolder);
    autoStartCheckbox.addEventListener('change', saveAutoStartState); // Add event listener for auto-start checkbox
}



async function loadAndRenderAbnormal() {
    if (isLoading) return;
    isLoading = true;
    showToast('이상 번역 기록을 불러오는 중...', 'info');
    document.getElementById('loading-skeleton').style.display = 'block';
    historyContainer.innerHTML = '';

    try {
        const response = await fetch(`/translations/abnormal?t=${Date.now()}`);
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }
        const abnormalData = await response.json();
        
        // Update the applied URLs set from the response
        appliedUrlsSet = new Set(abnormalData._applied_urls || []);
        delete abnormalData._applied_urls;

        renderGroupedHistory(abnormalData); // Render the filtered data

        if (Object.keys(abnormalData).length === 0) {
            showToast("이상 번역 기록이 없습니다.", "info");
        }

    } catch (error) {
        console.error("Failed to load abnormal translations:", error);
        showToast("이상 번역 기록 로딩 실패.", "error");
    } finally {
        isLoading = false;
        document.getElementById('loading-skeleton').style.display = 'none';
        // Do not hide emptyState here, as an empty result is valid for this view
    }
}

function toggleFindEmpty() {
    isFindingEmpty = !isFindingEmpty;
    findEmptyBtn.classList.toggle('active', isFindingEmpty);
    searchBox.value = '';
    currentSearch = '';

    if (isFindingEmpty) {
        loadAndRenderAbnormal();
    } else {
        // When turning off, reload the full dataset
        loadAndRenderGrouped();
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
    folderScope.innerHTML = '<option value="__all__">모든 폴더</option>';
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

    for (const folderName in groupedTranslations) {
        if (selectedFolder !== '__all__' && folderName !== selectedFolder) {
            continue;
        }

        const urlGroups = groupedTranslations[folderName]; // This is an array of urlGroup objects
        if (!Array.isArray(urlGroups)) continue; // Safety check

        for (const urlGroup of urlGroups) {
            const items = urlGroup.items; // This is the array of translation items
            if (!Array.isArray(items)) continue; // Safety check

            for (const item of items) {
                // Check conditionText in original
                if (conditionTextValue) {
                    const originalContent = caseSensitiveValue ? item.original : item.original.toLowerCase();
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

    if (!confirm(`선택된 조건에 따라 번역 기록에서 "${findTextValue}"을(를) "${replaceTextValue}"(으)로 바꾸시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
        return;
    }

    try {
        const response = await fetch('/translations/find_replace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                find_text: findTextValue,
                replace_text: replaceTextValue,
                condition_text: conditionTextValue,
                folder_scope: selectedFolder,
                use_regex: useRegexValue,
                case_sensitive: caseSensitiveValue
            })
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

function handleCheckboxChange(e) {
    const target = e.target;
    if (!target.matches('input[type="checkbox"]')) return;

    if (target.classList.contains('folder-select-all-checkbox')) {
        const folderGroup = target.closest('.history-folder-group');
        if (!folderGroup) return;

        const groupCheckboxes = folderGroup.querySelectorAll('.group-select-all-checkbox');
        groupCheckboxes.forEach(cb => {
            if (cb.checked !== target.checked) {
                cb.click();
            }
        });

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
        const urlGroups = groupedTranslations[folderName];
        if (!Array.isArray(urlGroups)) continue;

        for (const urlGroup of urlGroups) {
            const items = urlGroup.items;
            if (!Array.isArray(items)) continue;

            const item = items.find(t => t.id === id);
            if (item) return item;
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

    // 2. Handle URL-level actions (Title Edit, Apply)
    const urlHeader = target.closest('.list-group-header');
    if (urlHeader) {
        if (target.classList.contains('edit-title-btn')) {
            const url = target.dataset.url;
            const titleElement = urlHeader.querySelector('.list-group-title');
            const currentTitle = titleElement.textContent.split(' (')[0];
            const newTitle = prompt("Enter new title:", currentTitle);
            if (newTitle && newTitle !== currentTitle) {
                const countMatch = titleElement.textContent.match(/(\d+)/);
                const count = countMatch ? countMatch[0] : '';
                titleElement.textContent = `${newTitle} (${count}`;
                try {
                    await fetch('/translations/url_title', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url, title: newTitle })
                    });
                    showToast('Title updated successfully!', 'success');
                } catch (error) {
                    showToast('Failed to update title.', 'error');
                    titleElement.textContent = `${currentTitle} (${count}`;
                }
            }
            return; // Action handled
        }

        if (target.classList.contains('btn-apply')) {
            const url = target.dataset.url;
            toggleApplyStatus(url, target); // Pass button for optimistic UI update
            return; // Action handled
        }

        // If no specific action button in the url-header was clicked, treat it as a toggle
        if (!target.closest('.list-group-actions') && !target.closest('a')) {
            urlHeader.nextElementSibling.classList.toggle('collapsed');
            const icon = urlHeader.querySelector('.list-group-toggle');
            icon.classList.toggle('collapsed');
            icon.textContent = icon.classList.contains('collapsed') ? 'chevron_right' : 'expand_more';
        }
        return;
    }

    // 3. Handle Item-level actions (Save, Copy, Exclude, Delete)
    const itemRow = target.closest('.history-item');
    if (itemRow) {
        const id = parseInt(itemRow.dataset.id);
        if (target.classList.contains('delete-btn')) {
            if (!confirm('이 번역을 삭제하시겠습니까?')) return;
            await fetch(`/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) });
            itemRow.remove();
            showToast('삭제되었습니다.');
        } else if (target.classList.contains('exclude-btn')) {
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
        } else if (target.classList.contains('save-item-btn')) {
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
        } else if (target.classList.contains('copy-btn')) {
            navigator.clipboard.writeText(itemRow.querySelector('.translated-text').textContent);
            showToast('클립보드에 복사되었습니다.');
        }
        return; // Action handled
    }

    // 4. Handle Folder expand/collapse
    const folderHeader = target.closest('.folder-group-header');
    if (folderHeader) {
        // Only toggle if the click was not on an action button
        if (!target.closest('.list-group-actions')) {
             folderHeader.nextElementSibling.classList.toggle('collapsed');
             folderHeader.querySelector('.folder-group-toggle').classList.toggle('collapsed');
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
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    const hasSelection = checkedItems.length > 0;

    if (hasSelection) {
        bulkActionsPanel.style.display = 'flex';
        selectionCount.textContent = `${checkedItems.length}개 항목 선택됨`;
    } else {
        bulkActionsPanel.style.display = 'none';
    }
    
    deleteSelectedBtn.disabled = !hasSelection;
    moveSelectedToFolderDropdown.disabled = !hasSelection;
}

async function deleteSelectedTranslations() {
    const checkedItems = Array.from(document.querySelectorAll('.item-checkbox:checked'));
    if (checkedItems.length === 0 || !confirm(`정말로 ${checkedItems.length}개의 번역을 삭제하시겠습니까?`)) return;
    
    const idsToDelete = checkedItems.map(item => parseInt(item.dataset.id));
    await fetch(`/translations/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToDelete }) });
    showToast(`${idsToDelete.length}개의 항목이 삭제되었습니다.`, 'success');
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

    await fetch('/translations/move', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: idsToMove, folder_name: folderForAPI }) });
    showToast(`${idsToMove.length}개의 항목이 이동되었습니다.`, 'success');
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

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.prepend(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 10); // A small delay to allow the element to be in the DOM for the transition

    setTimeout(() => {
        toast.classList.remove('show');
        // Remove the element after the transition is complete
        toast.addEventListener('transitionend', () => {
            toast.remove();
            // If the container is empty, remove it as well
            if (container.children.length === 0) {
                container.remove();
            }
        });
    }, 5000); // Keep the toast for 5 seconds
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    // Saving preference disabled: chrome.storage.local.set({ darkMode: document.body.classList.contains('dark-mode') });
}

async function loadDarkModePreference() {
    // Disabled: chrome.storage.local.get is not available
    // const { darkMode } = await chrome.storage.local.get('darkMode');
    // if (darkMode) document.body.classList.add('dark-mode');
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