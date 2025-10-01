let allTranslations = [];
let urlToTitle = {};
let titleCache = {};
let currentEditInfo = null;

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadAndRender();
});

function setupEventListeners() {
    document.getElementById('searchBox').addEventListener('input', handleSearch);
    document.getElementById('exportJsonBtn').addEventListener('click', exportTranslationsAsJson);
    document.getElementById('exportPdfBtn').addEventListener('click', exportToPrintableHtml);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllTranslations);
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelectedTranslations);
    document.getElementById('darkModeToggle').addEventListener('click', toggleDarkMode);

    loadDarkModePreference();

    const container = document.getElementById('history-container');

    container.addEventListener('click', (e) => {
        const target = e.target;
        const groupHeader = target.closest('.list-group-header');
        if (groupHeader) {
            const groupContent = groupHeader.nextElementSibling;
            const toggle = groupHeader.querySelector('.list-group-toggle');
            if (groupContent) {
                groupContent.classList.toggle('collapsed');
                toggle.classList.toggle('collapsed');
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
            return;
        }
    });

    container.addEventListener('change', (e) => {
        const target = e.target;
        if (target.type === 'checkbox') {
            if (target.classList.contains('group-select-all-checkbox')) {
                const group = target.closest('.list-group');
                if (group) {
                    const itemCheckboxes = group.querySelectorAll('.item-checkbox');
                    itemCheckboxes.forEach(checkbox => { checkbox.checked = target.checked; });
                }
            }
            updateBulkActionPanel();
        }
    });

    document.getElementById('editModal').style.display = 'none';
    document.getElementById('cancelEdit').addEventListener('click', () => document.getElementById('editModal').style.display = 'none');
    document.getElementById('saveEdit').addEventListener('click', saveEditedTranslation);
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

async function loadAndRender() {
    console.log('loadAndRender: 시작');
    const loadingSkeleton = document.getElementById('loading-skeleton');
    const emptyState = document.getElementById('emptyState');
    const historyContainer = document.getElementById('history-container');

    if (!loadingSkeleton || !emptyState || !historyContainer) {
        console.error('loadAndRender: 필수 DOM 요소(loading-skeleton, emptyState, history-container)를 찾을 수 없습니다.');
        return;
    }

    loadingSkeleton.style.display = 'block';
    emptyState.style.display = 'none';
    historyContainer.innerHTML = '';

    const allData = await chrome.storage.local.get(null);
    console.log('loadAndRender: chrome.storage.local.get(null) 결과:', allData);
    titleCache = allData.titleCache || {};
    
    const flattened = [];
    const groupedByUrl = {};
    const urls = [];

    for (const [key, value] of Object.entries(allData)) {
        if (key.startsWith('http') && Array.isArray(value)) {
            urls.push(key);
            if (!groupedByUrl[key]) groupedByUrl[key] = [];
            value.forEach(translation => {
                const compositeKey = `${key}|${translation.pid || translation.hash}`;
                const enrichedTranslation = { url: key, ...translation, compositeKey };
                flattened.push(enrichedTranslation);
                groupedByUrl[key].push(enrichedTranslation);
            });
        }
    }

    console.log('loadAndRender: flattened 데이터:', flattened);
    console.log('loadAndRender: groupedByUrl 데이터:', groupedByUrl);

    allTranslations = flattened.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    await fetchTitles(urls);
    loadingSkeleton.style.display = 'none';
    console.log('loadAndRender: 로딩 스켈레톤 숨김');
    renderView(groupedByUrl, historyContainer, emptyState);
    console.log('loadAndRender: renderView 호출 완료');
}

function renderView(groupedByUrl, container, emptyState) {
    console.log('renderView: 시작, groupedByUrl:', groupedByUrl);
    
    if (Object.keys(groupedByUrl).length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        console.log('renderView: groupedByUrl 비어있음, emptyState 표시');
        return;
    }

    emptyState.style.display = 'none';
    console.log('renderView: emptyState 숨김');
    container.innerHTML = '';

    const sortedUrls = Object.keys(groupedByUrl).sort((a, b) => {
        const lastTimeA = Math.max(...groupedByUrl[a].map(t => t.timestamp || 0));
        const lastTimeB = Math.max(...groupedByUrl[b].map(t => t.timestamp || 0));
        return lastTimeB - lastTimeA;
    });

    for (const url of sortedUrls) {
        const translations = groupedByUrl[url];
        const title = urlToTitle[url] || url;
        console.log(`renderView: 그룹 렌더링 - URL: ${url}, 제목: ${title}, 번역 수: ${translations.length}`);
        const groupEl = document.createElement('div');
        groupEl.className = 'list-group fade-in';

        groupEl.innerHTML = `
            <div class="list-group-header">
                <span class="list-group-toggle">▼</span>
                <h3 class="list-group-title">${escapeHtml(title)} (${translations.length})</h3>
                <div class="list-group-actions">
                    <label><input type="checkbox" class="group-select-all-checkbox"> 전체 선택</label>
                </div>
            </div>
            <div class="list-group-content">
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
                        ${translations.map(t => renderItem(t)).join('')}
                    </tbody>
                </table>
            </div>
        `;
        container.appendChild(groupEl);
    }
    console.log('renderView: 모든 그룹 렌더링 완료');
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
                    <button class="btn btn-outline delete-btn" title="삭제">🗑️</button>
                </div>
            </td>
        </tr>
    `;
}

function handleSearch() {
    const query = document.getElementById('searchBox').value.toLowerCase().trim();
    document.querySelectorAll('.list-group').forEach(group => {
        let hasVisibleItemsInGroup = false;
        const groupTitle = group.querySelector('.list-group-title').textContent.toLowerCase();

        group.querySelectorAll('.history-item').forEach(item => {
            const isVisible = item.textContent.toLowerCase().includes(query);
            item.style.display = isVisible ? '' : 'none';
            if (isVisible) hasVisibleItemsInGroup = true;
        });

        group.style.display = (hasVisibleItemsInGroup || groupTitle.includes(query)) ? '' : 'none';
    });
}

function updateBulkActionPanel() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    const countSpan = document.getElementById('selection-count');
    const moveDropdown = document.getElementById('moveSelectedToFolderDropdown');
    const deleteButton = document.getElementById('deleteSelectedBtn');

    if (checkedItems.length > 0) {
        countSpan.textContent = `${checkedItems.length}개 항목 선택됨`;
        moveDropdown.disabled = false;
        deleteButton.disabled = false;
    } else {
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
}

async function clearAllTranslations() {
    if (!confirm('모든 번역 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    await chrome.storage.local.clear();
    loadAndRender();
}

function openEditModal(compositeKey) {
    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (!translation) return;
    currentEditInfo = { url: translation.url, id: (translation.pid || translation.hash) };
    document.getElementById('editOriginal').value = translation.original;
    document.getElementById('editTranslated').value = translation.translated;
    document.getElementById('editModal').style.display = 'flex';
    document.getElementById('editTranslated').focus();
}

async function saveEditedTranslation() {
    if (!currentEditInfo) return;
    const { url, id } = currentEditInfo;
    const newTranslated = document.getElementById('editTranslated').value;
    const result = await chrome.storage.local.get(url);
    let translations = result[url] || [];
    const targetIndex = translations.findIndex(t => (t.pid || t.hash) === id);
    if (targetIndex > -1) {
        translations[targetIndex].translated = newTranslated;
        translations[targetIndex].timestamp = Date.now();
        await chrome.storage.local.set({ [url]: translations });
        loadAndRender();
        document.getElementById('editModal').style.display = 'none';
    }
}

async function copyTranslation(compositeKey) {
    const translation = allTranslations.find(t => t.compositeKey === compositeKey);
    if (translation) {
        await navigator.clipboard.writeText(translation.translated);
        // You might want a toast notification here
    }
}

function exportTranslationsAsJson() {
    const dataStr = JSON.stringify(allTranslations, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `translation-history.json`;
    link.click();
}

function exportToPrintableHtml() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    if (checkedItems.length === 0) return;

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
