// =================================================================================
// Globals
// =================================================================================

let allTranslations = [];
let groupedTranslations = {};
let urlToTitle = {};
let titleCache = {};
let currentEditInfo = null;
let currentFindReplaceUrl = null;

// =================================================================================
// DOM Elements
// =================================================================================

const historyGrid = document.getElementById('historyGrid');
const emptyState = document.getElementById('emptyState');
const searchBox = document.getElementById('searchBox');
const exportBtn = document.getElementById('exportBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const clearCacheBtn = document.getElementById('clearCacheBtn');
const editModal = document.getElementById('editModal');
const findReplaceModal = document.getElementById('findReplaceModal');
const openGlobalFindReplaceBtn = document.getElementById('openGlobalFindReplaceBtn');

// =================================================================================
// Initialization
// =================================================================================

document.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    setupEventListeners();
    loadAndRender();
});

function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .history-group { margin-bottom: 1.5rem; border: 1px solid #e0e0e0; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .group-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background-color: #f7f7f7; border-bottom: 1px solid #e0e0e0; border-top-left-radius: 8px; border-top-right-radius: 8px; cursor: pointer; }
        .group-header:hover { background-color: #eff3f8; }
        .group-title-container { flex-grow: 1; margin: 0 15px; min-width: 0; }
        .group-title { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .group-url-details { font-size: 12px; }
        .group-url-details summary { cursor: pointer; display: inline-block; margin-top: 4px; color: #555; }
        .group-url { word-break: break-all; color: #777; margin-top: 4px; }
        .group-header-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .group-toggle-btn { background: none; border: none; font-size: 18px; cursor: pointer; padding: 0 5px; transition: transform 0.2s; }
        .group-toggle-btn.collapsed { transform: rotate(-90deg); }
        .group-item-container { padding: 16px; }
        .group-item-container.collapsed { display: none; }
        .btn-apply, .btn-find-replace { padding: 6px 12px; font-size: 12px; color: white; border: none; border-radius: 6px; cursor: pointer; transition: background-color 0.2s; }
        .btn-apply { background-color: #3182ce; }
        .btn-apply:hover { background-color: #2c5282; }
        .btn-apply.applied { background-color: #c53030; }
        .btn-apply.applied:hover { background-color: #9b2c2c; }
        .btn-find-replace { background-color: #ed8936; }
        .btn-find-replace:hover { background-color: #dd6b20; }
        .group-select-all { display: flex; align-items: center; font-size: 12px; color: #555; }
        .history-item { display: flex; border-bottom: 1px solid #f0f0f0; padding-bottom: 1rem; margin-bottom: 1rem; }
        .history-item:last-child { border-bottom: none; margin-bottom: 0; }
        .item-checkbox-container { padding: 8px 16px 0 0; }
        .item-content-container { flex-grow: 1; }
        .hidden { display: none; }
    `;
    document.head.appendChild(style);
}

function setupEventListeners() {
    searchBox.addEventListener('input', handleSearch);
    exportBtn.addEventListener('click', exportTranslations);
    clearAllBtn.addEventListener('click', clearAllTranslations);
    deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    clearCacheBtn.addEventListener('click', clearTitleCache);
    openGlobalFindReplaceBtn.addEventListener('click', () => openFindReplaceModal(null));

    const closeModal = document.getElementById('closeModal');
    const cancelEdit = document.getElementById('cancelEdit');
    const saveEdit = document.getElementById('saveEdit');
    closeModal.addEventListener('click', () => editModal.style.display = 'none');
    cancelEdit.addEventListener('click', () => editModal.style.display = 'none');
    saveEdit.addEventListener('click', saveEditedTranslation);

    const closeFindReplaceModal = document.getElementById('closeFindReplaceModal');
    const cancelFindReplace = document.getElementById('cancelFindReplace');
    const executeFindReplace = document.getElementById('executeFindReplace');
    closeFindReplaceModal.addEventListener('click', closeFindReplaceModalHandler);
    cancelFindReplace.addEventListener('click', closeFindReplaceModalHandler);
    executeFindReplace.addEventListener('click', executeFindReplaceHandler);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (editModal.style.display === 'flex') editModal.style.display = 'none';
            if (findReplaceModal.style.display === 'flex') closeFindReplaceModalHandler();
        }
    });

    historyGrid.addEventListener('click', (e) => {
        const target = e.target;

        if (target.classList.contains('edit-title-btn')) {
            const url = target.dataset.url;
            const titleEl = historyGrid.querySelector(`.group-title[data-url="${url}"]`);
            
            // Prevent re-triggering if already in edit mode
            if (titleEl.isContentEditable) return;

            const originalTitle = titleEl.textContent;
            titleEl.contentEditable = 'true';
            titleEl.focus();
            titleEl.style.borderBottom = '1px solid #3182ce';
            titleEl.style.padding = '2px 4px';
            titleEl.style.backgroundColor = '#f0f5ff';

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
                    showToast('제목이 수정되었습니다.');
                    // Update title attribute for hover
                    titleEl.title = newTitle;
                } else {
                    titleEl.textContent = originalTitle; // Revert if empty
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
                    titleEl.textContent = originalTitle; // Revert on escape
                    saveTitle();
                }
            };

            titleEl.addEventListener('blur', handleBlur);
            titleEl.addEventListener('keydown', handleKeydown);
            
            return;
        }

        // Handle error log deletion
        if (target.id === 'deleteErrorLogBtn') {
            (async () => {
                if (confirm('API 오류 로그를 삭제하시겠습니까?')) {
                    try {
                        await chrome.storage.local.remove('error_log');
                        document.getElementById('errorLogContainer').remove();
                        showToast('API 오류 로그가 삭제되었습니다.');
                    } catch (error) {
                        console.error('Failed to delete error log:', error);
                        showToast('오류 로그 삭제에 실패했습니다.', 'error');
                    }
                }
            })();
            return;
        }

        const groupHeader = target.closest('.group-header');

        if (target.classList.contains('group-toggle-btn') || (groupHeader && !target.closest('.group-header-actions') && !target.closest('details'))) {
            const group = target.closest('.history-group');
            const container = group.querySelector('.group-item-container');
            const toggleBtn = group.querySelector('.group-toggle-btn');
            container.classList.toggle('collapsed');
            toggleBtn.classList.toggle('collapsed');
            toggleBtn.textContent = container.classList.contains('collapsed') ? '▶' : '▼';
            return;
        }

        if (target.classList.contains('action-btn')) {
            const item = target.closest('.history-item');
            const compositeKey = item.dataset.key;
            if (target.classList.contains('edit-btn')) openEditModal(compositeKey);
            else if (target.classList.contains('copy-btn')) copyTranslation(compositeKey);
            else if (target.classList.contains('exclude-btn')) excludeTranslation(compositeKey);
            else if (target.classList.contains('delete-btn')) deleteTranslation(compositeKey);
        } else if (target.classList.contains('btn-apply')) {
            const url = target.dataset.url;
            toggleApplyStatus(url, target);
        } else if (target.classList.contains('btn-find-replace')) {
            const url = target.dataset.url;
            openFindReplaceModal(url);
        }
    });

    historyGrid.addEventListener('change', (e) => {
        if (e.target.classList.contains('group-select-all-checkbox')) {
            const group = e.target.closest('.history-group');
            const items = group.querySelectorAll('.item-checkbox');
            items.forEach(checkbox => checkbox.checked = e.target.checked);
        }
        updateDeleteButtonVisibility();
    });
}

async function loadAndRender() {
    try {
        const allData = await chrome.storage.local.get(null);

        // Handle error logs
        if (allData.error_log && allData.error_log.length > 0) {
            renderErrorLog(allData.error_log);
            showToast(`${allData.error_log.length}개의 API 오류 로그가 있습니다.`, 'info');
        }

        titleCache = allData.titleCache || {};
        const flattened = [];
        groupedTranslations = {};
        const urls = [];
        for (const [key, value] of Object.entries(allData)) {
            if (key.startsWith('http') && Array.isArray(value)) {
                urls.push(key);
                const validTranslations = value.filter(t => t.pid || t.hash);
                if (validTranslations.length > 0) {
                    validTranslations.sort((a, b) => naturalSort(a.pid || 'z', b.pid || 'z'));
                    groupedTranslations[key] = validTranslations;
                }
                validTranslations.forEach(translation => {
                    flattened.push({ url: key, ...translation, compositeKey: `${key}|${translation.pid || translation.hash}` });
                });
            }
        }
        allTranslations = flattened.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        await fetchTitles(urls);
        renderGroupedView(allData);
        updateStats();
        updateDeleteButtonVisibility();
    } catch (error) {
        console.error('Failed to load translations:', error);
        showToast('번역 기록을 불러오는데 실패했습니다.', 'error');
    }
}

async function fetchTitles(urls) {
    const urlsToFetch = urls.filter(url => !titleCache[url]);
    if (urlsToFetch.length > 0) {
        showToast(`${urlsToFetch.length}개의 페이지 제목을 가져오는 중...`, 'info');
    }
    const titlePromises = urlsToFetch.map(url =>
        chrome.runtime.sendMessage({ action: 'fetchTitle', url: url })
            .then(response => {
                titleCache[url] = (response && response.title) ? response.title : url;
            })
            .catch(error => {
                console.warn(`Could not fetch title for ${url}:`, error);
                titleCache[url] = url;
            })
    );
    await Promise.all(titlePromises);
    urls.forEach(url => { urlToTitle[url] = titleCache[url] || url; });
    await chrome.storage.local.set({ titleCache });
}

function renderGroupedView(allData = {}) {
    // If there are no regular translations but there is an error log, don't show empty state
    if (Object.keys(groupedTranslations).length === 0) {
        if (!document.getElementById('errorLogContainer')) {
            historyGrid.innerHTML = '';
            emptyState.style.display = 'block';
        }
        return;
    }
    emptyState.style.display = 'none';
    
    // Clear only non-error-log content
    const nonErrorGroups = historyGrid.querySelectorAll('.history-group:not(#errorLogContainer)');
    nonErrorGroups.forEach(el => el.remove());

    historyGrid.style.gridTemplateColumns = '1fr';
    const sortedUrls = Object.keys(groupedTranslations).sort((a, b) => {
        const lastTimeA = Math.max(...groupedTranslations[a].map(t => t.timestamp || 0));
        const lastTimeB = Math.max(...groupedTranslations[b].map(t => t.timestamp || 0));
        return lastTimeB - lastTimeA;
    });

    for (const url of sortedUrls) {
        const translations = groupedTranslations[url];
        const status = allData['status-' + url] || {};
        const isApplied = status.applied;
        const groupEl = document.createElement('div');
        groupEl.className = 'history-group';
        groupEl.dataset.url = url;
        const groupItemsHtml = translations.map(t => renderItem(t, url)).join('');
        groupEl.innerHTML = `
            <div class="group-header">
                <button class="group-toggle-btn">▼</button>
                <div class="group-title-container">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <p class="group-title" data-url="${url}" title="${escapeHtml(urlToTitle[url] || url)}">${escapeHtml(urlToTitle[url] || url)}</p>
                        <button class="action-btn edit-title-btn" data-url="${url}" title="제목 수정" style="padding: 2px 4px; font-size: 14px;">✏️</button>
                    </div>
                    <details class="group-url-details"><summary>URL</summary><p class="group-url">${escapeHtml(url)}</p></details>
                </div>
                <div class="group-header-actions">
                    <button class="btn-apply ${isApplied ? 'applied' : ''}" data-url="${url}">${isApplied ? '적용 해제' : '페이지에 적용'}</button>
                    <button class="btn-find-replace" data-url="${url}">찾아 바꾸기</button>
                    <label class="group-select-all"><input type="checkbox" class="group-select-all-checkbox"> 전체</label>
                </div>
            </div>
            <div class="group-item-container">${groupItemsHtml}</div>
        `;

        // 기본 상태를 '닫힘'으로 설정
        const container = groupEl.querySelector('.group-item-container');
        const toggleBtn = groupEl.querySelector('.group-toggle-btn');
        container.classList.add('collapsed');
        toggleBtn.classList.add('collapsed');
        toggleBtn.textContent = '▶';

        historyGrid.appendChild(groupEl);
    }
}

function renderItem(t, url) {
    const compositeKey = `${url}|${t.pid || t.hash}`;
    const date = t.timestamp ? new Date(t.timestamp) : new Date();
    const dateStr = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
        <div class="history-item" data-key="${compositeKey}" data-pid="${t.pid || 'N/A'}">
            <div class="item-checkbox-container"><input type="checkbox" class="item-checkbox" data-key="${compositeKey}"></div>
            <div class="item-content-container">
                <div class="item-header">
                    <div class="item-date">${dateStr}</div>
                    <div class="item-actions">
                        <button class="action-btn edit-btn" title="수정">✏️</button>
                        <button class="action-btn copy-btn" title="복사">📋</button>
                        <button class="action-btn exclude-btn" title="번역 제외">🚫</button>
                        <button class="action-btn delete-btn" title="삭제">🗑️</button>
                    </div>
                </div>
                <div class="original-text"><div class="text-label">원문 (ID: ${t.pid || 'N/A'})</div><div class="text-content">${escapeHtml(t.original)}</div></div>
                <div class="translated-text"><div class="text-label">번역 (한국어)</div><div class="text-content">${escapeHtml(t.translated)}</div></div>
            </div>
        </div>
    `;
}

function renderErrorLog(errorLogs) {
    const errorContainer = document.createElement('div');
    errorContainer.id = 'errorLogContainer';
    errorContainer.className = 'history-group'; // Reuse existing styles
    errorContainer.style.borderColor = '#e53e3e'; // Make it stand out

    const logItemsHtml = errorLogs.map(log => {
        const date = new Date(log.timestamp).toLocaleString('ko-KR');
        const textsHtml = log.texts.map(text => `<li>${escapeHtml(text)}</li>`).join('');
        return `
            <div class="error-log-item" style="padding: 10px 0;">
                <p style="margin:0 0 4px;"><strong>발생 시각:</strong> ${date}</p>
                <p style="margin:0 0 4px;"><strong>발생 URL:</strong> <a href="${escapeHtml(log.url)}" target="_blank">${escapeHtml(log.url)}</a></p>
                <p style="margin:0 0 4px;"><strong>오류 원인:</strong> <span style="color: red; font-weight: bold;">${escapeHtml(log.reason)}</span></p>
                <p style="margin:0 0 4px;"><strong>전송된 텍스트:</strong></p>
                <ul style="background: #fff5f5; border: 1px solid #fecaca; border-radius: 4px; padding: 10px 10px 10px 30px; font-size: 12px; margin-top: 0;">${textsHtml}</ul>
            </div>
        `;
    }).join('<hr style="border: none; border-top: 1px solid #eee; margin: 0;">');

    errorContainer.innerHTML = `
        <div class="group-header" style="background-color: #fed7d7; cursor: default;">
            <div class="group-title-container">
                <p class="group-title" style="color: #c53030;">🚨 API 오류 로그</p>
            </div>
            <div class="group-header-actions">
                <button id="deleteErrorLogBtn" class="btn-apply applied" style="font-size: 12px; background-color: #c53030; cursor: pointer;">로그 삭제</button>
            </div>
        </div>
        <div class="group-item-container">${logItemsHtml}</div>
    `;

    historyGrid.prepend(errorContainer);
}

function updateStats() {
    document.getElementById('totalCount').textContent = allTranslations.length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    document.getElementById('todayCount').textContent = allTranslations.filter(t => t.timestamp && new Date(t.timestamp) >= today).length;
    document.getElementById('avgLength').textContent = allTranslations.length > 0 ? Math.round(allTranslations.reduce((sum, t) => sum + (t.original || '').length, 0) / allTranslations.length) : 0;
}

function updateDeleteButtonVisibility() {
    const anyChecked = document.querySelector('.item-checkbox:checked');
    deleteSelectedBtn.style.display = anyChecked ? 'inline-block' : 'none';
}

function openEditModal(compositeKey) {
    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (!translation) return;
    currentEditInfo = { url: translation.url, id: (translation.pid || translation.hash) };
    document.getElementById('editOriginal').value = translation.original;
    document.getElementById('editTranslated').value = translation.translated;
    editModal.style.display = 'flex';
    document.getElementById('editTranslated').focus();
}

async function saveEditedTranslation() {
    if (!currentEditInfo) return;
    const { url, id } = currentEditInfo;
    const newTranslated = document.getElementById('editTranslated').value.trim();
    if (!newTranslated) { showToast('번역 내용을 입력하세요.', 'error'); return; }
    try {
        const result = await chrome.storage.local.get(url);
        let translations = result[url] || [];
        const targetIndex = translations.findIndex(t => (t.pid || t.hash) === id);
        if (targetIndex > -1) {
            translations[targetIndex].translated = newTranslated;
            translations[targetIndex].timestamp = Date.now();
            await chrome.storage.local.set({ [url]: translations });
            await loadAndRender();
            editModal.style.display = 'none';
            showToast('번역이 수정되었습니다!');
        } else { showToast('원본 번역을 찾지 못해 수정에 실패했습니다.', 'error'); }
    } catch (error) { console.error('Save failed:', error); showToast('저장에 실패했습니다.', 'error'); }
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
            const findRegex = new RegExp(find.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&'), 'g');

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
                await loadAndRender();
                showToast(`총 ${totalModifiedCount}개 항목에서 단어를 교체했습니다.`);
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
            const findRegex = new RegExp(find.replace(/[-\/\\^$*+?.()|[\\]{}]/g, '\\$&'), 'g');
            
            translations.forEach(t => {
                if (t.translated && t.translated.includes(find)) {
                    t.translated = t.translated.replace(findRegex, replace);
                    modifiedCount++;
                }
            });

            if (modifiedCount > 0) {
                await chrome.storage.local.set({ [url]: translations });
                await loadAndRender();
                showToast(`${modifiedCount}개 항목에서 단어를 교체했습니다.`);
            } else {
                showToast('교체할 단어를 찾지 못했습니다.', 'info');
            }
        } catch (error) {
            console.error('Find and replace failed:', error);
            showToast('찾아 바꾸기에 실패했습니다.', 'error');
        }
    }

    closeFindReplaceModalHandler();
}

function handleSearch() {
    const query = searchBox.value.toLowerCase().trim();
    document.querySelectorAll('.history-group').forEach(group => {
        let hasVisibleItems = false;
        group.querySelectorAll('.history-item').forEach(item => {
            const isVisible = item.textContent.toLowerCase().includes(query);
            item.classList.toggle('hidden', !isVisible);
            if (isVisible) hasVisibleItems = true;
        });
        group.classList.toggle('hidden', !hasVisibleItems && !group.textContent.toLowerCase().includes(query));
    });
}

async function deleteSelectedTranslations() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    if (checkedItems.length === 0) return;
    if (!confirm(`${checkedItems.length}개의 번역을 삭제하시겠습니까?`)) return;
    const itemsToDelete = {};
    checkedItems.forEach(item => {
        const [url, id] = item.dataset.key.split('|');
        if (!itemsToDelete[url]) itemsToDelete[url] = [];
        itemsToDelete[url].push(id);
    });
    try {
        for (const url in itemsToDelete) {
            const idsToDelete = new Set(itemsToDelete[url]);
            const result = await chrome.storage.local.get(url);
            const updatedTranslations = (result[url] || []).filter(t => !idsToDelete.has(t.pid || t.hash));
            if (updatedTranslations.length > 0) {
                await chrome.storage.local.set({ [url]: updatedTranslations });
            } else {
                await chrome.storage.local.remove(url);
            }
        }
        await loadAndRender();
        showToast(`${checkedItems.length}개의 번역이 삭제되었습니다.`);
    } catch (error) {
        showToast('선택한 항목 삭제에 실패했습니다.', 'error');
    }
}

async function clearAllTranslations() {
    if (!confirm('모든 번역 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    try {
        await chrome.storage.local.clear();
        await loadAndRender();
        showToast('모든 번역 기록이 삭제되었습니다.');
    } catch (error) {
        showToast('삭제에 실패했습니다.', 'error');
    }
}

async function clearTitleCache() {
    await chrome.storage.local.remove('titleCache');
    showToast('제목 캐시가 초기화되었습니다. 페이지를 새로고침하세요.', 'info');
}

async function copyTranslation(compositeKey) {
    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (!translation) return;
    await navigator.clipboard.writeText(translation.translated);
    showToast('번역이 클립보드에 복사되었습니다!');
}

function exportTranslations() {
    if (allTranslations.length === 0) {
        showToast('내보낼 번역이 없습니다.', 'error');
        return;
    }
    const exportData = allTranslations.map(t => ({ PID: t.pid, 원문: t.original, 번역: t.translated, URL: t.url, 날짜: new Date(t.timestamp || 0).toLocaleString('ko-KR') }));
    const dataStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `translation-history-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    showToast('번역 기록이 내보내졌습니다!');
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
        showToast('문장이 번역에서 제외되었습니다.');

    } catch (error) {
        console.error('Failed to exclude sentence:', error);
        showToast('문장 제외 처리에 실패했습니다.', 'error');
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
        await loadAndRender();
        if (!skipConfirm) {
            showToast('번역이 삭제되었습니다.');
        }
    } catch (error) {
        console.error('Delete failed:', error);
        showToast('삭제에 실패했습니다.', 'error');
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
        showToast(newStatus.applied ? '설정 완료: 이제 해당 페이지에서 번역이 적용됩니다.' : '설정 해제: 페이지에서 번역이 더 이상 적용되지 않습니다.');
    } catch (error) {
        console.error('Failed to toggle apply status:', error);
        showToast('상태 변경에 실패했습니다.', 'error');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']|[']/g, m => map[m]);
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