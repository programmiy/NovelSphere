// =================================================================================
// Globals & Constants
// =================================================================================

const LONG_TEXT_THRESHOLD = 150; // Define threshold for long texts
const JAPANESE_REGEX = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
const PID_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;
let hasScannedForP_Tags = false;
let isTranslationCancelled = false;
let translationCache = new Map(); // Cache for original translation objects
let exclusionSet = new Set(); // Cache for excluded original texts

// =================================================================================
// Initialization & Event Listeners
// =================================================================================

// Listen for changes in storage (e.g., from the history page)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    const statusKey = 'status-' + window.location.href;
    if (changes[statusKey]) {
        console.log("Apply status changed. Reloading page to apply changes.");
        window.location.reload();
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

async function init() {
    try {
        console.log("Translator extension initializing...");

        injectSidebar();
        setupEventListeners();

        // 1. Fetch existing translations and exclusion list in parallel
        const url = window.location.href;
        const [translations, excluded] = await Promise.all([
            fetchTranslationsForUrl(url),
            fetchExclusionsForUrl(url)
        ]);

        if (excluded) {
            exclusionSet = new Set(excluded);
        }

        if (translations) {
            // 2. Populate cache and sidebar with existing data
            translationCache.clear();
            translations.forEach(t => translationCache.set(t.pid, t));
            populateSidebar(translations);
            logToSidebar(`서버에서 ${translations.length}개의 저장된 번역을 불러왔습니다.`);
        }

        // 3. Check if translations should be applied to the page content
        const statusKey = 'status-' + url;
        const statusResult = await chrome.storage.local.get(statusKey);
        if (statusResult[statusKey] && statusResult[statusKey].applied) {
            applyTranslationsToPage(translations);
        }

        // 4. Scan for and translate any new paragraphs
        const hasJapanesePTags = await scanForJapanesePTags();
        if (hasJapanesePTags) {
            showSidebar(); // This will trigger translateAllPTags for new content
        }

    } catch (error) {
        console.error("Translator extension failed to initialize:", error);
        if (document.getElementById('jp-translator-sidebar')) {
            logToSidebar(`초기화 실패: ${error.message}`, "log-error");
        }
    }
}

async function fetchTranslationsForUrl(url) {
    try {
        const fetchUrl = `http://127.0.0.1:8001/translations?url=${encodeURIComponent(url)}&limit=5000`; // Increased limit
        const response = await fetch(fetchUrl);
        if (!response.ok) {
            console.warn(`[fetchTranslationsForUrl] Server responded with ${response.status}`);
            return null;
        }
        const data = await response.json();
        return data.translations;
    } catch (error) {
        console.error("Error fetching translations for URL:", error);
        logToSidebar("서버에서 번역을 불러오는 데 실패했습니다.", "log-error");
        return null;
    }
}

async function fetchExclusionsForUrl(url) {
    try {
        const fetchUrl = `http://127.0.0.1:8001/excluded_sentences?url=${encodeURIComponent(url)}`;
        const response = await fetch(fetchUrl);
        if (!response.ok) {
            console.warn(`[fetchExclusionsForUrl] Server responded with ${response.status}`);
            return null;
        }
        const data = await response.json();
        return data.excluded_texts;
    } catch (error) {
        console.error("Error fetching exclusion list:", error);
        logToSidebar("서버에서 제외 목록을 불러오는 데 실패했습니다.", "log-error");
        return null;
    }
}

function applyTranslationsToPage(translations) {
    if (!translations || translations.length === 0) return;

    const translationMap = new Map(translations.map(t => [t.pid, t.translated]));
    const paragraphs = getTargetParagraphs();
    let replacementCount = 0;

    paragraphs.forEach(p => {
        if (translationMap.has(p.id)) {
            const translatedText = translationMap.get(p.id);
            if (translatedText) {
                p.innerHTML = translatedText;
                const appliedStyle = { color: '#E2E8F0', fontFamily: 'TwoCon' };
                Object.assign(p.style, appliedStyle);
                replacementCount++;
            }
        }
    });
    console.log(`[applyTranslationsToPage] Applied ${replacementCount} translations to page content.`);
    logToSidebar(`페이지에 저장된 번역 ${replacementCount}개를 적용했습니다.`);
}

// =================================================================================
// UI Injection & Management
// =================================================================================

function injectSidebar() {
    if (document.getElementById('jp-translator-sidebar')) return;
    const sidebar = document.createElement('div');
    sidebar.id = 'jp-translator-sidebar';
    sidebar.innerHTML = `
        <div class="sidebar-header">
            <h3>🗾 번역 워크스페이스</h3>
            <div class="sidebar-controls">
                <button id="stop-translation-btn" title="번역 중지" style="display:none;">⏹️</button>
                <button id="retry-translation-btn" title="다시 시도" style="display:none;">🔄</button>
                <button id="sidebar-close-btn" title="닫기">&times;</button>
            </div>
        </div>
        <div class="sidebar-content">
            <table id="translation-table">
                <thead>
                    <tr>
                        <th>원문 (일본어)</th>
                        <th>번역 (한국어)</th>
                        <th>저장</th>
                    </tr>
                </thead>
                <tbody id="translation-table-body"></tbody>
            </table>
            <div id="sidebar-empty-state" style="display: none; text-align: center; padding: 20px; color: #888;">
                <p>페이지의 &lt;p&gt; 태그에서 일본어를 스캔하여 번역합니다.</p>
            </div>
        </div>
        <div class="sidebar-footer">
             <div id="sidebar-log-console"></div>
        </div>
    `;
    document.body.appendChild(sidebar);

    const style = document.createElement('style');
    style.textContent = `
        #jp-translator-sidebar { position: fixed; top: 0; right: -450px; width: 450px; height: 100%; background-color: #f8f9fa; border-left: 1px solid #dee2e6; box-shadow: -2px 0 8px rgba(0,0,0,0.1); z-index: 9999; transition: right 0.3s ease-in-out; display: flex; flex-direction: column; }
        #jp-translator-sidebar.visible { right: 0; }
        .sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background-color: #667eea; color: white; flex-shrink: 0; }
        .sidebar-header h3 { margin: 0; font-size: 16px; }
        .sidebar-controls button { background: none; border: none; color: white; font-size: 20px; cursor: pointer; margin-left: 8px; }
        .sidebar-content { flex-grow: 1; overflow-y: auto; }
        .sidebar-footer { flex-shrink: 0; border-top: 1px solid #dee2e6; background-color: #333; color: #ddd; font-family: monospace; font-size: 11px; max-height: 150px; overflow-y: auto; }
        #sidebar-log-console { padding: 8px; }
        #sidebar-log-console p { margin: 0 0 4px; border-bottom: 1px solid #444; padding-bottom: 4px; }
        #sidebar-log-console .log-time { color: #888; margin-right: 8px; }
        #sidebar-log-console .log-error { color: #ff8b8b; }
        #translation-table { width: 100%; border-collapse: collapse; }
        #translation-table th, #translation-table td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #e9ecef; }
        #translation-table th { background-color: #f1f3f5; font-size: 12px; font-weight: 600; }
        #translation-table .original-text { font-size: 13px; color: #495057; word-break: break-all; }
        #translation-table .translated-text { font-size: 13px; color: #212529; outline: none; width: 100%; -webkit-user-modify: read-write-plaintext-only; }
        #translation-table .translated-text:focus { background-color: #e9f7fd; }
        #translation-table .save-btn { background-color: #4CAF50; color: white; border: none; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; }
        #translation-table .save-btn:hover { background-color: #45a049; }
        #translation-table .save-btn:disabled { background-color: #cccccc; }
    `;
    document.head.appendChild(style);
}

function showSidebar() {
    document.getElementById('jp-translator-sidebar').classList.add('visible');
    updateEmptyState();

    if (!hasScannedForP_Tags) {
        translateAllPTags();
        hasScannedForP_Tags = true;
    }
}

function hideSidebar() {
    document.getElementById('jp-translator-sidebar').classList.remove('visible');
}

function updateEmptyState() {
    const tableBody = document.getElementById('translation-table-body');
    const emptyState = document.getElementById('sidebar-empty-state');
    emptyState.style.display = tableBody.rows.length === 0 ? 'block' : 'none';
}

// =================================================================================
// Event Listeners
// =================================================================================

function setupEventListeners() {
    document.getElementById('sidebar-close-btn').addEventListener('click', hideSidebar);
    
    document.getElementById('stop-translation-btn').addEventListener('click', () => {
        isTranslationCancelled = true;
        logToSidebar("API 요청이 사용자에 의해 중지되었습니다.", "log-error");
        document.getElementById('stop-translation-btn').style.display = 'none';
        updateSidebarWithCancelled();
    });

    document.getElementById('retry-translation-btn').addEventListener('click', () => {
        logToSidebar("재번역을 시도합니다...");
        document.getElementById('retry-translation-btn').style.display = 'none';
        const tableBody = document.getElementById('translation-table-body');
        tableBody.innerHTML = ''; 
        hasScannedForP_Tags = false;
        showSidebar();
    });
}

// =================================================================================
// Data & Persistence
// =================================================================================



async function saveSingleTranslation(pid, original, translated) {
    const url = window.location.href;
    const title = document.title;
    const record = {
        url: url,
        pid: pid,
        original: original,
        translated: translated,
        timestamp: Math.floor(Date.now() / 1000),
        folderName: null,
        title: title
    };

    try {
        const response = await fetch('http://127.0.0.1:8001/translations/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([record]) // API expects an array
        });
        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }
        logToSidebar(`(pid: ${pid}) 번역을 서버에 저장했습니다.`);
    } catch (error) {
        console.error("Error saving single translation to server:", error);
        logToSidebar(`번역 저장 실패 (pid: ${pid}): ${error.message}`, "log-error");
    }
}

async function saveAllTranslations(itemsToSave) {
    if (itemsToSave.length === 0) return;

    const url = window.location.href;
    const title = document.title;
    const records = itemsToSave.map(item => ({
        url: url,
        pid: item.id,
        original: item.original,
        translated: item.translated,
        timestamp: Math.floor(Date.now() / 1000),
        folderName: null, // Or some other default
        title: title
    }));

    try {
        const response = await fetch('http://127.0.0.1:8001/translations/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(records)
        });
        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }
        logToSidebar(`${records.length}개의 번역을 서버에 저장했습니다.`);
    } catch (error) {
        console.error("Error saving all translations to server:", error);
        logToSidebar(`서버에 일괄 저장 실패: ${error.message}`, "log-error");
    }
}

// =================================================================================
// Core Translation Logic
// =================================================================================

// =================================================================================
// Core Translation Logic
// =================================================================================

function getTargetParagraphs() {
    const allParagraphs = document.querySelectorAll('p[id]');
    return Array.from(allParagraphs).filter(p => !p.classList.contains('blank') && PID_REGEX.test(p.id));
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function translateAllPTags() {
    isTranslationCancelled = false;
    document.getElementById('stop-translation-btn').style.display = 'inline-block';
    document.getElementById('retry-translation-btn').style.display = 'none';

    const paragraphs = getTargetParagraphs();
    const textsToTranslate = [];
    paragraphs.forEach(p => {
        // Check against the cache first. If it's already translated, skip.
        if (translationCache.has(p.id)) {
            return;
        }

        // Exclude PIDs starting with 'la' followed by numbers
        if (/^la\d+$/.test(p.id)) {
            return;
        }

        const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
            .replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー')
            .trim();

        // Check if the text is in the exclusion list
        if (exclusionSet.has(text)) {
            return;
        }

        if (text && JAPANESE_REGEX.test(text)) {
            textsToTranslate.push({ id: p.id, text: text });
        }
    });

    if (textsToTranslate.length === 0) {
        logToSidebar("번역할 새로운 내용이 없습니다.");
        document.getElementById('stop-translation-btn').style.display = 'none';
        return;
    }

    logToSidebar(`총 ${textsToTranslate.length}개의 문장 번역을 시작합니다.`);
    
    const longTexts = textsToTranslate.filter(item => item.text.length > LONG_TEXT_THRESHOLD);
    const normalTexts = textsToTranslate.filter(item => item.text.length <= LONG_TEXT_THRESHOLD);

    if (longTexts.length > 0) {
        logToSidebar(`경고: ${longTexts.length}개의 긴 문장(${LONG_TEXT_THRESHOLD}자 이상)이 감지되어 개별적으로 처리합니다.`);
    }
    
    addPlaceholderRows(textsToTranslate);

    const allFinishedResults = [];
    
    async function translateChunk(items, chunkSize) {
        if (isTranslationCancelled) return;
    
        const MAX_MESSAGE_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_MESSAGE_RETRIES; attempt++) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'batchTranslate',
                    items: items
                });
    
                if (isTranslationCancelled) return;
    
                if (chrome.runtime.lastError) {
                    throw new Error(chrome.runtime.lastError.message);
                }
    
                if (response && response.translations) {
                    const successes = response.translations.filter(t => !t.translated.includes('번역 실패') && !t.translated.includes('API 오류'));
                    const failures = response.translations.filter(t => t.translated.includes('번역 실패') || t.translated.includes('API 오류'));
    
                    if (successes.length > 0) {
                        updateSidebarWithTranslations(successes);
                        allFinishedResults.push(...successes);
                    }
    
                    if (failures.length > 0) {
                        const failedOriginalItems = items.filter(originalItem =>
                            failures.some(failedItem => failedItem.id === originalItem.id)
                        );
                        
                        logToSidebar(`${failedOriginalItems.length}개 항목 번역 실패. 더 작은 단위로 재시도합니다.`, 'log-error');
                        await handleFailure(failedOriginalItems, chunkSize);
                    }
                    return;
                } else {
                    throw new Error(response?.error || 'Malformed response from background script');
                }
            } catch (error) {
                console.warn(`Chunk translation failed (attempt ${attempt + 1}/${MAX_MESSAGE_RETRIES}):`, error.message);
                if (attempt < MAX_MESSAGE_RETRIES - 1) {
                    const delay = 1000 * Math.pow(2, attempt);
                    logToSidebar(`통신 오류. ${delay / 1000}초 후 재시도... (${attempt + 1}/${MAX_MESSAGE_RETRIES})`, 'log-error');
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Chunk translation failed after all retries for ${items.length} items:`, error);
                    logToSidebar(`${items.length}개 항목 통신 최종 실패. 더 작은 단위로 재시도합니다.`, 'log-error');
                    await handleFailure(items, chunkSize);
                }
            }
        }
    }
    async function handleFailure(failedItems, currentChunkSize) {
        if (isTranslationCancelled) return;
        if (currentChunkSize > 1) {
            const newChunkSize = Math.ceil(currentChunkSize / 2);
            const subChunks = chunkArray(failedItems, newChunkSize);
            for (const subChunk of subChunks) {
                await translateChunk(subChunk, newChunkSize);
            }
        } else if (failedItems.length > 0) {
            for (const item of failedItems) {
                const sentences = item.text.split('。').filter(s => s.trim().length > 0);
                
                if (sentences.length > 1) {
                    await retryWithSentenceSplitting(item);
                } else {
                    console.error(`Failed to translate item ${item.id} after retries:`, item.text);
                    const errorResultForUI = { id: item.id, original: item.text, translated: `번역 실패: API 오류` };
                    updateSidebarWithTranslations([errorResultForUI]);

                    if (!isTranslationCancelled) {
                        const resultForStorage = { id: item.id, original: item.text, translated: '' };
                        allFinishedResults.push(resultForStorage);
                    }
                }
            }
        }
    }

    async function retryWithSentenceSplitting(originalItem) {
        logToSidebar(`문장 분할 재시도... (ID: ${originalItem.id})`, 'info');

        const sentences = originalItem.text.split('。').map(s => s.trim()).filter(s => s.length > 0);
        const subItemsForApi = sentences.map((sentence, index) => ({
            id: `${originalItem.id}-part${index}`,
            text: sentence + '。'
        }));

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'batchTranslate',
                items: subItemsForApi
            });

            if (response && response.translations) {
                const translatedSentences = response.translations.map(t => t.translated);
                
                if (translatedSentences.some(t => t.includes('번역 실패') || t.includes('API 오류'))) {
                    throw new Error('Sub-sentence translation failed.');
                }
                
                const combinedTranslation = translatedSentences.join(' ');

                const finalResult = {
                    id: originalItem.id,
                    original: originalItem.text,
                    translated: combinedTranslation
                };
                updateSidebarWithTranslations([finalResult]);
                allFinishedResults.push(finalResult);
                logToSidebar(`문장 분할 번역 성공 (ID: ${originalItem.id})`);

            } else {
                throw new Error('Malformed response from background script for split sentences.');
            }

        } catch (error) {
            console.error(`Sentence splitting retry also failed for item ${originalItem.id}:`, error);
            const errorResultForUI = { id: originalItem.id, original: originalItem.text, translated: `번역 실패: 분할 재시도 실패` };
            updateSidebarWithTranslations([errorResultForUI]);

            if (!isTranslationCancelled) {
                const resultForStorage = { id: item.id, original: item.text, translated: '' };
                allFinishedResults.push(resultForStorage);
            }
        }
    }

    // Process long texts individually first
    for (const [index, item] of longTexts.entries()) {
        if (isTranslationCancelled) break;
        logToSidebar(`긴 문장 번역 중 (${index + 1}/${longTexts.length})...`);
        await translateChunk([item], 1);
        if (index < longTexts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000)); 
        }
    }

    // Then, process normal texts in batches
    if (!isTranslationCancelled && normalTexts.length > 0) {
        logToSidebar(`${normalTexts.length}개의 일반 문장을 묶음으로 번역합니다.`);
        const totalSize = normalTexts.length;
        const idealChunks = 10;
        let initialChunkSize = Math.ceil(totalSize / idealChunks);
        initialChunkSize = Math.max(5, initialChunkSize);
        initialChunkSize = Math.min(20, initialChunkSize);

        logToSidebar(`초기 묶음 크기를 ${initialChunkSize}(으)로 설정합니다.`);
        const chunks = chunkArray(normalTexts, initialChunkSize);
        let progress = 0;

        let dynamicDelay = chunks.length * 100;
        dynamicDelay = Math.max(500, dynamicDelay);
        dynamicDelay = Math.min(5000, dynamicDelay);
        logToSidebar(`동적 딜레이를 ${dynamicDelay}ms로 설정합니다.`);

        for (const [index, chunk] of chunks.entries()) {
            if (isTranslationCancelled) break;
            progress += chunk.length;
            logToSidebar(`(${progress}/${normalTexts.length}) 일반 문장 번역 진행 중...`);
            await translateChunk(chunk, initialChunkSize);

            if (index < chunks.length - 1) {
                logToSidebar(`${dynamicDelay / 1000}초 후 다음 묶음을 번역합니다.`);
                await new Promise(resolve => setTimeout(resolve, dynamicDelay));
            }
        }
    }

    // Finalize
    document.getElementById('stop-translation-btn').style.display = 'none';
    if (allFinishedResults.length > 0) {
        await saveAllTranslations(allFinishedResults);
    }
    sortSidebar();
    logToSidebar("모든 번역 작업이 완료되었습니다.");
}

async function scanForJapanesePTags() {
    const paragraphs = getTargetParagraphs();
    for (const p of paragraphs) {
        if (p.textContent && JAPANESE_REGEX.test(p.textContent.trim())) return true;
    }
    return false;
}

// =================================================================================
// Sidebar UI Population & Sorting
// =================================================================================

function populateSidebar(translations) {
    translations.forEach(addEntryToSidebar);
    updateEmptyState();
    sortSidebar();
}

function addPlaceholderRows(items) {
    const tableBody = document.getElementById('translation-table-body');
    items.forEach(item => {
        const row = tableBody.insertRow(0);
        row.setAttribute('data-pid', item.id);
        row.innerHTML = `
            <td><div class="original-text">${escapeHtml(item.text)}</div></td>
            <td><div class="translated-text" contenteditable="false">⏳ 번역 중...</div></td>
            <td><button class="save-btn" disabled>저장</button></td>
        `;
    });
    updateEmptyState();
}

function updateSidebarWithTranslations(translations) {
    translations.forEach(item => {
        const row = document.querySelector(`tr[data-pid="${item.id}"]`);
        if (row) {
            const originalCell = row.querySelector('.original-text');
            originalCell.innerHTML = escapeHtml(item.original);

            const translatedCell = row.querySelector('.translated-text');
            const saveBtn = row.querySelector('.save-btn');
            
            const isError = item.translated.includes('번역 실패') || item.translated.includes('API 오류');

            if (isError) {
                translatedCell.innerHTML = escapeHtml(item.translated);
                translatedCell.setAttribute('contenteditable', 'false');
                translatedCell.style.color = 'red';
                saveBtn.disabled = true;
            } else {
                translatedCell.innerHTML = escapeHtml(item.translated);
                translatedCell.setAttribute('contenteditable', 'true');
                translatedCell.style.color = ''; // Reset color
                saveBtn.disabled = false;

                // Clone and replace the button to remove any old listeners and attach a new one
                const newSaveBtn = saveBtn.cloneNode(true);
                saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

                newSaveBtn.addEventListener('click', async () => {
                    const editedText = translatedCell.textContent.trim();
                    await saveSingleTranslation(item.id, item.original, editedText);
                    newSaveBtn.textContent = '저장됨!';
                    setTimeout(() => { newSaveBtn.textContent = '저장'; }, 1500);
                });
            }
        }
    });
}

function addEntryToSidebar(translation) {
    const tableBody = document.getElementById('translation-table-body');
    if (document.querySelector(`tr[data-pid="${translation.pid}"]`)) return;

    const row = tableBody.insertRow();
    row.setAttribute('data-pid', translation.pid);
    row.innerHTML = `
        <td><div class="original-text">${escapeHtml(translation.original)}</div></td>
        <td><div class="translated-text" contenteditable="true">${escapeHtml(translation.translated)}</div></td>
        <td><button class="save-btn">저장</button></td>
    `;

    const saveBtn = row.querySelector('.save-btn');
    saveBtn.addEventListener('click', async () => {
        const editedText = row.querySelector('.translated-text').textContent.trim();
        await saveSingleTranslation(translation.pid, translation.original, editedText);
        saveBtn.textContent = '저장됨!';
        setTimeout(() => { saveBtn.textContent = '저장'; }, 1500);
    });
    updateEmptyState();
}

function sortSidebar() {
    const tableBody = document.getElementById('translation-table-body');
    const rows = Array.from(tableBody.querySelectorAll('tr[data-pid]'));
    const orderedPids = getTargetParagraphs().map(p => p.id);

    rows.sort((a, b) => {
        const pidA = a.dataset.pid;
        const pidB = b.dataset.pid;
        return orderedPids.indexOf(pidA) - orderedPids.indexOf(pidB);
    });

    rows.forEach(row => tableBody.appendChild(row));
}

// =================================================================================
// Utility Functions
// =================================================================================

function logToSidebar(message, level = 'log') {
    const consoleDiv = document.getElementById('sidebar-log-console');
    const logEntry = document.createElement('p');
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    
    logEntry.innerHTML = `<span class="log-time">${time}</span>`;
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    if (level === 'log-error') {
        messageSpan.className = 'log-error';
    }
    logEntry.appendChild(messageSpan);
    
    consoleDiv.prepend(logEntry);
    if (consoleDiv.children.length > 30) { // Keep log history clean
        consoleDiv.removeChild(consoleDiv.lastChild);
    }
}

function updateSidebarWithErrors(items, errorMessage) {
    items.forEach(item => {
        const row = document.querySelector(`tr[data-pid="${item.id}"]`);
        if (row) {
            const translatedCell = row.querySelector('.translated-text');
            translatedCell.textContent = `오류: ${errorMessage}`;
            translatedCell.style.color = 'red';
        }
    });
}

function updateSidebarWithCancelled() {
    const rows = document.querySelectorAll('#translation-table-body tr');
    rows.forEach(row => {
        const translatedCell = row.querySelector('.translated-text');
        if (translatedCell.textContent.includes('번역 중')) {
            translatedCell.textContent = '취소됨';
            translatedCell.style.color = 'orange';
        }
    });
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return hash.toString();
}

function escapeHtml(text) {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}