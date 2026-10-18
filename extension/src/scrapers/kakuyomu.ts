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
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'header a[href*="/works/"], a.widget-toc-main-title, a[class*="workTitle"], a[class*="WorkHeader"], a[href*="/works/"]'
      )
    );
    const found = links.find((a) => /\/works\/\d+\/?$/.test((a.getAttribute('href') || '').split('?')[0]));
    return found || null;
  }

  getTocEpisodes(): TocEpisodeItem[] {
    let elements = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[class*="WorkTocSection_link"], [class*="WorkTocSection"] a, .widget-toc-episode a, a.widget-toc-episode-episodeTitle, [class*="widget-toc-episode"] a'
      )
    );
    if (!elements.length) {
      elements = Array.from(
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/works/"][href*="/episodes/"]')
      ).filter((a) => {
        const isHeaderButton =
          a.closest('header') ||
          a.closest('.widget-workCard-actions') ||
          a.closest('[class*="ReadButton"]') ||
          (a.textContent || '').includes('1話目から読む');
        return !isHeaderButton && a.href;
      });
    }
    return elements.map((el) => {
      const titleEl = el.querySelector(
        '[class*="WorkTocSection_title"], .widget-toc-episode-episodeTitle, [class*="episodeTitle"]'
      );
      let title = titleEl && titleEl.textContent ? titleEl.textContent.trim() : (el.textContent || '').trim();
      title = title.replace(/\s*\d{4}年\d{1,2}月\d{1,2}日.*$/, '').trim();
      return {
        element: el,
        url: el.href.split('#')[0],
        title: title || '제목 없음',
      };
    });
  }
}
