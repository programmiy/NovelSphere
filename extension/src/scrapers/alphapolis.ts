// alphapolis.ts: 알파폴리스(alphapolis.co.jp) DOM 스크래퍼
import type { PlatformScraper, TocEpisodeItem } from './base.ts';

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
    if (epEl && !epEl.closest('a') && epEl.textContent && epEl.textContent.trim()) {
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
    if (path.includes('/episode/') || document.querySelector('#novelBoby, #novelBody, .novel-body')) {
      return false;
    }
    return (
      /\/novel\/\d+\/\d+\/?$/.test(path) ||
      !!document.querySelector('.content-statuses, .episode-list, .episodes')
    );
  }

  prepareContent(): void {
    const bodyEl = document.querySelector<HTMLElement>('#novelBoby, #novelBody, .novel-body');
    if (!bodyEl || bodyEl.dataset.lanovelPreprocessed) return;
    if (bodyEl.querySelectorAll('p[id]').length > 0) return;

    const existingPs = bodyEl.querySelectorAll('p');
    if (existingPs.length > 1) {
      existingPs.forEach((p, idx) => {
        if (!p.id) p.id = `L${idx + 1}`;
      });
      bodyEl.dataset.lanovelPreprocessed = 'true';
      return;
    }

    const rawHtml = bodyEl.innerHTML;
    const lines = /<br\s*\/?>/i.test(rawHtml) ? rawHtml.split(/<br\s*\/?>/i) : rawHtml.split(/\r?\n/);
    if (lines.length <= 1) return;

    bodyEl.innerHTML = '';
    lines.forEach((line, index) => {
      const p = document.createElement('p');
      p.id = `L${index + 1}`;
      const trimmed = line.replace(/<[^>]*>/g, '').trim();
      if (!trimmed) {
        p.className = 'blank';
        p.innerHTML = '<br>';
      } else {
        p.innerHTML = line.trim();
      }
      bodyEl.appendChild(p);
    });
    bodyEl.dataset.lanovelPreprocessed = 'true';
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

  getTocEpisodes(rootDoc: Document | Element = document): TocEpisodeItem[] {
    const elements = Array.from(
      rootDoc.querySelectorAll<HTMLAnchorElement>('.episode a, .episode-list a, .episodes a')
    );
    return elements.map((el) => {
      const rawHref = el.getAttribute('href') || el.href || '';
      return {
        element: el,
        url: rawHref.split('#')[0],
        title: (el.textContent || '').trim(),
      };
    });
  }
}
