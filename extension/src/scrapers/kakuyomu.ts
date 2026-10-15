// kakuyomu.ts: 카쿠요무(kakuyomu.jp) DOM 스크래퍼
import { PlatformScraper, TocEpisodeItem } from './base';

export class KakuyomuScraper implements PlatformScraper {
  readonly name = 'kakuyomu';

  matches(_url: string, host: string): boolean {
    return host.includes('kakuyomu.jp');
  }

  detectNovelTitle(): string | null {
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
      document.querySelector<HTMLElement>('.widget-toc-main-title') ||
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
    }

    return null;
  }

  extractEpisodeTitle(): string {
    const epEl = document.querySelector('.widget-episodeTitle, [class*="widget-episodeTitle"], h1[class*="episodeTitle"]');
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
    return /\/works\/\d+\/?$/.test(path) || !!document.querySelector('.widget-toc-episode');
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.getElementById('contentMain-nextEpisode') ||
      document.querySelector('a.widget-episodeNavigation-next') ||
      document.querySelector('#contentMain-readNextEpisode') ||
      document.querySelector('a.js-read-next-episode') ||
      document.querySelector('a[data-link-click-action-name="WorksEpisodesEpisodeFooterNextEpisode"]');
    if (direct && (direct as HTMLAnchorElement).href) return direct as HTMLAnchorElement;

    const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/episodes/"]'));
    const found = candidates.find((a) => (a.textContent || '').includes('次のエピソード'));
    if (found && found.href) return found;

    const relNext = document.querySelector<HTMLAnchorElement>('a[rel="next"], link[rel="next"]');
    if (relNext && (relNext as HTMLAnchorElement).href) return relNext as HTMLAnchorElement;

    return null;
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.getElementById('contentMain-previousEpisode') ||
      document.querySelector('a.widget-episodeNavigation-previous');
    if (direct && (direct as HTMLAnchorElement).href) return direct as HTMLAnchorElement;

    const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/episodes/"]'));
    const found = candidates.find((a) => (a.textContent || '').includes('前のエピソード'));
    if (found && found.href) return found;

    return null;
  }

  findTocLink(): HTMLAnchorElement | null {
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('header a[href*="/works/"], a.widget-toc-main-title, a[class*="workTitle"]')
    );
    const found = links.find((a) => /\/works\/\d+$/.test((a.getAttribute('href') || '').split('?')[0]));
    return found || null;
  }

  getTocEpisodes(): TocEpisodeItem[] {
    const elements = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.widget-toc-episode a, a.widget-toc-episode-episodeTitle')
    );
    return elements.map((el) => ({
      element: el,
      url: el.href.split('#')[0],
      title: (el.textContent || '').trim(),
    }));
  }
}
