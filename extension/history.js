// Global state
let allTranslations = []; // This will now only hold the currently loaded page of translations
let allFolders = [];

// Server/UI state
let currentPage = 1;
let totalRecords = 0;
let isLoading = false;
const RECORDS_PER_PAGE = 50;
let currentSearch = '';
let currentFolder = '';

// DOM element cache
let historyContainer, emptyState, searchBox, deleteSelectedBtn, folderFilterDropdown, moveSelectedToFolderDropdown, darkModeToggle;

// Debounce timer
let searchTimeout;

// Main initialization
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    setupEventListeners();
    loadDarkModePreference();
    loadAndRender(true);
});

function cacheDOMElements() {
    historyContainer = document.getElementById('history-container');
    emptyState = document.getElementById('emptyState');
    searchBox = document.getElementById('searchBox');
    deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    folderFilterDropdown = document.getElementById('folderFilterDropdown');
    moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown');
    darkModeToggle = document.getElementById('darkModeToggle');
    // Other elements can be cached as needed
}

async function loadAndRender(isInitialLoad = false) {
    if (isLoading) return;
    isLoading = true;

    if (isInitialLoad) {
        historyContainer.innerHTML = '';
        currentPage = 1;
        allTranslations = [];
        totalRecords = 0;
        await loadAndRenderFolders();
    }

    document.getElementById('loading-skeleton').style.display = 'block';

    try {
        const skip = (currentPage - 1) * RECORDS_PER_PAGE;
        let url = `http://127.0.0.1:8000/translations?skip=${skip}&limit=${RECORDS_PER_PAGE}`;
        if (currentSearch) url += `&search=${encodeURIComponent(currentSearch)}`;
        if (currentFolder) url += `&folder=${encodeURIComponent(currentFolder)}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
        
        const data = await response.json();
        totalRecords = data.total_count;
        const newTranslations = data.translations;

        allTranslations.push(...newTranslations);
        renderHistory(newTranslations, isInitialLoad);
        updateBulkActionPanel(); // Update stats and panel visibility

        currentPage++;
    } catch (error) {
        console.error("Failed to load data:", error);
        showToast("Failed to load data. Is the server running?", "error");
    } finally {
        isLoading = false;
        document.getElementById('loading-skeleton').style.display = 'none';
        emptyState.style.display = totalRecords === 0 ? 'block' : 'none';
    }
}

function renderHistory(translations, isInitial) {
    const tableBody = historyContainer.querySelector('tbody');

    if (isInitial || !tableBody) {
        historyContainer.innerHTML = `
            <table class="history-table">
                <thead>
                    <tr>
                        <th style="width: 40px;"><input type="checkbox" id="global-select-all"></th>
                        <th>Original</th>
                        <th>Translation</th>
                        <th style="width: 150px;">Folder</th>
                        <th style="width: 120px;">Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;
    }

    const newBody = historyContainer.querySelector('tbody');
    const itemsHtml = translations.map(t => renderItem(t)).join('');
    newBody.insertAdjacentHTML('beforeend', itemsHtml);
}

function renderItem(t) {
    const date = new Date(t.timestamp * 1000);
    const dateStr = date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
    const folderOptions = allFolders.map(f => 
        `<option value="${escapeHtml(f)}" ${t.folderName === f ? 'selected' : ''}>${escapeHtml(f)}</option>`
    ).join('');

    return `
        <tr class="history-item" data-id="${t.id}">
            <td><input type="checkbox" class="item-checkbox" data-id="${t.id}"></td>
            <td>
                <div class="item-text-block">
                    <div class="text-label">${escapeHtml(t.url)} (ID: ${t.pid || 'N/A'})</div>
                    <div class="text-content original-text">${escapeHtml(t.original)}</div>
                </div>
            </td>
            <td>
                <div class="item-text-block">
                    <div class="text-label">Translation</div>
                    <div class="text-content translated-text" contenteditable="true">${escapeHtml(t.translated)}</div>
                </div>
            </td>
            <td>
                 <select class="form-select item-folder-assign-dropdown" data-id="${t.id}">
                    <option value="" ${!t.folderName ? 'selected' : ''}>No Folder</option>
                    ${folderOptions}
                </select>
            </td>
            <td class="item-actions-container">
                <div class="item-date">${dateStr}</div>
                <div class="item-actions">
                    <button class="btn btn-outline save-item-btn" title="Save">💾</button>
                    <button class="btn btn-outline copy-btn" title="Copy">📋</button>
                    <button class="btn btn-outline delete-btn" title="Delete">🗑️</button>
                </div>
            </td>
        </tr>
    `;
}

async function loadAndRenderFolders() {
    try {
        const response = await fetch('http://127.0.0.1:8000/folders');
        if (!response.ok) throw new Error('Failed to load folders');
        allFolders = await response.json();
        renderFoldersUI();
    } catch (error) {
        console.error(error);
        showToast("Failed to load folders.", "error");
    }
}

function renderFoldersUI() {
    if (!folderFilterDropdown || !moveSelectedToFolderDropdown) return;
    folderFilterDropdown.innerHTML = '<option value="">All Folders</option>';
    moveSelectedToFolderDropdown.innerHTML = '<option value="">Move to Folder...</option><option value="">No Folder</option>';
    allFolders.forEach(folderName => {
        const option = `<option value="${escapeHtml(folderName)}">${escapeHtml(folderName)}</option>`;
        folderFilterDropdown.insertAdjacentHTML('beforeend', option);
        moveSelectedToFolderDropdown.insertAdjacentHTML('beforeend', option);
    });
}

function setupEventListeners() {
    // Search
    searchBox.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = e.target.value;
            loadAndRender(true);
        }, 500);
    });

    // Folder Filter
    folderFilterDropdown.addEventListener('change', (e) => {
        currentFolder = e.target.value;
        loadAndRender(true);
    });

    // Infinite Scroll
    window.addEventListener('scroll', () => {
        if (isLoading) return;
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 300) {
            if (allTranslations.length < totalRecords) {
                loadAndRender(false);
            }
        }
    });

    // Event delegation for item actions
    historyContainer.addEventListener('click', handleHistoryClick);
    historyContainer.addEventListener('change', handleHistoryChange);

    // Bulk actions
    deleteSelectedBtn.addEventListener('click', deleteSelectedTranslations);
    moveSelectedToFolderDropdown.addEventListener('change', moveSelectedTranslationsToFolder);
    
    // Other controls
    darkModeToggle.addEventListener('click', toggleDarkMode);
}

async function handleHistoryClick(e) {
    const target = e.target;
    const itemRow = target.closest('.history-item');
    if (!itemRow) return;

    const id = parseInt(itemRow.dataset.id);

    if (target.classList.contains('delete-btn')) {
        if (!confirm('Delete this translation?')) return;
        await fetch('http://127.0.0.1:8000/translations/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [id] })
        });
        itemRow.remove();
        totalRecords--;
        updateBulkActionPanel();
        showToast('Deleted.');
    }

    if (target.classList.contains('save-item-btn')) {
        const original = itemRow.querySelector('.original-text').textContent;
        const translated = itemRow.querySelector('.translated-text').textContent;
        const record = allTranslations.find(t => t.id === id);
        if (!record) return;

        const itemToUpsert = { ...record, translated, timestamp: Math.floor(Date.now() / 1000) };
        await fetch('http://127.0.0.1:8000/translations/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([itemToUpsert])
        });
        showToast('Saved.');
    }
    
    if (target.classList.contains('copy-btn')) {
        const translatedText = itemRow.querySelector('.translated-text').textContent;
        navigator.clipboard.writeText(translatedText);
        showToast('Copied to clipboard.');
    }
}

async function handleHistoryChange(e) {
    const target = e.target;

    if (target.classList.contains('item-folder-assign-dropdown')) {
        const id = parseInt(target.dataset.id);
        const newFolder = target.value || null;
        await fetch('http://127.0.0.1:8000/translations/move', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [id], folder_name: newFolder })
        });
        showToast('Folder changed.');
    }

    if (target.id === 'global-select-all' || target.classList.contains('item-checkbox')) {
        if (target.id === 'global-select-all') {
            historyContainer.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = target.checked);
        }
        updateBulkActionPanel();
    }
}

async function deleteSelectedTranslations() {
    const checkedItems = Array.from(document.querySelectorAll('.item-checkbox:checked'));
    if (checkedItems.length === 0) return;
    if (!confirm(`Delete ${checkedItems.length} translations?`)) return;
    
    const idsToDelete = checkedItems.map(item => parseInt(item.dataset.id));
    await fetch('http://127.0.0.1:8000/translations/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToDelete })
    });
    showToast(`${idsToDelete.length} items deleted.`, 'success');
    loadAndRender(true);
}

async function moveSelectedTranslationsToFolder(event) {
    const checkedItems = Array.from(document.querySelectorAll('.item-checkbox:checked'));
    if (checkedItems.length === 0) return;

    const targetFolder = event.target.value;
    if (targetFolder === "") return; // Ignore the placeholder "Move to folder..."

    const idsToMove = checkedItems.map(item => parseInt(item.dataset.id));
    const newFolderName = targetFolder === "No Folder" ? null : targetFolder;

    if (!confirm(`Move ${idsToMove.length} items to '${targetFolder}'?`)) return;

    await fetch('http://127.0.0.1:8000/translations/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: idsToMove, folder_name: newFolderName })
    });
    showToast(`${idsToMove.length} items moved.`, 'success');
    loadAndRender(true);
}

function updateBulkActionPanel() {
    const checkedItems = document.querySelectorAll('.item-checkbox:checked');
    const panel = document.getElementById('bulk-actions');
    const countSpan = document.getElementById('selection-count');
    const moveDropdown = document.getElementById('moveSelectedToFolderDropdown');
    const deleteButton = document.getElementById('deleteSelectedBtn');

    document.getElementById('totalCount').textContent = totalRecords;

    if (checkedItems.length > 0) {
        panel.style.display = 'flex';
        countSpan.textContent = `${checkedItems.length} items selected`;
        moveDropdown.disabled = false;
        deleteButton.disabled = false;
    } else {
        panel.style.display = 'none';
    }
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return text.toString().replace(/[&<"'/]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','/':'&#x2F;'})[s]);
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

function renderErrorLog(logs) {
    const container = document.getElementById('errorLogContainer');
    const contentDiv = document.getElementById('errorLogContent');
    if (!container || !contentDiv) return;

    if (!logs || logs.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    contentDiv.innerHTML = logs.map(log => {
        const date = new Date(log.timestamp).toLocaleString('ko-KR');
        const texts = log.texts.map(t => `<li>${escapeHtml(t)}</li>`).join('');
        const stack = log.stack ? `<pre style="white-space: pre-wrap; font-size: 11px; color: #888; background: #f0f0f0; padding: 5px; border-radius: 4px;">${escapeHtml(log.stack)}</pre>` : '';

        return `
            <div class="error-log-item">
                <p><strong>시간:</strong> ${date}</p>
                <p><strong>원인:</strong> <span style="color: var(--danger-color);">${escapeHtml(log.reason)}</span></p>
                <p><strong>URL:</strong> <a href="${log.url}" target="_blank">${escapeHtml(log.url)}</a></p>
                <p><strong>관련 텍스트:</strong></p>
                <ul>${texts}</ul>
                ${stack}
            </div>
        `;
    }).join('');
}