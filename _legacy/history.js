let allTranslations = [];
let urlToTitle = {};
let titleCache = {};
let currentEditInfo = null;
let currentFindReplaceUrl = null;

const FOLDERS_STORAGE_KEY = 'translation_folders';
let allFolders = [];

let historyContainer, emptyState, searchBox, exportJsonBtn, exportPdfBtn, clearAllBtn, deleteSelectedBtn, clearCacheBtn, darkModeToggle, newFolderNameInput, createFolderButton, folderFilterDropdown, moveSelectedToFolderDropdown, editModal, closeModal, cancelEdit, saveEdit, findReplaceModal, closeFindReplaceModal, cancelFindReplace, executeFindReplace, bulkActionsPanel, selectionCountSpan;

document.addEventListener('DOMContentLoaded', () => {
    historyContainer = document.getElementById('history-container');
    emptyState = document.getElementById('emptyState');
    searchBox = document.getElementById('searchBox');
    exportJsonBtn = document.getElementById('exportJsonBtn');
    exportPdfBtn = document.getElementById('exportPdfBtn');
    clearAllBtn = document.getElementById('clearAllBtn');
    deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    clearCacheBtn = document.getElementById('clearCacheBtn');
    darkModeToggle = document.getElementById('darkModeToggle');
    newFolderNameInput = document.getElementById('newFolderNameInput');
    createFolderButton = document.getElementById('createFolderButton');
    folderFilterDropdown = document.getElementById('folderFilterDropdown');
    moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown');
    editModal = document.getElementById('editModal');
    closeModal = document.getElementById('closeModal');
    cancelEdit = document.getElementById('cancelEdit');
    saveEdit = document.getElementById('saveEdit');
    findReplaceModal = document.getElementById('findReplaceModal');
    closeFindReplaceModal = document.getElementById('closeFindReplaceModal');
    cancelFindReplace = document.getElementById('cancelFindReplace');
    executeFindReplace = document.getElementById('executeFindReplace');
    bulkActionsPanel = document.getElementById('bulk-actions');
    selectionCountSpan = document.getElementById('selection-count');
    setupEventListeners();
    loadDarkModePreference();

    const deleteErrorLogBtn = document.getElementById('deleteErrorLogBtn');
    if (deleteErrorLogBtn) {
        deleteErrorLogBtn.addEventListener('click', async () => {
            if (confirm('API 오류 로그를 삭제하시겠습니까?')) {
                try {
                    await chrome.storage.local.remove('error_log');
                    const errorLogContainer = document.getElementById('errorLogContainer');
                    if (errorLogContainer) {
                        errorLogContainer.style.display = 'none'; // Hide the container instead of removing it
                    }
                    showToast('API 오류 로그가 삭제되었습니다.', 'success');
                } catch (error) {
                    console.error('Failed to delete error log:', error);
                    showToast('오류 로그 삭제에 실패했습니다.', 'error');
                }
            }
        });
    }

    if (createFolderButton) {
        createFolderButton.addEventListener('click', async () => {
            const folderName = newFolderNameInput.value.trim();
            if (folderName) {
                let folders = await loadFolders();
                if (!folders.includes(folderName)) {
                    folders.push(folderName);
                    await saveFolders(folders);
                    newFolderNameInput.value = '';
                    renderFolders();
                    loadAndRender();
                    showToast(`폴더 "${folderName}"가 생성되었습니다.`, 'success');
                } else {
                    showToast('이미 존재하는 폴더 이름입니다.', 'error');
                }
            } else {
                showToast('폴더 이름을 입력해주세요.', 'error');
            }
        });
    }

    loadFolders().then(folders => {
        allFolders = folders;
        renderFolders();
        loadAndRender();
    });
});

function setupEventListeners() {
    searchBox.addEventListener('input', handleSearch);
    exportJsonBtn.addEventListener('click', exportTranslationsAsJson);
    exportPdfBtn.addEventListener('click', exportToPrintableHtml);
    clearAllBtn.addEventListener('click', clearAllTranslations);
    deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    clearCacheBtn.addEventListener('click', clearTitleCache);
    darkModeToggle.addEventListener('click', toggleDarkMode);
    
    if (folderFilterDropdown) {
        folderFilterDropdown.addEventListener('change', () => { loadAndRender(); });
    }
    if (moveSelectedToFolderDropdown) {
        moveSelectedToFolderDropdown.addEventListener('change', async (event) => {
            const targetFolder = event.target.value;
            if (targetFolder) {
                await moveSelectedTranslationsToFolder(targetFolder === '폴더 없음' ? undefined : targetFolder);
                event.target.value = '';
            }
        });
    }

    historyContainer.addEventListener('click', (e) => {
        const target = e.target;

        const folderHeader = target.closest('.folder-group-header');
        if (folderHeader && !target.closest('.list-group-actions')) {
            const folderContent = folderHeader.nextElementSibling;
            const toggle = folderHeader.querySelector('.folder-group-toggle');
            if (folderContent) {
                folderContent.classList.toggle('collapsed');
                toggle.classList.toggle('collapsed');
                toggle.textContent = folderContent.classList.contains('collapsed') ? '▶' : '▼';
            }
            return;
        }

        const findReplaceBtn = target.closest('.btn-find-replace');
        if (findReplaceBtn) {
            const url = findReplaceBtn.dataset.url;
            openFindReplaceModal(url);
            return;
        }

        const applyBtn = target.closest('.btn-apply');
        if (applyBtn) {
            const url = applyBtn.dataset.url;
            toggleApplyStatus(url, applyBtn);
            return;
        }

        const editTitleBtn = target.closest('.edit-title-btn');
        if (editTitleBtn) {
            const url = editTitleBtn.dataset.url;
            const titleEl = historyContainer.querySelector(`.list-group-title[data-url="${url}"]`);
            
            if (titleEl.isContentEditable) return;

            const originalTitle = titleEl.textContent;
            titleEl.contentEditable = 'true';
            titleEl.focus();
            titleEl.style.borderBottom = '1px solid var(--primary-color)';
            titleEl.style.padding = '2px';
            titleEl.style.backgroundColor = 'var(--item-hover-bg)';

            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(titleEl);
            selection.removeAllRanges();
            selection.addRange(range);

            const cleanup = () => {
                titleEl.contentEditable = 'false';
                titleEl.style.borderBottom = 'none';
                titleEl.style.padding = '0';
                titleEl.style.backgroundColor = 'transparent';
                titleEl.removeEventListener('blur', handleBlur);
                titleEl.removeEventListener('keydown', handleKeydown);
            };

            const saveTitle = async () => {
                const newTitle = titleEl.textContent.trim();
                cleanup();
                if (newTitle && newTitle !== originalTitle) {
                    urlToTitle[url] = newTitle;
                    titleCache[url] = newTitle;
                    await chrome.storage.local.set({ titleCache });
                    showToast('제목이 수정되었습니다.', 'success');
                } else {
                    titleEl.textContent = originalTitle;
                }
            };

            const handleBlur = () => {
                saveTitle();
            };

            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveTitle();
                } else if (e.key === 'Escape') {
                    titleEl.textContent = originalTitle;
                    cleanup();
                }
            };

            titleEl.addEventListener('blur', handleBlur);
            titleEl.addEventListener('keydown', handleKeydown);
            
            return;
        }

        const groupHeader = target.closest('.list-group-header');
        if (groupHeader && !target.closest('.list-group-actions')) {
            const groupContent = groupHeader.nextElementSibling;
            const toggle = groupHeader.querySelector('.list-group-toggle');
            if (groupContent) {
                groupContent.classList.toggle('collapsed');
                toggle.classList.toggle('collapsed');
                toggle.textContent = groupContent.classList.contains('collapsed') ? '▶' : '▼';
            }
            return;
        }

        const actionButton = target.closest('.item-actions .btn');
        if (actionButton) {
            const item = target.closest('.history-item');
            const compositeKey = item.dataset.key;
            if (actionButton.classList.contains('edit-btn')) openEditModal(compositeKey);
            else if (actionButton.classList.contains('copy-btn')) copyTranslation(compositeKey);
            else if (actionButton.classList.contains('delete-btn')) deleteTranslation(compositeKey);
            else if (actionButton.classList.contains('exclude-btn')) excludeTranslation(compositeKey);
            return;
        }

    });

    historyContainer.addEventListener('change', (e) => {
        const target = e.target;
        if (target.type === 'checkbox') { // 모든 체크박스 이벤트를 여기서 처리
            if (target.classList.contains('group-select-all-checkbox')) {
                const group = target.closest('.list-group');
                if (group) {
                    const itemCheckboxes = group.querySelectorAll('.item-checkbox');
                    itemCheckboxes.forEach(checkbox => { checkbox.checked = target.checked; });
                }
            } else if (target.classList.contains('folder-select-all-checkbox')) {
                const folderGroup = target.closest('.history-folder-group');
                if (folderGroup) {
                    const itemCheckboxes = folderGroup.querySelectorAll('.item-checkbox');
                    itemCheckboxes.forEach(checkbox => { checkbox.checked = target.checked; });
                }
            }
            updateBulkActionPanel();
        
        } else if (target.classList.contains('item-folder-assign-dropdown')) {
            const compositeKey = target.dataset.key;
            const newFolderName = target.value === '폴더 없음' ? undefined : target.value;
            assignFolderToSingleTranslation(compositeKey, newFolderName);
            showToast(`번역 기록이 폴더 '${newFolderName || '폴더 없음'}'(으)로 이동되었습니다.`, 'success');
        }
    });

    closeModal.addEventListener('click', () => editModal.style.display = 'none');
    cancelEdit.addEventListener('click', () => editModal.style.display = 'none');
    saveEdit.addEventListener('click', saveEditedTranslation);

    document.getElementById('openGlobalFindReplaceBtn').addEventListener('click', () => openFindReplaceModal(null));
    closeFindReplaceModal.addEventListener('click', closeFindReplaceModalHandler);
    cancelFindReplace.addEventListener('click', closeFindReplaceModalHandler);
    executeFindReplace.addEventListener('click', executeFindReplaceHandler);

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            const hasDataChanges = Object.keys(changes).some(key => 
                key.startsWith('http') || 
                key === FOLDERS_STORAGE_KEY ||
                key === 'error_log' ||
                key === 'titleCache' ||
                key === 'darkMode'
            );
            if (hasDataChanges) {
                loadAndRender();
            }
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            loadAndRender();
        }
    });
}
async function loadAndRender() {
    const progressContainer = document.getElementById('progress-container');
    if(progressContainer) {
        progressContainer.textContent = '번역 기록을 불러오는 중...';
        progressContainer.style.display = 'block';
    }

    const loadingSkeleton = document.getElementById('loading-skeleton');

    if (!loadingSkeleton || !emptyState || !historyContainer) {
        console.error('loadAndRender: 필수 DOM 요소를 찾을 수 없습니다.');
        return;
    }

    loadingSkeleton.style.display = 'block';
    emptyState.style.display = 'none';
    historyContainer.innerHTML = '';

    const allData = await chrome.storage.local.get(null);
    titleCache = allData.titleCache || {};
    
    const flattened = [];
    const urls = [];
    const groupedByFolder = {};
    allFolders.forEach(folder => { groupedByFolder[folder] = {}; });
    groupedByFolder['폴더 없음'] = {};

    const dataEntries = Object.entries(allData);
    const totalEntries = dataEntries.length;
    let processedEntries = 0;

    for (const [key, value] of dataEntries) {
        processedEntries++;
        if (processedEntries % 10 === 0 || processedEntries === totalEntries) {
            const percentage = Math.round((processedEntries / totalEntries) * 100);
            if(progressContainer) progressContainer.textContent = `데이터 처리 중... ${percentage}%`;
        }

        if (key.startsWith('http') && Array.isArray(value)) {
            urls.push(key);
            value.forEach(translation => {
                const folderName = translation.folderName || '폴더 없음';
                if (!groupedByFolder[folderName]) {
                    groupedByFolder[folderName] = {};
                }
                if (!groupedByFolder[folderName][key]) {
                    groupedByFolder[folderName][key] = [];
                }
                const compositeKey = `${key}|${translation.pid || translation.hash}`;
                const enrichedTranslation = { url: key, ...translation, compositeKey };
                groupedByFolder[folderName][key].push(enrichedTranslation);
                flattened.push(enrichedTranslation);
            });
        }
    }

    allTranslations = flattened.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (urls.length > 0) {
        showToast('페이지 제목을 불러오는 중...', 'info');
    }
    await fetchTitles(urls);
    loadingSkeleton.style.display = 'none';
    
    renderGroupedView(groupedByFolder, historyContainer, emptyState, allData);
    updateStats();
    updateBulkActionPanel();
    renderFolders();

    if (allData.error_log && allData.error_log.length > 0) {
        renderErrorLog(allData.error_log);
    }
    if(progressContainer) progressContainer.style.display = 'none';
    showToast('로드 완료', 'success');
}

async function fetchTitles(urls) {
    const urlsToFetch = urls.filter(url => !titleCache[url]);
    const titlePromises = urlsToFetch.map(url =>
        chrome.runtime.sendMessage({ action: 'fetchTitle', url: url })
            .then(response => { titleCache[url] = (response && response.title) ? response.title : url; })
            .catch(() => { titleCache[url] = url; })
    );
    if (urlsToFetch.length > 0) {
        await Promise.all(titlePromises);
        await chrome.storage.local.set({ titleCache });
    }
    urls.forEach(url => { urlToTitle[url] = titleCache[url] || url; });
}

function renderGroupedView(groupedByFolder, container, emptyState, allData) {
    const hasAnyTranslations = Object.values(groupedByFolder).some(folder => Object.keys(folder).length > 0);
    if (!hasAnyTranslations) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }
    emptyState.style.display = 'none';
    container.innerHTML = '';

    const sortedFolderNames = [...allFolders, '폴더 없음'].filter(name => groupedByFolder[name] && Object.keys(groupedByFolder[name]).length > 0);

    for (const folderName of sortedFolderNames) {
        const folderGroupEl = document.createElement('div');
        folderGroupEl.className = 'history-folder-group';
        
        const urlsInFolder = Object.keys(groupedByFolder[folderName]).sort((a, b) => {
            const lastTimeA = Math.max(...groupedByFolder[folderName][a].map(t => t.timestamp || 0));
            const lastTimeB = Math.max(...groupedByFolder[folderName][b].map(t => t.timestamp || 0));
            return lastTimeB - lastTimeA;
        });

        let urlGroupsHtml = '';
        for (const url of urlsInFolder) {
            const translations = groupedByFolder[folderName][url];
            const title = urlToTitle[url] || url;
            const status = allData['status-' + url] || {};
            const isApplied = status.applied;
            const groupItemsHtml = translations.map(t => renderItem(t)).join('');

            urlGroupsHtml += `
                <div class="list-group fade-in" data-url="${url}">
                    <div class="list-group-header">
                        <span class="list-group-toggle collapsed">▶</span>
                        <a href="${url}" target="_blank" class="list-group-title-link"><h3 class="list-group-title" data-url="${url}">${escapeHtml(title)} (${translations.length})</h3></a>
                        <button class="btn btn-outline btn-icon edit-title-btn" data-url="${url}" title="제목 수정">✏️</button>
                        <div class="list-group-actions">
                            <button class="btn btn-secondary btn-apply ${isApplied ? 'applied' : ''}" data-url="${url}">${isApplied ? '적용 해제' : '페이지에 적용'}</button>
                            <button class="btn btn-secondary btn-find-replace" data-url="${url}">찾아 바꾸기</button>
                            <label><input type="checkbox" class="group-select-all-checkbox"> 전체 선택</label>
                        </div>
                    </div>
                    <div class="list-group-content collapsed">
                        <table class="history-table">
                            <thead>
                                <tr>
                                    <th style="width: 40px;"></th>
                                    <th>원문</th>
                                    <th>번역</th>
                                    <th style="width: 120px;">액션</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${groupItemsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        folderGroupEl.innerHTML = `
            <div class="folder-group-header">
                <span class="folder-group-toggle collapsed">▶</span>
                <h2 class="folder-group-title">${escapeHtml(folderName)}</h2>
                <div class="list-group-actions">
                    <label style="margin-left: auto;"><input type="checkbox" class="folder-select-all-checkbox" data-folder-name="${escapeHtml(folderName)}"> 전체 선택</label>
                </div>
            </div>
            <div class="folder-group-content collapsed">
                ${urlGroupsHtml}
            </div>
        `;
        container.appendChild(folderGroupEl);
    }
}

function renderItem(t) {
    const date = t.timestamp ? new Date(t.timestamp) : new Date();
    const dateStr = date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });

    return `
        <tr class="history-item" data-key="${t.compositeKey}">
            <td>
                <input type="checkbox" class="item-checkbox" data-key="${t.compositeKey}">
            </td>
            <td>
                <div class="item-text-block">
                    <div class="text-label">원문 (ID: ${t.pid || 'N/A'})</div>
                    <div class="text-content">${escapeHtml(t.original)}</div>
                </div>
            </td>
            <td>
                <div class="item-text-block">
                    <div class="text-label">번역</div>
                    <div class="text-content">${escapeHtml(t.translated)}</div>
                </div>
            </td>
            <td class="item-actions-container">
                <div class="item-date">${dateStr}</div>
                <div class="item-actions">
                    <button class="btn btn-outline edit-btn" title="수정">✏️</button>
                    <button class="btn btn-outline copy-btn" title="복사">📋</button>
                    <button class="btn btn-outline exclude-btn" title="제외">🚫</button>
                    <button class="btn btn-outline delete-btn" title="삭제">🗑️</button>
                </div>
            </td>
        </tr>
    `;
}

function handleSearch() {
    const query = searchBox.value.toLowerCase().trim();
    document.querySelectorAll('.list-group').forEach(group => {
        let hasVisibleItemsInGroup = false;
        const groupTitle = group.querySelector('.list-group-title').textContent.toLowerCase();

        group.querySelectorAll('.history-item').forEach(item => {
            const originalText = item.querySelector('.item-text-block:first-child .text-content').textContent.toLowerCase();
            const translatedText = item.querySelector('.item-text-block:last-child .text-content').textContent.toLowerCase();
            const isVisible = originalText.includes(query) || translatedText.includes(query);
            item.style.display = isVisible ? '' : 'none';
            if (isVisible) hasVisibleItemsInGroup = true;
        });

        group.style.display = (hasVisibleItemsInGroup || groupTitle.includes(query)) ? '' : 'none';
    });
}

function updateStats() {
    document.getElementById('totalCount').textContent = allTranslations.length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    document.getElementById('todayCount').textContent = allTranslations.filter(t => t.timestamp && new Date(t.timestamp) >= today).length;
    document.getElementById('avgLength').textContent = allTranslations.length > 0 ? Math.round(allTranslations.reduce((sum, t) => sum + (t.original || '').length, 0) / allTranslations.length) : 0;
}

function updateStats() {
    document.getElementById('totalCount').textContent = allTranslations.length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    document.getElementById('todayCount').textContent = allTranslations.filter(t => t.timestamp && new Date(t.timestamp) >= today).length;
    document.getElementById('avgLength').textContent = allTranslations.length > 0 ? Math.round(allTranslations.reduce((sum, t) => sum + (t.original || '').length, 0) / allTranslations.length) : 0;
}

function updateBulkActionPanel() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    const panel = document.getElementById('bulk-actions');
    const countSpan = document.getElementById('selection-count');
    const moveDropdown = document.getElementById('moveSelectedToFolderDropdown');
    const deleteButton = document.getElementById('deleteSelectedBtn');

    if (checkedItems.length > 0) {
        panel.style.display = 'flex';
        countSpan.textContent = `${checkedItems.length}개 항목 선택됨`;
        moveDropdown.disabled = false;
        deleteButton.disabled = false;
    } else {
        panel.style.display = 'none';
        countSpan.textContent = '선택된 항목 없음';
        moveDropdown.disabled = true;
        deleteButton.disabled = true;
    }
}

async function deleteSelectedTranslations() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    if (checkedItems.length === 0) return;
    if (!confirm(`${checkedItems.length}개의 번역을 삭제하시겠습니까?`)) return;
    
    const itemsToDelete = {};
    checkedItems.forEach(item => {
        const [url, id] = item.dataset.key.split('|');
        if (!itemsToDelete[url]) itemsToDelete[url] = new Set();
        itemsToDelete[url].add(id);
    });

    for (const url in itemsToDelete) {
        const result = await chrome.storage.local.get(url);
        const updated = (result[url] || []).filter(t => !itemsToDelete[url].has(t.pid || t.hash));
        if (updated.length > 0) {
            await chrome.storage.local.set({ [url]: updated });
        } else {
            await chrome.storage.local.remove(url);
        }
    }
    loadAndRender();
    showToast(`${checkedItems.length}개의 번역이 삭제되었습니다.`, 'success');
}

async function clearAllTranslations() {
    if (!confirm('모든 번역 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    await chrome.storage.local.clear();
    loadAndRender();
    showToast('모든 번역 기록이 삭제되었습니다.', 'success');
}

async function clearTitleCache() {
    await chrome.storage.local.remove('titleCache');
    showToast('제목 캐시가 초기화되었습니다. 페이지를 새로고침하세요.', 'info');
}

async function copyTranslation(compositeKey) {
    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (translation) {
        await navigator.clipboard.writeText(translation.translated);
        showToast('번역이 클립보드에 복사되었습니다!', 'success');
    }
}

async function deleteTranslation(compositeKey, skipConfirm = false) {
    if (!skipConfirm && !confirm('이 번역을 삭제하시겠습니까?')) return;
    const [url, id] = compositeKey.split('|');
    if (!url || !id) return;
    try {
        const result = await chrome.storage.local.get(url);
        let translations = result[url] || [];
        const updatedTranslations = translations.filter(t => (t.pid || t.hash) !== id);
        if (updatedTranslations.length > 0) {
            await chrome.storage.local.set({ [url]: updatedTranslations });
        } else {
            await chrome.storage.local.remove(url);
        }
        if (!skipConfirm) {
            showToast('번역이 삭제되었습니다.', 'success');
        }
        // The view will be re-rendered by the storage listener, so no need to call loadAndRender()
    } catch (error) {
        console.error('Delete failed:', error);
        showToast('삭제에 실패했습니다.', 'error');
    }
}

async function excludeTranslation(compositeKey) {
    if (!confirm('이 문장을 번역에서 영구적으로 제외하시겠습니까? 제외된 문장은 다시 번역되지 않습니다.')) return;

    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (!translation) {
        showToast('제외할 항목을 찾지 못했습니다.', 'error');
        return;
    }

    const { url, original } = translation;

    try {
        const result = await chrome.storage.local.get('excluded_sentences');
        const excludedDb = result.excluded_sentences || {};
        
        const exclusionListForUrl = excludedDb[url] || [];
        if (!exclusionListForUrl.includes(original)) {
            exclusionListForUrl.push(original);
            excludedDb[url] = exclusionListForUrl;
            await chrome.storage.local.set({ excluded_sentences: excludedDb });
        }

        // Now delete the item from the history view, skipping confirmation
        await deleteTranslation(compositeKey, true); 
        showToast('문장이 번역에서 제외되었습니다.', 'success');

    } catch (error) {
        console.error('Failed to exclude sentence:', error);
        showToast('문장 제외 처리에 실패했습니다.', 'error');
    }
}

async function toggleApplyStatus(url, button) {
    const statusKey = 'status-' + url;
    try {
        const result = await chrome.storage.local.get(statusKey);
        const currentStatus = result[statusKey] || {};
        const newStatus = { applied: !currentStatus.applied, timestamp: Date.now() };
        await chrome.storage.local.set({ [statusKey]: newStatus });
        button.textContent = newStatus.applied ? '적용 해제' : '페이지에 적용';
        button.classList.toggle('applied', newStatus.applied);
        showToast(newStatus.applied ? '설정 완료: 이제 해당 페이지에서 번역이 적용됩니다.' : '설정 해제: 페이지에서 더 이상 번역이 적용되지 않습니다.');
    } catch (error) {
        console.error('Failed to toggle apply status:', error);
        showToast('상태 변경에 실패했습니다.', 'error');
    }
}

function openEditModal(compositeKey) {
    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (!translation) {
        showToast('수정할 번역을 찾을 수 없습니다.', 'error');
        return;
    }

    currentEditInfo = {
        compositeKey: compositeKey,
        url: translation.url,
        id: translation.pid || translation.hash
    };

    document.getElementById('editOriginal').value = translation.original;
    document.getElementById('editTranslated').value = translation.translated;
    editModal.style.display = 'flex';
}

async function saveEditedTranslation() {
    if (!currentEditInfo) {
        showToast('수정할 정보가 없습니다.', 'error');
        return;
    }

    const { url, id } = currentEditInfo;
    const newTranslatedText = document.getElementById('editTranslated').value;

    try {
        const result = await chrome.storage.local.get(url);
        const translations = result[url] || [];
        let found = false;
        const updatedTranslations = translations.map(t => {
            if ((t.pid || t.hash) === id) {
                t.translated = newTranslatedText;
                found = true;
            }
            return t;
        });

        if (found) {
            await chrome.storage.local.set({ [url]: updatedTranslations });
            showToast('번역이 성공적으로 수정되었습니다.', 'success');
        } else {
            showToast('저장할 번역을 찾지 못했습니다.', 'error');
        }
    } catch (error) {
        console.error('번역 수정 중 오류 발생:', error);
        showToast('번역 수정에 실패했습니다.', 'error');
    } finally {
        editModal.style.display = 'none';
        currentEditInfo = null;
        // loadAndRender() will be called automatically by the storage listener
    }
}

function openFindReplaceModal(url) {
    currentFindReplaceUrl = url;
    document.getElementById('findText').value = '';
    document.getElementById('replaceText').value = '';
    findReplaceModal.style.display = 'flex';
    document.getElementById('findText').focus();
}

function closeFindReplaceModalHandler() {
    findReplaceModal.style.display = 'none';
    currentFindReplaceUrl = null;
}

async function executeFindReplaceHandler() {
    const find = document.getElementById('findText').value;
    const replace = document.getElementById('replaceText').value;
    const url = currentFindReplaceUrl;

    if (!find) {
        showToast('찾을 내용을 입력하세요.', 'error');
        return;
    }

    // Global find and replace
    if (url === null) {
        if (!confirm(`모든 번역 기록에서 '${find}'을(를) '${replace}'(으)로 바꾸시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
        
        try {
            let totalModifiedCount = 0;
            const allData = await chrome.storage.local.get(null);
            const findRegex = new RegExp(find.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');

            for (const key in allData) {
                if (key.startsWith('http') && Array.isArray(allData[key])) {
                    let modifiedInThisUrl = false;
                    allData[key].forEach(t => {
                        if (t.translated && t.translated.includes(find)) {
                            t.translated = t.translated.replace(findRegex, replace);
                            totalModifiedCount++;
                            modifiedInThisUrl = true;
                        }
                    });
                    if (modifiedInThisUrl) {
                        await chrome.storage.local.set({ [key]: allData[key] });
                    }
                }
            }

            if (totalModifiedCount > 0) {
                showToast(`총 ${totalModifiedCount}개 항목에서 단어를 교체했습니다.`, 'success');
            } else {
                showToast('교체할 단어를 찾지 못했습니다.', 'info');
            }
        } catch (error) {
            console.error('Global find and replace failed:', error);
            showToast('전체 찾아 바꾸기에 실패했습니다.', 'error');
        }

    // URL-specific find and replace
    } else {
        if (!confirm(`'${urlToTitle[url] || url}'의 모든 번역에서 '${find}'을(를) '${replace}'(으)로 바꾸시겠습니까?`)) return;
        
        try {
            const result = await chrome.storage.local.get(url);
            let translations = result[url] || [];
            let modifiedCount = 0;
            const findRegex = new RegExp(find.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
            
            translations.forEach(t => {
                if (t.translated && t.translated.includes(find)) {
                    t.translated = t.translated.replace(findRegex, replace);
                    modifiedCount++;
                }
            });

            if (modifiedCount > 0) {
                await chrome.storage.local.set({ [url]: translations });
                showToast(`${modifiedCount}개 항목에서 단어를 교체했습니다.`, 'success');
            } else {
                showToast('교체할 단어를 찾지 못했습니다.', 'info');
            }
        } catch (error) {
            console.error('Find and replace failed:', error);
            showToast('찾아 바꾸기에 실패했습니다.', 'error');
        }
    }

    closeFindReplaceModalHandler();
    // The view will auto-reload due to the storage listener
}

function exportTranslationsAsJson() {
    if (allTranslations.length === 0) {
        showToast('내보낼 번역이 없습니다.', 'error');
        return;
    }
    const exportData = allTranslations.map(t => ({
        PID: t.pid,
        원문: t.original,
        번역: t.translated,
        URL: t.url,
        폴더: t.folderName || '폴더 없음',
        날짜: new Date(t.timestamp || 0).toLocaleString('ko-KR')
    }));
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `translation-history-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showToast('번역 기록이 내보내졌습니다!', 'success');
}

function exportToPrintableHtml() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    if (checkedItems.length === 0) {
        showToast('내보낼 항목을 선택해주세요.', 'error');
        return;
    }

    const selected = allTranslations.filter(t => 
        Array.from(checkedItems).some(c => c.dataset.key === t.compositeKey)
    );

    const grouped = selected.reduce((acc, t) => {
        if (!acc[t.url]) acc[t.url] = [];
        acc[t.url].push(t);
        return acc;
    }, {});

    let bodyContent = '';
    for (const url in grouped) {
        const title = urlToTitle[url] || url;
        bodyContent += `<h2>${escapeHtml(title)}</h2>`;
        bodyContent += '<table class="translation-table">';
        bodyContent += '<thead><tr><th>원문</th><th>번역</th></tr></thead><tbody>';
        grouped[url].forEach(t => {
            bodyContent += `<tr><td>${escapeHtml(t.original)}</td><td>${escapeHtml(t.translated)}</td></tr>`;
        });
        bodyContent += '</tbody></table>';
    }

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>번역 내보내기</title><style>body{font-family:sans-serif;margin:40px;}h2{border-bottom:1px solid #ccc;padding-bottom:10px;margin-top:40px;}table{width:100%;border-collapse:collapse;margin-top:20px;}th,td{border:1px solid #ddd;padding:8px;text-align:left;vertical-align:top;}th{background-color:#f2f2f2;}@media print{.print-btn{display:none;}}</style></head><body><button class="print-btn" onclick="window.print()">인쇄 (PDF로 저장)</button>${bodyContent}</body></html>`;

    const newTab = window.open();
    newTab.document.open();
    newTab.document.write(html);
    newTab.document.close();
}

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"'']/g, m => map[m]);
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        background: ${type === 'error' ? '#e53e3e' : (type === 'info' ? '#3182ce' : '#48bb78')}; color: white;
        padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
        z-index: 1001; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        transform: translateX(100%); transition: transform 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.transform = 'translateX(0)'; }, 100);
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function naturalSort(a, b) {
    const re = /(\d+)/g;
    const aParts = a.toString().split(re);
    const bParts = b.toString().split(re);
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];
        if (i % 2) {
            const aNum = parseInt(aPart, 10);
            const bNum = parseInt(bPart, 10);
            if (aNum !== bNum) return aNum - bNum;
        } else {
            if (aPart !== bPart) return aPart.localeCompare(bPart);
        }
    }
    return a.length - b.length;
}



// 선택된 번역 기록들을 지정된 폴더로 이동
async function moveSelectedTranslationsToFolder(folderName) {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    if (checkedItems.length === 0) {
        showToast('이동할 번역 기록을 선택해주세요.', 'info');
        return;
    }
    if (!confirm(`${checkedItems.length}개의 번역 기록을 폴더 '${folderName || '폴더 없음'}'(으)로 이동하시겠습니까?`)) {
        return;
    }

    const itemsToUpdate = {}; // { url: [id1, id2, ...], ... }
    checkedItems.forEach(item => {
        const [url, id] = item.dataset.key.split('|');
        if (!itemsToUpdate[url]) itemsToUpdate[url] = [];
        itemsToUpdate[url].push(id);
    });

    try {
        let totalMovedCount = 0;
        for (const url in itemsToUpdate) {
            const idsToUpdate = new Set(itemsToUpdate[url]);
            const result = await chrome.storage.local.get(url);
            let translations = result[url] || [];
            let changed = false;
            translations = translations.map(t => {
                if (idsToUpdate.has(t.pid || t.hash)) {
                    if (t.folderName !== folderName) {
                        t.folderName = folderName;
                        changed = true;
                        totalMovedCount++;
                    }
                }
                return t;
            });
            if (changed) {
                await chrome.storage.local.set({ [url]: translations });
            }
        }
        await loadAndRender(); // 변경 사항 반영을 위해 새로고침
        showToast(`${totalMovedCount}개의 번역 기록이 폴더 '${folderName || '폴더 없음'}'(으)로 이동되었습니다.`, 'success');
    } catch (error) {
        console.error('Failed to move selected translations:', error);
        showToast('선택 항목 이동에 실패했습니다.', 'error');
    }
}

// =================================================================================
// Folder Management Functions (새로운 섹션 추가)
// =================================================================================

// 폴더 목록 불러오기
async function loadFolders() {
    const result = await chrome.storage.local.get(FOLDERS_STORAGE_KEY);
    return result[FOLDERS_STORAGE_KEY] || [];
}

// 폴더 목록 저장하기
async function saveFolders(folders) {
    await chrome.storage.local.set({ [FOLDERS_STORAGE_KEY]: folders });
}

// 폴더 목록 렌더링
function renderFolders() {
    const folderListDiv = document.getElementById('folderList');
    const folderFilterDropdown = document.getElementById('folderFilterDropdown');
    const moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown');
    if (!folderListDiv || !folderFilterDropdown || !moveSelectedToFolderDropdown) return; // 요소가 없으면 리턴

    folderListDiv.innerHTML = ''; // 기존 목록 지우기
    folderFilterDropdown.innerHTML = '<option value="">모든 폴더</option>'; // 필터 드롭다운 초기화
    moveSelectedToFolderDropdown.innerHTML = '<option value="">선택 항목 폴더에 이동</option>'; // 선택 이동 드롭다운 초기화

    if (allFolders.length === 0) {
        folderListDiv.innerHTML = '<p style="color: var(--text-secondary);">생성된 폴더가 없습니다.</p>';
        return;
    }

    allFolders.forEach(folderName => {
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        folderItem.innerHTML = `
            <span>${escapeHtml(folderName)}</span>
            <div class="folder-controls">
                <button class="delete-folder-btn" data-folder-name="${escapeHtml(folderName)}">삭제</button>
            </div>
        `;
        folderListDiv.appendChild(folderItem);

        const filterOption = document.createElement('option');
        filterOption.value = folderName;
        filterOption.textContent = folderName;
        folderFilterDropdown.appendChild(filterOption);

        const moveOption = document.createElement('option');
        moveOption.value = folderName;
        moveOption.textContent = folderName;
        moveSelectedToFolderDropdown.appendChild(moveOption);
    });

    folderListDiv.querySelectorAll('.delete-folder-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
            const folderToDelete = event.target.dataset.folderName;
            if (confirm(`정말로 폴더 "${folderToDelete}"를 삭제하시겠습니까? 이 폴더에 할당된 번역 기록은 "폴더 없음"으로 변경됩니다.`)) {
                allFolders = allFolders.filter(name => name !== folderToDelete);
                await saveFolders(allFolders);
                
                await removeFolderFromTranslations(folderToDelete);

                renderFolders();
                loadAndRender();
                showToast(`폴더 "${folderToDelete}"가 삭제되었습니다.`, 'success');
            }
        });
    });
}

// 번역 기록에서 폴더 정보 제거 (폴더 삭제 시 호출)
async function removeFolderFromTranslations(folderName) {
    const allData = await chrome.storage.local.get(null);
    for (const url in allData) {
        if (url === 'apiKey' || url.startsWith('status-') || url.startsWith('excluded_sentences') || url.startsWith('error_log') || url === FOLDERS_STORAGE_KEY || url === 'titleCache') {
            continue;
        }
        let translations = allData[url];
        if (Array.isArray(translations)) {
            let changed = false;
            translations = translations.map(t => {
                if (t.folderName === folderName) {
                    delete t.folderName;
                    changed = true;
                }
                return t;
            });
            if (changed) {
                await chrome.storage.local.set({ [url]: translations });
            }
        }
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDarkMode = document.body.classList.contains('dark-mode');
    chrome.storage.local.set({ darkMode: isDarkMode });
    updateDarkModeToggleIcon(isDarkMode);
}

async function loadDarkModePreference() {
    const result = await chrome.storage.local.get('darkMode');
    const isDarkMode = result.darkMode;
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
    }
    updateDarkModeToggleIcon(isDarkMode);
}

function updateDarkModeToggleIcon(isDarkMode) {
    const toggleButton = document.getElementById('darkModeToggle');
    if (toggleButton) {
        toggleButton.innerHTML = `<span class="material-icons">${isDarkMode ? 'light_mode' : 'dark_mode'}</span>`;
    }
}

function naturalSort(a, b) {
    const re = /(\d+)/g;
    const aParts = a.toString().split(re);
    const bParts = b.toString().split(re);
    for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
        const aPart = aParts[i];
        const bPart = bParts[i];
        if (i % 2) {
            const aNum = parseInt(aPart, 10);
            const bNum = parseInt(bPart, 10);
            if (aNum !== bNum) return aNum - bNum;
        } else {
            if (aPart !== bPart) return aPart.localeCompare(bPart);
        }
    }
    return a.length - b.length;
}