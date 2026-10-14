// =================================================================================
// 원격 제어 - 콘텐츠 스크립트 측 (content.js 바로 뒤에 로드됨, 같은 전역 공간 공유)
//  - 번역 상태를 2초마다 background.js 로 보고
//  - background.js 가 전달한 원격 명령(다음화/이전화/일시정지/재개/터보/재번역) 실행
//  기존 content.js 코드는 수정하지 않고, 전역 함수를 감싸서(wrap) 상태만 관찰한다.
// =================================================================================
(function () {
    'use strict';
    if (window.__lanovelRemoteContentLoaded) return;
    window.__lanovelRemoteContentLoaded = true;

    const REPORT_INTERVAL_MS = 2000;
    const CENSOR_FLAG_MS = 20000;

    let inflight = 0;               // 진행 중인 translateAllPTags 호출 수
    let remoteNextPending = false;  // 다음화 예약 여부
    let nextDeadlineTimer = null;
    let lastLogText = '';
    let censorSplitUntil = 0;
    let retryDelayUntil = 0;
    let activeDelayFn = null;

    // ---------- 기존 전역 함수 감싸기 ----------
    function wrapGlobal(name, makeWrapper) {
        try {
            const orig = window[name];
            if (typeof orig !== 'function') return;
            window[name] = makeWrapper(orig);
        } catch (e) {
            console.warn(`[remote] ${name} 감싸기 실패`, e);
        }
    }

    wrapGlobal('logToSidebar', (orig) => function (message, level) {
        try {
            const text = String(message || '');
            lastLogText = text.slice(0, 120);
            if (text.includes('문장 분할 재시도') || text.includes('검열 감지')) {
                censorSplitUntil = Date.now() + CENSOR_FLAG_MS;
            }
            const m = text.match(/(\d+)초 후 재시도/);
            if (m) retryDelayUntil = Date.now() + parseInt(m[1], 10) * 1000;
        } catch (e) { /* 관찰 실패는 무시 */ }
        return orig.apply(this, arguments);
    });

    wrapGlobal('sleepResponsive', (orig) => function (getDelayFn) {
        activeDelayFn = getDelayFn;
        return orig.apply(this, arguments);
    });

    wrapGlobal('translateAllPTags', (orig) => async function () {
        inflight++;
        try {
            return await orig.apply(this, arguments);
        } finally {
            inflight = Math.max(0, inflight - 1);
            onTranslationFinished();
        }
    });

    // ---------- 상태 계산 ----------
    function sidebarReady() {
        return !!document.getElementById('jp-translator-sidebar');
    }

    function computeProgress() {
        const rows = document.querySelectorAll('#translation-table-body tr[data-pid]');
        if (!rows.length) return 0;
        let done = 0;
        rows.forEach((tr) => {
            const cell = tr.querySelector('.translated-text');
            const t = cell ? (cell.textContent || '').trim() : '';
            if (t && !t.includes('번역 중')) done++;
        });
        return Math.round((done / rows.length) * 100);
    }

    function delayRemainingSec() {
        let remaining = 0;
        try {
            if (typeof currentDelayResolver !== 'undefined' && currentDelayResolver && activeDelayFn) {
                const target = typeof activeDelayFn === 'function' ? activeDelayFn() : activeDelayFn;
                remaining = Math.max(remaining, target - (Date.now() - currentDelayStart));
            }
        } catch (e) { /* ignore */ }
        remaining = Math.max(remaining, retryDelayUntil - Date.now());
        return Math.max(0, Math.ceil(remaining / 1000));
    }

    function buildStatus() {
        const cancelled = typeof isTranslationCancelled !== 'undefined' && isTranslationCancelled;
        const turboAborted = typeof turboAbortedOnLoad !== 'undefined' && turboAbortedOnLoad;
        const turbo = typeof isTurboMode !== 'undefined' && isTurboMode;
        const delaySec = delayRemainingSec();

        let phase = 'idle';
        if (turboAborted) phase = 'turbo_wait';
        else if (cancelled) phase = 'paused';
        else if (Date.now() < censorSplitUntil && inflight > 0) phase = 'censor_split';
        else if (delaySec > 0) phase = 'delay_wait';
        else if (inflight > 0) phase = 'translating';

        let chapterTitle = '';
        try { chapterTitle = (typeof extractEpisodeTitle === 'function' && extractEpisodeTitle()) || document.title || ''; } catch (e) { chapterTitle = document.title || ''; }

        return {
            phase,
            text: lastLogText,
            url: window.location.href.split('#')[0],
            book_title: (typeof currentNovelTitle !== 'undefined' && currentNovelTitle) || '',
            chapter_title: chapterTitle,
            percentage: computeProgress(),
            delay_remaining_sec: phase === 'delay_wait' ? delaySec : 0,
            next_scheduled: remoteNextPending,
            turbo,
        };
    }

    function reportStatus() {
        if (!sidebarReady()) return;      // 번역이 활성화된 페이지에서만 보고
        try {
            chrome.runtime.sendMessage({ action: 'remoteStatus', data: buildStatus() }, () => {
                void chrome.runtime.lastError;   // 응답 없음 경고 무시
            });
        } catch (e) { /* 확장 컨텍스트가 무효화된 경우(확장 새로고침) 무시 */ }
    }
    setInterval(reportStatus, REPORT_INTERVAL_MS);

    // ---------- 이동 ----------
    function navigateWithAutoTranslate(url, hudText, icon) {
        try { sessionStorage.setItem('lanovel_auto_translate_next', '1'); } catch (e) { /* ignore */ }
        try { if (typeof showLanovelHud === 'function') showLanovelHud(hudText, icon); } catch (e) { /* ignore */ }
        setTimeout(() => { window.location.href = url; }, 300);
    }

    function goNextNow() {
        const link = typeof findNextEpisodeLink === 'function' ? findNextEpisodeLink() : null;
        if (!link || !link.href) return { ok: false, message: '다음 화 링크를 찾을 수 없습니다 (마지막 회차일 수 있어요).' };
        remoteNextPending = false;
        navigateWithAutoTranslate(link.href, '원격: 다음 화로 이동', '➡️');
        return { ok: true, message: '다음 화로 이동합니다.' };
    }

    async function onTranslationFinished() {
        if (!remoteNextPending || inflight > 0) return;
        if (typeof isTranslationCancelled !== 'undefined' && isTranslationCancelled) return;   // 일시정지 중이면 보류

        // 기존 로직이 완료 후 자동으로 다음화로 넘어가므로, 그 대기 시간이 지나도
        // 같은 페이지에 있을 때만(=번역할 게 없었거나 자동 이동이 안 걸린 경우) 직접 이동한다.
        clearTimeout(nextDeadlineTimer);
        let waitMs = 20000;
        try {
            const recent = await getRecentEpisodeCount(5);
            waitMs = calculateAdaptiveEpisodeDelay(recent, isTurboMode) + 15000;
        } catch (e) { /* 기본값 사용 */ }
        const startUrl = window.location.href;
        nextDeadlineTimer = setTimeout(() => {
            if (remoteNextPending && window.location.href === startUrl && inflight === 0) {
                goNextNow();
            }
        }, waitMs);
    }

    // ---------- 명령 실행 ----------
    function clickIfExists(id) {
        const el = document.getElementById(id);
        if (el) { el.click(); return true; }
        return false;
    }

    function handleCommand(type, params) {
        if (!sidebarReady()) return { ok: false, message: '이 탭은 번역 페이지가 아닙니다.' };
        const cancelled = typeof isTranslationCancelled !== 'undefined' && isTranslationCancelled;

        switch (type) {
            case 'next':
                if (inflight > 0) {
                    remoteNextPending = true;
                    return { ok: true, message: '현재 화 번역이 끝나면 다음 화로 이동합니다.' };
                }
                if (cancelled) {
                    remoteNextPending = true;
                    return { ok: true, message: '일시정지 상태입니다. 재개 후 번역이 끝나면 이동합니다.' };
                }
                return goNextNow();

            case 'cancel_next':
                remoteNextPending = false;
                clearTimeout(nextDeadlineTimer);
                return { ok: true, message: '다음화 예약을 취소했습니다.' };

            case 'prev': {
                const link = typeof findPrevEpisodeLink === 'function' ? findPrevEpisodeLink() : null;
                if (!link || !link.href) return { ok: false, message: '이전 화 링크를 찾을 수 없습니다 (첫 회차일 수 있어요).' };
                remoteNextPending = false;
                navigateWithAutoTranslate(link.href, '원격: 이전 화로 이동', '⏮️');
                return { ok: true, message: '이전 화로 이동합니다.' };
            }

            case 'pause':
                if (cancelled) return { ok: true, message: '이미 일시정지 상태입니다.' };
                if (!clickIfExists('stop-translation-btn')) {
                    isTranslationCancelled = true;
                }
                return { ok: true, message: '일시정지했습니다.' };

            case 'resume':
                if (typeof resolveResume !== 'undefined' && resolveResume) {
                    clickIfExists('resume-translation-btn');    // API 한도로 대기 중이던 묶음 재개
                    return { ok: true, message: '번역을 재개합니다.' };
                }
                if (cancelled) {
                    // 🔄 재시도 버튼은 '전체 재번역'이라 쓰지 않고, 저장된 번역은 건너뛰는 일반 번역을 다시 시작
                    const retry = document.getElementById('retry-translation-btn');
                    if (retry) retry.style.display = 'none';
                    translateAllPTags(false);
                    return { ok: true, message: '남은 문장부터 번역을 다시 시작합니다.' };
                }
                return { ok: true, message: '이미 진행 중입니다.' };

            case 'turbo_on':
                setTurboMode(true, true);
                return { ok: true, message: '터보 모드를 켰습니다.' };

            case 'turbo_off':
                setTurboMode(false, true);
                return { ok: true, message: '터보 모드를 껐습니다.' };

            case 'retranslate':
                if (!clickIfExists('retry-translation-btn')) {
                    return { ok: false, message: '재번역 버튼을 찾을 수 없습니다.' };
                }
                return { ok: true, message: '현재 화 전체 재번역을 시작합니다.' };

            default:
                return { ok: false, message: `이 탭에서 처리하지 않는 명령: ${type}` };
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'remoteCommand') {
            try {
                sendResponse(handleCommand(request.type, request.params || {}));
            } catch (e) {
                sendResponse({ ok: false, message: String(e && e.message || e) });
            }
            return false;
        }
        return false;
    });
})();
