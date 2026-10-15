// alphapolis.ts: 알파폴리스(alphapolis.co.jp) DOM 스크래퍼
import { PlatformScraper, TocEpisodeItem } from './base';

export class AlphapolisScraper implements PlatformScraper {
  readonly name = 'alphapolis';

  matches(_url: string, host: string): boolean {
    return host.includes('alphapolis.co.jp');
  }

  detectNovelTitle(): string | null {
    const titleEl = document.querySelector<HTMLElement>('.title a, .novel-title, h1.title, .title');
    if (titleEl && titleEl.textContent && titleEl.textContent.trim()) {
      return titleEl.textContent.trim();
    }
    const parts = document.title.split(/\s*[\/|-]\s*/);
    if (parts.length > 1) {
      return parts[parts.length - 1].trim();
    }
    return null;
  }

  extractEpisodeTitle(): string {
    const epEl = document.querySelector<HTMLElement>('.episode-title, h2.title, .novel-sub-title, .sub-title');
    if (epEl && epEl.textContent && epEl.textContent.trim()) {
      return epEl.textContent.trim();
    }
    const parts = document.title.split(/\s*[\/|-]\s*/);
    if (parts.length > 0 && parts[0].trim()) {
      return parts[0].trim();
    }
    return '';
  }

  getWorkKey(url: string): string | null {
    const match = url.match(/\/novel\/(\d+)/);
    return match ? `alphapolis_${match[1]}` : null;
  }

  isTocPage(_url: string, path: string): boolean {
    return (
      /\/novel\/\d+\/?$/.test(path) ||
      !!document.querySelector('.content-statuses, .episode-list, .episodes')
    );
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.next a') ||
      document.querySelector<HTMLAnchorElement>('a.btn-next') ||
      document.querySelector<HTMLAnchorElement>('.navigation .next a') ||
      document.querySelector<HTMLAnchorElement>('a[rel="next"]');
    return (direct && direct.href) ? direct : null;
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.prev a') ||
      document.querySelector<HTMLAnchorElement>('a.btn-prev') ||
      document.querySelector<HTMLAnchorElement>('.navigation .prev a') ||
      document.querySelector<HTMLAnchorElement>('a[rel="prev"]');
    return (direct && direct.href) ? direct : null;
  }

  findTocLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.header-novel-title a') ||
      document.querySelector<HTMLAnchorElement>('a[href*="/novel/"]');
    return (direct && direct.href) ? direct : null;
  }

  getTocEpisodes(): TocEpisodeItem[] {
    const elements = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.episode a, .episode-list a, .episodes a')
    );
    return elements.map((el) => ({
      element: el,
      url: el.href.split('#')[0],
      title: (el.textContent || '').trim(),
    }));
  }
}
