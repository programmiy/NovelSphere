// key_nav.ts: 키보드 단축키 내비게이션 및 자동 번역 트리거 모듈
import { PlatformScraper } from '../scrapers/base';
import { state } from '../core/state';
import { showLanovelHud } from './hud';
import {
  handleQuickJumpNKey,
  moveQuickJumpFocus,
  toggleQuickJumpDrawer,
  quickJumpFocusedIndex,
  untranslatedEpisodesCache,
} from './toc_quick_jump';

export function setupLanovelKeyboardNavigation(
  scraper: PlatformScraper,
  onShowSidebar: () => void
): void {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement | null;
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
      const nextLink = scraper.findNextEpisodeLink();
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
      const prevLink = scraper.findPrevEpisodeLink();
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
      if (!scraper.isTocPage(window.location.href, window.location.pathname)) {
        const tocLink = scraper.findTocLink();
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
    if (scraper.isTocPage(window.location.href, window.location.pathname)) {
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

export function checkAutoTranslateNextTrigger(onShowSidebar: () => void): void {
  if (sessionStorage.getItem('lanovel_auto_translate_next') === '1') {
    sessionStorage.removeItem('lanovel_auto_translate_next');
    if (state.turboAbortedOnLoad || state.isTranslationCancelled) {
      console.log('[checkAutoTranslateNextTrigger] 쾌속모드 정각 도달로 새 회차 자동 번역 취소');
      return;
    }
    showLanovelHud('새 회차 자동 번역을 시작합니다!', '⚡', 2500);
    setTimeout(() => {
      if (!state.turboAbortedOnLoad && !state.isTranslationCancelled) {
        onShowSidebar();
      }
    }, 500);
  }
}
