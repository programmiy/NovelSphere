// syosetu.ts: 소설가가 되자/녹턴/문라이트/미드나이트(syosetu.com) DOM 스크래퍼
import { PlatformScraper, TocEpisodeItem } from './base';

export class SyosetuScraper implements PlatformScraper {
  readonly name = 'syosetu';

  matches(_url: string, host: string): boolean {
    return host.includes('syosetu.com');
  }

  detectNovelTitle(): string | null {
    const novelLink =
      document.querySelector<HTMLElement>('.c-announce a[href*="/n"]') ||
      document.querySelector<HTMLElement>('.p-novel__series-link') ||
      document.querySelector<HTMLElement>('.novel_title') ||
      document.querySelector<HTMLElement>('a.margin_r20');

    if (novelLink && novelLink.textContent && novelLink.textContent.trim()) {
      return novelLink.textContent.trim();
    }

    const parts = document.title.split(/\s*-\s*/);
    if (parts.length > 1) {
      return parts[parts.length - 1].trim();
    } else if (parts.length > 0 && parts[0].trim()) {
      return parts[0].trim();
    }
    return null;
  }

  extractEpisodeTitle(): string {
    const epEl = document.querySelector('.p-novel__title, .novel_subtitle, [class*="novel__title"]');
    if (epEl && epEl.textContent && epEl.textContent.trim()) {
      return epEl.textContent.trim();
    }
    if (document.title) {
      const clean = document.title
        .replace(/\s*-\s*(小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ).*$/i, '')
        .trim();
      const parts = clean.split(/\s*-\s*/);
      if (parts.length > 1 && parts[parts.length - 1].trim()) {
        return parts[parts.length - 1].trim();
      }
      if (parts[0].trim()) return parts[0].trim();
    }
    return '';
  }

  getWorkKey(url: string): string | null {
    const match = url.match(/\/(n\d+[a-z]+)(\/|$)/i);
    return match ? `syosetu_${match[1].toLowerCase()}` : null;
  }

  isTocPage(_url: string, path: string): boolean {
    return (/\/n[a-z0-9]+\/?$/i.test(path) && !/\/\d+\/?$/.test(path)) || !!document.querySelector('.p-eplist');
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.c-pager__item--next') ||
      document.querySelector<HTMLAnchorElement>('a.novel_bn_next') ||
      document.querySelector<HTMLAnchorElement>('.novel_bn a.c-pager__item--next') ||
      document.querySelector<HTMLAnchorElement>('a.c-pager__item.c-pager__item--next') ||
      document.querySelector<HTMLAnchorElement>('a.novelview_pager-next');
    if (direct && direct.href) return direct;

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.novel_bn a, .c-pager a, a.c-pager__item'));
    const found = links.find((a) => (a.textContent || '').includes('次へ'));
    return found || null;
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.c-pager__item--before') ||
      document.querySelector<HTMLAnchorElement>('a.novel_bn_prev');
    if (direct && direct.href) return direct;

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.novel_bn a, .c-pager a, a.c-pager__item'));
    const found = links.find((a) => (a.textContent || '').includes('前へ'));
    return found || null;
  }

  findTocLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.c-announce a[href*="/n"]') ||
      document.querySelector<HTMLAnchorElement>('.p-novel__series-link') ||
      document.querySelector<HTMLAnchorElement>('.novel_title a');
    return (direct && direct.href) ? direct : null;
  }

  getTocEpisodes(): TocEpisodeItem[] {
    const elements = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.p-eplist__sublist .p-eplist__subtitle a, .subtitle a')
    );
    return elements.map((el) => ({
      element: el,
      url: el.href.split('#')[0],
      title: (el.textContent || '').trim(),
    }));
  }
}
