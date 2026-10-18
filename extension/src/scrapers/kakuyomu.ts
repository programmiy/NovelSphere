// kakuyomu.ts: 카쿠요무(kakuyomu.jp) DOM 스크래퍼
import type { PlatformScraper, TocEpisodeItem } from './base.ts';

export class KakuyomuScraper implements PlatformScraper {
  readonly name = 'kakuyomu';

  matches(_url: string, host: string): boolean {
    return host.includes('kakuyomu.jp');
  }

  detectNovelTitle(): string | null {
    const heading = document.querySelector<HTMLElement>(
      'h1[class*="WorkHeader"], h1[class*="Title"], .widget-toc-main-title, header h1, h1'
    );
    if (heading && heading.textContent && heading.textContent.trim()) {
      return heading.textContent.trim();
    }

    const workLink =
      Array.from(document.querySelectorAll<HTMLAnchorElement>('header a[href*="/works/"]')).find((a) => {
        const txt = (a.textContent || '').trim();
        const aria = a.getAttribute('aria-label') || '';
        const href = a.getAttribute('href') || '';
        return (
          txt &&
          !txt.includes('閉じる') &&
          !aria.includes('閉じる') &&
          !txt.includes('目次') &&
          !txt.includes('TOP') &&
          /\/works\/\d+$/.test(href.split('?')[0])
        );
      }) ||
      document.querySelector<HTMLElement>('a[href^="/works/"][class*="Title"]') ||
      document.querySelector<HTMLElement>('header a[class*="workTitle"]');

    if (workLink && workLink.textContent && workLink.textContent.trim()) {
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
    } else if (parts.length > 0 && parts[0].trim()) {
      return parts[0].trim();
    }

    return null;
  }

  extractEpisodeTitle(): string {
    const epEl = document.querySelector(
      '.widget-episodeTitle, [class*="widget-episodeTitle"], h1[class*="episodeTitle"], [class*="EpisodeTitle"]'
    );
    if (epEl && epEl.textContent && epEl.textContent.trim()) {
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
    return '';
  }

  getWorkKey(url: string): string | null {
    const match = url.match(/\/works\/(\d+)/);
    return match ? `kakuyomu_${match[1]}` : null;
  }

  isTocPage(_url: string, path: string): boolean {
    if (path.includes('/episodes/')) {
      return false;
    }
    if (typeof document !== 'undefined') {
      if (document.querySelector('.widget-episodeBody, [class*="Episode_body"], [class*="episodeBody"]')) {
        return false;
      }
      if (
        document.querySelector(
          '.widget-toc-episode, [class*="WorkTocSection"], [class*="WorkToc"], a[href*="/works/"][href*="/episodes/"]'
        )
      ) {
        return true;
      }
    }
    return /\/works\/\d+\/?$/.test(path);
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    if (typeof document === 'undefined') return null;
    const direct =
      document.getElementById('contentMain-nextEpisode') ||
      document.querySelector('a.widget-episodeNavigation-next') ||
      document.querySelector('#contentMain-readNextEpisode') ||
      document.querySelector('a.js-read-next-episode') ||
      document.querySelector('a[data-link-click-action-name="WorksEpisodesEpisodeFooterNextEpisode"]') ||
      document.querySelector('a[class*="nextEpisode"], a[class*="NextEpisode"]');
    if (direct && (direct as HTMLAnchorElement).href) return direct as HTMLAnchorElement;

    const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/episodes/"]'));
    const found = candidates.find((a) => (a.textContent || '').includes('次のエピソード') || (a.textContent || '').includes('次へ'));
    if (found && found.href) return found;

    const relNext = document.querySelector<HTMLAnchorElement>('a[rel="next"], link[rel="next"]');
    if (relNext && (relNext as HTMLAnchorElement).href) return relNext as HTMLAnchorElement;

    return null;
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    if (typeof document === 'undefined') return null;
    const direct =
      document.getElementById('contentMain-previousEpisode') ||
      document.querySelector('a.widget-episodeNavigation-previous') ||
      document.querySelector('a[class*="previousEpisode"], a[class*="PreviousEpisode"]');
    if (direct && (direct as HTMLAnchorElement).href) return direct as HTMLAnchorElement;

    const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/episodes/"]'));
    const found = candidates.find((a) => (a.textContent || '').includes('前のエピソード') || (a.textContent || '').includes('前へ'));
    if (found && found.href) return found;

    return null;
  }

  findTocLink(): HTMLAnchorElement | null {
    if (typeof document === 'undefined') return null;
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'header a[href*="/works/"], a.widget-toc-main-title, a[class*="workTitle"], a[class*="WorkHeader"], a[href*="/works/"]'
      )
    );
    const found = links.find((a) => /\/works\/\d+\/?$/.test((a.getAttribute('href') || '').split('?')[0]));
    return found || null;
  }

  getTocEpisodes(rootDoc: Document | Element = document): TocEpisodeItem[] {
    // 1. Next.js __NEXT_DATA__ JSON 기반 전체 목차 추출 (카쿠요무의 아코디언/가상화 목록 완벽 대응)
    const nextDataScript = rootDoc.querySelector('#__NEXT_DATA__');
    if (nextDataScript && nextDataScript.textContent) {
      try {
        const nextData = JSON.parse(nextDataScript.textContent);
        const apollo =
          nextData?.props?.pageProps?.__APOLLO_STATE__ ||
          nextData?.props?.apolloState ||
          {};

        // 메인 작품 ID 확인: query.workId 또는 tableOfContentsV2를 가진 Work 탐색
        let workId = nextData?.query?.workId;
        let mainWork: any = workId ? apollo[`Work:${workId}`] : null;

        if (!mainWork || !mainWork.tableOfContentsV2) {
          for (const key of Object.keys(apollo)) {
            if (key.startsWith('Work:') && apollo[key]?.tableOfContentsV2) {
              mainWork = apollo[key];
              workId = mainWork.id || key.replace('Work:', '');
              break;
            }
          }
        }

        if (mainWork && mainWork.tableOfContentsV2 && workId) {
          const episodes: TocEpisodeItem[] = [];
          const toc = mainWork.tableOfContentsV2;

          // 현재 DOM에 존재하는 <a> 태그들을 URL 기준으로 매핑해두기 (있을 경우 element 연결)
          const domElements = Array.from(
            rootDoc.querySelectorAll<HTMLAnchorElement>('a[href*="/works/"][href*="/episodes/"]')
          );
          const elementMap = new Map<string, HTMLElement>();
          domElements.forEach((el) => {
            const rawHref = el.getAttribute('href') || el.href || '';
            const clean = rawHref.split('#')[0].split('?')[0];
            const epMatch = clean.match(/\/episodes\/(\d+)/);
            if (epMatch) {
              elementMap.set(epMatch[1], el);
            }
          });

          // tableOfContentsV2 순회하며 순서대로 회차 추출
          if (Array.isArray(toc)) {
            for (const itemRef of toc) {
              const refKey = itemRef?.__ref;
              if (!refKey) continue;
              const chapterOrEp = apollo[refKey];
              if (!chapterOrEp) continue;

              if (chapterOrEp.__typename === 'TableOfContentsChapter') {
                const epUnions = chapterOrEp.episodeUnions || [];
                for (const epRef of epUnions) {
                  const epKey = epRef?.__ref;
                  if (!epKey) continue;
                  const ep = apollo[epKey];
                  if (ep && ep.id) {
                    const epId = String(ep.id);
                    episodes.push({
                      element: elementMap.get(epId),
                      url: `https://kakuyomu.jp/works/${workId}/episodes/${epId}`,
                      title: ep.title || '제목 없음',
                    });
                  }
                }
              } else if (chapterOrEp.__typename === 'Episode' && chapterOrEp.id) {
                const epId = String(chapterOrEp.id);
                episodes.push({
                  element: elementMap.get(epId),
                  url: `https://kakuyomu.jp/works/${workId}/episodes/${epId}`,
                  title: chapterOrEp.title || '제목 없음',
                });
              }
            }
          }

          if (episodes.length > 0) {
            return episodes;
          }
        }
      } catch (e) {
        console.warn('[LANOVEL] 카쿠요무 __NEXT_DATA__ 파싱 실패, DOM 폴백을 시도합니다:', e);
      }
    }

    // 2. DOM 기반 폴백 (기존 방식)
    let elements = Array.from(
      rootDoc.querySelectorAll<HTMLAnchorElement>(
        'a[class*="WorkTocSection_link"], [class*="WorkTocSection"] a, .widget-toc-episode a, a.widget-toc-episode-episodeTitle, [class*="widget-toc-episode"] a'
      )
    );
    if (!elements.length) {
      elements = Array.from(
        rootDoc.querySelectorAll<HTMLAnchorElement>('a[href*="/works/"][href*="/episodes/"]')
      ).filter((a) => {
        const isHeaderButton =
          a.closest('header') ||
          a.closest('.widget-workCard-actions') ||
          a.closest('[class*="ReadButton"]') ||
          (a.textContent || '').includes('1話目から読む');
        return !isHeaderButton && (a.getAttribute('href') || a.href);
      });
    }
    return elements.map((el) => {
      const titleEl = el.querySelector(
        '[class*="WorkTocSection_title"], .widget-toc-episode-episodeTitle, [class*="episodeTitle"]'
      );
      let title = titleEl && titleEl.textContent ? titleEl.textContent.trim() : (el.textContent || '').trim();
      title = title.replace(/\s*\d{4}年\d{1,2}月\d{1,2}日.*$/, '').trim();
      const rawHref = el.getAttribute('href') || el.href || '';
      const fullUrl = rawHref.startsWith('http')
        ? rawHref
        : `https://kakuyomu.jp${rawHref.startsWith('/') ? '' : '/'}${rawHref}`;
      return {
        element: el,
        url: fullUrl.split('#')[0],
        title: title || '제목 없음',
      };
    });
  }
}
