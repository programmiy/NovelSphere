// hameln.ts: 하멜른(syosetu.org) DOM 스크래퍼
import type { PlatformScraper, TocEpisodeItem } from './base.ts';

export class HamelnScraper implements PlatformScraper {
  readonly name = 'hameln';

  matches(_url: string, host: string): boolean {
    return host.includes('syosetu.org');
  }

  detectNovelTitle(): string | null {
    const titleLink = document.querySelector<HTMLAnchorElement>('a[href*="/novel/"][style*="font-weight:bold"], span.novel_title a');
    if (titleLink && titleLink.textContent && titleLink.textContent.trim()) {
      return titleLink.textContent.trim();
    }
    const parts = document.title.split(/\s*-\s*/);
    if (parts.length > 1) {
      return parts[parts.length - 1].trim();
    }
    return null;
  }

  extractEpisodeTitle(): string {
    const epEl = document.querySelector<HTMLElement>('span[style*="font-size:120%"], h2, .ss');
    if (epEl && !epEl.closest('a') && epEl.textContent && epEl.textContent.trim()) {
      return epEl.textContent.trim();
    }
    const parts = document.title.split(/\s*-\s*/);
    if (parts.length > 0 && parts[0].trim()) {
      return parts[0].trim();
    }
    return '';
  }

  getWorkKey(url: string): string | null {
    const match = url.match(/\/novel\/(\d+)/);
    return match ? `hameln_${match[1]}` : null;
  }

  isTocPage(_url: string, path: string): boolean {
    if (document.getElementById('honbun')) {
      return false;
    }
    return (
      /\/novel\/\d+\/?$/.test(path) ||
      (!path.endsWith('.html') && document.querySelectorAll('table a[href*="/novel/"]').length > 3)
    );
  }

  prepareContent(): void {
    const honbun = document.getElementById('honbun');
    if (!honbun || honbun.dataset.lanovelPreprocessed) return;
    const paragraphs = honbun.querySelectorAll('p');
    if (paragraphs.length > 0) {
      paragraphs.forEach((p, idx) => {
        if (!p.id) {
          p.id = `L${idx + 1}`;
        } else if (/^\d+$/.test(p.id)) {
          p.id = `L${p.id}`;
        }
      });
      honbun.dataset.lanovelPreprocessed = 'true';
    }
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    return links.find((a) => (a.textContent || '').trim() === '次へ' && a.href) || null;
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    return links.find((a) => (a.textContent || '').trim() === '前へ' && a.href) || null;
  }

  findTocLink(): HTMLAnchorElement | null {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    return (
      links.find((a) => {
        const txt = (a.textContent || '').trim();
        return (txt === '目次' || txt === 'TOP') && a.href;
      }) || null
    );
  }

  getTocEpisodes(rootDoc: Document | Element = document): TocEpisodeItem[] {
    const elements = Array.from(rootDoc.querySelectorAll<HTMLAnchorElement>('table a[href*="/novel/"]'));
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
