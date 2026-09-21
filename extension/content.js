// =================================================================================
// Globals & Constants
// =================================================================================

let autoScrollInterval = null;
const LONG_TEXT_THRESHOLD = 150; // Define threshold for long texts
const JAPANESE_REGEX = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/;
const PID_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;
let hasScannedForP_Tags = false;
let isTranslationCancelled = false;
let resolveResume = null; // 번역 재개를 위한 전역 resolver
let translationCache = new Map(); // Cache for original translation objects
let exclusionSet = new Set(); // Cache for excluded original texts
let isPageApplied = false; // 웹페이지 본문 번역 적용 여부 상태

// Circuit Breaker logic is now managed by background.js

// 소설 제목 및 소설별 구분선 설정 상태
let currentNovelTitle = "";
const DEFAULT_GLOBAL_SEPARATORS = [
    "＜あとがき＞",
    "&lt;あとがき&gt;",
    "【あとがき】",
    "＜解説＞",
    "【大事なお知らせ】",
    "【宣伝】",
    "お読み頂きありがとうございます！"
];
const PRESET_SEPARATORS = [
    "◎◎◎",
    "----------",
    "++",
    "　☆☆☆☆☆",
    "――――",
    "***"
];
let activeSeparators = [...DEFAULT_GLOBAL_SEPARATORS];
let separatorConfig = {
    useDefaults: true,
    customSeparators: [],
    effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS]
};

// 알림 센터 연계 재번역 검수 상태
let reviewTargetsData = null;
let reviewTargetPids = new Set();

function getCleanUrl() {
    return window.location.href.split('#')[0];
}

// =================================================================================
// Initialization & Event Listeners
// =================================================================================

// Listen for changes in storage (e.g., from the history page)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    const cleanUrl = getCleanUrl();
    const statusKey = 'status-' + window.location.href;
    const cleanStatusKey = 'status-' + cleanUrl;
    const change = changes[statusKey] || changes[cleanStatusKey];
    if (change && change.newValue) {
        const targetApplied = !!change.newValue.applied;
        if (targetApplied !== isPageApplied) {
            console.log(`[storage] Apply status changed to ${targetApplied}. Updating page smoothly.`);
            setPageApplyStatus(targetApplied, false);
        }
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// =================================================================================
// Novel Title & Separator Management
// =================================================================================

async function detectNovelTitle() {
    // 1. 서버 DB에서 해당 URL의 folderName이 있는지 확인
    try {
        const cleanUrl = getCleanUrl();
        const response = await fetch(`http://127.0.0.1:8001/api/novel_info?url=${encodeURIComponent(cleanUrl)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.folderName) {
                return data.folderName;
            }
        }
    } catch (e) {
        console.warn("[detectNovelTitle] Failed to fetch folderName from server:", e);
    }

    // 2. 사이트별 DOM 파싱
    const host = window.location.hostname;
    
    if (host.includes('kakuyomu.jp')) {
        const workLink = document.querySelector('header a[href*="/works/"]') || 
                         document.querySelector('.widget-toc-main-title') ||
                         document.querySelector('a[href^="/works/"][class*="Title"]');
        if (workLink && workLink.textContent.trim()) {
            return workLink.textContent.trim();
        }
        const titleText = document.title.replace(/\s*-\s*カクヨム.*$/i, '').trim();
        const parts = titleText.split(/\s*-\s*/);
        if (parts.length > 1) {
            let novelPart = parts[parts.length - 1].trim();
            novelPart = novelPart.replace(/（[^）]+）$/, '').trim();
            novelPart = novelPart.replace(/\([^)]+\)$/, '').trim();
            if (novelPart) return novelPart;
        }
    } else if (host.includes('syosetu.com')) {
        // 쇼세츠 소설 본 제목 요소 탐색
        // 주의: .p-novel__title 은 화별 소제목(h1)이므로 절대 사용하지 말 것
        const novelLink = document.querySelector('.c-announce a[href*="/n"]') ||
                          document.querySelector('.p-novel__series-link') || 
                          document.querySelector('.novel_title') ||
                          document.querySelector('a.margin_r20');
        if (novelLink && novelLink.textContent.trim()) {
            return novelLink.textContent.trim();
        }
        const parts = document.title.split(/\s*-\s*/);
        if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
        }
    }

    // 3. Fallback: document.title 파싱
    const cleanDocTitle = document.title.split(/[-|–—]/)[0].trim();
    return cleanDocTitle || "기본 소설";
}

async function loadNovelSeparators(novelTitle) {
    if (!novelTitle) novelTitle = "기본 소설";
    try {
        const resp = await fetch(`http://127.0.0.1:8001/api/separators?novel_title=${encodeURIComponent(novelTitle)}`);
        if (resp.ok) {
            const data = await resp.json();
            separatorConfig = {
                useDefaults: data.use_defaults,
                customSeparators: data.custom_separators || [],
                effectiveSeparators: data.effective_separators || []
            };
            activeSeparators = data.effective_separators;
            
            const cacheKey = `separators_${novelTitle}`;
            chrome.storage.local.set({ [cacheKey]: separatorConfig });
            return separatorConfig;
        }
    } catch (e) {
        console.warn("[loadNovelSeparators] Server request failed, falling back to local storage:", e);
    }

    try {
        const cacheKey = `separators_${novelTitle}`;
        const stored = await chrome.storage.local.get(cacheKey);
        if (stored[cacheKey]) {
            separatorConfig = stored[cacheKey];
            activeSeparators = separatorConfig.effectiveSeparators || [];
            return separatorConfig;
        }
    } catch (e) {
        console.error("[loadNovelSeparators] Local storage get failed:", e);
    }

    activeSeparators = [...DEFAULT_GLOBAL_SEPARATORS];
    separatorConfig = {
        useDefaults: true,
        customSeparators: [],
        effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS]
    };
    return separatorConfig;
}

async function saveNovelSeparators(novelTitle, customSeparators, useDefaults) {
    const payload = {
        novel_title: novelTitle,
        separators: customSeparators,
        use_defaults: useDefaults
    };

    let effective = [];
    if (useDefaults) {
        effective.push(...DEFAULT_GLOBAL_SEPARATORS);
    }
    for (const s of customSeparators) {
        if (!effective.includes(s)) {
            effective.push(s);
        }
    }

    separatorConfig = {
        useDefaults: useDefaults,
        customSeparators: customSeparators,
        effectiveSeparators: effective
    };
    activeSeparators = effective;

    const cacheKey = `separators_${novelTitle}`;
    await chrome.storage.local.set({ [cacheKey]: separatorConfig });

    try {
        const resp = await fetch('http://127.0.0.1:8001/api/separators', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) {
            console.warn("Failed to persist separators to server, stored locally:", resp.status);
        }
    } catch (e) {
        console.warn("Server unavailable while saving separators, stored locally:", e);
    }

    return separatorConfig;
}

async function resetNovelSeparators(novelTitle) {
    try {
        await fetch(`http://127.0.0.1:8001/api/separators?novel_title=${encodeURIComponent(novelTitle)}`, {
            method: 'DELETE'
        });
    } catch (e) {
        console.warn("Server delete request failed:", e);
    }

    const cacheKey = `separators_${novelTitle}`;
    await chrome.storage.local.remove(cacheKey);

    activeSeparators = [...DEFAULT_GLOBAL_SEPARATORS];
    separatorConfig = {
        useDefaults: true,
        customSeparators: [],
        effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS]
    };
    return separatorConfig;
}

function checkSeparatorMatch(text, separators) {
    if (!text || !separators || separators.length === 0) return null;
    for (const sep of separators) {
        if (!sep) continue;
        if (sep === '— (em-dash)' || sep === '^[\\s—]+$') {
            if (/^[\s—]+$/.test(text)) return sep;
        } else if (text.includes(sep)) {
            return sep;
        }
    }
    return null;
}

function updateNovelTitleUI(title) {
    const displayElem = document.getElementById('current-novel-title-display');
    if (displayElem) {
        displayElem.textContent = title || '소설 없음';
        displayElem.title = `클릭하여 소설 제목 변경 (${title || '미지정'})`;
    }
}

// =================================================================================
// 알림 센터 연계 재번역 검수 로직 (Review Target Highlighting & Inspection)
// =================================================================================

async function checkAndLoadReviewTargets() {
    try {
        const cleanUrl = getCleanUrl();
        let batchId = null;
        if (window.location.hash.includes('lanovel_review=')) {
            const hashMatch = window.location.hash.match(/lanovel_review=([^&]+)/);
            if (hashMatch) {
                batchId = decodeURIComponent(hashMatch[1]);
            }
        }

        let apiUrl = `http://127.0.0.1:8001/cleanup/review_targets?url=${encodeURIComponent(cleanUrl)}`;
        if (batchId) {
            apiUrl += `&batch_id=${encodeURIComponent(batchId)}`;
        }

        const res = await fetch(apiUrl);
        if (!res.ok) return;
        const data = await res.json();

        if (data.has_targets && Array.isArray(data.targets) && data.targets.length > 0) {
            reviewTargetsData = data;
            reviewTargetPids = new Set(data.targets.map(t => t.pid).filter(Boolean));
            console.log(`[ReviewTargets] 재번역 검수 대상 ${reviewTargetPids.size}개 감지:`, Array.from(reviewTargetPids));

            // 상단 검수 패널 렌더링
            renderReviewTargetPanel();

            // 본문 DOM 강조
            highlightReviewTargetDOMs();

            // 사이드바 행이 이미 존재하는 경우 강조 스타일 및 배지 적용
            updateSidebarReviewTargetHighlights();

            // 해시를 통해 검수 목적으로 방문한 경우 사이드바 자동 오픈 및 안내
            if (window.location.hash.includes('lanovel_review')) {
                showSidebar();
                logToSidebar(`🔔 [알림 센터 연계] 재번역 검수 대상 ${data.targets.length}건이 감지되었습니다. 상단 패널을 확인하세요.`);
            }
        }
    } catch (e) {
        console.warn("[checkAndLoadReviewTargets] Failed to load review targets:", e);
    }
}

function updateSidebarReviewTargetHighlights() {
    if (!reviewTargetPids || reviewTargetPids.size === 0) return;
    reviewTargetPids.forEach(pid => {
        const row = document.querySelector(`tr[data-pid="${pid}"]`);
        if (row) {
            row.classList.add('review-target-row');
            const origDiv = row.querySelector('.original-text');
            if (origDiv && !origDiv.querySelector('.review-badge')) {
                origDiv.insertAdjacentHTML('afterbegin', '<span class="review-badge" title="알림 센터 연계 재번역 검수 문장">⚡재검수</span>');
            }
        }
    });
}

function renderReviewTargetPanel() {
    const panel = document.getElementById('review-target-panel');
    if (!panel || !reviewTargetsData || !reviewTargetsData.targets || reviewTargetsData.targets.length === 0) {
        if (panel) panel.style.display = 'none';
        return;
    }

    const targets = reviewTargetsData.targets;
    const notifId = reviewTargetsData.notif_id;

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="review-panel-header">
            <span class="review-panel-title">
                <span>🔔</span>
                <span>알림 센터 재번역 검수 (<strong id="review-panel-count">${targets.length}</strong>건)</span>
            </span>
            <div class="review-panel-actions">
                ${notifId ? `<button class="review-dismiss-btn" id="review-dismiss-btn" title="검수를 마치고 알림 센터의 해당 알림을 해제합니다">✓ 검수 완료</button>` : ''}
                <button id="close-review-panel-btn" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #b45309; line-height: 1;">&times;</button>
            </div>
        </div>
        <div class="review-panel-body" id="review-panel-cards">
            ${targets.map(t => {
                const currentTrans = translationCache.get(t.pid);
                const transText = currentTrans && currentTrans.translated ? escapeHtml(currentTrans.translated) : '번역 대기 중...';
                const isWaiting = !currentTrans || !currentTrans.translated;
                return `
                    <div class="review-card" data-pid="${escapeHtml(t.pid || '')}">
                        <div class="review-card-pid">문장 ID: ${escapeHtml(t.pid || '알 수 없음')}</div>
                        <div class="review-card-ori" title="${escapeHtml(t.original)}">원문: ${escapeHtml(t.original)}</div>
                        <div class="review-card-tra ${isWaiting ? 'waiting' : ''}" id="review-tra-${escapeHtml(t.pid || '')}">
                            번역: ${transText}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    const closeBtn = document.getElementById('close-review-panel-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }

    const dismissBtn = document.getElementById('review-dismiss-btn');
    if (dismissBtn && notifId) {
        dismissBtn.addEventListener('click', async () => {
            try {
                dismissBtn.disabled = true;
                dismissBtn.textContent = '처리 중...';
                const res = await fetch(`http://127.0.0.1:8001/cleanup/notifications/${notifId}/dismiss`, { method: 'POST' });
                if (res.ok) {
                    dismissBtn.textContent = '해제됨!';
                    logToSidebar("알림 센터의 해당 삭제 알림이 해제되었습니다.");
                    setTimeout(() => {
                        panel.style.display = 'none';
                    }, 1000);
                }
            } catch (err) {
                console.error('알림 해제 실패:', err);
                dismissBtn.textContent = '해제 실패';
            }
        });
    }

    const cardContainer = document.getElementById('review-panel-cards');
    if (cardContainer) {
        cardContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.review-card');
            if (card && card.dataset.pid) {
                focusAndScrollToPid(card.dataset.pid);
            }
        });
    }
}

function focusAndScrollToPid(pid) {
    if (!pid) return;

    // 1. 사이드바 테이블 내 행으로 스크롤 및 하이라이트
    const row = document.querySelector(`tr[data-pid="${pid}"]`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('lanovel-row-highlight');
        void row.offsetWidth; // Reflow
        row.classList.add('lanovel-row-highlight');
    }

    // 2. 웹페이지 본문 문단으로 스크롤 및 하이라이트
    const p = document.getElementById(pid);
    if (p) {
        p.scrollIntoView({ behavior: 'smooth', block: 'center' });
        p.classList.remove('lanovel-highlight-pulse');
        void p.offsetWidth;
        p.classList.add('lanovel-highlight-pulse');
    }
}

function highlightReviewTargetDOMs() {
    if (!reviewTargetPids || reviewTargetPids.size === 0) return;
    reviewTargetPids.forEach(pid => {
        const p = document.getElementById(pid);
        if (p) {
            p.classList.add('review-target-dom');
            p.title = "🔔 알림 센터 연계 재번역 검수 대상 문장입니다.";
        }
    });
}

async function init() {
    try {
        // 0. Check if the current origin is allowed
        const response = await fetch('http://127.0.0.1:8001/api/allowed_origins');
        if (!response.ok) {
            console.warn('Could not fetch allowed origins from server. Stopping initialization.');
            return;
        }
        const allowedOrigins = await response.json();
        const currentUrl = window.location.href;
        const isAllowed = allowedOrigins.some(origin => currentUrl.startsWith(origin));

        if (!isAllowed) {
            console.log(`Translator extension disabled: Current URL (${currentUrl}) is not in the allowed origins list.`);
            return; // Stop execution if the origin is not allowed
        }

        console.log("Translator extension initializing...");

        injectSidebar();
        setupEventListeners();

        // 0.5. 소설 제목 감지 및 해당 소설의 구분선 설정 로드
        currentNovelTitle = await detectNovelTitle();
        updateNovelTitleUI(currentNovelTitle);
        await loadNovelSeparators(currentNovelTitle);
        renderSeparatorSettingsPanel();

        // 1. Fetch existing translations and exclusion list in parallel
        const url = getCleanUrl();
        const [translations, excluded] = await Promise.all([
            fetchTranslationsForUrl(url),
            fetchExclusionsForUrl(url)
        ]);

        if (excluded) {
            exclusionSet = new Set(excluded);
        }

        // 2. 알림 센터 연계 재번역 검수 대상 먼저 조회하여 reviewTargetPids 사전 확보
        await checkAndLoadReviewTargets();

        if (translations) {
            // 2.5. Populate cache and sidebar with existing data (단, 빈 번역문은 유효 번역 캐시에서 제외)
            translationCache.clear();
            translations.forEach(t => {
                if (t.translated && t.translated.trim()) {
                    translationCache.set(t.pid, t);
                }
            });
            populateSidebar(translations);
            logToSidebar(`서버에서 ${translations.length}개의 저장된 번역을 불러왔습니다.`);
        }

        // 3. Check if translations should be applied to the page content
        let initialApplied = false;
        try {
            const response = await fetch(`http://127.0.0.1:8001/api/urls/apply_status?url=${encodeURIComponent(url)}`);
            if (response.ok) {
                const status = await response.json();
                initialApplied = !!status.applied;
            }
        } catch (e) {
            console.warn('Could not fetch apply status from server', e);
            try {
                const storageResult = await chrome.storage.local.get(['status-' + url, 'status-' + window.location.href]);
                const localStatus = storageResult['status-' + url] || storageResult['status-' + window.location.href];
                if (localStatus && typeof localStatus.applied === 'boolean') {
                    initialApplied = localStatus.applied;
                }
            } catch (storageErr) {
                console.warn('Could not fetch apply status from chrome storage', storageErr);
            }
        }

        isPageApplied = initialApplied;
        updateApplyButtonUI(isPageApplied);
        if (isPageApplied && translations) {
            applyTranslationsToPage(translations, false);
        }

        // 본문 문단 클릭 연동 활성화
        setupParagraphInteraction();

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

function applyTranslationsToPage(translations, logNotification = true) {
    if (!translations || translations.length === 0) return;

    const translationMap = new Map(translations.map(t => [t.pid || t.id, t.translated]));
    const paragraphs = getTargetParagraphs();
    let replacementCount = 0;

    paragraphs.forEach(p => {
        if (translationMap.has(p.id)) {
            const translatedText = translationMap.get(p.id);
            if (translatedText && !translatedText.includes('번역 실패') && !translatedText.includes('API 오류')) {
                // 최초 적용 시 원문 HTML 및 스타일을 데이터셋에 안전하게 보관
                if (!p.dataset.lanovelOriginalHtml) {
                    p.dataset.lanovelOriginalHtml = p.innerHTML;
                    p.dataset.lanovelOriginalStyle = p.getAttribute('style') || '';
                }
                p.innerHTML = translatedText;
                p.classList.add('lanovel-applied-text');
                const appliedStyle = { color: '#E2E8F0', fontFamily: 'TwoCon' };
                Object.assign(p.style, appliedStyle);
                replacementCount++;
            }
        }
    });

    console.log(`[applyTranslationsToPage] Applied ${replacementCount} translations to page content.`);
    if (logNotification && replacementCount > 0) {
        logToSidebar(`페이지에 번역 ${replacementCount}개를 적용했습니다.`);
    }
    updateApplyButtonUI(true);
    setupParagraphInteraction();
}

function restoreOriginalPage() {
    const paragraphs = getTargetParagraphs();
    let restoredCount = 0;

    paragraphs.forEach(p => {
        if (p.dataset.lanovelOriginalHtml) {
            p.innerHTML = p.dataset.lanovelOriginalHtml;
            if (p.dataset.lanovelOriginalStyle) {
                p.setAttribute('style', p.dataset.lanovelOriginalStyle);
            } else {
                p.removeAttribute('style');
            }
            p.classList.remove('lanovel-applied-text');
            restoredCount++;
        }
    });

    console.log(`[restoreOriginalPage] Restored ${restoredCount} paragraphs to original.`);
    logToSidebar(`본문을 원문으로 복원했습니다 (${restoredCount}개 문단).`);
    updateApplyButtonUI(false);
    setupParagraphInteraction();
}

function updateApplyButtonUI(applied) {
    const dot = document.getElementById('apply-status-dot');
    const text = document.getElementById('apply-status-text');
    const count = document.getElementById('apply-stats-count');
    const btn = document.getElementById('sidebar-apply-toggle-btn');
    const btnIcon = document.getElementById('apply-btn-icon');
    const btnText = document.getElementById('apply-btn-text');

    const paragraphs = getTargetParagraphs();
    const totalTarget = paragraphs.length;
    const translatedCount = translationCache.size;

    if (count) {
        count.textContent = `(번역 ${translatedCount}개 / 본문 ${totalTarget}개)`;
    }

    if (applied) {
        if (dot) dot.className = 'status-dot applied';
        if (text) {
            text.className = 'apply-status-text applied';
            text.textContent = '본문 번역 적용 중';
        }
        if (btn) {
            btn.className = 'sidebar-apply-btn applied';
            btn.title = '클릭하면 웹페이지 본문을 원문으로 복원합니다.';
        }
        if (btnIcon) btnIcon.textContent = '✅';
        if (btnText) btnText.textContent = '적용 중 (원문 복원)';
    } else {
        if (dot) dot.className = 'status-dot';
        if (text) {
            text.className = 'apply-status-text';
            text.textContent = '원문 표시 중';
        }
        if (btn) {
            btn.className = 'sidebar-apply-btn';
            btn.title = '클릭하면 번역문을 웹페이지 본문에 적용합니다.';
        }
        if (btnIcon) btnIcon.textContent = '📄';
        if (btnText) btnText.textContent = '페이지에 적용';
    }
}

async function setPageApplyStatus(applied, syncStorageAndServer = true) {
    isPageApplied = applied;

    if (isPageApplied) {
        const allTranslations = Array.from(translationCache.values());
        applyTranslationsToPage(allTranslations, true);
    } else {
        restoreOriginalPage();
    }

    updateApplyButtonUI(isPageApplied);

    if (syncStorageAndServer) {
        const cleanUrl = getCleanUrl();
        const currentUrl = window.location.href;

        // 1. 서버 API 동기화
        try {
            await fetch('http://127.0.0.1:8001/api/urls/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: cleanUrl, apply: isPageApplied })
            });
        } catch (e) {
            console.warn('[setPageApplyStatus] Failed to sync apply status to server:', e);
        }

        // 2. 확장 프로그램 storage 동기화
        try {
            const statusObj = { applied: isPageApplied, timestamp: Date.now() };
            await chrome.storage.local.set({
                ['status-' + cleanUrl]: statusObj,
                ['status-' + currentUrl]: statusObj
            });
        } catch (e) {
            console.warn('[setPageApplyStatus] Failed to sync apply status to chrome storage:', e);
        }
    }
}

function togglePageApplyStatus() {
    setPageApplyStatus(!isPageApplied, true);
}

// 본문 문단 클릭 시 사이드바의 해당 번역 행으로 이동 & 하이라이트
function setupParagraphInteraction() {
    const paragraphs = getTargetParagraphs();
    paragraphs.forEach(p => {
        if (p.dataset.lanovelLinked) return;
        p.dataset.lanovelLinked = 'true';

        p.addEventListener('click', (e) => {
            // 본문 텍스트 드래그 선택 중인 경우 무시
            const selection = window.getSelection();
            if (selection && selection.toString().trim().length > 0) return;

            const row = document.querySelector(`tr[data-pid="${p.id}"]`);
            if (row) {
                const sidebar = document.getElementById('jp-translator-sidebar');
                if (sidebar && !sidebar.classList.contains('visible')) {
                    showSidebar();
                }
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.remove('lanovel-row-highlight');
                void row.offsetWidth;
                row.classList.add('lanovel-row-highlight');
                setTimeout(() => {
                    row.classList.remove('lanovel-row-highlight');
                }, 1600);
            }
        });
    });
}

// 사이드바 행 클릭 시 본문의 해당 문단으로 스크롤 이동 & 하이라이트
function handleSidebarRowClick(pid, e) {
    if (e && (e.target.closest('button') || e.target.closest('.translated-text') || e.target.tagName === 'INPUT')) {
        return;
    }
    const targetP = document.getElementById(pid);
    if (targetP) {
        targetP.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetP.classList.remove('lanovel-highlight-pulse');
        void targetP.offsetWidth;
        targetP.classList.add('lanovel-highlight-pulse');
        setTimeout(() => {
            targetP.classList.remove('lanovel-highlight-pulse');
        }, 1600);
    }
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
                <button id="separator-settings-btn" title="소설별 구분선 설정">⚙️</button>
                <button id="stop-translation-btn" title="번역 중지" style="display:none;">⏹️</button>
                <button id="resume-translation-btn" title="번역 재개" style="display:none;">▶️</button>
                <button id="retry-translation-btn" title="다시 시도" style="display:none;">🔄</button>
                <button id="sidebar-close-btn" title="닫기">&times;</button>
            </div>
        </div>
        <div id="sidebar-novel-banner" class="sidebar-novel-banner">
            <div class="novel-banner-info">
                <span class="novel-banner-icon">📖</span>
                <span id="current-novel-title-display" class="novel-banner-title" title="클릭하여 소설 제목 수정">소설 감지 중...</span>
                <button id="edit-novel-title-btn" class="novel-banner-btn" title="소설 제목 직접 변경">✏️</button>
            </div>
            <button id="toggle-sep-panel-btn" class="novel-banner-sep-toggle" title="이 소설의 구분선 설정">⚙️ 구분선 설정</button>
        </div>
        <div id="separator-settings-panel" class="separator-settings-panel" style="display: none;">
            <div class="sep-panel-header">
                <span class="sep-panel-title">⚙️ 소설별 번역 구분선(작가의 말) 설정</span>
                <button id="close-sep-panel-btn" class="sep-close-btn">&times;</button>
            </div>
            <div class="sep-panel-body">
                <div class="sep-info-box">
                    <span class="sep-novel-name" id="panel-novel-name-display"></span>의 작가의 말 구분선 설정입니다. 본문 맥락선과 겹치지 않게 주의하세요.
                </div>
                <div class="sep-form-group">
                    <label class="sep-checkbox-label">
                        <input type="checkbox" id="use-global-defaults-check" checked>
                        <span>공통 후기 키워드 포함 (＜あとがき＞, 【大事なお知らせ】 등)</span>
                    </label>
                </div>
                <div class="sep-section-title">적용 중인 구분선 목록:</div>
                <div id="active-separators-container" class="sep-tags-wrap"></div>
                
                <div class="sep-section-title">자주 쓰는 기호 빠른 추가:</div>
                <div id="preset-buttons-container" class="sep-presets-wrap"></div>

                <div class="sep-section-title">새 구분선 직접 추가:</div>
                <div class="sep-input-row">
                    <input type="text" id="new-separator-input" placeholder="추가할 기호/문자열 입력 (예: ◎◎◎)" class="sep-input">
                    <button id="add-separator-btn" class="sep-add-btn">추가</button>
                </div>

                <div class="sep-panel-footer">
                    <button id="save-separators-btn" class="sep-save-btn">💾 설정 저장</button>
                    <button id="reset-separators-btn" class="sep-reset-btn">기본값 복원</button>
                </div>
            </div>
        </div>
        <div id="sidebar-apply-banner" class="sidebar-apply-banner">
            <div class="apply-status-info">
                <span id="apply-status-dot" class="status-dot"></span>
                <span id="apply-status-text" class="apply-status-text">원문 표시 중</span>
                <span id="apply-stats-count" class="apply-stats-count">(0개 적용)</span>
            </div>
            <button id="sidebar-apply-toggle-btn" class="sidebar-apply-btn" title="웹페이지 본문에 번역을 즉시 적용하거나 원문으로 복원합니다">
                <span id="apply-btn-icon" class="apply-btn-icon">📄</span>
                <span id="apply-btn-text" class="apply-btn-text">페이지에 적용</span>
            </button>
        </div>
        <div id="review-target-panel" class="review-target-panel" style="display: none;"></div>
        <div class="sidebar-content">
            <table id="translation-table">
                <thead>
                    <tr>
                        <th>원문 (일본어)</th>
                        <th>번역 (한국어)</th>
                        <th>관리</th>
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

    const toggleButton = document.createElement('button');
    toggleButton.id = 'jp-translator-toggle-btn';
    toggleButton.innerHTML = '文';
    document.body.appendChild(toggleButton);

    const style = document.createElement('style');
    style.textContent = `
        #jp-translator-sidebar { position: fixed; top: 0; right: 0; width: 460px; max-width: 90vw; min-width: 320px; height: 100%; background-color: #f8f9fa; border-left: 1px solid #dee2e6; box-shadow: -2px 0 8px rgba(0,0,0,0.1); z-index: 9999; transform: translateX(100%); transition: transform 0.3s ease-in-out; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        #jp-translator-sidebar.visible { transform: translateX(0); }
        .sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background-color: #667eea; color: white; flex-shrink: 0; }
        .sidebar-header h3 { margin: 0; font-size: 16px; }
        .sidebar-controls button { background: none; border: none; color: white; font-size: 18px; cursor: pointer; margin-left: 6px; }
        .sidebar-novel-banner { display: flex; justify-content: space-between; align-items: center; padding: 7px 12px; background: #eef2ff; border-bottom: 1px solid #c7d2fe; font-size: 12px; flex-shrink: 0; }
        .novel-banner-info { display: flex; align-items: center; gap: 5px; overflow: hidden; flex: 1; }
        .novel-banner-icon { font-size: 14px; }
        .novel-banner-title { font-weight: 600; color: #3730a3; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; border-bottom: 1px dashed #6366f1; }
        .novel-banner-title:hover { color: #4338ca; background: #e0e7ff; }
        .novel-banner-btn { background: none; border: none; cursor: pointer; font-size: 12px; padding: 0 2px; }
        .novel-banner-sep-toggle { background: #4f46e5; color: white; border: none; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-weight: 500; white-space: nowrap; }
        .novel-banner-sep-toggle:hover { background: #4338ca; }
        .sidebar-apply-banner { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #ffffff; border-bottom: 1px solid #e2e8f0; font-size: 12px; flex-shrink: 0; }
        .apply-status-info { display: flex; align-items: center; gap: 6px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background-color: #94a3b8; display: inline-block; transition: background-color 0.3s; }
        .status-dot.applied { background-color: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.6); }
        .apply-status-text { font-weight: 600; color: #475569; }
        .apply-status-text.applied { color: #059669; }
        .apply-stats-count { font-size: 11px; color: #64748b; }
        .sidebar-apply-btn { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #cbd5e1; background: #f8fafc; color: #334155; padding: 4px 10px; border-radius: 5px; font-size: 11.5px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .sidebar-apply-btn:hover { background: #f1f5f9; border-color: #94a3b8; }
        .sidebar-apply-btn.applied { background: #10b981; border-color: #059669; color: white; }
        .sidebar-apply-btn.applied:hover { background: #059669; }
        #translation-table tbody tr { cursor: pointer; transition: background-color 0.2s; }
        #translation-table tbody tr:hover { background-color: #f1f5f9; }
        .lanovel-row-highlight { animation: lanovelRowPulse 1.5s ease-out; }
        @keyframes lanovelRowPulse { 0% { background-color: #fef08a !important; } 100% { background-color: transparent; } }
        .separator-settings-panel { background: #ffffff; border-bottom: 2px solid #6366f1; padding: 12px 14px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); font-size: 12px; max-height: 380px; overflow-y: auto; flex-shrink: 0; }
        .sep-panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .sep-panel-title { font-weight: 600; color: #1e1b4b; font-size: 13px; }
        .sep-close-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: #64748b; line-height: 1; }
        .sep-info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 10px; margin-bottom: 8px; color: #475569; font-size: 11px; line-height: 1.4; }
        .sep-novel-name { font-weight: 600; color: #4f46e5; }
        .sep-form-group { margin-bottom: 8px; }
        .sep-checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; color: #334155; font-size: 11.5px; }
        .sep-section-title { font-size: 11px; font-weight: 600; color: #475569; margin: 8px 0 4px; }
        .sep-tags-wrap { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; min-height: 26px; }
        .sep-tag { display: inline-flex; align-items: center; background: #e0e7ff; color: #3730a3; padding: 2px 7px; border-radius: 12px; font-size: 11px; font-weight: 500; }
        .sep-tag.is-custom { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
        .sep-tag-remove { margin-left: 4px; cursor: pointer; color: #ef4444; font-weight: bold; font-size: 13px; }
        .sep-tag-remove:hover { color: #b91c1c; }
        .sep-presets-wrap { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
        .sep-preset-btn { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 6px; font-size: 11px; cursor: pointer; color: #334155; transition: background 0.2s; }
        .sep-preset-btn:hover { background: #e2e8f0; }
        .sep-input-row { display: flex; gap: 4px; margin-bottom: 10px; }
        .sep-input { flex: 1; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; outline: none; }
        .sep-input:focus { border-color: #6366f1; }
        .sep-add-btn { background: #6366f1; color: white; border: none; border-radius: 4px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
        .sep-add-btn:hover { background: #4f46e5; }
        .sep-panel-footer { display: flex; justify-content: flex-end; gap: 6px; border-top: 1px solid #f1f5f9; padding-top: 8px; }
        .sep-save-btn { background: #10b981; color: white; border: none; border-radius: 4px; padding: 5px 12px; font-size: 12px; cursor: pointer; font-weight: 500; }
        .sep-save-btn:hover { background: #059669; }
        .sep-reset-btn { background: #94a3b8; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
        .sep-reset-btn:hover { background: #64748b; }
        .sidebar-content { flex-grow: 1; overflow-y: auto; }
        .sidebar-footer { flex-shrink: 0; border-top: 1px solid #dee2e6; background-color: #333; color: #ddd; font-family: monospace; font-size: 11px; max-height: 150px; overflow-y: auto; }
        #sidebar-log-console { padding: 8px; }
        #sidebar-log-console p { margin: 0 0 4px; border-bottom: 1px solid #444; padding-bottom: 4px; }
        .log-time { margin-right: 8px; }
        .log-error { color: #ff6b6b !important; }
        #translation-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        #translation-table th, #translation-table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #e9ecef; }
        #translation-table th:nth-child(1) { width: 40%; }
        #translation-table th:nth-child(2) { width: 42%; }
        #translation-table th:nth-child(3) { width: 18%; }
        #translation-table th { background-color: #f1f3f5; font-size: 12px; font-weight: 600; }
        #translation-table .original-text { font-size: 13px; color: #495057; word-break: break-all; }
        #translation-table .translated-text { font-size: 13px; color: #212529; outline: none; width: 100%; -webkit-user-modify: read-write-plaintext-only; }
        #translation-table .translated-text:focus { background-color: #e9f7fd; }
        #translation-table .action-btns { display: flex; gap: 4px; align-items: center; }
        #translation-table .save-btn { background-color: #4CAF50; color: white; border: none; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; }
        #translation-table .save-btn:hover { background-color: #45a049; }
        #translation-table .save-btn:disabled { background-color: #cccccc; cursor: not-allowed; }
        #jp-translator-toggle-btn { position: fixed; top: 50%; left: 0; transform: translateY(-50%); background-color: #667eea; color: white; border: none; border-top-right-radius: 5px; border-bottom-right-radius: 5px; padding: 10px 5px; cursor: pointer; z-index: 9998; font-size: 18px; writing-mode: vertical-rl; }
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

function toggleSidebar() {
    const sidebar = document.getElementById('jp-translator-sidebar');
    if (sidebar.classList.contains('visible')) {
        hideSidebar();
    } else {
        showSidebar();
    }
}

function updateEmptyState() {
    const tableBody = document.getElementById('translation-table-body');
    const emptyState = document.getElementById('sidebar-empty-state');
    emptyState.style.display = tableBody.rows.length === 0 ? 'block' : 'none';
}

function toggleSeparatorPanel() {
    const panel = document.getElementById('separator-settings-panel');
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
        panel.style.display = 'block';
        renderSeparatorSettingsPanel();
    } else {
        panel.style.display = 'none';
    }
}

function renderSeparatorSettingsPanel() {
    const panel = document.getElementById('separator-settings-panel');
    if (!panel) return;

    const novelNameDisplay = document.getElementById('panel-novel-name-display');
    if (novelNameDisplay) {
        novelNameDisplay.textContent = `'${currentNovelTitle || "기본 소설"}'`;
    }

    const useDefaultsCheck = document.getElementById('use-global-defaults-check');
    if (useDefaultsCheck) {
        useDefaultsCheck.checked = separatorConfig.useDefaults !== false;
    }

    // 태그 칩 렌더링
    const tagsContainer = document.getElementById('active-separators-container');
    if (tagsContainer) {
        tagsContainer.innerHTML = '';
        if (activeSeparators.length === 0) {
            tagsContainer.innerHTML = '<span style="color:#94a3b8; font-style:italic; font-size:11px;">설정된 구분선이 없습니다.</span>';
        } else {
            activeSeparators.forEach(sep => {
                const isDefault = DEFAULT_GLOBAL_SEPARATORS.includes(sep);
                const tag = document.createElement('span');
                tag.className = 'sep-tag' + (isDefault ? '' : ' is-custom');
                tag.innerHTML = `<span>${escapeHtml(sep)}</span><span class="sep-tag-remove" title="제거">&times;</span>`;
                tag.querySelector('.sep-tag-remove').addEventListener('click', () => {
                    removeSeparator(sep);
                });
                tagsContainer.appendChild(tag);
            });
        }
    }

    // 프리셋 버튼 렌더링
    const presetsContainer = document.getElementById('preset-buttons-container');
    if (presetsContainer) {
        presetsContainer.innerHTML = '';
        PRESET_SEPARATORS.forEach(preset => {
            const isAdded = activeSeparators.includes(preset);
            const btn = document.createElement('button');
            btn.className = 'sep-preset-btn';
            btn.textContent = (isAdded ? '✓ ' : '+ ') + preset;
            if (isAdded) {
                btn.style.opacity = '0.6';
                btn.style.borderColor = '#10b981';
                btn.style.color = '#059669';
            }
            btn.addEventListener('click', () => {
                if (!isAdded) {
                    addSeparator(preset);
                } else {
                    removeSeparator(preset);
                }
            });
            presetsContainer.appendChild(btn);
        });
    }
}

function addSeparator(sep) {
    sep = sep.trim();
    if (!sep) return;
    if (!activeSeparators.includes(sep)) {
        activeSeparators.push(sep);
        if (!separatorConfig.customSeparators.includes(sep)) {
            separatorConfig.customSeparators.push(sep);
        }
        renderSeparatorSettingsPanel();
    }
}

function removeSeparator(sep) {
    activeSeparators = activeSeparators.filter(s => s !== sep);
    separatorConfig.customSeparators = separatorConfig.customSeparators.filter(s => s !== sep);
    renderSeparatorSettingsPanel();
}

// =================================================================================
// Event Listeners
// =================================================================================

function setupEventListeners() {
    document.getElementById('sidebar-close-btn').addEventListener('click', hideSidebar);
    document.getElementById('jp-translator-toggle-btn').addEventListener('click', toggleSidebar);
    
    const applyToggleBtn = document.getElementById('sidebar-apply-toggle-btn');
    if (applyToggleBtn) {
        applyToggleBtn.addEventListener('click', togglePageApplyStatus);
    }
    
    // 구분선 설정 패널 이벤트 연결
    const sepSettingsBtn = document.getElementById('separator-settings-btn');
    if (sepSettingsBtn) sepSettingsBtn.addEventListener('click', toggleSeparatorPanel);

    const toggleSepPanelBtn = document.getElementById('toggle-sep-panel-btn');
    if (toggleSepPanelBtn) toggleSepPanelBtn.addEventListener('click', toggleSeparatorPanel);

    const closeSepPanelBtn = document.getElementById('close-sep-panel-btn');
    if (closeSepPanelBtn) closeSepPanelBtn.addEventListener('click', () => {
        const panel = document.getElementById('separator-settings-panel');
        if (panel) panel.style.display = 'none';
    });

    const addSepBtn = document.getElementById('add-separator-btn');
    const newSepInput = document.getElementById('new-separator-input');
    if (addSepBtn && newSepInput) {
        const handleAdd = () => {
            const val = newSepInput.value.trim();
            if (val) {
                addSeparator(val);
                newSepInput.value = '';
            }
        };
        addSepBtn.addEventListener('click', handleAdd);
        newSepInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
            }
        });
    }

    const useDefaultsCheck = document.getElementById('use-global-defaults-check');
    if (useDefaultsCheck) {
        useDefaultsCheck.addEventListener('change', (e) => {
            const checked = e.target.checked;
            separatorConfig.useDefaults = checked;
            if (checked) {
                DEFAULT_GLOBAL_SEPARATORS.forEach(ds => {
                    if (!activeSeparators.includes(ds)) activeSeparators.push(ds);
                });
            } else {
                activeSeparators = activeSeparators.filter(s => !DEFAULT_GLOBAL_SEPARATORS.includes(s));
            }
            renderSeparatorSettingsPanel();
        });
    }

    const saveSeparatorsBtn = document.getElementById('save-separators-btn');
    if (saveSeparatorsBtn) {
        saveSeparatorsBtn.addEventListener('click', async () => {
            saveSeparatorsBtn.textContent = '⏳ 저장 중...';
            saveSeparatorsBtn.disabled = true;
            try {
                const useDefs = document.getElementById('use-global-defaults-check').checked;
                const customOnly = activeSeparators.filter(s => !DEFAULT_GLOBAL_SEPARATORS.includes(s));
                await saveNovelSeparators(currentNovelTitle, customOnly, useDefs);
                saveSeparatorsBtn.textContent = '✅ 저장됨!';
                logToSidebar(`[${currentNovelTitle}] 구분선 설정 저장 완료 (적용 중: ${activeSeparators.length}개)`);
                setTimeout(() => {
                    saveSeparatorsBtn.textContent = '💾 설정 저장';
                    saveSeparatorsBtn.disabled = false;
                    const panel = document.getElementById('separator-settings-panel');
                    if (panel) panel.style.display = 'none';
                }, 1000);
            } catch (err) {
                saveSeparatorsBtn.textContent = '❌ 실패';
                logToSidebar(`구분선 설정 저장 실패: ${err.message}`, 'log-error');
                setTimeout(() => {
                    saveSeparatorsBtn.textContent = '💾 설정 저장';
                    saveSeparatorsBtn.disabled = false;
                }, 1500);
            }
        });
    }

    const resetSeparatorsBtn = document.getElementById('reset-separators-btn');
    if (resetSeparatorsBtn) {
        resetSeparatorsBtn.addEventListener('click', async () => {
            if (!confirm(`'${currentNovelTitle}'의 구분선 설정을 기본값으로 복원하시겠습니까?`)) return;
            resetSeparatorsBtn.textContent = '⏳ 복원 중...';
            await resetNovelSeparators(currentNovelTitle);
            renderSeparatorSettingsPanel();
            resetSeparatorsBtn.textContent = '기본값 복원';
            logToSidebar(`[${currentNovelTitle}] 구분선 설정이 기본값으로 복원되었습니다.`);
        });
    }

    // 소설 제목 변경 버튼 및 타이틀 클릭 이벤트
    const editNovelTitleBtn = document.getElementById('edit-novel-title-btn');
    const novelTitleDisplay = document.getElementById('current-novel-title-display');
    const handleEditNovelTitle = async () => {
        const newTitle = prompt("현재 소설의 제목을 입력하세요 (소설별 구분선 및 폴더 기준이 됩니다):", currentNovelTitle);
        if (newTitle && newTitle.trim() && newTitle.trim() !== currentNovelTitle) {
            currentNovelTitle = newTitle.trim();
            updateNovelTitleUI(currentNovelTitle);
            await loadNovelSeparators(currentNovelTitle);
            renderSeparatorSettingsPanel();
            logToSidebar(`소설 제목이 '${currentNovelTitle}'(으)로 변경되었습니다.`);
        }
    };
    if (editNovelTitleBtn) editNovelTitleBtn.addEventListener('click', handleEditNovelTitle);
    if (novelTitleDisplay) novelTitleDisplay.addEventListener('click', handleEditNovelTitle);

    document.getElementById('stop-translation-btn').addEventListener('click', () => {
        isTranslationCancelled = true;
        logToSidebar("API 요청이 사용자에 의해 중지되었습니다.", "log-error");
        document.getElementById('stop-translation-btn').style.display = 'none';
        document.getElementById('resume-translation-btn').style.display = 'none';
        document.getElementById('retry-translation-btn').style.display = 'inline-block';
        updateSidebarWithCancelled();
    });

    document.getElementById('resume-translation-btn').addEventListener('click', () => {
        if (resolveResume) {
            logToSidebar("번역을 재개합니다...");
            document.getElementById('resume-translation-btn').style.display = 'none';
            document.getElementById('stop-translation-btn').style.display = 'inline-block';
            resolveResume();
            resolveResume = null;
        }
    });

    document.getElementById('retry-translation-btn').addEventListener('click', () => {
        logToSidebar("고성능 모델(Gemini 3.0 Flash)로 전체 재번역을 시작합니다...");
        document.getElementById('retry-translation-btn').style.display = 'none';
        const tableBody = document.getElementById('translation-table-body');
        tableBody.innerHTML = ''; 
        translationCache.clear();
        hasScannedForP_Tags = false;
        translateAllPTags(true);
        showSidebar();
    });
}

// =================================================================================
// Data & Persistence
// =================================================================================



async function saveSingleTranslation(pid, original, translated) {
    const url = getCleanUrl();
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

    // 캐시 업데이트
    translationCache.set(pid, { pid: pid, original: original, translated: translated });

    // 본문 적용 활성 상태라면 페이지 본문에도 실시간 즉시 반영
    if (isPageApplied) {
        const targetP = document.getElementById(pid);
        if (targetP) {
            if (!targetP.dataset.lanovelOriginalHtml) {
                targetP.dataset.lanovelOriginalHtml = targetP.innerHTML;
                targetP.dataset.lanovelOriginalStyle = targetP.getAttribute('style') || '';
            }
            targetP.innerHTML = translated;
            targetP.classList.add('lanovel-applied-text');
            const appliedStyle = { color: '#E2E8F0', fontFamily: 'TwoCon' };
            Object.assign(targetP.style, appliedStyle);
        }
    }
    updateApplyButtonUI(isPageApplied);

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
    const validItems = itemsToSave.filter(item => item.translated && item.translated.trim());
    if (validItems.length === 0) return;

    const url = getCleanUrl();
    const title = document.title;
    const records = validItems.map(item => ({
        url: url,
        pid: item.id,
        original: item.original,
        translated: item.translated,
        timestamp: Math.floor(Date.now() / 1000),
        folderName: null,
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

async function translateAllPTags(isRetranslation = false) {
    isTranslationCancelled = false;
    document.getElementById('stop-translation-btn').style.display = 'inline-block';
    document.getElementById('retry-translation-btn').style.display = 'none';

    const paragraphs = getTargetParagraphs();
    const textsToTranslate = [];
    let skipTranslation = false;

    paragraphs.forEach(p => {
        const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();

        if (p.id === 'tagCount') {
            return; 
        }

        if (skipTranslation) {
            return;
        }

        const matchedSep = checkSeparatorMatch(text, activeSeparators);
        if (matchedSep) {
            skipTranslation = true;
            logToSidebar(`구분선 '${matchedSep}'을(를) 만나 이후의 번역을 중단합니다.`);
            return;
        }

        const cached = translationCache.get(p.id);
        if (cached && cached.translated && cached.translated.trim()) {
            return;
        }

        if (/^(la|lp)\d+$/i.test(p.id)) {
            return;
        }

        const cleanedText = text.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');

        if (exclusionSet.has(cleanedText)) {
            return;
        }

        if (cleanedText && JAPANESE_REGEX.test(cleanedText)) {
            textsToTranslate.push({ id: p.id, text: cleanedText });
        }
    });

    if (textsToTranslate.length === 0) {
        logToSidebar("번역할 새로운 내용이 없습니다.");
        document.getElementById('stop-translation-btn').style.display = 'none';
        document.getElementById('retry-translation-btn').style.display = 'inline-block';
        return;
    }

    const sepCount = activeSeparators.length;
    const sepPreview = sepCount > 0 ? activeSeparators.slice(0, 3).join(', ') + (sepCount > 3 ? ` 외 ${sepCount - 3}개` : '') : '없음';
    const modelDesc = isRetranslation ? "고성능 모델(Gemini 3.0 Flash)" : "기본 엔진";
    logToSidebar(`[소설: ${currentNovelTitle || '기본'}] 총 ${textsToTranslate.length}개의 문장 번역을 시작합니다. (${modelDesc}, 구분선: ${sepPreview})`);
    
    const longTexts = textsToTranslate.filter(item => item.text.length > LONG_TEXT_THRESHOLD);
    const normalTexts = textsToTranslate.filter(item => item.text.length <= LONG_TEXT_THRESHOLD);

    if (longTexts.length > 0) {
        logToSidebar(`경고: ${longTexts.length}개의 긴 문장(${LONG_TEXT_THRESHOLD}자 이상)이 감지되어 개별적으로 처리합니다.`);
    }
    
    addPlaceholderRows(textsToTranslate);

    async function translateChunk(items, chunkSize) {
        if (isTranslationCancelled) return;
    
        const MAX_MESSAGE_RETRIES = 5; // Increased retries
        for (let attempt = 0; attempt < MAX_MESSAGE_RETRIES; attempt++) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'batchTranslate',
                    items: items,
                    isRetranslation: isRetranslation
                });
    
                if (isTranslationCancelled) return;
    
                if (chrome.runtime.lastError) {
                    throw new Error(chrome.runtime.lastError.message);
                }

                // Handle explicit error response from background script
                if (response && response.error) {
                    throw new Error(response.error);
                }
    
                if (response && response.notification) {
                    logToSidebar(response.notification, 'log-error');
                    if (response.stop) {
                        document.getElementById('stop-translation-btn').style.display = 'none';
                        document.getElementById('resume-translation-btn').style.display = 'inline-block';
                        logToSidebar("번역이 일시 중지되었습니다. 수동 작업 후 재개 버튼(▶️)을 눌러주세요.");
                        
                        // 현재 처리 중인 항목들의 placeholder 문구를 지워 편집을 도움
                        items.forEach(item => {
                            const row = document.querySelector(`tr[data-pid="${item.id}"]`);
                            if (row) {
                                const cell = row.querySelector('.translated-text');
                                if (cell && cell.textContent.includes('번역 중')) {
                                    cell.textContent = '';
                                }
                            }
                        });

                        // 사용자가 재개 버튼을 누를 때까지 대기
                        await new Promise(resolve => { resolveResume = resolve; });
                        return await translateChunk(items, chunkSize); // 재개 시 현재 뭉치 다시 시도
                    }
                    return; 
                }

                if (response && response.translations) {
                    // [검열 감지 알림] 하단 로그 콘솔에 검열 생략 안내
                    const censoredItems = response.translations.filter(t => t.censored || (t.translated && t.translated.includes('[검열로 인해 번역 생략]')));
                    if (censoredItems.length > 0) {
                        censoredItems.forEach(item => {
                            const preview = item.original ? (item.original.length > 25 ? item.original.slice(0, 25) + '...' : item.original) : '';
                            logToSidebar(`⚠️ [검열 감지] 문장(ID: ${item.id}) 번역이 검열로 인해 생략되었습니다. (원문: ${preview})`, 'log-error');
                        });
                    }

                    const successes = response.translations.filter(t => t.translated !== null && !t.translated.includes('번역 실패'));
                    const failures = response.translations.filter(t => t.translated === null || t.translated.includes('번역 실패'));
    
                    if (successes.length > 0) {
                        updateSidebarWithTranslations(successes);
                        await saveAllTranslations(successes); // Save successful chunks immediately
                    }
    
                    if (failures.length > 0) {
                        const failedOriginalItems = items.filter(originalItem =>
                            failures.some(failedItem => failedItem.id === originalItem.id)
                        );
                        
                        logToSidebar(`${failedOriginalItems.length}개 항목 번역 실패. 더 작은 단위로 재시도합니다.`, 'log-error');
                        await handleFailure(failedOriginalItems, chunkSize);
                    }
                    return; // Success, exit the retry loop
                } else {
                    throw new Error('Malformed response from background script');
                }
            } catch (error) {
                if (error.message.includes('The message channel closed')) {
                    console.warn('Message channel closed, likely due to page reload. Translation chunk cancelled.');
                    return; // Stop retrying, the page is gone.
                }

                console.warn(`Chunk translation failed (attempt ${attempt + 1}/${MAX_MESSAGE_RETRIES}):`, error.message);

                if (attempt < MAX_MESSAGE_RETRIES - 1) {
                    const delay = (40 + Math.pow(2, attempt)) * 1000 + Math.floor(Math.random() * 1000); // Start with a 40s base + exponential backoff with jitter
                    logToSidebar(`통신 오류. ${Math.round(delay / 1000)}초 후 재시도... (${attempt + 1}/${MAX_MESSAGE_RETRIES})`, 'log-error');
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
        if (currentChunkSize > 1 && failedItems.length > 1) {
            const newChunkSize = Math.ceil(currentChunkSize / 2);
            logToSidebar(`묶음 단위를 ${newChunkSize}으로 줄여 재시도합니다.`);
            const subChunks = chunkArray(failedItems, newChunkSize);
            for (const [index, subChunk] of subChunks.entries()) {
                if (isTranslationCancelled) break;
                await translateChunk(subChunk, newChunkSize);
                
                if (index < subChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 30000));
                }
            }
        } else if (failedItems.length > 0) {
            for (const item of failedItems) {
                if (isTranslationCancelled) break;
                const sentences = item.text.split('。').filter(s => s.trim().length > 0);
                
                if (sentences.length > 1) {
                    await retryWithSentenceSplitting(item);
                } else {
                    console.error(`Failed to translate item ${item.id} after retries:`, item.text);
                    const errorResultForUI = { id: item.id, original: item.text, translated: `번역 실패: API 오류` };
                    updateSidebarWithTranslations([errorResultForUI]);
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
                items: subItemsForApi,
                isRetranslation: true
            });

            // Handle stop signals from background script (e.g., on 429 error)
            if (response && response.notification) {
                logToSidebar(response.notification, 'log-error');
                if (response.stop) {
                    isTranslationCancelled = true;
                    document.getElementById('stop-translation-btn').style.display = 'none';
                    updateSidebarWithCancelled();
                }
                return; // Stop further processing for this item
            }

            if (response && response.translations) {
                const hasFailedPart = response.translations.some(t => t.translated === null);
                let combinedTranslation = null;

                if (hasFailedPart) {
                    logToSidebar(`문장 분할 번역 실패 (ID: ${originalItem.id}) - 일부 조각 번역 실패`);
                } else {
                    const translatedSentences = response.translations.map(t => t.translated);
                    combinedTranslation = translatedSentences.join(' ');
                    logToSidebar(`문장 분할 번역 성공 (ID: ${originalItem.id})`);
                }

                const finalResult = {
                    id: originalItem.id,
                    original: originalItem.text,
                    translated: combinedTranslation
                };
                updateSidebarWithTranslations([finalResult]);
                
                if (combinedTranslation !== null) {
                    await saveAllTranslations([finalResult]); // Save successful split-sentence results immediately
                }

            } else {
                throw new Error('Malformed response from background script for split sentences.');
            }

        } catch (error) {
            if (error.message.includes('The message channel closed')) {
                console.warn('Message channel closed during sentence splitting. Translation cancelled.');
                return; // Stop, the page is gone.
            }
            console.error(`Sentence splitting retry also failed for item ${originalItem.id}:`, error);
            const pid = originalItem.id;
            const finalResult = {
                id: pid,
                original: originalItem.text,
                translated: ''
            };

            updateSidebarWithTranslations([finalResult]);
            
            await saveAllTranslations([finalResult]);
        }
    }

    // Process long texts individually first
    for (const [index, item] of longTexts.entries()) {
        if (isTranslationCancelled) break;
        logToSidebar(`긴 문장 번역 중 (${index + 1}/${longTexts.length})...`);
        await translateChunk([item], 1);
                    if (index < longTexts.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기
                    }    }

    // Then, process normal texts in batches
    if (!isTranslationCancelled && normalTexts.length > 0) {
        logToSidebar(`${normalTexts.length}개의 일반 문장을 묶음으로 번역합니다.`);
        
        const totalSentences = textsToTranslate.length;
        const normalSentenceCount = normalTexts.length;
        let initialChunkSize;

        if (normalSentenceCount <= 10) {
            // 10개 이하인 경우 분할하지 않고 한 번에 처리
            initialChunkSize = normalSentenceCount;
            logToSidebar(`번역할 일반 문장 수(${normalSentenceCount})가 10개 이하이므로, 분할하지 않고 한 번에 번역합니다.`);
        } else if (totalSentences > 80) {
            // "Aggressive" splitting for many sentences
            const idealChunks = 10;
            initialChunkSize = Math.ceil(normalTexts.length / idealChunks);
            initialChunkSize = Math.max(5, initialChunkSize);
            initialChunkSize = Math.min(20, initialChunkSize);
            logToSidebar(`총 문장 수(${totalSentences})가 80개를 초과하여, 묶음 크기를 ${initialChunkSize}(으)로 공격적으로 설정합니다.`);
        } else {
            // New "stepped" splitting for fewer sentences
            let numGroups;
            if (normalSentenceCount <= 20) {
                numGroups = 2;
            } else {
                // For 21-30 -> 3 groups, 31-40 -> 4 groups, etc.
                numGroups = Math.ceil(normalSentenceCount / 10);
            }
            // Ensure at least 1 group if count is very low.
            numGroups = Math.max(1, numGroups); 

            initialChunkSize = Math.ceil(normalSentenceCount / numGroups);
            logToSidebar(`총 문장 수(${totalSentences})가 80개 이하이므로, ${numGroups}개의 그룹으로 나누어(묶음 크기: ${initialChunkSize}) 번역합니다.`);
        }

        const chunks = chunkArray(normalTexts, initialChunkSize);
        let progress = 0;

        const dynamicDelay = 5000; // 5초 고정 대기
        logToSidebar(`RPM 제한을 피하기 위해 묶음 간 대기 시간을 ${dynamicDelay / 1000}초로 설정합니다.`);

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
    document.getElementById('retry-translation-btn').style.display = 'inline-block';
    sortSidebar();
    logToSidebar("모든 번역 작업이 완료되었습니다.");

    if (!isTranslationCancelled) {
        const scrollDelay = 60000; // 60-second delay
        const currentUrl = getCleanUrl(); // Get the current clean URL

        const startAutoScroll = () => {
            logToSidebar(`번역 완료. ${scrollDelay / 1000}초 후 페이지 끝으로 자동 스크롤합니다.`);

            setTimeout(() => {
                if (isTranslationCancelled) return;

                logToSidebar("페이지 끝으로 스크롤 후 다음 페이지 액션을 실행합니다.");
                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });

                const checkScrollEndInterval = setInterval(() => {
                    if (isTranslationCancelled) {
                        clearInterval(checkScrollEndInterval);
                        return;
                    }
                    
                    if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 10) {
                        clearInterval(checkScrollEndInterval);
                        
                        if (currentUrl.includes('novel18.syosetu.com')) {
                            logToSidebar("'novel18.syosetu.com'입니다. '次へ' 버튼을 찾아서 클릭합니다.");
                            const nextButton = document.querySelector('a.c-pager__item.c-pager__item--next');
                            if (nextButton && nextButton.href) {
                                logToSidebar(`다음 페이지로 이동: ${nextButton.href}`);
                                window.location.href = nextButton.href;
                            } else {
                                logToSidebar("다음 페이지 버튼을 찾을 수 없습니다.");
                            }
                        } else if (currentUrl.includes('kakuyomu.jp')) {
                            logToSidebar("'kakuyomu.jp'입니다. 'PageDown' 키를 누릅니다.");
                            setTimeout(() => {
                                document.body.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'PageDown',
                                    code: 'PageDown',
                                    bubbles: true,
                                    cancelable: true,
                                    keyCode: 34
                                }));
                            }, 4000); // Small delay to ensure PageDown is registered
                        } else {
                            logToSidebar("지원되지 않는 사이트입니다. 기본 'PageDown' 키를 누릅니다.");
                             setTimeout(() => {
                                document.body.dispatchEvent(new KeyboardEvent('keydown', {
                                    key: 'PageDown',
                                    code: 'PageDown',
                                    bubbles: true,
                                    cancelable: true,
                                    keyCode: 34
                                }));
                            }, 4000);
                        }
                    }
                }, 100);
            }, scrollDelay);
        };

        if (document.visibilityState === 'visible') {
            startAutoScroll();
        } else {
            logToSidebar("페이지가 활성화되면 자동 스크롤을 시작합니다.");
            const visibilityChangeHandler = () => {
                if (document.visibilityState === 'visible') {
                    startAutoScroll();
                    document.removeEventListener('visibilitychange', visibilityChangeHandler);
                }
            };
            document.addEventListener('visibilitychange', visibilityChangeHandler);
        }
    }
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
    updateApplyButtonUI(isPageApplied);
}

async function retranslateSingleRow(pid, originalText) {
    const row = document.querySelector(`tr[data-pid="${pid}"]`);
    if (!row) return;

    const translatedCell = row.querySelector('.translated-text');
    const retransBtn = row.querySelector('.retranslate-row-btn');
    const saveBtn = row.querySelector('.save-btn');

    if (retransBtn) retransBtn.disabled = true;
    if (saveBtn) saveBtn.disabled = true;

    const prevContent = translatedCell.textContent;
    translatedCell.textContent = '⏳ 재번역 중...';
    translatedCell.style.color = '#4a6cf7';

    logToSidebar(`(pid: ${pid}) 고성능 모델로 재번역 요청 중...`);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'batchTranslate',
            items: [{ id: pid, text: originalText }],
            isRetranslation: true
        });

        if (response && response.translations && response.translations.length > 0) {
            const newTranslated = response.translations[0].translated;
            if (newTranslated) {
                translatedCell.textContent = newTranslated;
                translatedCell.style.color = '';
                translatedCell.setAttribute('contenteditable', 'true');

                // 페이지 내 실제 p 태그 내용도 갱신 (본문 적용 상태일 때)
                if (isPageApplied) {
                    const pTag = document.getElementById(pid);
                    if (pTag) {
                        if (!pTag.dataset.lanovelOriginalHtml) {
                            pTag.dataset.lanovelOriginalHtml = pTag.innerHTML;
                            pTag.dataset.lanovelOriginalStyle = pTag.getAttribute('style') || '';
                        }
                        pTag.innerHTML = newTranslated;
                        pTag.classList.add('lanovel-applied-text');
                        const appliedStyle = { color: '#E2E8F0', fontFamily: 'TwoCon' };
                        Object.assign(pTag.style, appliedStyle);
                    }
                }

                // translationCache 갱신
                translationCache.set(pid, { pid: pid, original: originalText, translated: newTranslated });

                // DB에 즉시 저장
                await saveSingleTranslation(pid, originalText, newTranslated);
                logToSidebar(`(pid: ${pid}) 고성능 모델 재번역 및 저장 완료.`);
            } else {
                throw new Error("빈 번역 응답 수신");
            }
        } else if (response && response.error) {
            throw new Error(response.error);
        } else {
            throw new Error("응답 형식 오류");
        }
    } catch (err) {
        console.error(`Error retranslating row ${pid}:`, err);
        logToSidebar(`(pid: ${pid}) 재번역 실패: ${err.message}`, 'log-error');
        translatedCell.textContent = prevContent;
        translatedCell.style.color = '';
    } finally {
        if (retransBtn) retransBtn.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

function addPlaceholderRows(items) {
    const tableBody = document.getElementById('translation-table-body');
    items.forEach(item => {
        const row = tableBody.insertRow(0);
        row.setAttribute('data-pid', item.id);
        row.innerHTML = `
            <td><div class="original-text" title="클릭하면 본문의 해당 문단으로 이동합니다">${escapeHtml(item.text)}</div></td>
            <td><div class="translated-text" contenteditable="true">⏳ 번역 중...</div></td>
            <td>
                <div class="action-btns">
                    <button class="save-btn" disabled>저장</button>
                    <button class="retranslate-row-btn" title="고성능 모델로 재번역" disabled>🔄</button>
                </div>
            </td>
        `;

        // 행 클릭 시 본문 문단으로 스크롤 이동 및 하이라이트 (버튼/입력 영역 제외)
        row.addEventListener('click', (e) => handleSidebarRowClick(item.id, e));

        const translatedCell = row.querySelector('.translated-text');
        const saveBtn = row.querySelector('.save-btn');
        const retransBtn = row.querySelector('.retranslate-row-btn');

        // 입력이 발생하면 저장 버튼 활성화
        translatedCell.addEventListener('input', () => {
            if (saveBtn.disabled) saveBtn.disabled = false;
        });

        // 클릭 시 수동 저장 기능 연결
        saveBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const editedText = translatedCell.textContent.trim();
            await saveSingleTranslation(item.id, item.text, editedText);
            saveBtn.textContent = '저장됨!';
            setTimeout(() => { saveBtn.textContent = '저장'; }, 1500);
        });

        // 재번역 버튼 연결
        if (retransBtn) {
            retransBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                retranslateSingleRow(item.id, item.text);
            });
        }
    });
    updateEmptyState();
    updateApplyButtonUI(isPageApplied);
}

function updateSidebarWithTranslations(translations) {
    translations.forEach(item => {
        // If the translation is null or undefined, skip updating this item's UI.
        if (item.translated === null || typeof item.translated === 'undefined') {
            return;
        }

        const isError = item.translated.includes('번역 실패') || item.translated.includes('API 오류');
        const isCensored = item.censored || item.translated.includes('[검열로 인해 번역 생략]');

        // 성공한 번역은 캐시에 반영
        if (!isError) {
            translationCache.set(item.id, { pid: item.id, original: item.original, translated: item.translated });
        }

        const row = document.querySelector(`tr[data-pid="${item.id}"]`);
        if (row) {
            const isReviewTarget = reviewTargetPids.has(item.id);
            if (isReviewTarget) {
                row.classList.add('review-target-row');
                const p = document.getElementById(item.id);
                if (p) p.classList.add('review-target-dom');

                // 상단 검수 패널 내 실시간 번역문 업데이트
                const panelTraEl = document.getElementById(`review-tra-${item.id}`);
                if (panelTraEl) {
                    panelTraEl.textContent = `번역: ${item.translated || '(빈 번역문)'}`;
                    panelTraEl.classList.remove('waiting');
                }
            }

            const originalCell = row.querySelector('.original-text');
            originalCell.innerHTML = escapeHtml(item.original);
            originalCell.title = "클릭하면 본문의 해당 문단으로 이동합니다";
            if (isReviewTarget && !originalCell.querySelector('.review-badge')) {
                originalCell.insertAdjacentHTML('afterbegin', '<span class="review-badge" title="알림 센터 연계 재번역 검수 문장">⚡재검수</span>');
            }

            const translatedCell = row.querySelector('.translated-text');
            const saveBtn = row.querySelector('.save-btn');
            const retransBtn = row.querySelector('.retranslate-row-btn');

            if (isError) {
                translatedCell.innerHTML = escapeHtml(item.translated);
                translatedCell.setAttribute('contenteditable', 'false');
                translatedCell.style.color = 'red';
                if (saveBtn) saveBtn.disabled = true;
                if (retransBtn) retransBtn.disabled = false; // 오류 시 재번역 버튼 활성화
            } else {
                translatedCell.innerHTML = escapeHtml(item.translated);
                translatedCell.setAttribute('contenteditable', 'true');
                if (isCensored) {
                    translatedCell.style.color = '#f59e0b'; // 검열 생략 문장은 시각적으로 구별되도록 주황색 표시
                } else {
                    translatedCell.style.color = ''; // Reset color
                }
                if (saveBtn) saveBtn.disabled = false;
                if (retransBtn) retransBtn.disabled = false;

                if (saveBtn) {
                    const newSaveBtn = saveBtn.cloneNode(true);
                    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
                    newSaveBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const editedText = translatedCell.textContent.trim();
                        await saveSingleTranslation(item.id, item.original, editedText);
                        newSaveBtn.textContent = '저장됨!';
                        setTimeout(() => { newSaveBtn.textContent = '저장'; }, 1500);
                    });
                }

                if (retransBtn) {
                    const newRetransBtn = retransBtn.cloneNode(true);
                    retransBtn.parentNode.replaceChild(newRetransBtn, retransBtn);
                    newRetransBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        retranslateSingleRow(item.id, item.original);
                    });
                }
            }
        }
    });

    // 본문 적용이 활성화되어 있다면 도착한 번역들을 본문에도 실시간 즉시 주입
    if (isPageApplied) {
        const successes = translations.filter(t => t.translated !== null && !t.translated.includes('번역 실패') && !t.translated.includes('API 오류'));
        if (successes.length > 0) {
            applyTranslationsToPage(successes, false);
        }
    }
    updateApplyButtonUI(isPageApplied);
}

function addEntryToSidebar(translation) {
    const tableBody = document.getElementById('translation-table-body');
    if (document.querySelector(`tr[data-pid="${translation.pid}"]`)) return;

    const row = tableBody.insertRow();
    row.setAttribute('data-pid', translation.pid);
    const isReviewTarget = reviewTargetPids.has(translation.pid);
    if (isReviewTarget) {
        row.classList.add('review-target-row');
        const p = document.getElementById(translation.pid);
        if (p) p.classList.add('review-target-dom');
    }
    const badgeHtml = isReviewTarget ? '<span class="review-badge" title="알림 센터 연계 재번역 검수 문장">⚡재검수</span>' : '';

    row.innerHTML = `
        <td><div class="original-text" title="클릭하면 본문의 해당 문단으로 이동합니다">${badgeHtml}${escapeHtml(translation.original)}</div></td>
        <td><div class="translated-text" contenteditable="true">${escapeHtml(translation.translated)}</div></td>
        <td>
            <div class="action-btns">
                <button class="save-btn">저장</button>
                <button class="retranslate-row-btn" title="고성능 모델로 재번역">🔄</button>
            </div>
        </td>
    `;

    // 행 클릭 시 본문 문단으로 스크롤 이동 및 하이라이트 (버튼/입력 영역 제외)
    row.addEventListener('click', (e) => handleSidebarRowClick(translation.pid, e));

    const saveBtn = row.querySelector('.save-btn');
    saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const editedText = row.querySelector('.translated-text').textContent.trim();
        await saveSingleTranslation(translation.pid, translation.original, editedText);
        saveBtn.textContent = '저장됨!';
        setTimeout(() => { saveBtn.textContent = '저장'; }, 1500);
    });

    const retransBtn = row.querySelector('.retranslate-row-btn');
    if (retransBtn) {
        retransBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retranslateSingleRow(translation.pid, translation.original);
        });
    }

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