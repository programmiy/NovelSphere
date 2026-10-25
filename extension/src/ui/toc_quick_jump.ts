import { serverFetch } from '../core/api_client.ts';
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

  // URL 중복 제거 및 절대 경로 정규화
  const episodeDataList: TocEpisodeItem[] = [];
  const urlSet = new Set<string>();
  episodeItems.forEach((item) => {
    if (!item.url) return;
    const cleanUrl = new URL(item.url, window.location.href).href.split('#')[0];
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

  // 서버에 배치 조회 요청 (5초 타임아웃 방어)
  const translatedSet = new Set<string>();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await serverFetch('/api/check_translated_urls', {
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
        const norm = normalizeUrlKey(u);
        translatedSet.add(norm);
        translatedSet.add(norm + '/');
        if (norm.startsWith('http://') || norm.startsWith('https://')) {
          const pathOnly = norm.replace(/^https?:\/\/[^\/]+/, '');
          if (pathOnly) {
            translatedSet.add(pathOnly);
            translatedSet.add(pathOnly + '/');
          }
        }
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
    const pathOnly = cleanNoSlash.replace(/^https?:\/\/[^\/]+/, '');
    const isTranslated =
      translatedSet.has(cleanNoSlash) ||
      translatedSet.has(cleanNoSlash + '/') ||
      (pathOnly && (translatedSet.has(pathOnly) || translatedSet.has(pathOnly + '/')));
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

    if (item.element) {
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

  console.log(`[LANOVEL] TOC 초기화 완료: 총 ${episodeDataList.length}개 회차 중 ${untranslatedEpisodesCache.length}개 미번역 발견`);
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
  if (targetEp && targetEp.element && targetEp.element.isConnected) {
    targetEp.element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// 소설 목차 URL 역산 헬퍼 (본문 회차 페이지에서도 목차 URL 추출)
export function getNovelTocUrl(scraper: PlatformScraper, currentUrl: string = typeof window !== 'undefined' ? window.location.href : ''): string | null {
  if (!currentUrl) return null;
  // 1. live DOM 내 목차 링크 우선 탐색 (플랫폼별 유효 N코드 URL 패턴 재검증)
  if (scraper.findTocLink) {
    const link = scraper.findTocLink();
    if (link && link.href) {
      const clean = link.href.split('#')[0].split('?')[0];
      // Syosetu의 경우 공지/뉴스/작품정보 오매칭 방지용 N코드 검증
      if (!currentUrl.includes('syosetu.com') || /\/n\d+[a-z]+(\/|$)/i.test(clean)) {
        if (clean) return clean;
      }
    }
  }

  // 2. URL 패턴 기반 목차 URL 역산
  try {
    const parsed = new URL(currentUrl);
    const host = parsed.hostname;
    const path = parsed.pathname;

    if (host.includes('kakuyomu.jp')) {
      const m = path.match(/\/works\/(\d+)/);
      if (m) return `https://kakuyomu.jp/works/${m[1]}`;
    }
    if (host.includes('syosetu.com')) {
      const m = path.match(/\/(n[a-z0-9]+)/i);
      if (m) return `${parsed.origin}/${m[1].toLowerCase()}/`;
    }
    if (host.includes('novelup.plus')) {
      const m = path.match(/\/story\/(\d+)/);
      if (m) return `https://novelup.plus/story/${m[1]}`;
    }
    if (host.includes('alphapolis.co.jp')) {
      const m = path.match(/\/novel\/(\d+\/\d+)/);
      if (m) return `https://www.alphapolis.co.jp/novel/${m[1]}`;
    }
    if (host.includes('syosetu.org')) {
      const m = path.match(/\/novel\/(\d+)/);
      if (m) return `https://syosetu.org/novel/${m[1]}/`;
    }
  } catch (e) {
    console.warn('[LANOVEL] 목차 URL 역산 실패:', e);
  }
  return null;
}

// 본문 회차 페이지에서 페이지 이동 없이 백그라운드로 목차를 조회하여 미번역 서랍 로드
export async function loadRemoteTocEpisodes(scraper: PlatformScraper): Promise<boolean> {
  const tocUrl = getNovelTocUrl(scraper);
  if (!tocUrl) {
    showLanovelHud('소설 목차 URL을 확인할 수 없습니다.', '⚠️', 2500);
    return false;
  }

  showLanovelHud('소설 전체 목차 및 번역 상태를 불러오는 중...', '⏳', 8000);

  try {
    let episodeItems: TocEpisodeItem[] = [];

    // 1. 백엔드 목차 임포트 API 우선 활용 (/api/import-toc: 쇼세츠 100화 단위 페이징 및 카쿠요무 Apollo 완벽 순회)
    try {
      const serverResp = await serverFetch('/api/import-toc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toc_url: tocUrl }),
      });
      if (serverResp.ok) {
        const importedList = await serverResp.json();
        if (Array.isArray(importedList) && importedList.length > 0) {
          episodeItems = importedList.map((item: any) => ({
            url: item.url,
            title: item.title,
          }));
          console.log(`[LANOVEL] 백엔드 /api/import-toc 연동 성공: 총 ${episodeItems.length}개 챕터 획득`);
        }
      }
    } catch (apiErr) {
      console.warn('[LANOVEL] 백엔드 /api/import-toc 호출 실패, 프론트엔드 직접 fetch fallback 실행:', apiErr);
    }

    // 2. 백엔드 조회 실패 시 브라우저 단일 fetch fallback
    if (!episodeItems.length) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const resp = await fetch(tocUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!resp.ok) {
        showLanovelHud(`목차 요청 실패 (HTTP ${resp.status})`, '⚠️', 2500);
        return false;
      }

      const html = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      if (scraper.getTocEpisodes) {
        episodeItems = scraper.getTocEpisodes(doc);
      }
    }

    if (!episodeItems.length) {
      showLanovelHud('목차에서 회차 목록을 찾지 못했습니다.', '⚠️', 2500);
      return false;
    }

    // URL 중복 제거 및 절대 경로 정규화
    const episodeDataList: TocEpisodeItem[] = [];
    const urlSet = new Set<string>();
    episodeItems.forEach((item) => {
      if (!item.url) return;
      const cleanUrl = new URL(item.url, tocUrl).href.split('#')[0];
      if (!urlSet.has(cleanUrl)) {
        urlSet.add(cleanUrl);
        episodeDataList.push({
          element: item.element,
          url: cleanUrl,
          title: item.title,
        });
      }
    });

    if (!episodeDataList.length) return false;

    // 서버에 배치 조회 요청 (5초 타임아웃)
    const translatedSet = new Set<string>();
    try {
      const serverCtrl = new AbortController();
      const sTimeout = setTimeout(() => serverCtrl.abort(), 5000);
      const checkResp = await serverFetch('/api/check_translated_urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: Array.from(urlSet) }),
        signal: serverCtrl.signal,
      });
      clearTimeout(sTimeout);
      if (checkResp.ok) {
        const data = await checkResp.json();
        const list: string[] = data.translated_urls || [];
        list.forEach((u) => {
          const norm = normalizeUrlKey(u);
          translatedSet.add(norm);
          translatedSet.add(norm + '/');
          if (norm.startsWith('http://') || norm.startsWith('https://')) {
            const pathOnly = norm.replace(/^https?:\/\/[^\/]+/, '');
            if (pathOnly) {
              translatedSet.add(pathOnly);
              translatedSet.add(pathOnly + '/');
            }
          }
        });
      }
    } catch (e) {
      console.warn('[LANOVEL] 서버 번역 URL 확인 중 오류 발생:', e);
    }

    // 제외 회차 목록 조회
    const excludedUrls = await getExcludedEpisodeUrls();
    const excludedSet = new Set(excludedUrls.map(normalizeUrlKey));

    untranslatedEpisodesCache = [];
    episodeDataList.forEach((item, index) => {
      const cleanNoSlash = normalizeUrlKey(item.url);
      const pathOnly = cleanNoSlash.replace(/^https?:\/\/[^\/]+/, '');
      const isTranslated =
        translatedSet.has(cleanNoSlash) ||
        translatedSet.has(cleanNoSlash + '/') ||
        (pathOnly && (translatedSet.has(pathOnly) || translatedSet.has(pathOnly + '/')));
      const isExcluded = excludedSet.has(cleanNoSlash);

      if (!isTranslated) {
        untranslatedEpisodesCache.push({
          index: untranslatedEpisodesCache.length,
          tocIndex: index,
          title: item.title,
          url: item.url,
          element: item.element,
          isExcluded: isExcluded,
        });
      }
    });

    console.log(`[LANOVEL] 원격 전체 목차 로드 완료: 총 ${episodeDataList.length}개 회차 중 ${untranslatedEpisodesCache.length}개 미번역 발견`);
    renderQuickJumpPanel(untranslatedEpisodesCache);
    if (untranslatedEpisodesCache.length > 0) {
      showLanovelHud(`미번역 회차 ${untranslatedEpisodesCache.length}화 로드 완료`, '⚡', 1800);
    } else {
      showLanovelHud('모든 회차의 번역이 완료되었습니다!', '🎉', 2000);
    }
    return true;
  } catch (err: any) {
    console.error('[LANOVEL] 비동기 목차 로드 실패:', err);
    showLanovelHud('목차를 불러오는 중 오류가 발생했습니다.', '❌', 2500);
    return false;
  }
}

// 사이드바 버튼 또는 N 단축키를 통해 미번역 회차 서랍을 동적으로 띄우고 지우는 토글 함수
export async function toggleQuickJumpFromSidebar(): Promise<void> {
  const drawer = document.getElementById('lanovel-quick-jump-drawer');
  const container = document.getElementById('lanovel-quick-jump-container');

  // 1. 이미 서랍이 열려 있는 경우 -> 닫기 (지우기)
  if (drawer && drawer.classList.contains('open')) {
    toggleQuickJumpDrawer(false);
    showLanovelHud('미번역 회차 서랍을 닫았습니다.', '⚡', 1500);
    return;
  }

  // 2. 서랍 요소가 존재하고 닫혀 있는 경우 -> 열기 (띄우기) 및 첫 미번역 포커스
  if (drawer && container) {
    toggleQuickJumpDrawer(true);
    if (quickJumpFocusedIndex < 0 && untranslatedEpisodesCache.length > 0) {
      const firstActive = untranslatedEpisodesCache.findIndex((ep) => !ep.isExcluded);
      if (firstActive !== -1) {
        quickJumpFocusedIndex = firstActive;
        updateQuickJumpFocusUI();
      }
    }
    showLanovelHud('미번역 회차 서랍을 열었습니다.', '⚡', 1500);
    return;
  }

  // 3. 목차 페이지이나 아직 퀵 점프 서랍이 초기화되지 않은 경우 -> DOM에서 스캔 후 즉시 열기
  const scraper = getScraper();
  if (scraper.isTocPage(window.location.href, window.location.pathname)) {
    showLanovelHud('목차 회차 목록을 불러오는 중...', '⏳', 1500);
    await initTocPageFeatures(scraper);
    const newDrawer = document.getElementById('lanovel-quick-jump-drawer');
    if (newDrawer) {
      toggleQuickJumpDrawer(true);
      if (quickJumpFocusedIndex < 0 && untranslatedEpisodesCache.length > 0) {
        const firstActive = untranslatedEpisodesCache.findIndex((ep) => !ep.isExcluded);
        if (firstActive !== -1) {
          quickJumpFocusedIndex = firstActive;
          updateQuickJumpFocusUI();
        }
      }
      showLanovelHud('미번역 회차 서랍을 열었습니다.', '⚡', 1500);
    }
  } else {
    // 4. 본문 회차 페이지인 경우 -> 페이지를 절대 이동하지 않고, 백엔드/백그라운드 fetch로 목차를 가져와 서랍 표시!
    const ok = await loadRemoteTocEpisodes(scraper);
    if (ok) {
      toggleQuickJumpDrawer(true);
      if (quickJumpFocusedIndex < 0 && untranslatedEpisodesCache.length > 0) {
        const firstActive = untranslatedEpisodesCache.findIndex((ep) => !ep.isExcluded);
        if (firstActive !== -1) {
          quickJumpFocusedIndex = firstActive;
          updateQuickJumpFocusUI();
        }
      }
      showLanovelHud('미번역 회차 서랍을 열었습니다.', '⚡', 1500);
    }
  }
}
