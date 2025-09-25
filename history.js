// =================================================================================
// Globals
// =================================================================================

let allTranslations = [];
let groupedTranslations = {};
let urlToTitle = {};
let titleCache = {};
let currentEditInfo = null;
let currentFindReplaceUrl = null;

const FOLDERS_STORAGE_KEY = 'translation_folders';
let allFolders = []; // 모든 폴더 이름을 저장할 배열

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
    // loadAndRender(); // 이 부분은 폴더 로딩 후 호출되도록 아래로 이동

    const newFolderNameInput = document.getElementById('newFolderNameInput');
    const createFolderButton = document.getElementById('createFolderButton');

    // 폴더 생성 버튼 이벤트
    if (createFolderButton) { // HTML 요소가 존재하는지 확인
        console.log("createFolderButton 요소 찾음:", createFolderButton); // 디버깅 로그 추가
        createFolderButton.addEventListener('click', async () => {
            console.log("폴더 생성 버튼 클릭됨"); // 디버깅 로그 추가
            const folderName = newFolderNameInput.value.trim();
            console.log("입력된 폴더 이름:", folderName); // 디버깅 로그 추가

            if (folderName) {
                let folders = await loadFolders();
                console.log("현재 폴더 목록:", folders); // 디버깅 로그 추가

                if (!folders.includes(folderName)) {
                    folders.push(folderName);
                    await saveFolders(folders);
                    console.log("새 폴더 저장됨:", folders); // 디버깅 로그 추가
                    newFolderNameInput.value = ''; // 입력 필드 초기화
                    renderFolders(); // 폴더 목록 새로고침
                    loadAndRender(); // 번역 기록도 새로고침 (폴더 필터링 옵션 업데이트 등)
                    showToast(`폴더 "${folderName}"가 생성되었습니다.`); // 토스트 메시지 추가
                } else {
                    showToast('이미 존재하는 폴더 이름입니다.', 'error');
                }
            } else {
                showToast('폴더 이름을 입력해주세요.', 'error');
            }
        });
    } else {
        console.error("createFolderButton 요소를 찾을 수 없습니다."); // 디버깅 로그 추가
    }

    // 페이지 로드 시 폴더 목록도 불러와 렌더링
    loadFolders().then(folders => {
        allFolders = folders;
        renderFolders();
        loadAndRender(); // 폴더 로딩 후 번역 기록 로딩 및 렌더링
    });
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

    // 폴더 필터 드롭다운 이벤트 리스너 추가
    const folderFilterDropdown = document.getElementById('folderFilterDropdown');
    if (folderFilterDropdown) {
        folderFilterDropdown.addEventListener('change', () => {
            loadAndRender(); // 필터 변경 시 번역 기록 새로고침
        });
    }

    // 선택 항목 폴더 이동 드롭다운 이벤트 리스너 추가
    const moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown');
    if (moveSelectedToFolderDropdown) {
        moveSelectedToFolderDropdown.addEventListener('change', async (event) => {
            const targetFolder = event.target.value;
            if (targetFolder) { // 폴더가 선택되었을 때만 실행
                await moveSelectedTranslationsToFolder(targetFolder === '폴더 없음' ? undefined : targetFolder);
                event.target.value = ''; // 드롭다운 초기화
            }
        });
    }

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
        } else if (e.target.classList.contains('item-folder-assign-dropdown')) { // 개별 항목 폴더 할당 드롭다운
            const compositeKey = e.target.dataset.key;
            const newFolderName = e.target.value === '폴더 없음' ? undefined : e.target.value;
            assignFolderToSingleTranslation(compositeKey, newFolderName);
            showToast(`번역 기록이 폴더 '${newFolderName || '폴더 없음'}'(으)로 이동되었습니다.`);
            // loadAndRender(); // 변경 사항 반영을 위해 새로고침 (필요시)
        }
        updateDeleteButtonVisibility();
    });

    // Add a listener for storage changes to auto-refresh the view
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            // Check if a translation key (http...), folder list, or error log has changed.
            const hasDataChanges = Object.keys(changes).some(key => 
                key.startsWith('http') || 
                key === FOLDERS_STORAGE_KEY ||
                key === 'error_log'
            );
            if (hasDataChanges) {
                console.log('Detected changes in storage, reloading history view...');
                showToast('데이터 변경이 감지되어 목록을 새로고침합니다.', 'info');
                loadAndRender();
            }
        }
    });

    // Add listener to refresh data when tab becomes visible
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            console.log("Tab is visible, refreshing data.");
            showToast('탭이 활성화되어 데이터를 새로고침합니다.', 'info');
            loadAndRender();
        }
    });
}

// 개별 번역 기록에 폴더 할당 함수 (새로 추가)
async function assignFolderToSingleTranslation(compositeKey, folderName) {
    const [url, id] = compositeKey.split('|');
    if (!url || !id) return;
    try {
        const result = await chrome.storage.local.get(url);
        let translations = result[url] || [];
        const targetIndex = translations.findIndex(t => (t.pid || t.hash) === id);
        if (targetIndex > -1) {
            translations[targetIndex].folderName = folderName;
            await chrome.storage.local.set({ [url]: translations });
            loadAndRender(); // 변경 사항 반영을 위해 새로고침
        }
    } catch (error) {
        console.error('Failed to assign folder to single translation:', error);
        showToast('개별 번역에 폴더 할당 실패했습니다.', 'error');
    }
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
        const urls = [];

        // New, correct grouping logic
        const groupedByFolder = {};
        allFolders.forEach(folder => { groupedByFolder[folder] = {}; });
        groupedByFolder['폴더 없음'] = {};

        for (const [key, value] of Object.entries(allData)) {
            if (key.startsWith('http') && Array.isArray(value)) {
                urls.push(key);
                const validTranslations = value.filter(t => t.pid || t.hash);

                validTranslations.forEach(translation => {
                    const folderName = translation.folderName || '폴더 없음';
                    if (!groupedByFolder[folderName]) {
                        groupedByFolder[folderName] = {}; // Safety for new folders created elsewhere
                    }
                    if (!groupedByFolder[folderName][key]) {
                        groupedByFolder[folderName][key] = [];
                    }
                    groupedByFolder[folderName][key].push(translation);

                    // also populate flattened array for stats
                    flattened.push({ url: key, ...translation, compositeKey: `${key}|${translation.pid || translation.hash}` });
                });
            }
        }

        // Sort items within each URL group
        for (const folder in groupedByFolder) {
            for (const url in groupedByFolder[folder]) {
                groupedByFolder[folder][url].sort((a, b) => naturalSort(a.pid || 'z', b.pid || 'z'));
            }
        }

        allTranslations = flattened.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        await fetchTitles(urls);
        
        // 현재 선택된 폴더 필터 값 가져오기
        const folderFilterDropdown = document.getElementById('folderFilterDropdown');
        const selectedFolder = folderFilterDropdown ? folderFilterDropdown.value : '';

        const filteredGroupedByFolder = {};
        if (selectedFolder === '') { // "모든 폴더" 선택 시
            Object.assign(filteredGroupedByFolder, groupedByFolder);
        } else { // 특정 폴더 선택 시
            if (groupedByFolder[selectedFolder]) {
                filteredGroupedByFolder[selectedFolder] = groupedByFolder[selectedFolder];
            }
        }

        renderGroupedView(filteredGroupedByFolder, allData); // 필터링된 groupedByFolder를 전달
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

function renderGroupedView(groupedByFolder, allData = {}) {
    // If there are no regular translations but there is an error log, don't show empty state
    if (Object.keys(groupedByFolder['폴더 없음']).length === 0 && allFolders.every(f => Object.keys(groupedByFolder[f]).length === 0)) {
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

    // 폴더 이름 (폴더 없음 포함)을 기준으로 정렬
    const sortedFolderNames = [...allFolders, '폴더 없음'].filter(name => Object.keys(groupedByFolder[name]).length > 0);

    for (const folderName of sortedFolderNames) {
        const folderGroupEl = document.createElement('div');
        folderGroupEl.className = 'history-folder-group';
        folderGroupEl.innerHTML = `
            <div class="folder-group-header">
                <button class="folder-group-toggle-btn">▼</button>
                <h3 class="folder-group-title">${escapeHtml(folderName)}</h3>
                <label class="folder-select-all" style="margin-left: auto;"><input type="checkbox" class="folder-select-all-checkbox"> 전체</label>
            </div>
            <div class="folder-group-content">
                <!-- URL 그룹들이 여기에 렌더링됩니다 -->
            </div>
        `;
        historyGrid.appendChild(folderGroupEl);

        const folderGroupContent = folderGroupEl.querySelector('.folder-group-content');
        const folderGroupToggleBtn = folderGroupEl.querySelector('.folder-group-toggle-btn');
        const folderSelectAllCheckbox = folderGroupEl.querySelector('.folder-select-all-checkbox'); // 새로 추가

        // 폴더 그룹 토글 기능 (기존과 동일)
        folderGroupToggleBtn.addEventListener('click', () => {
            folderGroupContent.classList.toggle('collapsed');
            folderGroupToggleBtn.classList.toggle('collapsed');
            folderGroupToggleBtn.textContent = folderGroupContent.classList.contains('collapsed') ? '▶' : '▼';
        });

        // 폴더 전체 선택 체크박스 이벤트 리스너
        folderSelectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            // 해당 폴더 내의 모든 URL 그룹의 체크박스를 선택/해제
            folderGroupContent.querySelectorAll('.group-select-all-checkbox').forEach(groupCheckbox => {
                groupCheckbox.checked = isChecked;
                // 각 URL 그룹 내의 개별 항목 체크박스도 선택/해제
                const group = groupCheckbox.closest('.history-group');
                group.querySelectorAll('.item-checkbox').forEach(itemCheckbox => {
                    itemCheckbox.checked = isChecked;
                });
            });
            updateDeleteButtonVisibility(); // 삭제 버튼 가시성 업데이트
        });

        // 해당 폴더에 속한 URL 그룹들을 렌더링
        const urlsInFolder = Object.keys(groupedByFolder[folderName]).sort((a, b) => {
            const lastTimeA = Math.max(...groupedByFolder[folderName][a].map(t => t.timestamp || 0));
            const lastTimeB = Math.max(...groupedByFolder[folderName][b].map(t => t.timestamp || 0));
            return lastTimeB - lastTimeA;
        });

        for (const url of urlsInFolder) {
            const translations = groupedByFolder[folderName][url];
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
                        <select class="folder-assign-dropdown" data-url="${url}">
                            <option value="">폴더 선택</option>
                            ${allFolders.map(f => `<option value="${escapeHtml(f)}" ${f === folderName ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                            <option value="폴더 없음" ${folderName === '폴더 없음' ? 'selected' : ''}>폴더 없음</option>
                        </select>
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

            folderGroupContent.appendChild(groupEl);
        }
    }

    // 폴더 할당 드롭다운 이벤트 리스너
    historyGrid.querySelectorAll('.folder-assign-dropdown').forEach(dropdown => {
        dropdown.addEventListener('change', async (event) => {
            const urlToAssign = event.target.dataset.url;
            const newFolderName = event.target.value === '폴더 없음' ? undefined : event.target.value;
            await assignFolderToUrlTranslations(urlToAssign, newFolderName);
            showToast(`'${urlToAssign}'의 번역 기록이 폴더 '${newFolderName || '폴더 없음'}'(으)로 이동되었습니다.`);
            loadAndRender(); // 변경 사항 반영을 위해 새로고침
        });
    });
}

// URL의 모든 번역 기록에 폴더 할당
async function assignFolderToUrlTranslations(url, folderName) {
    try {
        const result = await chrome.storage.local.get(url);
        let translations = result[url] || [];
        let changed = false;
        translations = translations.map(t => {
            if (t.folderName !== folderName) {
                t.folderName = folderName;
                changed = true;
            }
            return t;
        });
        if (changed) {
            await chrome.storage.local.set({ [url]: translations });
        }
    } catch (error) {
        console.error('Failed to assign folder to URL translations:', error);
        showToast('폴더 할당에 실패했습니다.', 'error');
    }
}

function renderItem(t, url) {
    const compositeKey = `${url}|${t.pid || t.hash}`;
    const date = t.timestamp ? new Date(t.timestamp) : new Date();
    const dateStr = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const currentFolderName = t.folderName || '폴더 없음'; // 현재 폴더 이름 가져오기
    return `
        <div class="history-item" data-key="${compositeKey}" data-pid="${t.pid || 'N/A'}">
            <div class="item-checkbox-container"><input type="checkbox" class="item-checkbox" data-key="${compositeKey}"></div>
            <div class="item-content-container">
                <div class="item-header">
                    <div class="item-date">${dateStr}</div>
                    <div class="item-actions">
                        <select class="item-folder-assign-dropdown" data-key="${compositeKey}">
                            <option value="">폴더 선택</option>
                            ${allFolders.map(f => `<option value="${escapeHtml(f)}" ${f === currentFolderName ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
                            <option value="폴더 없음" ${currentFolderName === '폴더 없음' ? 'selected' : ''}>폴더 없음</option>
                        </select>
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
    const newTranslated = document.getElementById('editTranslated').value;
    try {
        const result = await chrome.storage.local.get(url);
        let translations = result[url] || [];
        const targetIndex = translations.findIndex(t => (t.pid || t.hash) === id);
        if (targetIndex > -1) {
            translations[targetIndex].translated = newTranslated;
            translations[targetIndex].timestamp = Date.now();
            // folderName은 수정 모달에서 변경되지 않으므로 기존 값을 유지
            // 만약 수정 모달에서 folderName을 변경하는 UI가 있다면 여기서 업데이트 필요
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
    
    // 모든 폴더 그룹을 순회
    document.querySelectorAll('.history-folder-group').forEach(folderGroup => {
        let hasVisibleItemsInFolder = false;
        
        // 폴더 이름이 검색어에 포함되는지 확인
        const folderNameEl = folderGroup.querySelector('.folder-group-title');
        const folderName = folderNameEl ? folderNameEl.textContent.toLowerCase() : '';
        const folderMatchesQuery = folderName.includes(query);

        // 해당 폴더 그룹 내의 모든 URL 그룹을 순회
        folderGroup.querySelectorAll('.history-group').forEach(group => {
            let hasVisibleItemsInGroup = false;
            
            // URL 그룹의 제목 또는 URL이 검색어에 포함되는지 확인
            const groupTitleEl = group.querySelector('.group-title');
            const groupUrlEl = group.querySelector('.group-url');
            const groupTitle = groupTitleEl ? groupTitleEl.textContent.toLowerCase() : '';
            const groupUrl = groupUrlEl ? groupUrlEl.textContent.toLowerCase() : '';
            const groupMatchesQuery = groupTitle.includes(query) || groupUrl.includes(query);

            // 해당 URL 그룹 내의 모든 번역 항목을 순회
            group.querySelectorAll('.history-item').forEach(item => {
                const isVisible = item.textContent.toLowerCase().includes(query);
                item.classList.toggle('hidden', !isVisible);
                if (isVisible) hasVisibleItemsInGroup = true;
            });

            // URL 그룹의 가시성 결정:
            // 1. 그룹 내에 보이는 항목이 있거나
            // 2. 그룹 자체의 제목/URL이 검색어와 일치하거나
            // 3. 상위 폴더 이름이 검색어와 일치하는 경우
            const groupShouldBeVisible = hasVisibleItemsInGroup || groupMatchesQuery || folderMatchesQuery;
            group.classList.toggle('hidden', !groupShouldBeVisible);
            if (groupShouldBeVisible) hasVisibleItemsInFolder = true;
        });

        // 폴더 그룹의 가시성 결정:
        // 1. 폴더 내에 보이는 URL 그룹이 있거나
        // 2. 폴더 이름이 검색어와 일치하는 경우
        const folderShouldBeVisible = hasVisibleItemsInFolder || folderMatchesQuery;
        folderGroup.classList.toggle('hidden', !folderShouldBeVisible);
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
    const exportData = allTranslations.map(t => ({
        PID: t.pid,
        원문: t.original,
        번역: t.translated,
        URL: t.url,
        폴더: t.folderName || '폴더 없음', // 폴더 정보 추가
        날짜: new Date(t.timestamp || 0).toLocaleString('ko-KR')
    }));
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
        showToast(`${totalMovedCount}개의 번역 기록이 폴더 '${folderName || '폴더 없음'}'(으)로 이동되었습니다.`);
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
    const moveSelectedToFolderDropdown = document.getElementById('moveSelectedToFolderDropdown'); // 새로 추가
    if (!folderListDiv || !folderFilterDropdown || !moveSelectedToFolderDropdown) return; // 요소가 없으면 리턴

    folderListDiv.innerHTML = ''; // 기존 목록 지우기
    folderFilterDropdown.innerHTML = '<option value="">모든 폴더</option>'; // 필터 드롭다운 초기화
    moveSelectedToFolderDropdown.innerHTML = '<option value="">선택 항목 폴더에 이동</option>'; // 선택 이동 드롭다운 초기화

    if (allFolders.length === 0) {
        folderListDiv.innerHTML = '<p style="color: rgba(255, 255, 255, 0.7);">생성된 폴더가 없습니다.</p>';
        return;
    }

    allFolders.forEach(folderName => {
        // 폴더 목록 (folderListDiv)에 항목 추가
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        folderItem.innerHTML = `
            <span>${escapeHtml(folderName)}</span>
            <div class="folder-controls">
                <button class="delete-folder-btn" data-folder-name="${escapeHtml(folderName)}">삭제</button>
            </div>
        `;
        folderListDiv.appendChild(folderItem);

        // 필터 드롭다운에 옵션 추가
        const filterOption = document.createElement('option');
        filterOption.value = folderName;
        filterOption.textContent = folderName;
        folderFilterDropdown.appendChild(filterOption);

        // 선택 이동 드롭다운에 옵션 추가
        const moveOption = document.createElement('option');
        moveOption.value = folderName;
        moveOption.textContent = folderName;
        moveSelectedToFolderDropdown.appendChild(moveOption);
    });

    // 폴더 삭제 버튼 이벤트 리스너 추가 (기존과 동일)
    folderListDiv.querySelectorAll('.delete-folder-btn').forEach(button => {
        button.addEventListener('click', async (event) => {
            const folderToDelete = event.target.dataset.folderName;
            if (confirm(`정말로 폴더 "${folderToDelete}"를 삭제하시겠습니까? 이 폴더에 할당된 번역 기록은 "폴더 없음"으로 변경됩니다.`)) {
                allFolders = allFolders.filter(name => name !== folderToDelete);
                await saveFolders(allFolders);
                
                // 해당 폴더에 할당된 번역 기록의 folderName을 제거
                await removeFolderFromTranslations(folderToDelete);

                renderFolders(); // 폴더 목록 새로고침
                loadAndRender(); // 번역 기록 새로고침
                showToast(`폴더 "${folderToDelete}"가 삭제되었습니다.`);
            }
        });
    });
}

// 번역 기록에서 폴더 정보 제거 (폴더 삭제 시 호출)
async function removeFolderFromTranslations(folderName) {
    const allData = await chrome.storage.local.get(null);
    for (const url in allData) {
        // 내부 저장소 키는 건너뛰기
        if (url === 'apiKey' || url.startsWith('status-') || url.startsWith('excluded_sentences') || url.startsWith('error_log') || url === FOLDERS_STORAGE_KEY || url === 'titleCache') {
            continue;
        }
        let translations = allData[url];
        if (Array.isArray(translations)) {
            let changed = false;
            translations = translations.map(t => {
                if (t.folderName === folderName) {
                    delete t.folderName; // folderName 속성 제거
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