// content.ts: LANOVEL 웹소설 번역 확장 콘텐츠 스크립트 메인 진입점
import { state } from './core/state';
import { getScraper } from './scrapers';
import {
  getCleanUrl,
  getTargetParagraphs,
  ensureTranslationsLoaded,
  hasUntranslatedParagraphs,
  applyTranslationsToPage,
  setPageApplyStatus,
  setupParagraphInteraction,
  loadTurboModeState,
  setTurboMode,
  translateAllPTags,
  startFullRetranslation,
  abortTurboMode,
} from './core/page_translator';
import { loadNovelSeparators } from './core/separators';
import { checkCutoffTimeReached } from './core/turbo';
import {
  injectSidebar,
  showSidebar,
  updateNovelTitleUI,
  updateApplyButtonUI,
  updateTurboModeUI,
  updateTurboBadgeUI,
  updateSidebarWithCancelled,
  logToSidebar,
} from './ui/sidebar';
import { checkAndLoadReviewTargets } from './ui/review_panel';
import {
  renderSeparatorSettingsPanel,
  checkAndExcludeSeparatorTranslations,
} from './ui/separator_panel';
import { setupLanovelKeyboardNavigation, checkAutoTranslateNextTrigger } from './ui/key_nav';
import { initTocPageFeatures, isEpisodeUrlExcluded } from './ui/toc_quick_jump';
import { showLanovelHud } from './ui/hud';

const DEFAULT_ALLOWED_DOMAINS = [
  'kakuyomu.jp',
  'syosetu.com',
  'novel18.syosetu.com',
  'ncode.syosetu.com',
  'noc.syosetu.com',
  'mid.syosetu.com',
  'mnlt.syosetu.com',
  'novelup.plus',
  'syosetu.org',
  'alphapolis.co.jp',
];

async function init(): Promise<void> {
  try {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
      return;
    }

    // 허용 도메인 확인
    const currentUrl = window.location.href;
    let isAllowed = false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200);
      const response = await fetch('http://127.0.0.1:8001/api/allowed_origins', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const allowedOrigins: string[] = await response.json();
        isAllowed = allowedOrigins.some((origin) => currentUrl.startsWith(origin));
      }
    } catch (e) {
      console.warn('[LANOVEL] 허용 도메인 목록 조회 실패 (기본 도메인 목록 폴백 진행)');
    }

    if (!isAllowed) {
      const isDefaultDomain = DEFAULT_ALLOWED_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith('.' + domain)
      );
      if (isDefaultDomain) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      console.log(`[LANOVEL] 현재 URL(${currentUrl})이 허용 목록에 없어 확장을 비활성화합니다.`);
      return;
    }

    console.log('[LANOVEL] 웹소설 번역 확장 프로그램 초기화 시작...');
    const scraper = getScraper();

    // 플랫폼별 본문 전처리 (노벨업 등 div 정규화)
    if (scraper.prepareContent) {
      scraper.prepareContent();
    }

    // 사이드바 주입 및 단축키 설정
    injectSidebar();
    setupLanovelKeyboardNavigation(scraper, () => {
      showSidebar();
      translateAllPTags(false);
    });

    // 0.1. 목차(TOC) 페이지 감지 시 배지 및 퀵 점프 서랍 즉시 초기화 후 조기 복귀
    if (scraper.isTocPage(window.location.href, window.location.pathname)) {
      console.log('[LANOVEL] 목차(TOC) 페이지 감지: 목차 기능(배지 및 퀵 점프 서랍)을 즉시 초기화합니다.');
      try {
        const title = (await scraper.detectNovelTitle()) || '기본 소설';
        state.currentNovelTitle = title;
        updateNovelTitleUI(title);
      } catch (_) {}
      await initTocPageFeatures(scraper);
      return;
    }

    // 쾌속모드 상태 및 정각 도달 검사
    await loadTurboModeState();

    // 0.3. 제외 회차 감지 시 번역 생략 및 다음 회차 자동 건너뛰기 / 마지막 페이지 판별
    const currentCleanUrl = getCleanUrl();
    const isExcluded = await isEpisodeUrlExcluded(currentCleanUrl);
    if (isExcluded) {
      console.log(`[LANOVEL] 제외된 회차 감지: ${currentCleanUrl} - 번역을 수행하지 않습니다.`);
      let nextLink = scraper.findNextEpisodeLink ? scraper.findNextEpisodeLink() : null;
      if (!nextLink) {
        await new Promise((r) => setTimeout(r, 300));
        nextLink = scraper.findNextEpisodeLink ? scraper.findNextEpisodeLink() : null;
      }

      if (nextLink && nextLink.href) {
        showLanovelHud('번역 제외 회차입니다. 다음 페이지로 이동합니다...', '⏭️', 2000);
        sessionStorage.setItem('lanovel_auto_translate_next', '1');
        setTimeout(() => {
          window.location.href = nextLink.href;
        }, 600);
        return;
      } else {
        sessionStorage.removeItem('lanovel_auto_translate_next');
        showLanovelHud('마지막 페이지입니다. (소설 연속 번역 종료)', '🏁', 5000);
        logToSidebar('다음 페이지 버튼을 찾을 수 없습니다. (마지막 페이지입니다)');
        return;
      }
    }

    checkAutoTranslateNextTrigger(() => {
      showSidebar();
      translateAllPTags(false);
    });

    // 소설 제목 감지 (서버 우선, DOM 폴백)
    const cleanUrl = getCleanUrl();
    let novelTitle = '';
    try {
      const resp = await fetch(`http://127.0.0.1:8001/api/novel_info?url=${encodeURIComponent(cleanUrl)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.folderName) novelTitle = data.folderName;
      }
    } catch (e) {}

    if (!novelTitle) {
      novelTitle = (await scraper.detectNovelTitle()) || '기본 소설';
    }
    state.currentNovelTitle = novelTitle;
    updateNovelTitleUI(novelTitle);

    // 구분선 설정 로드
    state.separatorConfig = await loadNovelSeparators(novelTitle);
    state.activeSeparators = state.separatorConfig.effectiveSeparators;
    renderSeparatorSettingsPanel();

    // 저장된 번역 데이터 선 로드
    const translations = await ensureTranslationsLoaded();

    // 구분선 기반 번역 자동 제외
    if (translations) {
      await checkAndExcludeSeparatorTranslations(translations);
    }

    // 재번역 검수 대상 조회
    await checkAndLoadReviewTargets(cleanUrl);

    // 본문 적용(Apply) 상태 조회 및 복원
    let initialApplied = false;
    try {
      const resp = await fetch(`http://127.0.0.1:8001/api/urls/apply_status?url=${encodeURIComponent(cleanUrl)}`);
      if (resp.ok) {
        const status = await resp.json();
        initialApplied = !!status.applied;
      }
    } catch (e) {
      const storageResult = await chrome.storage.local.get(['status-' + cleanUrl, 'status-' + window.location.href]);
      const localStatus = storageResult['status-' + cleanUrl] || storageResult['status-' + window.location.href];
      if (localStatus && typeof localStatus.applied === 'boolean') {
        initialApplied = localStatus.applied;
      }
    }

    state.isPageApplied = initialApplied;
    updateApplyButtonUI(state.isPageApplied);
    if (state.isPageApplied && translations) {
      applyTranslationsToPage(translations, false);
    }

    // 본문 문단 클릭 연동 활성화
    setupParagraphInteraction();

    // 원격 제어 콜백 주입
    state.onExtractEpisodeTitle = () => scraper.extractEpisodeTitle();
    state.onNextEpisode = () => {
      const link = scraper.findNextEpisodeLink();
      if (!link || !link.href) return { ok: false, message: '다음 화 링크를 찾을 수 없습니다.' };
      sessionStorage.setItem('lanovel_auto_translate_next', '1');
      showLanovelHud('원격: 다음 화로 이동', '➡️');
      setTimeout(() => {
        window.location.href = link.href;
      }, 300);
      return { ok: true, message: '다음 화로 이동합니다.' };
    };
    state.onPrevEpisode = () => {
      const link = scraper.findPrevEpisodeLink();
      if (!link || !link.href) return { ok: false, message: '이전 화 링크를 찾을 수 없습니다.' };
      sessionStorage.setItem('lanovel_auto_translate_next', '1');
      showLanovelHud('원격: 이전 화로 이동', '⏮️');
      setTimeout(() => {
        window.location.href = link.href;
      }, 300);
      return { ok: true, message: '이전 화로 이동합니다.' };
    };
    state.onRetranslate = () => {
      startFullRetranslation();
      return { ok: true, message: '재번역을 시작합니다.' };
    };
    state.onStartTranslation = async (isRetrans = false) => {
      await translateAllPTags(isRetrans);
    };
    state.onToggleTurboMode = (enabled, save) => {
      setTurboMode(enabled, save);
    };

    // UI 버튼 이벤트 바인딩
    const stopBtn = document.getElementById('stop-translation-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        state.isTranslationCancelled = true;
        stopBtn.style.display = 'none';
        const retryBtn = document.getElementById('retry-translation-btn');
        if (retryBtn) retryBtn.style.display = 'inline-block';
        logToSidebar('번역이 중지되었습니다.');
        updateSidebarWithCancelled();
        state.broadcastStatus();
      });
    }

    const retryBtn = document.getElementById('retry-translation-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        startFullRetranslation();
      });
    }

    const resumeBtn = document.getElementById('resume-translation-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        if (state.resolveResume) {
          resumeBtn.style.display = 'none';
          if (stopBtn) stopBtn.style.display = 'inline-block';
          const resolver = state.resolveResume;
          state.resolveResume = null;
          resolver();
        }
      });
    }

    const applyToggleBtn = document.getElementById('sidebar-apply-toggle-btn');
    if (applyToggleBtn) {
      applyToggleBtn.addEventListener('click', () => {
        setPageApplyStatus(!state.isPageApplied, true);
      });
    }

    // 지연 렌더링된 본문 DOM 대응 (아직 문단이 감지되지 않은 경우 최대 3회 재시도)
    if (getTargetParagraphs().length === 0) {
      for (let retry = 0; retry < 3; retry++) {
        await new Promise((r) => setTimeout(r, 250));
        if (scraper.prepareContent) {
          scraper.prepareContent();
        }
        if (getTargetParagraphs().length > 0) {
          setupParagraphInteraction();
          break;
        }
      }
    }

    // 미번역 문단이 존재하면 번역 실행
    if (state.turboAbortedOnLoad || (state.isTurboMode && checkCutoffTimeReached(state.turboCutoffHour, state.turboTargetTimestamp))) {
      if (!state.turboAbortedOnLoad) {
        await abortTurboMode('초기화 시간 도달');
      }
      logToSidebar('⏰ [정각 도달] 쾌속모드 초기화 정각에 도달하여 자동 번역이 중단되었습니다.', 'log-error');
    } else {
      if (hasUntranslatedParagraphs()) {
        showSidebar();
        translateAllPTags(false);
      } else {
        if (retryBtn) retryBtn.style.display = 'inline-block';
        console.log('[LANOVEL] 모든 문장이 이미 번역되어 있어 자동 번역을 생략합니다.');
      }
    }

    // 목차 페이지 기능 초기화
    await initTocPageFeatures(scraper);
  } catch (error: any) {
    console.error('[LANOVEL] 확장 프로그램 초기화 오류:', error);
  }
}

// 원격 제어 명령 수신 (background.js -> content.ts)
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request && request.action === 'remoteCommand') {
    try {
      const result = state.handleRemoteCommand(request.type, request.params || {});
      sendResponse(result);
    } catch (e: any) {
      sendResponse({ ok: false, message: String(e && e.message || e) });
    }
    return false;
  }
  return false;
});

// Storage 변경 감지 (다른 탭과의 동기화)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;

  const cleanUrl = getCleanUrl();
  const statusKey = 'status-' + window.location.href;
  const cleanStatusKey = 'status-' + cleanUrl;
  const change = changes[statusKey] || changes[cleanStatusKey];
  if (change && change.newValue) {
    const targetApplied = !!change.newValue.applied;
    if (targetApplied !== state.isPageApplied) {
      setPageApplyStatus(targetApplied, false);
    }
  }

  if (changes.lanovel_turbo_mode) {
    const newTurbo = !!changes.lanovel_turbo_mode.newValue;
    if (newTurbo !== state.isTurboMode) {
      state.isTurboMode = newTurbo;
      updateTurboModeUI(state.isTurboMode);
      if (state.currentDelayResolver) state.currentDelayResolver();
    }
  }
  if (changes.lanovel_turbo_cutoff) {
    state.turboCutoffHour = changes.lanovel_turbo_cutoff.newValue;
    updateTurboBadgeUI();
  }
  if (changes.lanovel_turbo_target) {
    state.turboTargetTimestamp = changes.lanovel_turbo_target.newValue || 0;
  }
});

// DOMContentLoaded 핸들러
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
