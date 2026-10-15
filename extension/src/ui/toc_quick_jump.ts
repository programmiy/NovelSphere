// toc_quick_jump.ts: 목차 페이지 상태 배지 및 퀵 점프 패널 모듈
import { PlatformScraper, TocEpisodeItem } from '../scrapers/base';
import { showLanovelHud } from './hud';

interface UntranslatedEpisode extends TocEpisodeItem {
  index: number;
  tocIndex: number;
}

export let quickJumpFocusedIndex = -1;
export let untranslatedEpisodesCache: UntranslatedEpisode[] = [];

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export async function initTocPageFeatures(scraper: PlatformScraper): Promise<void> {
  if (!scraper.isTocPage(window.location.href, window.location.pathname)) return;
  console.log('[LANOVEL] 목차 페이지 감지: 회차별 번역 상태 배지 및 퀵 점프 패널을 초기화합니다.');

  let episodeItems: TocEpisodeItem[] = [];
  if (scraper.getTocEpisodes) {
    episodeItems = scraper.getTocEpisodes();
  }

  if (!episodeItems.length) return;

  // URL 중복 제거
  const episodeDataList: TocEpisodeItem[] = [];
  const urlSet = new Set<string>();
  episodeItems.forEach((item) => {
    if (!item.url) return;
    const cleanUrl = item.url.split('#')[0];
    if (!urlSet.has(cleanUrl)) {
      urlSet.add(cleanUrl);
      episodeDataList.push({
        element: item.element,
        url: cleanUrl,
        title: item.title,
      });
    }
  });

  if (!episodeDataList.length) return;

  // 서버에 배치 조회 요청
  const translatedSet = new Set<string>();
  try {
    const resp = await fetch('http://127.0.0.1:8001/api/check_translated_urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: Array.from(urlSet) }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const list: string[] = data.translated_urls || [];
      list.forEach((u) => {
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

    const badge = document.createElement('span');
    badge.className = `lanovel-toc-badge ${isTranslated ? 'translated' : 'untranslated'}`;
    badge.innerHTML = `<span class="badge-dot"></span>${isTranslated ? '완료' : '미번역'}`;

    if (item.element.parentNode) {
      const existingBadge = item.element.parentNode.querySelector('.lanovel-toc-badge');
      if (!existingBadge) {
        item.element.parentNode.appendChild(badge);
      }
    }

    if (!isTranslated) {
      untranslatedEpisodesCache.push({
        index: untranslatedEpisodesCache.length,
        tocIndex: index,
        title: item.title,
        url: item.url,
        element: item.element,
      });
    }
  });

  renderQuickJumpPanel(untranslatedEpisodesCache);
}

export function renderQuickJumpPanel(untranslatedList: UntranslatedEpisode[]): void {
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

  const itemsHtml =
    count > 0
      ? untranslatedList
          .map(
            (ep, idx) => `
      <li class="quick-jump-item" data-jump-index="${idx}" title="${escapeHtml(ep.title)}">
        <span class="item-title">${escapeHtml(ep.title)}</span>
        <span class="item-action-hint">Enter 이동</span>
      </li>
    `
          )
          .join('')
      : `
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

  const trigger = document.getElementById('lanovel-quick-jump-trigger');
  if (trigger) {
    trigger.addEventListener('click', () => {
      toggleQuickJumpDrawer();
    });
  }

  const closeBtn = document.getElementById('lanovel-quick-jump-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toggleQuickJumpDrawer(false);
    });
  }

  const listEl = document.getElementById('lanovel-quick-jump-list');
  if (listEl) {
    listEl.querySelectorAll('.quick-jump-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-jump-index') || '-1', 10);
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
}

export function toggleQuickJumpDrawer(open?: boolean): void {
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

export function handleQuickJumpNKey(): void {
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

export function moveQuickJumpFocus(delta: number): void {
  if (!untranslatedEpisodesCache.length) return;
  quickJumpFocusedIndex =
    (quickJumpFocusedIndex + delta + untranslatedEpisodesCache.length) % untranslatedEpisodesCache.length;
  updateQuickJumpFocusUI();
}

export function updateQuickJumpFocusUI(): void {
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
