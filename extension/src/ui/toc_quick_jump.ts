// toc_quick_jump.ts: 목차 페이지 상태 배지 및 퀵 점프 패널 모듈
import type { PlatformScraper, TocEpisodeItem } from '../scrapers/base.ts';
import { getScraper } from '../scrapers/index.ts';
import { showLanovelHud } from './hud.ts';

export interface UntranslatedEpisode extends TocEpisodeItem {
  index: number;
  tocIndex: number;
  badgeElement?: HTMLElement;
  isExcluded?: boolean;
}

export const EXCLUDED_EPISODES_STORAGE_KEY = 'lanovel_excluded_urls';

export function normalizeUrlKey(url: string): string {
  if (!url) return '';
  return url.split('#')[0].split('?')[0].replace(/\/$/, '');
}

export async function getExcludedEpisodeUrls(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get(EXCLUDED_EPISODES_STORAGE_KEY);
    if (Array.isArray(stored[EXCLUDED_EPISODES_STORAGE_KEY])) {
      return stored[EXCLUDED_EPISODES_STORAGE_KEY];
    }
  } catch (e) {
    console.warn('[LANOVEL] 제외 회차 목록 조회 실패:', e);
  }
  return [];
}

export async function isEpisodeUrlExcluded(targetUrl: string): Promise<boolean> {
  if (!targetUrl) return false;
  const clean = normalizeUrlKey(targetUrl);
  const list = await getExcludedEpisodeUrls();
  const set = new Set(list.map(normalizeUrlKey));
  return set.has(clean);
}

export async function toggleEpisodeUrlExcluded(targetUrl: string): Promise<boolean> {
  if (!targetUrl) return false;
  const clean = normalizeUrlKey(targetUrl);
  const list = await getExcludedEpisodeUrls();
  const set = new Set(list.map(normalizeUrlKey));
  let isNowExcluded = false;
  if (set.has(clean)) {
    set.delete(clean);
    isNowExcluded = false;
  } else {
    set.add(clean);
    isNowExcluded = true;
  }
  try {
    await chrome.storage.local.set({ [EXCLUDED_EPISODES_STORAGE_KEY]: Array.from(set) });
  } catch (e) {
    console.warn('[LANOVEL] 제외 회차 목록 저장 실패:', e);
  }
  return isNowExcluded;
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
  // Next.js 및 동적 렌더링 사이트 대응: 최대 5회 재시도 (총 약 1초)
  for (let retry = 0; retry < 5; retry++) {
    if (scraper.getTocEpisodes) {
      episodeItems = scraper.getTocEpisodes();
    }
    if (episodeItems.length > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!episodeItems.length) {
    console.log('[LANOVEL] 목차 페이지이나 회차 링크 요소를 발견하지 못했습니다.');
    return;
  }

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

  // 서버에 배치 조회 요청 (2.5초 타임아웃 방어)
  const translatedSet = new Set<string>();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch('http://127.0.0.1:8001/api/check_translated_urls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: Array.from(urlSet) }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      const list: string[] = data.translated_urls || [];
      list.forEach((u) => {
        translatedSet.add(u.replace(/\/$/, ''));
        translatedSet.add(u.replace(/\/$/, '') + '/');
      });
    }
  } catch (e) {
    console.warn('[LANOVEL] 서버 번역 URL 확인 중 오류 발생 (기본 진행):', e);
  }

  // 제외 회차 목록 조회
  const excludedUrls = await getExcludedEpisodeUrls();
  const excludedSet = new Set(excludedUrls.map(normalizeUrlKey));

  // 배지 주입 및 미번역 목록 수집
  untranslatedEpisodesCache = [];
  episodeDataList.forEach((item, index) => {
    const cleanNoSlash = normalizeUrlKey(item.url);
    const isTranslated = translatedSet.has(cleanNoSlash) || translatedSet.has(cleanNoSlash + '/');
    const isExcluded = excludedSet.has(cleanNoSlash);

    const badge = document.createElement('span');
    badge.className = `lanovel-toc-badge ${isTranslated ? 'translated' : isExcluded ? 'excluded' : 'untranslated'}`;
    badge.innerHTML = `<span class="badge-dot"></span>${isTranslated ? '완료' : isExcluded ? '제외' : '미번역'}`;
    badge.title = isTranslated ? '번역 완료' : isExcluded ? '번역 제외됨 (클릭하여 해제)' : '미번역 (클릭하여 번역 제외)';

    if (!isTranslated) {
      badge.style.cursor = 'pointer';
      badge.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await toggleExclusionForItem(item.url, item.title);
      });
    }

    const existingBadge =
      item.element.parentNode?.querySelector('.lanovel-toc-badge') ||
      item.element.querySelector('.lanovel-toc-badge');
    if (!existingBadge) {
      if (item.element.parentNode) {
        item.element.insertAdjacentElement('afterend', badge);
      } else {
        item.element.appendChild(badge);
      }
    }

    if (!isTranslated) {
      untranslatedEpisodesCache.push({
        index: untranslatedEpisodesCache.length,
        tocIndex: index,
        title: item.title,
        url: item.url,
        element: item.element,
        badgeElement: badge,
        isExcluded: isExcluded,
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

  const activeCount = untranslatedList.filter((ep) => !ep.isExcluded).length;
  const count = activeCount;

  // 사이드바 상단 및 배너 버튼 상태 동기화
  const sidebarCtrlBtn = document.getElementById('sidebar-quick-jump-toggle-btn');
  if (sidebarCtrlBtn) {
    sidebarCtrlBtn.title = `미번역 회차 목록 (${count}화) 띄우기/닫기`;
  }
  const bannerBtn = document.getElementById('banner-quick-jump-btn');
  if (bannerBtn) {
    bannerBtn.textContent = `⚡ 미번역 ${count}화`;
  }
  const triggerHtml = `
    <div id="lanovel-quick-jump-trigger" title="클릭하거나 'N' 키를 눌러 미번역 회차 목록 보기">
      <span class="trigger-icon">⚡</span>
      <span>미번역 <strong id="lanovel-trigger-count">${count}</strong>화</span>
      <span class="trigger-keyhint">N</span>
    </div>
  `;

  const itemsHtml =
    untranslatedList.length > 0
      ? untranslatedList
          .map(
            (ep, idx) => `
      <li class="quick-jump-item ${ep.isExcluded ? 'is-excluded' : ''}" data-jump-index="${idx}" data-url="${escapeHtml(ep.url)}" title="${escapeHtml(ep.title)}">
        <span class="item-title ${ep.isExcluded ? 'is-excluded' : ''}">${escapeHtml(ep.title)}</span>
        <div class="item-actions">
          <button type="button" class="quick-jump-exclude-btn ${ep.isExcluded ? 'is-excluded' : ''}" data-url="${escapeHtml(ep.url)}" title="${ep.isExcluded ? '번역 제외 취소' : '이 회차 번역 제외'}">
            ${ep.isExcluded ? '제외됨' : '제외'}
          </button>
          <span class="item-action-hint">Enter 이동</span>
        </div>
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
          <span class="count-badge" id="lanovel-header-count">${count}</span>
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
    listEl.querySelectorAll('.quick-jump-exclude-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const url = btn.getAttribute('data-url');
        if (!url) return;
        const targetEp = untranslatedList.find((it) => it.url === url);
        await toggleExclusionForItem(url, targetEp ? targetEp.title : '');
      });
    });

    listEl.querySelectorAll('.quick-jump-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.quick-jump-exclude-btn')) return;

        const idx = parseInt(item.getAttribute('data-jump-index') || '-1', 10);
        if (!isNaN(idx) && untranslatedList[idx]) {
          const ep = untranslatedList[idx];
          if (ep.isExcluded) {
            showLanovelHud(`'${ep.title}'은(는) 제외된 회차입니다.`, '⚠️', 2000);
            return;
          }
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

export async function toggleExclusionForItem(url: string, title?: string): Promise<void> {
  if (!url) return;
  const targetEp = untranslatedEpisodesCache.find((it) => normalizeUrlKey(it.url) === normalizeUrlKey(url));
  const nowExcluded = await toggleEpisodeUrlExcluded(url);
  if (targetEp) {
    targetEp.isExcluded = nowExcluded;
    if (targetEp.badgeElement) {
      targetEp.badgeElement.className = `lanovel-toc-badge ${nowExcluded ? 'excluded' : 'untranslated'}`;
      targetEp.badgeElement.innerHTML = `<span class="badge-dot"></span>${nowExcluded ? '제외' : '미번역'}`;
      targetEp.badgeElement.title = nowExcluded ? '번역 제외됨 (클릭하여 해제)' : '미번역 (클릭하여 번역 제외)';
    }
  }

  const listEl = document.getElementById('lanovel-quick-jump-list');
  if (listEl) {
    const itemEl = listEl.querySelector(`.quick-jump-item[data-url="${escapeHtml(url)}"]`);
    if (itemEl) {
      itemEl.classList.toggle('is-excluded', nowExcluded);
      const titleEl = itemEl.querySelector('.item-title');
      if (titleEl) titleEl.classList.toggle('is-excluded', nowExcluded);
      const btnEl = itemEl.querySelector('.quick-jump-exclude-btn');
      if (btnEl) {
        btnEl.classList.toggle('is-excluded', nowExcluded);
        btnEl.textContent = nowExcluded ? '제외됨' : '제외';
        btnEl.setAttribute('title', nowExcluded ? '번역 제외 취소' : '이 회차 번역 제외');
      }
    }
  }

  const activeCount = untranslatedEpisodesCache.filter((ep) => !ep.isExcluded).length;
  const headerCount = document.getElementById('lanovel-header-count');
  if (headerCount) headerCount.textContent = String(activeCount);
  const triggerCount = document.getElementById('lanovel-trigger-count');
  if (triggerCount) triggerCount.textContent = String(activeCount);

  // 사이드바 상단 및 배너 버튼 상태 동기화
  const sidebarCtrlBtn = document.getElementById('sidebar-quick-jump-toggle-btn');
  if (sidebarCtrlBtn) {
    sidebarCtrlBtn.title = `미번역 회차 목록 (${activeCount}화) 띄우기/닫기`;
  }
  const bannerBtn = document.getElementById('banner-quick-jump-btn');
  if (bannerBtn) {
    bannerBtn.textContent = `⚡ 미번역 ${activeCount}화`;
  }

  if (nowExcluded) {
    showLanovelHud(`'${title || '회차'}' 번역 목록에서 제외되었습니다.`, '🚫', 2200);
  } else {
    showLanovelHud(`'${title || '회차'}' 번역 목록에 다시 포함되었습니다.`, '⚡', 2200);
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
  const activeEpisodes = untranslatedEpisodesCache
    .map((ep, idx) => ({ ep, idx }))
    .filter((item) => !item.ep.isExcluded);

  if (!activeEpisodes.length) {
    showLanovelHud('모든 회차가 이미 번역 완료 또는 제외되었습니다!', '🎉');
    return;
  }
  const drawer = document.getElementById('lanovel-quick-jump-drawer');
  if (!drawer) return;

  if (!drawer.classList.contains('open')) {
    drawer.classList.add('open');
    quickJumpFocusedIndex = activeEpisodes[0].idx;
  } else {
    const currentPos = activeEpisodes.findIndex((item) => item.idx === quickJumpFocusedIndex);
    const nextPos = (currentPos + 1) % activeEpisodes.length;
    quickJumpFocusedIndex = activeEpisodes[nextPos].idx;
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

// 사이드바 버튼을 통해 미번역 회차 서랍을 동적으로 띄우고 지우는 토글 함수
export async function toggleQuickJumpFromSidebar(): Promise<void> {
  const drawer = document.getElementById('lanovel-quick-jump-drawer');
  const container = document.getElementById('lanovel-quick-jump-container');

  // 1. 이미 서랍이 열려 있는 경우 -> 닫기 (지우기)
  if (drawer && drawer.classList.contains('open')) {
    toggleQuickJumpDrawer(false);
    showLanovelHud('미번역 회차 서랍을 닫았습니다.', '⚡', 1500);
    return;
  }

  // 2. 서랍 요소가 존재하고 닫혀 있는 경우 -> 열기 (띄우기)
  if (drawer && container) {
    toggleQuickJumpDrawer(true);
    showLanovelHud('미번역 회차 서랍을 열었습니다.', '⚡', 1500);
    return;
  }

  // 3. 목차 페이지이나 아직 퀵 점프 서랍이 초기화되지 않은 경우 -> 초기화 후 즉시 열기
  const scraper = getScraper();
  if (scraper.isTocPage(window.location.href, window.location.pathname)) {
    showLanovelHud('목차 회차 목록을 불러오는 중...', '⏳', 1500);
    await initTocPageFeatures(scraper);
    const newDrawer = document.getElementById('lanovel-quick-jump-drawer');
    if (newDrawer) {
      toggleQuickJumpDrawer(true);
      showLanovelHud('미번역 회차 서랍을 열었습니다.', '⚡', 1500);
    }
  } else {
    // 4. 본문 회차 페이지인 경우 -> 목차 페이지로 이동 안내 또는 이동
    const tocLink = scraper.findTocLink ? scraper.findTocLink() : null;
    if (tocLink && tocLink.href) {
      showLanovelHud('소설 목차 페이지로 이동하여 미번역 목록을 엽니다...', '📑', 2000);
      setTimeout(() => {
        window.location.href = tocLink.href;
      }, 300);
    } else {
      showLanovelHud('소설 목차 페이지에서 미번역 목록을 확인할 수 있습니다.', '⚠️', 2500);
    }
  }
}
