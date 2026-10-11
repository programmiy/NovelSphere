// =================================================================================
// Globals & Constants
// =================================================================================

let autoScrollInterval = null;
// ⚡ 글자 수 / 토큰 예산 기반 가변 청킹 기준치
const CHUNK_BUDGET_CHARACTERS = 2000; // 묶음당 최대 원문 글자 수 (약 1,000~1,500 토큰)
const CHUNK_BUDGET_MAX_ITEMS = 40;   // 묶음당 최대 문장 수 상한
const JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/;
const PID_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * 웹소설 본문 문단이 번역 대상인지 판별합니다.
 * 1. 일본어 문자 (히라가나, 가타카나, 한자) 포함 시 번역 대상.
 * 2. 대화/인용 괄호(「」, 『』, （）, 【】, 《》, 〈〉, 〔〕, “”, "")가 포함된 문장 (예: 「……」, 「……？」, 『……』, （……） 등).
 *    -> 소설 속 대사/독백/호흡 문단은 가나/한자가 없더라도 중요한 문맥이므로 반드시 수집합니다.
 * 3. 괄호가 없더라도 소설 지문의 말줄임표/대시/부호(……, …………, ――――, ……？ 등)로 구성된 침묵·호흡 문단.
 */
function isTranslatableText(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // 1. 일본어 문자 (히라가나, 가타카나, 한자) 포함
    if (JAPANESE_REGEX.test(trimmed)) {
        return true;
    }

    // 2. 대화/인용 괄호가 포함된 문장 (예: 「……」, 「……？」, 『……』, （……）, 「――」 등)
    if (/[「」『』【】《》〈〉〔〕（）“”"']/.test(trimmed)) {
        return true;
    }

    // 3. 소설 지문의 말줄임표(…, ‥), 대시(―, —), 물음표/느낌표 등으로 구성된 침묵/호흡 문단
    // 예: ……, …………, ――, ……？, ……!, ！？ 등
    if (/^[…‥・―—ー~～!?！？\s]+$/.test(trimmed)) {
        if (/[…‥―—]/.test(trimmed) || trimmed.length >= 2) {
            return true;
        }
    }

    return false;
}

/**
 * 문장 내에 의미 있는 문자(가나, 한자, 한글, 영문 등)가 전혀 없고,
 * 오직 문장부호, 괄호, 기호(「」『』…―!? 등) 및 공백으로만 이루어져 있는지 검사합니다.
 * 예: 「……」, 「…………」, 「……？」, 「……！」, 「……!?」, 『……』, （……）, ……, ―― 등
 * -> 이런 문장은 API 번역 호출 없이 즉시 원문 그대로 번역문으로 자동 대입(Fast-path)합니다.
 */
function isPurePunctuationOnly(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // 히라가나, 가타카나, 한자(CJK), 한글, 알파벳 문자가 하나라도 있으면 순수 기호 문장이 아님
    if (/[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf\uac00-\ud7a3a-zA-Z]/.test(trimmed)) {
        return false;
    }

    // 소설의 대화 괄호 또는 말줄임표/대시/부호 등이 최소 1자 이상 포함되어 있어야 함
    return /[「」『』【】《》〈〉〔〕（）“”"'\…‥・―—~～!?！？]/.test(trimmed);
}
let hasScannedForP_Tags = false;
let isTranslationCancelled = false;
let resolveResume = null; // 번역 재개를 위한 전역 resolver
let translationCache = new Map(); // Cache for original translation objects
let exclusionSet = new Set(); // Cache for excluded original texts
let isPageApplied = false; // 웹페이지 본문 번역 적용 여부 상태
let translationsLoadedPromise = null; // 저장된 번역 로드 완료 보장 Promise
let userDeletedTranslationPids = new Set(); // 사용자가 직접 번역을 삭제/비운 PID 추적 (빈칸 보완 번역 대상에서 제외)

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
let isReviewSession = false;

function isReviewMode() {
    return isReviewSession || window.location.hash.includes('lanovel_review') || (reviewTargetPids && reviewTargetPids.size > 0);
}

function getCleanUrl() {
    return window.location.href.split('#')[0];
}

// =================================================================================
// ⚡ 쾌속모드 (Turbo Mode) 상태 관리 및 정각 도달 감지
// =================================================================================
let isTurboMode = false;
let turboCutoffHour = null; // null: 자동 판별, 16: 16시 고정, 17: 17시 고정
let turboTargetTimestamp = 0; // 다음 목표 정각 타임스탬프 (ms)
let turboAbortedOnLoad = false; // 정각 도달로 인한 자동 OFF 및 번역 차단 플래그

// 미국 써머타임 공식 룰 (3월 둘째 일요일 02시 ~ 11월 첫째 일요일 02시)
function isUsDstRule(d) {
    const year = d.getFullYear();
    const march1 = new Date(year, 2, 1);
    const firstSunMarch = (7 - march1.getDay()) % 7 + 1;
    const secondSunMarch = firstSunMarch + 7;
    const dstStart = new Date(year, 2, secondSunMarch, 2, 0, 0);

    const nov1 = new Date(year, 10, 1);
    const firstSunNov = (7 - nov1.getDay()) % 7 + 1;
    const dstEnd = new Date(year, 10, firstSunNov, 2, 0, 0);

    return d >= dstStart && d < dstEnd;
}

// ⚡ 쾌속모드 초기화 기준 시각(정각) 감지
function detectCutoffInfo() {
    // 1. 수동 강제 설정이 있는 경우
    if (turboCutoffHour === 16) {
        return { hour: 16, isDst: true, label: "16:00 (수동)" };
    }
    if (turboCutoffHour === 17) {
        return { hour: 17, isDst: false, label: "17:00 (수동)" };
    }

    // 2. 미국 태평양(America/Los_Angeles) 시간대 자동 판별
    // PDT(써머타임): 한국 시간 16:00 (오후 4시)에 태평양 자정(API 쿼터 초기화) 도달
    // PST(표준시): 한국 시간 17:00 (오후 5시)에 태평양 자정(API 쿼터 초기화) 도달
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            timeZoneName: 'short'
        }).formatToParts(new Date());
        const tzName = parts.find(p => p.type === 'timeZoneName')?.value || '';
        const isDst = tzName.includes('PDT') || (!tzName.includes('PST') && isUsDstRule(new Date()));
        return {
            hour: isDst ? 16 : 17,
            isDst: isDst,
            label: isDst ? "16:00 (써머타임)" : "17:00 (표준시)"
        };
    } catch (e) {
        const isDst = isUsDstRule(new Date());
        return {
            hour: isDst ? 16 : 17,
            isDst: isDst,
            label: isDst ? "16:00 (써머타임)" : "17:00 (표준시)"
        };
    }
}

// 기준 정각의 다음 타임스탬프 계산 (오늘 이미 지났으면 내일 정각)
function calculateNextCutoffTimestamp(cutoffHour) {
    const now = new Date();
    let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cutoffHour, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
        target.setDate(target.getDate() + 1);
    }
    return target.getTime();
}

// ⚡ 대기시간(2초/8초) 경과 후 초기화 정각 도달 여부 판정
function checkCutoffTimeReached() {
    if (!turboTargetTimestamp) {
        const info = detectCutoffInfo();
        turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
    }
    return Date.now() >= turboTargetTimestamp;
}

// ⚡ 쾌속모드 온/오프 상태 변화에 실시간 반응하는 동적 지연 함수
let currentDelayResolver = null;
let currentDelayStart = 0;

function sleepResponsive(getDelayFn) {
    return new Promise(resolve => {
        currentDelayStart = Date.now();
        const checkInterval = 50; // 50ms마다 경과 시간 및 모드 변화 체크

        const intervalId = setInterval(() => {
            if (isTranslationCancelled) {
                clearInterval(intervalId);
                currentDelayResolver = null;
                resolve();
                return;
            }

            const elapsed = Date.now() - currentDelayStart;
            const targetDelay = typeof getDelayFn === 'function' ? getDelayFn() : getDelayFn;

            if (elapsed >= targetDelay) {
                clearInterval(intervalId);
                currentDelayResolver = null;
                resolve();
            }
        }, checkInterval);

        currentDelayResolver = () => {
            const elapsed = Date.now() - currentDelayStart;
            const targetDelay = typeof getDelayFn === 'function' ? getDelayFn() : getDelayFn;
            if (elapsed >= targetDelay) {
                clearInterval(intervalId);
                currentDelayResolver = null;
                resolve();
            }
        };
    });
}

// 저장소에서 쾌속모드 상태 로드
async function loadTurboModeState() {
    try {
        const stored = await chrome.storage.local.get(['lanovel_turbo_mode', 'lanovel_turbo_cutoff', 'lanovel_turbo_target']);
        isTurboMode = !!stored.lanovel_turbo_mode;
        turboCutoffHour = stored.lanovel_turbo_cutoff || null;
        turboTargetTimestamp = stored.lanovel_turbo_target || 0;

        if (isTurboMode) {
            if (!turboTargetTimestamp || Date.now() >= turboTargetTimestamp) {
                // 이미 정각이 지났다면 즉시 자동 OFF 및 초기화 번역 차단 플래그 설정
                turboAbortedOnLoad = true;
                await abortTurboMode("초기화 시간 도달");
                return;
            }
        }
        updateTurboModeUI(isTurboMode);
        updateTurboBadgeUI();
    } catch (e) {
        console.warn('[TurboMode] Error loading state from storage:', e);
    }
}

// ⚡ 쾌속모드 활성화/비활성화
async function setTurboMode(enabled, manual = true) {
    isTurboMode = enabled;
    const info = detectCutoffInfo();
    if (enabled) {
        turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
    } else {
        turboTargetTimestamp = 0;
    }

    try {
        await chrome.storage.local.set({
            lanovel_turbo_mode: isTurboMode,
            lanovel_turbo_cutoff: turboCutoffHour,
            lanovel_turbo_target: turboTargetTimestamp
        });
    } catch (e) {
        console.warn('[TurboMode] Failed to save state:', e);
    }

    updateTurboModeUI(isTurboMode);
    updateTurboBadgeUI();

    // 현재 진행 중인 대기(5초 -> 2초, 60초 -> 8초)가 있다면 즉시 단축 반응
    if (currentDelayResolver) {
        currentDelayResolver();
    }

    if (manual) {
        if (isTurboMode) {
            const targetDate = new Date(turboTargetTimestamp);
            const targetTimeStr = `${targetDate.getHours()}:${String(targetDate.getMinutes()).padStart(2, '0')}`;
            logToSidebar(`⚡ [쾌속모드 활성화] 번역간 대기 2초, 다음화 넘어가기 8초로 설정되었습니다. (초기화 기준: ${info.label}, ${targetTimeStr} 정각 도달 시 즉시 중단)`);
        } else {
            logToSidebar(`⚡ [쾌속모드 비활성화] 일반 번역 모드(대기 5초 / 60초)로 전환되었습니다.`);
        }
    }
}

// ⚡ 쾌속모드 즉시 중단 및 자동 OFF
async function abortTurboMode(reason = "초기화 시간 도달") {
    isTranslationCancelled = true;
    isTurboMode = false;
    turboTargetTimestamp = 0;
    try {
        await chrome.storage.local.set({
            lanovel_turbo_mode: false,
            lanovel_turbo_target: 0
        });
    } catch (e) {}

    updateTurboModeUI(false);

    const stopBtn = document.getElementById('stop-translation-btn');
    if (stopBtn) stopBtn.style.display = 'none';
    const retryBtn = document.getElementById('retry-translation-btn');
    if (retryBtn) retryBtn.style.display = 'inline-block';

    const info = detectCutoffInfo();
    logToSidebar(`⏰ [초기화 시간(${info.label}) 정각 도달] 쾌속 번역 및 다음 화 이동을 즉시 중단하고 쾌속모드를 종료합니다.`, "log-error");
}

function updateTurboModeUI(enabled) {
    const banner = document.getElementById('sidebar-turbo-banner');
    const toggle = document.getElementById('sidebar-turbo-toggle');
    const desc = document.getElementById('turbo-desc-text');
    if (toggle) toggle.checked = enabled;
    if (banner) {
        if (enabled) {
            banner.classList.add('active');
        } else {
            banner.classList.remove('active');
        }
    }
    if (desc) {
        desc.textContent = enabled ? '쾌속 진행 중 (2초/8초)' : '대기: 2초 / 8초';
    }
}

function updateTurboBadgeUI() {
    const badge = document.getElementById('turbo-cutoff-badge');
    if (badge) {
        const info = detectCutoffInfo();
        badge.textContent = `기준 ${info.label}`;
    }
}

async function cycleTurboCutoff() {
    // 자동 -> 16:00 -> 17:00 -> 자동 순환
    if (turboCutoffHour === null) {
        turboCutoffHour = 16;
    } else if (turboCutoffHour === 16) {
        turboCutoffHour = 17;
    } else {
        turboCutoffHour = null;
    }
    const info = detectCutoffInfo();
    if (isTurboMode) {
        turboTargetTimestamp = calculateNextCutoffTimestamp(info.hour);
    }
    try {
        await chrome.storage.local.set({
            lanovel_turbo_cutoff: turboCutoffHour,
            lanovel_turbo_target: turboTargetTimestamp
        });
    } catch (e) {}
    updateTurboBadgeUI();
    logToSidebar(`⚡ [쾌속모드 기준 변경] 중단 기준 시각이 '${info.label}'(으)로 설정되었습니다.`);
}

// =================================================================================
// Initialization & Event Listeners
// =================================================================================

// Listen for changes in storage (e.g., from the history page or other tabs)
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

    if (changes.lanovel_turbo_mode) {
        const newTurbo = !!changes.lanovel_turbo_mode.newValue;
        if (newTurbo !== isTurboMode) {
            isTurboMode = newTurbo;
            updateTurboModeUI(isTurboMode);
            if (currentDelayResolver) {
                currentDelayResolver();
            }
        }
    }
    if (changes.lanovel_turbo_cutoff) {
        turboCutoffHour = changes.lanovel_turbo_cutoff.newValue;
        updateTurboBadgeUI();
    }
    if (changes.lanovel_turbo_target) {
        turboTargetTimestamp = changes.lanovel_turbo_target.newValue || 0;
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
        // '閉じる', '目次', 'TOP' 등 제외하고 /works/<digits> 형태의 작품 메인 링크 우선 탐색
        const workLink = Array.from(document.querySelectorAll('header a[href*="/works/"]')).find(a => {
            const txt = (a.textContent || '').trim();
            const aria = a.getAttribute('aria-label') || '';
            const href = a.getAttribute('href') || '';
            return txt && !txt.includes('閉じる') && !aria.includes('閉じる') && !txt.includes('目次') && !txt.includes('TOP') && /\/works\/\d+$/.test(href.split('?')[0]);
        }) || document.querySelector('.widget-toc-main-title') ||
              document.querySelector('a[href^="/works/"][class*="Title"]') ||
              document.querySelector('header a[class*="workTitle"]');

        if (workLink && workLink.textContent.trim()) {
            const candidate = workLink.textContent.trim();
            if (candidate && !candidate.includes('閉じる')) {
                return candidate;
            }
        }
        const titleText = document.title.replace(/\s*-\s*カクヨム.*$/i, '').trim();
        const parts = titleText.split(/\s*-\s*/);
        if (parts.length > 1) {
            let novelPart = parts[parts.length - 1].trim();
            novelPart = novelPart.replace(/（[^）]+）$/, '').trim();
            novelPart = novelPart.replace(/\([^)]+\)$/, '').trim();
            if (novelPart && !novelPart.includes('閉じる')) return novelPart;
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
        if (parts.length > 1) {
            return parts[parts.length - 1].trim();
        } else if (parts.length > 0 && parts[0].trim()) {
            return parts[0].trim();
        }
    } else if (host.includes('novelup.plus')) {
        // 노벨업 작품 제목 탐색
        const novelTitleEl = document.querySelector('.episodeHeader .storyTitle') ||
                             document.querySelector('.storyTitle') ||
                             document.querySelector('.story_title');
        if (novelTitleEl && novelTitleEl.textContent.trim()) {
            return novelTitleEl.textContent.trim();
        }
        const titleText = document.title.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, '').trim();
        const parts = titleText.split(/\s*-\s*/);
        if (parts.length > 0 && parts[0].trim()) {
            let novelPart = parts[0].trim();
            novelPart = novelPart.replace(/（[^）]+）$/, '').trim();
            novelPart = novelPart.replace(/\([^)]+\)$/, '').trim();
            if (novelPart) return novelPart;
        }
    }

    // 3. Fallback: document.title 파싱
    const cleanDocTitle = document.title.split(/[-|–—]/)[0].trim();
    if (cleanDocTitle && cleanDocTitle !== '閉じる') {
        return cleanDocTitle;
    }
    return "기본 소설";
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
            isReviewSession = true;
            const hashMatch = window.location.hash.match(/lanovel_review=([^&]+)/);
            if (hashMatch) {
                batchId = decodeURIComponent(hashMatch[1]);
            }
        } else if (window.location.hash.includes('lanovel_review')) {
            isReviewSession = true;
        }

        let apiUrl = `http://127.0.0.1:8001/cleanup/review_targets?url=${encodeURIComponent(cleanUrl)}`;
        if (batchId) {
            apiUrl += `&batch_id=${encodeURIComponent(batchId)}`;
        }

        const res = await fetch(apiUrl);
        if (!res.ok) return;
        const data = await res.json();

        if (data.has_targets && Array.isArray(data.targets) && data.targets.length > 0) {
            isReviewSession = true;
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
                const cleanUrl = getCleanUrl();
                const res = await fetch(`http://127.0.0.1:8001/cleanup/notifications/${notifId}/dismiss?url=${encodeURIComponent(cleanUrl)}`, { method: 'POST' });
                if (res.ok) {
                    dismissBtn.textContent = '해제됨!';
                    logToSidebar("알림 센터의 해당 삭제 알림이 성공적으로 해제되었습니다.");
                    try {
                        await chrome.storage.local.set({ lastNotificationDismissed: Date.now() });
                    } catch (storageErr) {
                        // ignore storage error
                    }
                    setTimeout(() => {
                        panel.style.display = 'none';
                    }, 1000);
                } else {
                    dismissBtn.disabled = false;
                    dismissBtn.textContent = '해제 실패';
                }
            } catch (err) {
                console.error('알림 해제 실패:', err);
                dismissBtn.disabled = false;
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

// =================================================================================
// 구분선 설정 기반 번역 자동 제외 및 검수 패널 (Auto Exclude Separator Translations)
// =================================================================================

let separatorExcludedItems = [];

async function checkAndExcludeSeparatorTranslations(translationsList) {
    if (!translationsList || !Array.isArray(translationsList) || translationsList.length === 0) return;
    if (!activeSeparators || activeSeparators.length === 0) return;

    // 본문 문단 DOM 매핑 (유효한 텍스트를 가진 실제 문단 목록 순서대로 추출)
    const allParagraphs = getTargetParagraphs();
    const validParagraphs = [];
    allParagraphs.forEach(p => {
        if (!p || p.id === 'tagCount' || /^(la|lp)\d+$/i.test(p.id)) return;
        const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
        if (text) {
            validParagraphs.push({ element: p, text: text, pid: p.id });
        }
    });

    // 구분선 단락 및 그 다음 단락들 pid 매핑 (pid -> { matchedSep, isSubsequent: boolean })
    const excludedPidMap = new Map();

    for (let i = 0; i < validParagraphs.length; i++) {
        const item = validParagraphs[i];
        const matchedSep = checkSeparatorMatch(item.text, activeSeparators);
        if (matchedSep) {
            // 해당 구분선 단락 등록
            if (!excludedPidMap.has(item.pid)) {
                excludedPidMap.set(item.pid, { matchedSep: matchedSep, isSubsequent: false });
            }

            // 조건: "이 단락이 첫번째에 있지않는 이상, 그 다음단락들도 같이 제외되어야해"
            // 첫 번째 유효 단락(i === 0)이 아닐 때만 그 이후의 모든 단락들을 같이 제외 대상에 포함
            if (i > 0) {
                for (let j = i + 1; j < validParagraphs.length; j++) {
                    const nextItem = validParagraphs[j];
                    if (!excludedPidMap.has(nextItem.pid)) {
                        excludedPidMap.set(nextItem.pid, { matchedSep: matchedSep, isSubsequent: true });
                    }
                }
                break; // 이후 단락들을 모두 제외 집합에 넣었으므로 루프 종료
            }
        }
    }

    const targetsToExclude = [];
    const targetIds = [];

    translationsList.forEach(t => {
        if (!t || !t.id) return;
        if (exclusionSet && exclusionSet.has(t.original)) return;

        let matchInfo = null;

        // 1. 본문 순서 기반 제외 맵에서 pid 확인 (구분선 및 그 다음 단락들)
        if (t.pid && excludedPidMap.has(t.pid)) {
            matchInfo = excludedPidMap.get(t.pid);
        } else if (t.original) {
            // 2. DOM에 매핑되지 않은 경우라도 원문 텍스트가 구분선에 직접 일치하는 경우
            const sep = checkSeparatorMatch(t.original.trim(), activeSeparators);
            if (sep) {
                matchInfo = { matchedSep: sep, isSubsequent: false };
            }
        }

        // 구분선 또는 구분선 이후 단락에 해당하고 유효한 번역문이 존재하는 경우 제외 대상 선정
        if (matchInfo && t.translated && t.translated.trim()) {
            targetsToExclude.push({
                id: t.id,
                pid: t.pid,
                original: t.original,
                translated: t.translated,
                matchedSep: matchInfo.matchedSep,
                isSubsequent: matchInfo.isSubsequent
            });
            targetIds.push(t.id);
        }
    });

    if (targetsToExclude.length === 0) return;

    console.log(`[SeparatorExclude] 구분선 및 후속 단락 번역 ${targetsToExclude.length}건 감지. 자동 제외 실행:`, targetsToExclude);

    try {
        // 관리페이지의 "제외" 기능과 동일하게 POST /translations/exclude 호출
        const response = await fetch('http://127.0.0.1:8001/translations/exclude', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: targetIds })
        });

        if (!response.ok) {
            console.error(`[SeparatorExclude] 서버 제외 처리 실패 (상태 코드: ${response.status})`);
            return;
        }

        // 1. 제외 목록(exclusionSet) 및 번역 캐시 동기화
        targetsToExclude.forEach(item => {
            if (item.pid) {
                userDeletedTranslationPids.add(String(item.pid));
                translationCache.delete(item.pid);
            }
            if (item.original) {
                exclusionSet.add(item.original);
                const cleaned = item.original.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
                exclusionSet.add(cleaned);
            }
        });

        // 2. translationsList 배열에서 제외된 번역 항목 제거
        const targetIdSet = new Set(targetIds);
        for (let i = translationsList.length - 1; i >= 0; i--) {
            if (targetIdSet.has(translationsList[i].id)) {
                translationsList.splice(i, 1);
            }
        }

        // 3. 사이드바 테이블에서 해당 행 제거
        targetsToExclude.forEach(item => {
            if (item.pid) {
                const row = document.querySelector(`tr[data-pid="${item.pid}"]`);
                if (row) row.remove();
            }
        });
        updateEmptyState();

        // 4. 본문 DOM에서 번역문이 이미 적용되어 있다면 원문으로 복원
        targetsToExclude.forEach(item => {
            if (item.pid) {
                const p = document.getElementById(item.pid);
                if (p) {
                    if (p.dataset.lanovelOriginalHtml) {
                        p.innerHTML = p.dataset.lanovelOriginalHtml;
                        p.setAttribute('style', p.dataset.lanovelOriginalStyle || '');
                        delete p.dataset.lanovelOriginalHtml;
                        delete p.dataset.lanovelOriginalStyle;
                    } else if (item.original) {
                        p.innerHTML = item.original;
                    }
                    p.classList.remove('japanese-translated', 'lanovel-applied-text', 'review-target-dom');
                }
            }
        });

        // 5. 검수탭과 유사한 상단 알림 패널 렌더링
        separatorExcludedItems = targetsToExclude;
        renderSeparatorExcludePanel(targetsToExclude);

        // 6. 사용자가 알림을 확인할 수 있도록 사이드바 오픈
        showSidebar();

        // ⚠️ 중요: (하단로그는 x) 요구사항에 따라 logToSidebar는 일체 호출하지 않음
    } catch (err) {
        console.error('[SeparatorExclude] 자동 제외 처리 중 에러 발생:', err);
    }
}

function renderSeparatorExcludePanel(items) {
    const panel = document.getElementById('separator-exclude-panel');
    if (!panel || !items || items.length === 0) {
        if (panel) panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="separator-exclude-header">
            <span class="separator-exclude-title">
                <span>🛡️</span>
                <span>구분선 및 제외 단락 (<strong id="sep-exclude-count">${items.length}</strong>건)</span>
            </span>
            <div class="separator-exclude-actions">
                <button id="restore-all-sep-exclude-btn" class="sep-exclude-restore-all-btn" title="제외된 단락들을 모두 번역본으로 복원합니다">🔄 전체 복원</button>
                <button id="close-sep-exclude-btn" class="sep-exclude-close-btn" title="알림 닫기">&times;</button>
            </div>
        </div>
        <div class="separator-exclude-desc">
            구분선 설정 등으로 제외된 단락입니다. 잘못 제외된 경우 <strong>[복원]</strong>을 누르면 번역본이 즉시 원상복구됩니다.
        </div>
        <div class="separator-exclude-body" id="separator-exclude-cards">
            ${items.map(item => {
                const matchBadge = item.isSubsequent 
                    ? `(구분선 '${escapeHtml(item.matchedSep || '')}' 이후 단락)` 
                    : `(구분선: "${escapeHtml(item.matchedSep || '')}")`;
                const transPreview = item.translated && item.translated.trim() 
                    ? escapeHtml(item.translated) 
                    : '(보관된 번역 없음)';
                return `
                    <div class="separator-exclude-card" data-pid="${escapeHtml(item.pid || '')}">
                        <div class="sep-card-pid">
                            <span>문장 ID: ${escapeHtml(item.pid || '알 수 없음')}</span>
                            <span class="sep-card-match">${matchBadge}</span>
                        </div>
                        <div class="sep-card-ori" title="${escapeHtml(item.original || '')}">원문: ${escapeHtml(item.original || '')}</div>
                        <div class="sep-card-tra" title="${transPreview}">제외된 번역: <del>${transPreview}</del></div>
                        <div class="sep-card-footer">
                            <span class="sep-card-hint">클릭 시 본문 이동</span>
                            <button class="sep-card-restore-btn" data-pid="${escapeHtml(item.pid || '')}" title="이 단락만 복원">🔄 복원</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    // 닫기 버튼
    const closeBtn = document.getElementById('close-sep-exclude-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }

    // 전체 복원 버튼
    const restoreAllBtn = document.getElementById('restore-all-sep-exclude-btn');
    if (restoreAllBtn) {
        restoreAllBtn.addEventListener('click', async () => {
            if (!confirm(`제외된 ${items.length}개의 단락을 모두 복원하시겠습니까?`)) return;
            restoreAllBtn.disabled = true;
            restoreAllBtn.textContent = '⏳ 복원 중...';
            await restoreExcludedItems([...items]);
        });
    }

    // 카드 내부 클릭 (개별 복원 버튼 및 카드 이동)
    const cardContainer = document.getElementById('separator-exclude-cards');
    if (cardContainer) {
        cardContainer.addEventListener('click', async (e) => {
            const restoreBtn = e.target.closest('.sep-card-restore-btn');
            if (restoreBtn) {
                e.stopPropagation();
                const card = restoreBtn.closest('.separator-exclude-card');
                const pid = card ? card.dataset.pid : null;
                const targetItem = items.find(it => String(it.pid) === String(pid));
                if (targetItem) {
                    restoreBtn.disabled = true;
                    restoreBtn.textContent = '⏳...';
                    await restoreExcludedItems([targetItem]);
                }
                return;
            }

            const card = e.target.closest('.separator-exclude-card');
            if (card && card.dataset.pid && card.dataset.pid !== '알 수 없음') {
                focusAndScrollToPid(card.dataset.pid);
            }
        });
    }
}

async function restoreExcludedItems(itemsToRestore) {
    if (!itemsToRestore || itemsToRestore.length === 0) return;

    try {
        const payload = {
            url: getCleanUrl(),
            originals: itemsToRestore.map(it => it.original),
            items: itemsToRestore.map(it => ({
                pid: it.pid && it.pid !== '알 수 없음' ? it.pid : null,
                original: it.original,
                translated: it.translated || null,
                title: currentNovelTitle || ""
            }))
        };

        const response = await fetch('http://127.0.0.1:8001/translations/restore_excluded', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`[RestoreExcluded] 서버 복원 처리 실패 (상태 코드: ${response.status})`);
            alert('번역 복원 처리 중 서버 오류가 발생했습니다.');
            return;
        }

        const resData = await response.json();
        console.log('[RestoreExcluded] 서버 복원 성공:', resData);

        // 1. 제외 목록(exclusionSet) 및 클라이언트 상태 복원
        itemsToRestore.forEach(item => {
            if (item.pid && item.pid !== '알 수 없음') {
                userDeletedTranslationPids.delete(String(item.pid));
                if (item.translated) {
                    translationCache.set(item.pid, item.translated);
                }
            }
            if (item.original) {
                exclusionSet.delete(item.original);
                const cleaned = item.original.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
                exclusionSet.delete(cleaned);
            }
        });

        // 2. 사이드바 테이블에 행 복원
        itemsToRestore.forEach(item => {
            if (item.translated && item.pid && item.pid !== '알 수 없음') {
                addEntryToSidebar({
                    id: item.id || Date.now(),
                    pid: item.pid,
                    original: item.original,
                    translated: item.translated
                });
            }
        });
        updateEmptyState();

        // 3. 페이지에 번역이 적용되어 있는 상태라면 본문 DOM에도 즉시 번역문 적용
        const isApplied = document.getElementById('sidebar-apply-toggle-btn')?.classList.contains('applied');
        if (isApplied) {
            const validItems = itemsToRestore.filter(it => it.translated && it.pid && it.pid !== '알 수 없음');
            if (validItems.length > 0) {
                applyTranslationsToPage(validItems, false);
            }
        }

        // 4. separatorExcludedItems 배열에서 복원된 항목 제거
        const restoredOriginals = new Set(itemsToRestore.map(it => it.original));
        separatorExcludedItems = separatorExcludedItems.filter(it => !restoredOriginals.has(it.original));

        // 5. 패널 다시 렌더링 (남은 항목 없으면 자동 닫힘)
        renderSeparatorExcludePanel(separatorExcludedItems);

        // 6. 안내 메시지
        logToSidebar(`[복원 완료] ${itemsToRestore.length}개 단락이 정상 복원되었습니다.`, 'log-success');

    } catch (err) {
        console.error('[RestoreExcluded] 복원 실행 중 에러 발생:', err);
        alert('번역 복원 중 오류가 발생했습니다.');
    }
}

async function openExcludedManager() {
    try {
        const url = getCleanUrl();
        const res = await fetch(`http://127.0.0.1:8001/translations/excluded_details?url=${encodeURIComponent(url)}`);
        if (!res.ok) {
            alert('제외 목록을 가져오지 못했습니다.');
            return;
        }
        const data = await res.json();
        const excludedList = (data.excluded_items || []).map(item => ({
            id: item.id,
            pid: item.pid || '알 수 없음',
            original: item.original,
            translated: item.translated || '',
            matchedSep: '제외 목록',
            isSubsequent: false
        }));

        if (excludedList.length === 0) {
            alert('현재 페이지에 제외된 단락이 없습니다.');
            return;
        }

        separatorExcludedItems = excludedList;
        renderSeparatorExcludePanel(excludedList);
        
        // 구분선 패널이 열려있다면 닫기
        const sepPanel = document.getElementById('separator-settings-panel');
        if (sepPanel) sepPanel.style.display = 'none';

        showSidebar();
    } catch (e) {
        console.error('Failed to load excluded manager', e);
        alert('제외 목록을 불러오는 중 오류가 발생했습니다.');
    }
}

// =================================================================================
// Strict Load-Before-Translate Synchronization
// =================================================================================

async function ensureTranslationsLoaded() {
    if (translationsLoadedPromise) {
        return translationsLoadedPromise;
    }

    translationsLoadedPromise = (async () => {
        const url = getCleanUrl();
        logToSidebar("저장된 번역을 서버에서 불러오는 중...");
        try {
            const [translations, excluded] = await Promise.all([
                fetchTranslationsForUrl(url),
                fetchExclusionsForUrl(url)
            ]);

            if (excluded) {
                exclusionSet = new Set(excluded);
            }

            if (translations && Array.isArray(translations) && translations.length > 0) {
                translationCache.clear();
                translations.forEach(t => {
                    if (t.translated && t.translated.trim()) {
                        translationCache.set(t.pid, t);
                    }
                });
                populateSidebar(translations);
                logToSidebar(`서버에서 ${translations.length}개의 저장된 번역을 불러왔습니다.`);
            } else {
                logToSidebar("서버에 저장된 기존 번역이 없습니다.");
            }
            return translations;
        } catch (e) {
            console.error("[ensureTranslationsLoaded] 번역 로드 실패:", e);
            logToSidebar(`저장된 번역 로드 실패: ${e.message}`, "log-error");
            return null;
        }
    })();

    return translationsLoadedPromise;
}

function hasUntranslatedParagraphs() {
    const paragraphs = getTargetParagraphs();
    for (const p of paragraphs) {
        if (p.id === 'tagCount' || /^(la|lp)\d+$/i.test(p.id)) continue;
        const text = p.innerHTML.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").trim();
        if (!text) continue;

        const matchedSep = checkSeparatorMatch(text, activeSeparators);
        if (matchedSep) break; // 구분선 이후는 번역 대상 아님

        // 이미 유효한 번역이 캐시에 있으면 스킵
        const cached = translationCache.get(p.id);
        if (cached && cached.translated && cached.translated.trim()) {
            continue;
        }

        const cleanedText = text.replace(/([あアいイうウえエおオ])\1{2,}/g, '$1ー');
        if (exclusionSet.has(cleanedText)) continue;

        if (isTranslatableText(cleanedText)) {
            return true; // 번역할 문장이 실제로 존재함
        }
    }
    return false; // 모든 문장이 이미 번역되어 있음
}

// 노벨업(NovelUp+) 사이트의 경우 단일 <p id="episode_content"> 내에 줄바꿈으로 본문이 구성되어 있으므로,
// 기존 번역 시스템(문단별 p[id] 추출, 매핑, 스타일 적용)과 완벽히 호환되도록 줄 단위 <p id="L1"> 구조로 재구성합니다.
function prepareNovelUpContent() {
    if (!window.location.hostname.includes('novelup.plus')) return;
    const epContent = document.getElementById('episode_content');
    if (!epContent || epContent.dataset.lanovelPreprocessed) return;

    if (epContent.tagName.toLowerCase() === 'div' && epContent.querySelectorAll('p[id]').length > 0) {
        return;
    }

    const rawHtml = epContent.innerHTML;
    const lines = rawHtml.split(/\r?\n/);
    if (lines.length <= 1 && epContent.querySelectorAll('p').length > 1) {
        return;
    }

    const container = document.createElement('div');
    container.id = 'episode_content';
    container.dataset.lanovelPreprocessed = 'true';
    container.className = epContent.className;
    if (epContent.getAttribute('style')) {
        container.setAttribute('style', epContent.getAttribute('style'));
    }

    lines.forEach((line, index) => {
        const p = document.createElement('p');
        p.id = `L${index + 1}`;
        const trimmed = line.replace(/<[^>]*>/g, '').trim();
        if (!trimmed) {
            p.className = 'blank';
            p.innerHTML = '<br>';
        } else {
            p.innerHTML = line;
        }
        container.appendChild(p);
    });

    epContent.replaceWith(container);
    console.log(`[LANOVEL] NovelUp content transformed into ${lines.length} paragraphs for translation.`);
}

async function init() {
    try {
        // 0. 로컬 서버(관리페이지, 뷰어 등)에서는 번역 확장 프로그램 절대 비활성화
        const hostname = window.location.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
            return;
        }

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

        // 노벨업 본문 DOM 구조 정규화 (문단별 p[id]화)
        prepareNovelUpContent();

        injectSidebar();
        setupEventListeners();
        setupLanovelKeyboardNavigation();

        // 0.2. ⚡ 쾌속모드 상태 로드 및 정각 도달 여부 확인
        await loadTurboModeState();
        checkAutoTranslateNextTrigger();

        // 0.5. 소설 제목 감지 및 해당 소설의 구분선 설정 로드
        currentNovelTitle = await detectNovelTitle();
        updateNovelTitleUI(currentNovelTitle);
        await loadNovelSeparators(currentNovelTitle);
        renderSeparatorSettingsPanel();

        // 1. [핵심] 저장된 번역을 무조건 100% 먼저 불러와 캐시와 사이드바를 구축
        const url = getCleanUrl();
        const translations = await ensureTranslationsLoaded();

        // 1.5. 확장 구분선 설정 기반 번역 자동 제외 및 검수 패널
        await checkAndExcludeSeparatorTranslations(translations);

        // 2. 알림 센터 연계 재번역 검수 대상 먼저 조회하여 reviewTargetPids 사전 확보
        await checkAndLoadReviewTargets();

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

        // 4. 실제로 아직 번역되지 않은 문단이 있는 경우에만 사이드바를 열고 번역 진행
        if (turboAbortedOnLoad || (isTurboMode && checkCutoffTimeReached())) {
            if (!turboAbortedOnLoad) {
                await abortTurboMode("초기화 시간 도달");
            }
            console.log("[init] 쾌속모드 정각 도달로 자동 번역을 시작하지 않습니다.");
            logToSidebar("⏰ [정각 도달] 쾌속모드 초기화 정각에 도달하여 자동 번역 및 다음 화 이동이 완전히 중단되었습니다.", "log-error");
        } else {
            const needsTranslation = hasUntranslatedParagraphs();
            if (needsTranslation) {
                showSidebar(); // This will trigger translateAllPTags for new content
            } else {
                console.log("[init] 모든 문장이 이미 저장되어 있어 추가 번역을 수행하지 않습니다.");
            }
        }

        // 5. 목차(TOC) 페이지 기능 초기화 (배지 및 미번역 퀵 점프 패널)
        await initTocPageFeatures();

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
                <button id="sidebar-excluded-list-btn" title="제외된 단락 확인 및 복원">🛡️</button>
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
                    <button id="open-excluded-manager-btn" class="sep-manage-excluded-btn" title="현재 페이지에서 제외된 모든 단락을 조회하고 복원합니다">🛡️ 제외 단락 확인/복원</button>
                </div>
            </div>
        </div>
        <div id="sidebar-turbo-banner" class="sidebar-turbo-banner">
            <div class="turbo-info">
                <span class="turbo-icon">⚡</span>
                <span class="turbo-label">쾌속모드</span>
                <span class="turbo-desc" id="turbo-desc-text">대기: 2초 / 8초</span>
            </div>
            <div class="turbo-controls">
                <span id="turbo-cutoff-badge" class="turbo-cutoff-badge" title="클릭하여 기준 시간 변경 (자동 / 16:00 / 17:00)">기준 16:00 (써머타임)</span>
                <label class="turbo-switch" title="쾌속모드 ON/OFF (초기화 정각까지 빠른 번역)">
                    <input type="checkbox" id="sidebar-turbo-toggle">
                    <span class="turbo-slider round"></span>
                </label>
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
        <div id="separator-exclude-panel" class="separator-exclude-panel" style="display: none;"></div>
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

    // ⚡ 쾌속모드 토글 스위치 및 기준 시간 배지 이벤트 연결
    const turboToggle = document.getElementById('sidebar-turbo-toggle');
    if (turboToggle) {
        turboToggle.addEventListener('change', (e) => {
            setTurboMode(e.target.checked, true);
        });
    }

    const turboCutoffBadge = document.getElementById('turbo-cutoff-badge');
    if (turboCutoffBadge) {
        turboCutoffBadge.addEventListener('click', () => {
            cycleTurboCutoff();
        });
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

                // 새로 저장된 구분선 설정을 감안하여 현재 메모리 내 번역에 매칭되는 항목이 있으면 즉시 자동 제외 및 알림 처리
                if (translationCache.size > 0) {
                    const currentTranslations = Array.from(translationCache.values());
                    await checkAndExcludeSeparatorTranslations(currentTranslations);
                }
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

    const openExcludedManagerBtn = document.getElementById('open-excluded-manager-btn');
    if (openExcludedManagerBtn) {
        openExcludedManagerBtn.addEventListener('click', openExcludedManager);
    }

    const sidebarExcludedListBtn = document.getElementById('sidebar-excluded-list-btn');
    if (sidebarExcludedListBtn) {
        sidebarExcludedListBtn.addEventListener('click', openExcludedManager);
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
        userDeletedTranslationPids.clear();
        translationsLoadedPromise = null;
        hasScannedForP_Tags = false;
        translateAllPTags(true);
        showSidebar();
    });
}

// =================================================================================
// Data & Persistence
// =================================================================================



function extractEpisodeTitle() {
    const host = window.location.hostname;

    // 1. Kakuyomu DOM extraction
    if (host.includes('kakuyomu.jp')) {
        const epEl = document.querySelector('.widget-episodeTitle, [class*="widget-episodeTitle"], h1[class*="episodeTitle"]');
        if (epEl && epEl.textContent.trim()) {
            return epEl.textContent.trim();
        }
        if (document.title) {
            const clean = document.title.replace(/\s*-\s*カクヨム.*$/i, '').trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[0].trim()) {
                return parts[0].trim();
            }
            if (parts[0].trim()) return parts[0].trim();
        }
    }

    // 2. Syosetu DOM extraction
    if (host.includes('syosetu.com')) {
        const epEl = document.querySelector('.p-novel__title, .novel_subtitle, [class*="novel__title"]');
        if (epEl && epEl.textContent.trim()) {
            return epEl.textContent.trim();
        }
        if (document.title) {
            const clean = document.title.replace(/\s*-\s*(小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ).*$/i, '').trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[parts.length - 1].trim()) {
                return parts[parts.length - 1].trim();
            }
            if (parts[0].trim()) return parts[0].trim();
        }
    }

    // 3. NovelUp DOM extraction
    if (host.includes('novelup.plus')) {
        const epEl = document.querySelector('.episode_title, #section_episode .episode_title, h1');
        if (epEl && epEl.textContent.trim()) {
            return epEl.textContent.trim();
        }
        if (document.title) {
            const clean = document.title.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, '').trim();
            const parts = clean.split(/\s*-\s*/);
            if (parts.length > 1 && parts[parts.length - 1].trim()) {
                return parts[parts.length - 1].trim();
            }
            if (parts[0].trim()) return parts[0].trim();
        }
    }

    // 4. General Fallback
    if (document.title) {
        let clean = document.title.replace(/\s*-\s*(カクヨム|小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ|ノベルアップ).*$/i, '').trim();
        clean = clean.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, '').trim();
        const parts = clean.split(/\s*-\s*/);
        if (parts.length > 1 && parts[0].trim()) {
            return parts[0].trim();
        }
        return clean;
    }

    return '';
}

async function saveSingleTranslation(pid, original, translated) {
    const url = getCleanUrl();
    const title = extractEpisodeTitle() || document.title;
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
    const title = extractEpisodeTitle() || document.title;
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

// ⚡ 글자 수 / 토큰 예산 기반 가변 청킹 함수
function createBudgetChunks(items, maxChars = CHUNK_BUDGET_CHARACTERS, maxItems = CHUNK_BUDGET_MAX_ITEMS) {
    const chunks = [];
    let currentChunk = [];
    let currentChars = 0;

    for (const item of items) {
        const itemText = item.text || '';
        const itemLen = itemText.length;

        // 현재 묶음에 추가했을 때 글자 수 예산(maxChars) 또는 최대 문장 수(maxItems)를 초과하면 새 묶음 시작
        if (currentChunk.length > 0 && (currentChars + itemLen > maxChars || currentChunk.length >= maxItems)) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentChars = 0;
        }

        currentChunk.push(item);
        currentChars += itemLen;
    }

    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }

    return chunks;
}

// =================================================================================
// 소설 Work Key 및 10화 단위 연속 번역 세션·4시 리셋 카운터 관리
// =================================================================================

function getNovelWorkKey() {
    const url = window.location.href;
    const host = window.location.hostname;

    // 1. 카쿠요무: /works/1177354054887975130
    if (host.includes('kakuyomu.jp')) {
        const match = url.match(/\/works\/(\d+)/);
        if (match) return `kakuyomu_${match[1]}`;
    }
    // 2. 쇼세츠 (소설가가 되자): /n3298hj/ or /n4913gc/ (끝 슬래시 유무 무관)
    if (host.includes('syosetu.com')) {
        const match = url.match(/\/(n\d+[a-z]+)(\/|$)/i);
        if (match) return `syosetu_${match[1].toLowerCase()}`;
    }
    // 3. 노벨업플러스: /story/12345
    if (host.includes('novelup.plus')) {
        const match = url.match(/\/story\/(\d+)/);
        if (match) return `novelup_${match[1]}`;
    }
    // 4. 하멜른: /novel/12345
    if (host.includes('syosetu.org')) {
        const match = url.match(/\/novel\/(\d+)/);
        if (match) return `hameln_${match[1]}`;
    }
    // 5. 알파폴리스: /novel/12345
    if (host.includes('alphapolis.co.jp')) {
        const match = url.match(/\/novel\/(\d+)/);
        if (match) return `alphapolis_${match[1]}`;
    }

    // 6. Fallback: 소설 제목 정규화 (일본어, 영문, 숫자, 한글 모두 포함)
    if (currentNovelTitle && currentNovelTitle !== '기본 소설' && currentNovelTitle !== '閉じる') {
        const sanitized = currentNovelTitle.trim().replace(/[^a-zA-Z0-9가-힣\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff_]/g, '_');
        if (sanitized && sanitized.replace(/_/g, '').length > 0) {
            return `novel_${sanitized}`;
        }
    }

    return 'default';
}

// Gemini API 일일 쿼터 초기화 시각(미국 태평양 자정) 기준 윈도우 식별자 반환
// - 서머타임(PDT): 한국 시간 16:00 (오후 4시)
// - 표준시(PST): 한국 시간 17:00 (오후 5시)
function getCurrentQuotaWindow(now = new Date()) {
    const cutoffHour = typeof detectCutoffInfo === 'function' ? detectCutoffInfo().hour : 16;
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = now.getHours();

    if (hour < cutoffHour) {
        const prev = new Date(now.getTime() - 24 * 3600 * 1000);
        const pYear = prev.getFullYear();
        const pMonth = String(prev.getMonth() + 1).padStart(2, '0');
        const pDay = String(prev.getDate()).padStart(2, '0');
        return `${pYear}-${pMonth}-${pDay}_${cutoffHour}`;
    }
    return `${year}-${month}-${day}_${cutoffHour}`;
}

// =================================================================================
// ⚡ 최근 번역 회차 기반 적응형 RPM 방어 시스템 (Episode-Aware Adaptive Throttling)
// =================================================================================
const RECENT_EPISODES_STORAGE_KEY = 'lanovel_recent_episodes';
let recentEpisodesMemoryCache = [];

async function recordRecentEpisode(currentCleanUrl) {
    if (!currentCleanUrl) return;
    const now = Date.now();
    const pruneCutoff = now - 10 * 60 * 1000; // 10분 이상 지난 기록 정리

    let list = [];
    try {
        const stored = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
        if (Array.isArray(stored[RECENT_EPISODES_STORAGE_KEY])) {
            list = stored[RECENT_EPISODES_STORAGE_KEY].filter(it => it && it.timestamp >= pruneCutoff);
        }
    } catch (_) {
        list = recentEpisodesMemoryCache.filter(it => it && it.timestamp >= pruneCutoff);
    }

    // 동일 회차가 30초 내에 이미 들어있으면 타임스탬프만 갱신
    const existingIndex = list.findIndex(it => it.url === currentCleanUrl);
    if (existingIndex >= 0) {
        list[existingIndex].timestamp = now;
    } else {
        list.push({ url: currentCleanUrl, timestamp: now });
    }

    recentEpisodesMemoryCache = list;
    try {
        await chrome.storage.local.set({ [RECENT_EPISODES_STORAGE_KEY]: list });
    } catch (_) {}
}

async function getRecentEpisodeCount(windowMinutes = 5) {
    const now = Date.now();
    const cutoff = now - windowMinutes * 60 * 1000;
    let list = [];

    try {
        const stored = await chrome.storage.local.get(RECENT_EPISODES_STORAGE_KEY);
        if (Array.isArray(stored[RECENT_EPISODES_STORAGE_KEY])) {
            list = stored[RECENT_EPISODES_STORAGE_KEY];
        } else {
            list = recentEpisodesMemoryCache;
        }
    } catch (_) {
        list = recentEpisodesMemoryCache;
    }

    const distinctUrls = new Set(
        list.filter(it => it && it.timestamp >= cutoff && it.url).map(it => it.url)
    );
    return distinctUrls.size;
}

function calculateAdaptiveEpisodeDelay(recentCount, isTurbo) {
    if (isTurbo) {
        // 쾌속모드: 최근 번역한 회차가 많을수록 분당 요청 폭증(RPM 초과)을 막기 위해 점진적/대폭 지연 부여
        if (recentCount <= 2) return 8000;      // 0~2화: 기본 8초 (안전 구간)
        if (recentCount === 3) return 15000;    // 3화: 15초 (주의 구간)
        if (recentCount === 4) return 22000;    // 4화: 22초 (경고 구간)
        if (recentCount === 5) return 30000;    // 5화: 30초 (과열 주의)
        if (recentCount === 6) return 40000;    // 6화: 40초 (과열 위험)
        return 55000;                           // 7화 이상: 55초 (완전 쿨다운)
    } else {
        // 일반 모드: 기본 60초, 회차 급증 시 안전하게 추가 연장
        if (recentCount <= 4) return 60000;
        if (recentCount <= 6) return 75000;
        return 90000;
    }
}

function calculateAdaptiveChunkDelay(recentCount, isTurbo) {
    if (isTurbo) {
        if (recentCount <= 3) return 2000;      // 기본 2초
        if (recentCount <= 5) return 3000;      // 3초 미세 완충
        return 4500;                            // 4.5초 과열 완충
    } else {
        if (recentCount <= 4) return 5000;
        return 6500;
    }
}

async function updateAndGetBatchCount(currentCleanUrl) {
    const workKey = getNovelWorkKey();
    const stateKey = `lanovel_batch_state_${workKey}`;

    // 레거시 비정상 키(380 등 기존 누적 오염값) 완전 청소
    try {
        const allKeys = await chrome.storage.local.get(null);
        const legacyKeys = Object.keys(allKeys).filter(k => k.startsWith('lanovel_batch_count_'));
        if (legacyKeys.length > 0) {
            await chrome.storage.local.remove(legacyKeys);
        }
    } catch (_) {}

    const currentWindow = getCurrentQuotaWindow();
    const cutoffInfo = typeof detectCutoffInfo === 'function' ? detectCutoffInfo() : { hour: 16, label: '오후 4시' };
    const cutoffHour = cutoffInfo.hour;
    const now = Date.now();
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분 미활동 시 세션 만료 (새 세션은 1화부터 시작)

    let state = {
        consecutiveCount: 0,
        lastUpdated: 0,
        lastUrl: '',
        window: currentWindow
    };

    try {
        const stored = await chrome.storage.local.get(stateKey);
        if (stored && stored[stateKey]) {
            const s = stored[stateKey];
            // 오염된 기존 누적 count(2, 38 등)를 이번 연속 카운터로 잘못 승계하지 않도록 안전 초기화
            state.consecutiveCount = (typeof s.consecutiveCount === 'number') ? s.consecutiveCount : 0;
            state.lastUpdated = s.lastUpdated || 0;
            state.lastUrl = s.lastUrl || '';
            state.window = s.window || currentWindow;
        }
    } catch (e) {
        console.warn('[ntfy] Failed to read batch state from storage:', e);
    }

    // 1. API 일일 쿼터 초기화 시각(오후 4시/16시 또는 오후 5시/17시) 도달 시 카운터 0으로 갱신
    if (state.window && state.window !== currentWindow) {
        logToSidebar(`🔄 [일일 갱신] Gemini API 쿼터 초기화 시간(${cutoffHour}시)에 도달하여 이번 세션 연속 번역 카운터를 새로 시작합니다.`);
        state.consecutiveCount = 0;
        state.lastUrl = '';
        state.window = currentWindow;
    }

    // 2. 세션 타임아웃 검사 (이전 번역 완료 후 30분 이상 지났으면 새 세션으로 0으로 초기화)
    const isSessionExpired = !state.lastUpdated || (now - state.lastUpdated > SESSION_TIMEOUT_MS);
    if (isSessionExpired) {
        state.consecutiveCount = 0;
        state.lastUrl = '';
    }

    // 3. 동일 URL(회차) 중복 카운트 방지
    const isSameEpisode = (state.lastUrl && state.lastUrl === currentCleanUrl);
    if (isSameEpisode) {
        if (!state.consecutiveCount || state.consecutiveCount < 1) {
            state.consecutiveCount = 1;
        }
        logToSidebar(`[번역 진행 카운터] 동일 회차 재번역 감지: 이번 연속 번역 카운터를 유지합니다. (${state.consecutiveCount}화)`);
    } else {
        // 새 회차 번역: 연속 카운터 + 1 (새 세션 첫 번역이면 0 + 1 = 1)
        state.consecutiveCount = (state.consecutiveCount || 0) + 1;
    }

    state.lastUpdated = now;
    state.lastUrl = currentCleanUrl;
    state.window = currentWindow;

    try {
        await chrome.storage.local.set({ [stateKey]: state });
    } catch (e) {
        console.warn('[ntfy] Failed to save batch state:', e);
    }

    // 4. [서버 DB 동기화] 오늘 번역된 DB 기록을 바탕으로 오늘 소설 누적 및 전체 누적 회차 동기화
    let novelTodayCount = state.consecutiveCount;
    let totalTodayCount = window.lanovelTodayTotalEpisodes || 0;

    try {
        const syncUrl = `http://127.0.0.1:8001/api/translation_session_count?url=${encodeURIComponent(currentCleanUrl)}&work_key=${encodeURIComponent(workKey)}&novel_title=${encodeURIComponent(currentNovelTitle || '')}`;
        const serverResp = await fetch(syncUrl);
        if (serverResp.ok) {
            const serverData = await serverResp.json();
            if (typeof serverData.total_today_count === 'number') {
                totalTodayCount = serverData.total_today_count;
                window.lanovelTodayTotalEpisodes = totalTodayCount;
            }
            if (typeof serverData.count === 'number' && serverData.count > 0) {
                novelTodayCount = serverData.count;
            }
        }
    } catch (_) {}

    return {
        consecutiveCount: state.consecutiveCount,
        novelTodayCount: novelTodayCount,
        totalTodayCount: totalTodayCount,
        count: state.consecutiveCount,
        valueOf() { return this.consecutiveCount; },
        toString() { return String(this.consecutiveCount); }
    };
}

async function resetBatchCount() {
    const workKey = getNovelWorkKey();
    const stateKey = `lanovel_batch_state_${workKey}`;
    try {
        await chrome.storage.local.remove(stateKey);
    } catch (_) {}
}

// =================================================================================
// ntfy Push Notifications
// =================================================================================

async function sendNtfyProgress(novelTitle, episodeTitle, current, total, percentage, url, episodeCount = null) {
    try {
        const payload = {
            novel_title: novelTitle || '',
            episode_title: episodeTitle || '',
            current: current,
            total: total,
            percentage: percentage,
            url: url || ''
        };
        if (episodeCount !== null && episodeCount !== undefined) {
            payload.episode_count = episodeCount;
        }
        await fetch('http://127.0.0.1:8001/api/notifications/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        // 알림 전송 실패는 메인 프로세스를 방해하지 않음
    }
}

async function sendNtfyComplete(novelTitle, episodeTitle, totalCount, url, episodeCount = null) {
    try {
        const payload = {
            novel_title: novelTitle || '',
            episode_title: episodeTitle || '',
            total_count: totalCount,
            url: url || ''
        };
        if (episodeCount !== null && episodeCount !== undefined) {
            payload.episode_count = episodeCount;
        }
        await fetch('http://127.0.0.1:8001/api/notifications/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        // 알림 전송 실패는 메인 프로세스를 방해하지 않음
    }
}

// =================================================================================
// 미번역 빈칸 번역 감지 및 마지막 번역꾸러미 보완 헬퍼 함수
// =================================================================================

function isItemEmptyTranslation(item) {
    if (!item || !item.id) return false;
    const pid = String(item.id);

    // 1. 사용자가 직접 삭제했거나 구분선/제외 목록에 의해 제외된 번역인지 확인 (번역 삭제등 한게 아니라면)
    if (userDeletedTranslationPids.has(pid)) return false;
    const row = document.querySelector(`tr[data-pid="${pid}"]`);
    if (row && (row.dataset.userDeleted === 'true' || row.getAttribute('data-user-deleted') === 'true')) return false;
    if (exclusionSet.has(item.text)) return false;
    if (checkSeparatorMatch(item.text, activeSeparators)) return false;

    // 2. 검열로 인해 생략된 항목인지 확인
    const cached = translationCache.get(pid);
    if (cached && cached.translated && cached.translated.includes('[검열로 인해 번역 생략]')) return false;
    if (row) {
        const cell = row.querySelector('.translated-text');
        if (cell && cell.textContent.includes('[검열로 인해 번역 생략]')) return false;
    }

    // 3. 유효한 번역문이 존재하는지 확인
    // (1) 캐시 확인
    const cachedText = cached && cached.translated ? cached.translated.trim() : '';
    const hasValidCached = cachedText.length > 0 && !cachedText.includes('번역 실패') && !cachedText.includes('API 오류');

    // (2) 사이드바 DOM 확인
    let hasValidDOM = false;
    if (row) {
        const cell = row.querySelector('.translated-text');
        const domText = cell ? cell.textContent.trim() : '';
        if (domText.length > 0 && 
            !domText.includes('⏳ 번역 중') && 
            !domText.includes('⏳ 재번역 중') && 
            !domText.includes('번역 실패') && 
            !domText.includes('API 오류')) {
            hasValidDOM = true;
        }
    }

    // 캐시나 DOM에 유효한 번역문이 존재하면 빈칸이 아님
    if (hasValidCached || hasValidDOM) {
        return false;
    }

    // 번역문이 비어있거나 빈칸(공백)인 경우
    return true;
}

function getPendingEmptyItems(candidateItems, excludeItemIds = new Set()) {
    const emptyItems = [];
    const seenPids = new Set();
    for (const item of candidateItems) {
        if (!item || !item.id) continue;
        const pid = String(item.id);
        if (excludeItemIds.has(pid) || seenPids.has(pid)) continue;
        if (isItemEmptyTranslation(item)) {
            emptyItems.push(item);
            seenPids.add(pid);
        }
    }
    return emptyItems;
}

async function translateAllPTags(isRetranslation = false) {
    if (turboAbortedOnLoad) {
        console.log("[translateAllPTags] 쾌속모드 정각 도달로 번역이 차단되었습니다.");
        return;
    }
    isTranslationCancelled = false;
    document.getElementById('stop-translation-btn').style.display = 'inline-block';
    document.getElementById('retry-translation-btn').style.display = 'none';

    // ⚡ 쾌속모드 활성 상태에서 이미 정각에 도달했는지 선제 검사
    if (isTurboMode && checkCutoffTimeReached()) {
        await abortTurboMode("초기화 시간 도달");
        return;
    }

    // [핵심 보장] 일반 번역 시 반드시 서버에서 저장된 번역을 먼저 완벽히 불러와 캐시를 채운 후에만 진행
    if (!isRetranslation) {
        await ensureTranslationsLoaded();
    }

    const paragraphs = getTargetParagraphs();
    const textsToTranslate = [];
    const instantPunctuationItems = [];
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

        if (cleanedText && isTranslatableText(cleanedText)) {
            // [Fast-Path] 문자가 없고 순수 문장부호/기호만 있는 문장(「……」, 「……？」, …… 등)은 API 호출 없이 즉시 원문 그대로 대입
            if (isPurePunctuationOnly(cleanedText)) {
                instantPunctuationItems.push({ id: p.id, original: cleanedText, translated: cleanedText });
            } else {
                textsToTranslate.push({ id: p.id, text: cleanedText });
            }
        }
    });

    // ⚡ 순수 문장부호/기호 문장(「……」 등) 즉시 대입 및 저장 처리 (API 호출 0소모, 0초 즉시 반영)
    if (instantPunctuationItems.length > 0) {
        instantPunctuationItems.forEach(item => {
            const pidStr = String(item.id);
            userDeletedTranslationPids.delete(pidStr);
            translationCache.set(item.id, { pid: item.id, original: item.original, translated: item.translated });
            addEntryToSidebar({ pid: item.id, original: item.original, translated: item.translated });
        });
        updateSidebarWithTranslations(instantPunctuationItems);
        sortSidebar();
        if (isPageApplied) {
            applyTranslationsToPage(instantPunctuationItems, false);
        }
        await saveAllTranslations(instantPunctuationItems);
        logToSidebar(`[즉시 대입] 문자 없는 문장부호 문장 ${instantPunctuationItems.length}개(「……」 등)를 API 호출 없이 원문 그대로 즉시 적용했습니다.`);
    }

    if (textsToTranslate.length === 0) {
        if (instantPunctuationItems.length > 0) {
            logToSidebar("모든 번역 작업이 완료되었습니다. (순수 문장부호 즉시 대입 완료)");
            sortSidebar();
        } else {
            logToSidebar("번역할 새로운 내용이 없습니다.");
        }
        document.getElementById('stop-translation-btn').style.display = 'none';
        document.getElementById('retry-translation-btn').style.display = 'inline-block';
        return;
    }

    const sepCount = activeSeparators.length;
    const sepPreview = sepCount > 0 ? activeSeparators.slice(0, 3).join(', ') + (sepCount > 3 ? ` 외 ${sepCount - 3}개` : '') : '없음';
    const modelDesc = isRetranslation ? "고성능 모델(Gemini 3.0 Flash)" : "기본 엔진";
    const turboDesc = isTurboMode ? " ⚡쾌속모드" : "";
    const totalChars = textsToTranslate.reduce((sum, item) => sum + (item.text ? item.text.length : 0), 0);
    const chunks = createBudgetChunks(textsToTranslate, CHUNK_BUDGET_CHARACTERS, CHUNK_BUDGET_MAX_ITEMS);
    logToSidebar(`[소설: ${currentNovelTitle || '기본'}] 총 ${textsToTranslate.length}개 문장(약 ${totalChars.toLocaleString()}자)을 글자 수·토큰 예산(최대 ${CHUNK_BUDGET_CHARACTERS.toLocaleString()}자 / ${CHUNK_BUDGET_MAX_ITEMS}문장) 기반 ${chunks.length}개 최적 묶음으로 번역을 시작합니다. (${modelDesc}${turboDesc}, 구분선: ${sepPreview})`);
    
    addPlaceholderRows(textsToTranslate);

    function checkAndReportMilestone(currentProcessed, totalItems) {
        // [100% 완료 시에만 알림 정책] 회차 내부의 자잘한 진행 알림(25%, 50%, 75%)은 차단합니다.
        // 각 화가 100% 완료된 후 10화 단위 마일스톤에 도달할 때만 알림이 전송됩니다.
        return;
    }

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
                    if (response.error.includes("초기화 시간") || response.error.includes("자동 번역을 중지")) {
                        await abortTurboMode("초기화 시간 도달");
                        return;
                    }
                    throw new Error(response.error);
                }
    
                if (response && response.notification) {
                    logToSidebar(response.notification, 'log-error');
                    if (response.stop) {
                        if (response.isQuotaResetStop) {
                            // 쿼터 초기화(16시/17시) 정각 도달: 재시도나 재개 대기 없이 즉시 완전 중단
                            await abortTurboMode("초기화 시간 도달");
                            return;
                        }

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

                    // [원문 복붙/변형 감지 알림 & UI 처리]
                    const verbatimItems = response.translations.filter(t => 
                        Boolean(t.verbatim) || (t.translated && checkIsVerbatimOrParaphrased(t.original, t.translated))
                    );
                    if (verbatimItems.length > 0) {
                        verbatimItems.forEach(item => {
                            const preview = item.original ? (item.original.length > 25 ? item.original.slice(0, 25) + '...' : item.original) : '';
                            logToSidebar(`⚠️ [원문 복제·변형 감지] 문장(ID: ${item.id})이 원문과 동일/변형되어 자동 삭제 및 휴지통으로 이전되었습니다. (원문: ${preview})`, 'log-error');
                            translationCache.delete(item.id);

                            // 본문 pTag 원상복구
                            if (isPageApplied) {
                                const pTag = document.getElementById(item.id);
                                if (pTag && pTag.dataset.lanovelOriginalHtml) {
                                    pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
                                    pTag.classList.remove('lanovel-applied-text');
                                    pTag.removeAttribute('style');
                                    if (pTag.dataset.lanovelOriginalStyle) {
                                        pTag.setAttribute('style', pTag.dataset.lanovelOriginalStyle);
                                    }
                                }
                            }

                            const row = document.querySelector(`tr[data-pid="${item.id}"]`);
                            if (row) {
                                const cell = row.querySelector('.translated-text');
                                if (cell) {
                                    cell.textContent = '';
                                    cell.setAttribute('contenteditable', 'true');
                                }
                                const saveBtn = row.querySelector('.save-btn');
                                if (saveBtn) saveBtn.disabled = false;
                                const retransBtn = row.querySelector('.retranslate-row-btn');
                                if (retransBtn) retransBtn.disabled = false;
                            }
                            const panelTraEl = document.getElementById(`review-tra-${item.id}`);
                            if (panelTraEl) {
                                panelTraEl.textContent = '번역: (원문 복제·변형 감지되어 자동 삭제됨)';
                                panelTraEl.classList.add('waiting');
                            }
                        });
                    }

                    const verbatimIdSet = new Set(verbatimItems.map(v => String(v.id)));
                    const successes = response.translations.filter(t => 
                        !verbatimIdSet.has(String(t.id)) && t.translated !== null && !t.translated.includes('번역 실패')
                    );
                    const failures = response.translations.filter(t => 
                        !verbatimIdSet.has(String(t.id)) && (t.translated === null || t.translated.includes('번역 실패'))
                    );
    
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
                if (error.message && (error.message.includes('초기화 시간') || error.message.includes('자동 번역을 중지'))) {
                    await abortTurboMode("초기화 시간 도달");
                    return;
                }
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
                    await new Promise(resolve => setTimeout(resolve, 3000));
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

    // ⚡ 글자 수 / 토큰 예산 기반 가변 묶음 순차 번역
    if (!isTranslationCancelled && chunks.length > 0) {
        let progress = 0;
        const initialRecentEpCount = await getRecentEpisodeCount(5);
        const initialChunkDelay = calculateAdaptiveChunkDelay(initialRecentEpCount, isTurboMode);

        logToSidebar(isTurboMode 
            ? (initialRecentEpCount >= 4
                ? `⚡ [쾌속모드] 최근 번역 회차(${initialRecentEpCount}화) 과열 방지: 묶음 간 대기 시간을 ${(initialChunkDelay / 1000).toFixed(1)}초로 완충합니다.` 
                : `⚡ [쾌속모드] 번역 묶음 간 대기 시간을 ${(initialChunkDelay / 1000).toFixed(1)}초로 설정합니다.`) 
            : `RPM 제한을 피하기 위해 묶음 간 대기 시간을 ${(initialChunkDelay / 1000).toFixed(1)}초로 설정합니다.`);

        for (const [index, chunk] of chunks.entries()) {
            if (isTranslationCancelled) break;

            let currentChunk = chunk;
            const isLastChunk = (index === chunks.length - 1);

            // [번역 완료 한스텝전: 이전 꾸러미 빈칸 번역 통합]
            if (isLastChunk) {
                const currentChunkIdSet = new Set(chunk.map(c => String(c.id)));
                const emptyItems = getPendingEmptyItems(textsToTranslate, currentChunkIdSet);
                if (emptyItems.length > 0) {
                    logToSidebar(`[마지막 꾸러미 포함] 번역 완료 한스텝전, 이전 번역 중 빈칸(미완료) 문장 ${emptyItems.length}개를 마지막 번역꾸러미에 포함하여 함께 번역합니다.`);
                    emptyItems.forEach(item => {
                        const row = document.querySelector(`tr[data-pid="${item.id}"]`);
                        if (row) {
                            const cell = row.querySelector('.translated-text');
                            if (cell) {
                                cell.textContent = '⏳ 번역 중...';
                                cell.style.color = '';
                            }
                        }
                    });
                    currentChunk = [...chunk, ...emptyItems];
                }
            }

            const currentChunkChars = currentChunk.reduce((sum, it) => sum + (it.text ? it.text.length : 0), 0);
            progress += chunk.length;
            logToSidebar(`(${progress}/${textsToTranslate.length}문장, 묶음 ${index + 1}/${chunks.length} [약 ${currentChunkChars.toLocaleString()}자]) 번역 진행 중...${currentChunk.length > chunk.length ? ` (빈칸 문장 ${currentChunk.length - chunk.length}개 추가 포함)` : ''}`);
            await translateChunk(currentChunk, currentChunk.length);
            checkAndReportMilestone(progress, textsToTranslate.length);

            if (index < chunks.length - 1) {
                const currentDelay = calculateAdaptiveChunkDelay(initialRecentEpCount, isTurboMode);
                logToSidebar(`${(currentDelay / 1000).toFixed(1)}초 후 다음 묶음을 번역합니다.`);
                await sleepResponsive(() => calculateAdaptiveChunkDelay(initialRecentEpCount, isTurboMode));
                if (isTurboMode && checkCutoffTimeReached()) {
                    await abortTurboMode("초기화 시간 도달");
                    break;
                }
            }
        }
    }

    // [번역 완료 직전 최종 빈칸 확인 및 보완 마지막 번역꾸러미]
    if (!isTranslationCancelled) {
        const remainingEmptyItems = getPendingEmptyItems(textsToTranslate);
        if (remainingEmptyItems.length > 0) {
            logToSidebar(`[보완 번역꾸러미] 번역 완료 직전, 미완료 빈칸 번역 ${remainingEmptyItems.length}개가 감지되어 마지막 번역꾸러미로 추가 번역을 진행합니다.`);
            remainingEmptyItems.forEach(item => {
                const row = document.querySelector(`tr[data-pid="${item.id}"]`);
                if (row) {
                    const cell = row.querySelector('.translated-text');
                    if (cell) {
                        cell.textContent = '⏳ 번역 중...';
                        cell.style.color = '';
                    }
                }
            });
            await translateChunk(remainingEmptyItems, remainingEmptyItems.length);
        }
    }

    // Finalize
    document.getElementById('stop-translation-btn').style.display = 'none';
    document.getElementById('retry-translation-btn').style.display = 'inline-block';
    sortSidebar();
    logToSidebar("모든 번역 작업이 완료되었습니다.");

    if (!isTranslationCancelled) {
        // [알림 센터 검수 모드: 다음 페이지 자동 넘기기 차단 및 회차 카운트 제외]
        if (isReviewMode()) {
            logToSidebar("🔔 [알림 센터 검수 모드] 재번역 검수 회차이므로 다음 페이지 자동 넘기기가 비활성화되었습니다.");
            return;
        }

        // [10화 단위 번역 진행 알림 (100% 완료 시에만)]
        // 30분 세션 타임아웃, 중복 방지, 이번 연속 번역 및 일일 누적 통계 조회
        const batchStats = await updateAndGetBatchCount(getCleanUrl());
        const consecutiveCount = batchStats.consecutiveCount;
        const novelTodayCount = batchStats.novelTodayCount;
        const totalTodayCount = batchStats.totalTodayCount;
        const currentBatchCount = consecutiveCount; // ntfy 완료 핸들러 등 호환성 유지

        const totalTodayMsg = totalTodayCount ? ` / 전체: ${totalTodayCount}화` : '';
        logToSidebar(`[번역 진행 카운터] 현재 소설 이번 연속: ${consecutiveCount}화 완료 (오늘 이 소설: ${novelTodayCount}화${totalTodayMsg})`);

        // 10의 배수(10, 20, 30, ...) 화가 100% 완료되었을 때만 진행 알림 발송!
        if (consecutiveCount > 0 && consecutiveCount % 10 === 0) {
            logToSidebar(`🔔 [ntfy] 이번 연속 ${consecutiveCount}화 달성! 10화 단위 번역 진행 알림을 발송합니다.`);
            sendNtfyProgress(
                currentNovelTitle,
                extractEpisodeTitle() || document.title || '',
                textsToTranslate.length,
                textsToTranslate.length,
                100,
                getCleanUrl(),
                consecutiveCount
            );
        } else {
            logToSidebar(`[ntfy] 10화 단위 알림 정책 적용 중 (현재 이번 연속: ${consecutiveCount}화, 다음 알림: ${Math.ceil(consecutiveCount / 10) * 10}화)`);
        }

        const currentUrl = getCleanUrl(); // Get the current clean URL

        // 최근 번역 완료 회차 슬라이딩 윈도우에 등록 및 최근 5분 회차 빈도 조회
        await recordRecentEpisode(currentUrl);
        const completedRecentCount = await getRecentEpisodeCount(5);

        const startAutoScroll = async () => {
            if (isReviewMode()) {
                logToSidebar("🔔 [알림 센터 검수 모드] 재번역 검수 회차이므로 다음 페이지 자동 넘기기가 비활성화되었습니다.");
                return;
            }

            const targetDelay = calculateAdaptiveEpisodeDelay(completedRecentCount, isTurboMode);
            const delaySec = Math.round(targetDelay / 1000);

            if (isTurboMode) {
                if (completedRecentCount >= 3) {
                    logToSidebar(`⚡ [RPM 적응형 보호] 최근 5분간 번역 회차: ${completedRecentCount}화 감지 (과열 방지 구간) → 다음 회차 대기 시간을 ${delaySec}초로 자동 연장합니다.`);
                    showLanovelHud(`RPM 보호 지연 중... (${delaySec}초)`, '🛡️', 4000);
                } else {
                    logToSidebar(`⚡ [쾌속모드] 번역 완료 (최근 5분: ${completedRecentCount}화, 안전 구간). ${delaySec}초 후 다음 페이지로 이동합니다.`);
                }
            } else {
                if (completedRecentCount >= 5) {
                    logToSidebar(`[RPM 적응형 보호] 최근 5분간 번역 회차: ${completedRecentCount}화 감지 → 다음 회차 대기 시간을 ${delaySec}초로 연장합니다.`);
                } else {
                    logToSidebar(`번역 완료. ${delaySec}초 후 페이지 끝으로 자동 스크롤합니다.`);
                }
            }

            await sleepResponsive(() => calculateAdaptiveEpisodeDelay(completedRecentCount, isTurboMode));
            if (isTranslationCancelled) return;

            if (isTurboMode && checkCutoffTimeReached()) {
                await abortTurboMode("초기화 시간 도달");
                return;
            }

            logToSidebar("페이지 끝으로 스크롤 후 다음 페이지 액션을 실행합니다.");
            const scrollTarget = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            window.scrollTo({ top: scrollTarget, behavior: 'smooth' });

            let scrollCheckAttempts = 0;
            const checkScrollEndInterval = setInterval(() => {
                if (isTranslationCancelled) {
                    clearInterval(checkScrollEndInterval);
                    return;
                }
                
                scrollCheckAttempts++;
                const currentScroll = window.innerHeight + window.scrollY;
                const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                
                // 50px 버퍼 또는 3초(30회) 경과 시 스크롤 완료로 간주 (DPI 배율 차이 및 백그라운드 스로틀링 대응)
                if (currentScroll >= maxScroll - 50 || scrollCheckAttempts >= 30) {
                    clearInterval(checkScrollEndInterval);
                    
                    function navigateToNextChapter(targetUrl) {
                        const navDelay = Math.floor(Math.random() * 1000) + 1500; // 1.5 ~ 2.5초 완충 대기
                        logToSidebar(`다음 페이지로 이동합니다 (${(navDelay / 1000).toFixed(1)}초 대기): ${targetUrl}`);
                        setTimeout(() => {
                            window.location.href = targetUrl;
                        }, navDelay);
                    }

                    if (currentUrl.includes('novel18.syosetu.com') || currentUrl.includes('syosetu.com')) {
                        logToSidebar("소설 사이트 '次へ' 버튼을 찾아서 클릭합니다.");
                        const nextButton = document.querySelector('a.c-pager__item.c-pager__item--next') || document.querySelector('a.novelview_pager-next');
                        if (nextButton && nextButton.href) {
                            navigateToNextChapter(nextButton.href);
                        } else {
                            logToSidebar("다음 페이지 버튼을 찾을 수 없습니다. (소설 연속 번역 종료)");
                            // 마지막 화에 도달하여 다음 화가 없으므로 최종 완료 알림 발송
                            sendNtfyComplete(
                                currentNovelTitle,
                                extractEpisodeTitle() || document.title || '',
                                textsToTranslate.length,
                                getCleanUrl(),
                                currentBatchCount
                            );
                        }
                    } else if (currentUrl.includes('novelup.plus')) {
                        logToSidebar("노벨업플러스 '次へ' 버튼을 찾아서 클릭합니다.");
                        const nextLink = Array.from(document.querySelectorAll('a')).find(a => 
                            (a.closest('.episodeHeaderPager') || a.closest('#section_episode') || a.closest('.storyIndexFooter')) &&
                            a.textContent.includes('次へ') &&
                            a.href && !a.textContent.includes('前へ')
                        ) || Array.from(document.querySelectorAll('a')).find(a => 
                            a.textContent.includes('次へ') && a.href && a.href.includes('/story/') && !a.textContent.includes('前へ')
                        );

                        if (nextLink && nextLink.href) {
                            navigateToNextChapter(nextLink.href);
                        } else {
                            logToSidebar("다음 페이지 버튼을 찾을 수 없습니다. (소설 연속 번역 종료)");
                            sendNtfyComplete(
                                currentNovelTitle,
                                extractEpisodeTitle() || document.title || '',
                                textsToTranslate.length,
                                getCleanUrl(),
                                currentBatchCount
                            );
                        }
                    } else if (currentUrl.includes('kakuyomu.jp')) {
                        logToSidebar("카쿠요무 '다음 에피소드' 링크를 찾아서 이동합니다.");
                        const nextButton = document.querySelector('#contentMain-readNextEpisode') || 
                                           document.querySelector('a.js-read-next-episode') ||
                                           document.querySelector('a[data-link-click-action-name="WorksEpisodesEpisodeFooterNextEpisode"]') ||
                                           document.querySelector('link[rel="next"]');

                        if (nextButton && nextButton.href) {
                            navigateToNextChapter(nextButton.href);
                        } else {
                            logToSidebar("다음 페이지 버튼을 찾을 수 없습니다. (소설 연속 번역 종료)");
                            sendNtfyComplete(
                                currentNovelTitle,
                                extractEpisodeTitle() || document.title || '',
                                textsToTranslate.length,
                                getCleanUrl(),
                                currentBatchCount
                            );
                        }
                    } else {
                        logToSidebar("지원되지 않는 사이트입니다. 기본 'PageDown' 키를 누릅니다.");
                        const pageDownDelay = isTurboMode ? 500 : 4000;
                        setTimeout(() => {
                            document.body.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'PageDown',
                                code: 'PageDown',
                                bubbles: true,
                                cancelable: true,
                                keyCode: 34
                            }));
                        }, pageDownDelay);
                    }
                }
            }, 100);
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

function hasJapaneseText(text) {
    if (!text) return false;
    const cleaned = text
        .replace(/[\s\d_〇ー―~～\W\u2000-\u206f\u25a0-\u25ff\u2600-\u26ff\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/g, '')
        .replace(/^[っッ]+$/, '');
    if (cleaned.length === 0) return false;
    return /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
}

function isSymbolOrPunctOnly(text) {
    if (!text) return true;
    const cleaned = text
        .replace(/[\s\d_〇ー―~～\W\u2000-\u206f\u25a0-\u25ff\u2600-\u26ff\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/g, '')
        .replace(/^[っッ]+$/, '');
    return cleaned.length === 0;
}

const SIMPLIFIED_CHINESE_CHARS = new Set(
    '伤体国爱时门学书电见后发长气车开为过么这头经动问应现实关点进从总将内间来' +
    '说话对给会把没让样怎么去里两起带听说变' +
    '们这为么着说对让给样怎两带听变头经动问应关进从间长车门见书电伤发过时还开写话边东处' +
    '办帮宝备笔产场视认机业张节语虽随岁孙损缩锁态摊贪滩坛叹汤烫涛讨腾铁厅铜统图涂团颓腿' +
    '托脱洼袜网伪违围纬伟卫温闻稳涡窝呜坞妩雾务误锡牺袭习戏细虾吓显险线宪县响项销晓些泄' +
    '谢锌兴汹绣锈须虚嘘许叙绪续轩悬选询寻训讯逊压鸦鸭哑亚讶严岩盐厌扬阳养瑶摇尧遥窑药爷' +
    '页叶医亿义艺议译异荫阴银饮隐鹰婴莹营荧蝇赢颖哟拥佣咏踊涌痈优犹油邮铀游诱鱼渔娱与' +
    '屿吁驭狱誉预渊员圆园辕远怨愿约跃钥岳粤悦阅云匀陨运蕴酝晕韵杂灾载攒暂赞凿灶则择泽责' +
    '贼闸扎斋债毡战栈占粘涨帐账胀赵照折哲针侦珍真诊镇阵争征挣睁狰证支只织职执纸指掷帜质' +
    '钟终种肿重周洲昼朱猪诸诛烛瞩属著助铸筑抓拽专砖转赚庄桩装壮状锥追准浊纵邹阻组钻' +
    '别没么为什么怎么如果因为所以但是而且然后知道看见觉得'
);

const CHINESE_INDICATOR_CHARS = new Set(
    '的了是在我有个人这为说和时要你㑹后对着里去过发都经当与学进还没现她他们' +
    '写听头问话带让样给从关变总两应间长车门见书电伤动开条边东处办帮宝备笔产' +
    '场视认机实业张节语虽随岁孙损缩锁态滩坛叹汤讨体铁厅统图团脱网伪违围卫闻' +
    '稳务误袭习戏细显险线县响项销些谢兴须虚许叙续选询寻训压严岩盐厌扬阳养药' +
    '页叶医亿义艺议译异隐鹰婴营赢优犹油邮油游诱鱼渔娱与屿语吁狱誉预员圆园远怨' +
    '愿约跃运杂灾载暂赞则择泽责贼战张赵照针侦珍诊镇阵争征挣睁证只织职执纸指' +
    '质钟终种重周昼诸朱珠瞩助专砖转赚庄装壮状追准总组' +
    '吗吧呢啊么怎谁为什么怎么因为所以如果但是'
);

function containsChinese(text) {
    if (!text) return false;
    // 일본어 가나(히라가나/가타카나)가 포함되어 있다면 일본어이므로 중국어 판별 제외
    if (/[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]/.test(text)) return false;
    for (const ch of text) {
        if (SIMPLIFIED_CHINESE_CHARS.has(ch)) return true;
    }
    const hasHangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text);
    const hasHanja = /[\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
    if (!hasHangul && hasHanja) {
        for (const ch of text) {
            if (CHINESE_INDICATOR_CHARS.has(ch)) return true;
        }
        if (/[，：“”]/.test(text)) return true;
    }
    return false;
}

async function scanForJapanesePTags() {
    const paragraphs = getTargetParagraphs();
    for (const p of paragraphs) {
        if (p.textContent && hasJapaneseText(p.textContent.trim())) return true;
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

function checkIsVerbatimOrParaphrased(original, translated) {
    if (!original || !translated) return false;
    const cleanOri = original.trim();
    const cleanTra = translated.trim();
    if (!cleanTra) return false;

    // 원문에 사실상 일본어(가나/한자)가 없거나 순수 기호/부호/문장부호(예: 「……」)인 경우 복제/변형 감지에서 제외
    if (!hasJapaneseText(cleanOri) || isSymbolOrPunctOnly(cleanOri)) {
        return false;
    }

    // 1. 공백 제거 후 완전 일치 (원문 복제)
    const noSpaceOri = cleanOri.replace(/\s+/g, '');
    const noSpaceTra = cleanTra.replace(/\s+/g, '');
    if (noSpaceOri === noSpaceTra) return true;

    // 2. 중국어 감지 (사용자 정의: 변형은 중국어 기준)
    if (containsChinese(cleanTra)) return true;

    // 3. 한글이 전혀 없고 일본어 가나가 포함된 경우 (원문 변형 및 패러프레이징)
    const hasHangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(cleanTra);
    const hasKana = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]/.test(cleanTra);
    if (!hasHangul && hasKana) {
        if (noSpaceOri.includes(noSpaceTra) || noSpaceTra.includes(noSpaceOri)) {
            return true;
        }
        return true;
    }

    return false;
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
            const transItem = response.translations[0];
            const newTranslated = transItem.translated || '';
            const isVerbatim = Boolean(transItem.verbatim) || (newTranslated && checkIsVerbatimOrParaphrased(originalText, newTranslated));

            if (isVerbatim) {
                // 원문 복제/변형 감지: 자동 삭제 처리 및 즉시 피드백
                translatedCell.textContent = '';
                translatedCell.setAttribute('contenteditable', 'true');
                translatedCell.style.color = '';

                // 캐시에서 삭제
                translationCache.delete(pid);

                // 본문 적용 복원 (원문 HTML로 되돌림)
                if (isPageApplied) {
                    const pTag = document.getElementById(pid);
                    if (pTag && pTag.dataset.lanovelOriginalHtml) {
                        pTag.innerHTML = pTag.dataset.lanovelOriginalHtml;
                        pTag.classList.remove('lanovel-applied-text');
                        pTag.removeAttribute('style');
                        if (pTag.dataset.lanovelOriginalStyle) {
                            pTag.setAttribute('style', pTag.dataset.lanovelOriginalStyle);
                        }
                    }
                }

                // 상단 검수 패널 실시간 갱신
                const panelTraEl = document.getElementById(`review-tra-${pid}`);
                if (panelTraEl) {
                    panelTraEl.textContent = '번역: (원문 복제·변형 감지되어 자동 삭제됨)';
                    panelTraEl.classList.add('waiting');
                }

                // 서버 DB에서도 삭제 및 휴지통/알림에 등록되도록 보장
                if (newTranslated) {
                    await saveSingleTranslation(pid, originalText, newTranslated);
                }

                logToSidebar(`⚠️ (pid: ${pid}) 원문 복제·변형이 감지되어 번역문이 자동 삭제 및 휴지통으로 이동되었습니다.`, 'log-error');
            } else if (newTranslated) {
                userDeletedTranslationPids.delete(String(pid));
                row.removeAttribute('data-user-deleted');
                delete row.dataset.userDeleted;
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

                // 상단 검수 패널 실시간 갱신
                const panelTraEl = document.getElementById(`review-tra-${pid}`);
                if (panelTraEl) {
                    panelTraEl.textContent = `번역: ${newTranslated}`;
                    panelTraEl.classList.remove('waiting');
                }

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
            if (!editedText) {
                userDeletedTranslationPids.add(String(item.id));
                row.setAttribute('data-user-deleted', 'true');
                row.dataset.userDeleted = 'true';
            } else {
                userDeletedTranslationPids.delete(String(item.id));
                row.removeAttribute('data-user-deleted');
                delete row.dataset.userDeleted;
            }
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
        const isVerbatim = Boolean(item.verbatim) || (item.translated && checkIsVerbatimOrParaphrased(item.original, item.translated));

        // 성공한 번역은 캐시에 반영, 원문 복붙/변형은 캐시에서 제거
        if (isVerbatim) {
            translationCache.delete(item.id);
            item.translated = '';
        } else if (!isError && item.translated && item.translated.trim()) {
            userDeletedTranslationPids.delete(String(item.id));
            translationCache.set(item.id, { pid: item.id, original: item.original, translated: item.translated });
        } else if (!isError) {
            translationCache.set(item.id, { pid: item.id, original: item.original, translated: item.translated });
        }

        const row = document.querySelector(`tr[data-pid="${item.id}"]`);
        if (row) {
            if (!isError && item.translated && item.translated.trim()) {
                row.removeAttribute('data-user-deleted');
                delete row.dataset.userDeleted;
            }
            const isReviewTarget = reviewTargetPids.has(item.id);
            if (isReviewTarget) {
                row.classList.add('review-target-row');
                const p = document.getElementById(item.id);
                if (p) p.classList.add('review-target-dom');

                // 상단 검수 패널 내 실시간 번역문 업데이트
                const panelTraEl = document.getElementById(`review-tra-${item.id}`);
                if (panelTraEl) {
                    if (isVerbatim) {
                        panelTraEl.textContent = '번역: (원문 복제·변형 감지되어 자동 삭제됨)';
                        panelTraEl.classList.add('waiting');
                    } else {
                        panelTraEl.textContent = `번역: ${item.translated || '(빈 번역문)'}`;
                        if (item.translated) panelTraEl.classList.remove('waiting');
                    }
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
                        if (!editedText) {
                            userDeletedTranslationPids.add(String(item.id));
                            row.setAttribute('data-user-deleted', 'true');
                            row.dataset.userDeleted = 'true';
                        } else {
                            userDeletedTranslationPids.delete(String(item.id));
                            row.removeAttribute('data-user-deleted');
                            delete row.dataset.userDeleted;
                        }
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
        if (!editedText) {
            userDeletedTranslationPids.add(String(translation.pid));
            row.setAttribute('data-user-deleted', 'true');
            row.dataset.userDeleted = 'true';
        } else {
            userDeletedTranslationPids.delete(String(translation.pid));
            row.removeAttribute('data-user-deleted');
            delete row.dataset.userDeleted;
        }
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

// =================================================================================
// LANOVEL Phase 4 & 5: 스마트 키보드 내비게이션, HUD & 목차 퀵 점프 패널
// =================================================================================

let quickJumpFocusedIndex = -1;
let untranslatedEpisodesCache = [];

function showLanovelHud(message, icon = '📖', durationMs = 2200) {
    let hud = document.getElementById('lanovel-hud');
    if (!hud) {
        hud = document.createElement('div');
        hud.id = 'lanovel-hud';
        document.body.appendChild(hud);
    }
    hud.innerHTML = `<span class="hud-icon">${icon}</span><span class="hud-message">${escapeHtml(message)}</span>`;
    hud.classList.add('visible');
    
    if (window._lanovelHudTimer) {
        clearTimeout(window._lanovelHudTimer);
    }
    window._lanovelHudTimer = setTimeout(() => {
        hud.classList.remove('visible');
    }, durationMs);
}

// 1. 사이트별 네비게이션 링크 탐색기
function findNextEpisodeLink() {
    const host = window.location.hostname;
    // 카쿠요무
    if (host.includes('kakuyomu.jp')) {
        const direct = document.getElementById('contentMain-nextEpisode') ||
                       document.querySelector('a.widget-episodeNavigation-next');
        if (direct && direct.href) return direct;
        const candidates = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
        const found = candidates.find(a => (a.textContent || '').includes('次のエピソード'));
        if (found && found.href) return found;
    }
    // 쇼세츠 / 녹턴 / 미드나이트
    if (host.includes('syosetu.com')) {
        const direct = document.querySelector('.c-pager__item--next') ||
                       document.querySelector('a.novel_bn_next') ||
                       document.querySelector('.novel_bn a.c-pager__item--next');
        if (direct && direct.href) return direct;
        const links = Array.from(document.querySelectorAll('.novel_bn a, .c-pager a, a.c-pager__item'));
        const found = links.find(a => (a.textContent || '').includes('次へ'));
        if (found && found.href) return found;
    }
    // 노벨업
    if (host.includes('novelup.plus')) {
        const direct = document.querySelector('.episodeNavi .nextEpisode a') ||
                       document.querySelector('.btn_next') ||
                       document.querySelector('.episode_navigation .next a');
        if (direct && direct.href) return direct;
    }
    // 하멜른
    if (host.includes('syosetu.org')) {
        const links = Array.from(document.querySelectorAll('a'));
        const found = links.find(a => (a.textContent || '').trim() === '次へ');
        if (found && found.href) return found;
    }
    // 폴백 (rel="next" or contains "次へ")
    const relNext = document.querySelector('a[rel="next"]');
    if (relNext && relNext.href) return relNext;
    const allLinks = Array.from(document.querySelectorAll('a'));
    return allLinks.find(a => {
        const txt = (a.textContent || '').trim();
        return txt === '次へ' || txt === '다음화' || txt === '다음 화' || txt === '다음';
    }) || null;
}

function findPrevEpisodeLink() {
    const host = window.location.hostname;
    // 카쿠요무
    if (host.includes('kakuyomu.jp')) {
        const direct = document.getElementById('contentMain-previousEpisode') ||
                       document.querySelector('a.widget-episodeNavigation-previous');
        if (direct && direct.href) return direct;
        const candidates = Array.from(document.querySelectorAll('a[href*="/episodes/"]'));
        const found = candidates.find(a => (a.textContent || '').includes('前のエピソード'));
        if (found && found.href) return found;
    }
    // 쇼세츠
    if (host.includes('syosetu.com')) {
        const direct = document.querySelector('.c-pager__item--before') ||
                       document.querySelector('a.novel_bn_prev');
        if (direct && direct.href) return direct;
        const links = Array.from(document.querySelectorAll('.novel_bn a, .c-pager a, a.c-pager__item'));
        const found = links.find(a => (a.textContent || '').includes('前へ'));
        if (found && found.href) return found;
    }
    // 노벨업
    if (host.includes('novelup.plus')) {
        const direct = document.querySelector('.episodeNavi .prevEpisode a') ||
                       document.querySelector('.btn_prev') ||
                       document.querySelector('.episode_navigation .prev a');
        if (direct && direct.href) return direct;
    }
    // 하멜른
    if (host.includes('syosetu.org')) {
        const links = Array.from(document.querySelectorAll('a'));
        const found = links.find(a => (a.textContent || '').trim() === '前へ');
        if (found && found.href) return found;
    }
    // 폴백 (rel="prev" or contains "前へ")
    const relPrev = document.querySelector('a[rel="prev"]');
    if (relPrev && relPrev.href) return relPrev;
    const allLinks = Array.from(document.querySelectorAll('a'));
    return allLinks.find(a => {
        const txt = (a.textContent || '').trim();
        return txt === '前へ' || txt === '이전화' || txt === '이전 화' || txt === '이전';
    }) || null;
}

function findTocLink() {
    const host = window.location.hostname;
    // 카쿠요무: works/<digits> 형태 링크
    if (host.includes('kakuyomu.jp')) {
        const links = Array.from(document.querySelectorAll('header a[href*="/works/"], a.widget-toc-main-title, a[class*="workTitle"]'));
        const found = links.find(a => /\/works\/\d+$/.test((a.getAttribute('href') || '').split('?')[0]));
        if (found && found.href) return found;
    }
    // 쇼세츠
    if (host.includes('syosetu.com')) {
        const direct = document.querySelector('.c-announce a[href*="/n"]') ||
                       document.querySelector('.p-novel__series-link') ||
                       document.querySelector('.novel_title a');
        if (direct && direct.href) return direct;
    }
    // 노벨업
    if (host.includes('novelup.plus')) {
        const direct = document.querySelector('.episodeHeader .storyTitle a') ||
                       document.querySelector('.storyTitle a');
        if (direct && direct.href) return direct;
    }
    // 하멜른
    if (host.includes('syosetu.org')) {
        const links = Array.from(document.querySelectorAll('a'));
        const found = links.find(a => {
            const txt = (a.textContent || '').trim();
            return txt === '目次' || txt === 'TOP';
        });
        if (found && found.href) return found;
    }
    // 폴백
    const relIndex = document.querySelector('a[rel="index"]');
    if (relIndex && relIndex.href) return relIndex;
    const allLinks = Array.from(document.querySelectorAll('a'));
    return allLinks.find(a => {
        const txt = (a.textContent || '').trim();
        return txt === '目次' || txt === '목차' || txt === 'TOC';
    }) || null;
}

// 2. 목차 페이지 판별
function isTocPage() {
    const host = window.location.hostname;
    const pathname = window.location.pathname;
    if (host.includes('kakuyomu.jp')) {
        return /\/works\/\d+\/?$/.test(pathname) || !!document.querySelector('.widget-toc-episode');
    }
    if (host.includes('syosetu.com')) {
        return (/\/n[a-z0-9]+\/?$/i.test(pathname) && !/\/\d+\/?$/.test(pathname)) || !!document.querySelector('.p-eplist');
    }
    if (host.includes('novelup.plus')) {
        return (/\/story\/\d+\/?$/.test(pathname) && !/\/\d+\/\d+/.test(pathname)) || !!document.querySelector('.storyList');
    }
    if (host.includes('syosetu.org')) {
        return /\/novel\/\d+\/?$/.test(pathname) || (!pathname.endsWith('.html') && document.querySelectorAll('table a[href*="/novel/"]').length > 3);
    }
    return false;
}

// 3. 키보드 단축키 리스너
function setupLanovelKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        // 텍스트 입력 중일 때는 키보드 단축키 비활성화
        const target = e.target;
        if (target) {
            const tagName = target.tagName ? target.tagName.toUpperCase() : '';
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) {
                return;
            }
        }
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        const key = e.key;
        const lowerKey = key.toLowerCase();

        // [다음 화 이동] ] 또는 L
        if (key === ']' || lowerKey === 'l') {
            const nextLink = findNextEpisodeLink();
            if (nextLink && nextLink.href) {
                e.preventDefault();
                sessionStorage.setItem('lanovel_auto_translate_next', '1');
                showLanovelHud('다음 화로 이동 및 자동 번역...', '⚡');
                setTimeout(() => {
                    window.location.href = nextLink.href;
                }, 150);
            } else {
                showLanovelHud('다음 화가 없습니다 (마지막 회차)', '🏁');
            }
            return;
        }

        // [이전 화 이동] [ 또는 H
        if (key === '[' || lowerKey === 'h') {
            const prevLink = findPrevEpisodeLink();
            if (prevLink && prevLink.href) {
                e.preventDefault();
                showLanovelHud('이전 화로 이동 중...', '⏮️');
                setTimeout(() => {
                    window.location.href = prevLink.href;
                }, 150);
            } else {
                showLanovelHud('첫 번째 회차입니다', '🏁');
            }
            return;
        }

        // [소설 목차 이동] O 또는 T
        if (lowerKey === 'o' || lowerKey === 't') {
            if (!isTocPage()) {
                const tocLink = findTocLink();
                if (tocLink && tocLink.href) {
                    e.preventDefault();
                    showLanovelHud('소설 목차로 이동 중...', '📑');
                    setTimeout(() => {
                        window.location.href = tocLink.href;
                    }, 150);
                } else {
                    showLanovelHud('목차 링크를 찾을 수 없습니다', '❓');
                }
            }
            return;
        }

        // [목차 페이지 전용 단축키] N / 화살표 / Enter / ESC
        if (isTocPage()) {
            if (lowerKey === 'n') {
                e.preventDefault();
                handleQuickJumpNKey();
                return;
            }
            const drawer = document.getElementById('lanovel-quick-jump-drawer');
            if (drawer && drawer.classList.contains('open')) {
                if (key === 'ArrowDown') {
                    e.preventDefault();
                    moveQuickJumpFocus(1);
                } else if (key === 'ArrowUp') {
                    e.preventDefault();
                    moveQuickJumpFocus(-1);
                } else if (key === 'Enter') {
                    if (quickJumpFocusedIndex >= 0 && quickJumpFocusedIndex < untranslatedEpisodesCache.length) {
                        e.preventDefault();
                        const targetEp = untranslatedEpisodesCache[quickJumpFocusedIndex];
                        if (targetEp && targetEp.url) {
                            sessionStorage.setItem('lanovel_auto_translate_next', '1');
                            showLanovelHud(`'${targetEp.title}' 진입 및 자동 번역...`, '⚡');
                            setTimeout(() => {
                                window.location.href = targetEp.url;
                            }, 150);
                        }
                    }
                } else if (key === 'Escape') {
                    e.preventDefault();
                    toggleQuickJumpDrawer(false);
                }
            }
        }
    });
}

// 4. 새 회차 자동 번역 트리거
function checkAutoTranslateNextTrigger() {
    if (sessionStorage.getItem('lanovel_auto_translate_next') === '1') {
        sessionStorage.removeItem('lanovel_auto_translate_next');
        if (turboAbortedOnLoad || isTranslationCancelled) {
            console.log("[checkAutoTranslateNextTrigger] 쾌속모드 정각 도달로 새 회차 자동 번역 취소");
            return;
        }
        showLanovelHud('새 회차 자동 번역을 시작합니다!', '⚡', 2500);
        setTimeout(() => {
            if (!turboAbortedOnLoad && !isTranslationCancelled) {
                showSidebar();
            }
        }, 500);
    }
}

// 5. 목차 페이지 배지 및 퀵 점프 패널
async function initTocPageFeatures() {
    if (!isTocPage()) return;
    console.log('[LANOVEL] 목차 페이지 감지: 회차별 번역 상태 배지 및 퀵 점프 패널을 초기화합니다.');

    const host = window.location.hostname;
    let episodeElements = [];

    if (host.includes('kakuyomu.jp')) {
        episodeElements = Array.from(document.querySelectorAll('.widget-toc-episode a, a.widget-toc-episode-episodeTitle'));
    } else if (host.includes('syosetu.com')) {
        episodeElements = Array.from(document.querySelectorAll('.p-eplist__sublist .p-eplist__subtitle a, .subtitle a'));
    } else if (host.includes('novelup.plus')) {
        episodeElements = Array.from(document.querySelectorAll('.storyList .episode a, .episode_list a, .storyList a[href*="/story/"]'));
    } else if (host.includes('syosetu.org')) {
        episodeElements = Array.from(document.querySelectorAll('table a[href*="/novel/"]'));
    }

    if (!episodeElements.length) return;

    // URL 중복 제거 및 리스트 구성
    const episodeDataList = [];
    const urlSet = new Set();
    episodeElements.forEach(el => {
        const rawHref = el.getAttribute('href');
        if (!rawHref) return;
        const fullUrl = el.href.split('#')[0];
        if (!urlSet.has(fullUrl)) {
            urlSet.add(fullUrl);
            const title = (el.textContent || '').trim();
            episodeDataList.push({
                element: el,
                url: fullUrl,
                title: title
            });
        }
    });

    if (!episodeDataList.length) return;

    // 서버에 배치 조회 요청
    let translatedSet = new Set();
    try {
        const resp = await fetch('http://127.0.0.1:8001/api/check_translated_urls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: Array.from(urlSet) })
        });
        if (resp.ok) {
            const data = await resp.json();
            const list = data.translated_urls || [];
            list.forEach(u => {
                translatedSet.add(u.replace(/\/$/, ''));
                translatedSet.add(u.replace(/\/$/, '') + '/');
            });
        }
    } catch (e) {
        console.warn('[LANOVEL] 서버 번역 URL 확인 중 오류 발생:', e);
    }

    // 배지 주입 및 미번역 목록 수집
    untranslatedEpisodesCache = [];
    episodeDataList.forEach((item, index) => {
        const cleanNoSlash = item.url.replace(/\/$/, '');
        const isTranslated = translatedSet.has(cleanNoSlash) || translatedSet.has(cleanNoSlash + '/');
        
        // 배지 엘리먼트 생성
        const badge = document.createElement('span');
        badge.className = `lanovel-toc-badge ${isTranslated ? 'translated' : 'untranslated'}`;
        badge.innerHTML = `<span class="badge-dot"></span>${isTranslated ? '완료' : '미번역'}`;
        
        // 중복 추가 방지
        const existingBadge = item.element.parentNode.querySelector('.lanovel-toc-badge');
        if (!existingBadge) {
            item.element.parentNode.appendChild(badge);
        }

        if (!isTranslated) {
            untranslatedEpisodesCache.push({
                index: untranslatedEpisodesCache.length,
                tocIndex: index,
                title: item.title,
                url: item.url,
                element: item.element
            });
        }
    });

    renderQuickJumpPanel(untranslatedEpisodesCache);
}

function renderQuickJumpPanel(untranslatedList) {
    let container = document.getElementById('lanovel-quick-jump-container');
    if (container) container.remove();

    container = document.createElement('div');
    container.id = 'lanovel-quick-jump-container';

    const count = untranslatedList.length;
    const triggerHtml = `
        <div id="lanovel-quick-jump-trigger" title="클릭하거나 'N' 키를 눌러 미번역 회차 목록 보기">
            <span class="trigger-icon">⚡</span>
            <span>미번역 <strong>${count}</strong>화</span>
            <span class="trigger-keyhint">N</span>
        </div>
    `;

    const itemsHtml = count > 0 ? untranslatedList.map((ep, idx) => `
        <li class="quick-jump-item" data-jump-index="${idx}" title="${escapeHtml(ep.title)}">
            <span class="item-title">${escapeHtml(ep.title)}</span>
            <span class="item-action-hint">Enter 이동</span>
        </li>
    `).join('') : `
        <li class="quick-jump-item" style="justify-content: center; color: #10b981; cursor: default;">
            🎉 모든 회차의 번역이 완료되었습니다!
        </li>
    `;

    const drawerHtml = `
        <div id="lanovel-quick-jump-drawer">
            <div class="quick-jump-header">
                <div class="title-wrap">
                    <span style="color: #f59e0b; font-size: 14px;">⚡</span>
                    <h4>미번역 회차 목록</h4>
                    <span class="count-badge">${count}</span>
                </div>
                <button class="close-btn" id="lanovel-quick-jump-close" title="닫기 (ESC)">✕</button>
            </div>
            <ul class="quick-jump-list" id="lanovel-quick-jump-list">
                ${itemsHtml}
            </ul>
            <div class="quick-jump-footer">
                <span><kbd>N</kbd> / <kbd>↑↓</kbd> 선택</span>
                <span><kbd>Enter</kbd> 자동 번역 진입</span>
            </div>
        </div>
    `;

    container.innerHTML = triggerHtml + drawerHtml;
    document.body.appendChild(container);

    // 이벤트 리스너 연결
    const trigger = document.getElementById('lanovel-quick-jump-trigger');
    trigger.addEventListener('click', () => {
        toggleQuickJumpDrawer();
    });

    const closeBtn = document.getElementById('lanovel-quick-jump-close');
    closeBtn.addEventListener('click', () => {
        toggleQuickJumpDrawer(false);
    });

    const listEl = document.getElementById('lanovel-quick-jump-list');
    listEl.querySelectorAll('.quick-jump-item').forEach(item => {
        item.addEventListener('click', () => {
            const idx = parseInt(item.getAttribute('data-jump-index'), 10);
            if (!isNaN(idx) && untranslatedList[idx]) {
                const ep = untranslatedList[idx];
                sessionStorage.setItem('lanovel_auto_translate_next', '1');
                showLanovelHud(`'${ep.title}' 진입 및 자동 번역...`, '⚡');
                setTimeout(() => {
                    window.location.href = ep.url;
                }, 150);
            }
        });
    });
}

function toggleQuickJumpDrawer(open) {
    const drawer = document.getElementById('lanovel-quick-jump-drawer');
    if (!drawer) return;
    if (typeof open === 'boolean') {
        if (open) {
            drawer.classList.add('open');
        } else {
            drawer.classList.remove('open');
        }
    } else {
        drawer.classList.toggle('open');
    }
}

function handleQuickJumpNKey() {
    if (!untranslatedEpisodesCache.length) {
        showLanovelHud('모든 회차가 이미 번역 완료되었습니다!', '🎉');
        return;
    }
    const drawer = document.getElementById('lanovel-quick-jump-drawer');
    if (!drawer) return;

    if (!drawer.classList.contains('open')) {
        drawer.classList.add('open');
        quickJumpFocusedIndex = 0;
    } else {
        quickJumpFocusedIndex = (quickJumpFocusedIndex + 1) % untranslatedEpisodesCache.length;
    }

    updateQuickJumpFocusUI();
}

function moveQuickJumpFocus(delta) {
    if (!untranslatedEpisodesCache.length) return;
    quickJumpFocusedIndex = (quickJumpFocusedIndex + delta + untranslatedEpisodesCache.length) % untranslatedEpisodesCache.length;
    updateQuickJumpFocusUI();
}

function updateQuickJumpFocusUI() {
    const listEl = document.getElementById('lanovel-quick-jump-list');
    if (!listEl) return;

    const items = listEl.querySelectorAll('.quick-jump-item');
    items.forEach((item, idx) => {
        if (idx === quickJumpFocusedIndex) {
            item.classList.add('focused');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('focused');
        }
    });

    const targetEp = untranslatedEpisodesCache[quickJumpFocusedIndex];
    if (targetEp && targetEp.element) {
        targetEp.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}