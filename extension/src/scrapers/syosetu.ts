// syosetu.ts: 소설가가 되자/녹턴/문라이트/미드나이트(syosetu.com) DOM 스크래퍼
import type { PlatformScraper, TocEpisodeItem } from './base.ts';

export class SyosetuScraper implements PlatformScraper {
  readonly name = 'syosetu';

  matches(_url: string, host: string): boolean {
    return host.includes('syosetu.com');
  }

  detectNovelTitle(): string | null {
    if (typeof document === 'undefined') return null;
    // 1. 공지 배너(.c-announce) 오매칭 방지: 빵부스러기 및 N코드 패턴 링크 우선
    const breadcrumbLink = document.querySelector<HTMLElement>('.c-breadcrumbs a[href*="/n"]');
    if (breadcrumbLink) {
      const href = breadcrumbLink.getAttribute('href') || '';
      if (/\/n\d+[a-z]+(\/|$|\?)/i.test(href) && breadcrumbLink.textContent?.trim()) {
        return breadcrumbLink.textContent.trim();
      }
    }

    const novelLink =
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
    if (typeof document === 'undefined') return '';
    const epEl = document.querySelector<HTMLElement>('.p-novel__title, .novel_subtitle, [class*="novel__title"]');
    if (epEl && !epEl.closest('a') && epEl.textContent && epEl.textContent.trim()) {
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
    if (typeof document !== 'undefined' && document.querySelector('.p-novel__body, #novel_honbun, .p-novel__text')) {
      return false;
    }
    return (/\/n[a-z0-9]+\/?$/i.test(path) && !/\/\d+\/?$/.test(path)) || (typeof document !== 'undefined' && !!document.querySelector('.p-eplist, .index_box'));
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    if (typeof document === 'undefined') return null;
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
    if (typeof document === 'undefined') return null;
    const direct =
      document.querySelector<HTMLAnchorElement>('.c-pager__item--before') ||
      document.querySelector<HTMLAnchorElement>('a.novel_bn_prev');
    if (direct && direct.href) return direct;

    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.novel_bn a, .c-pager a, a.c-pager__item'));
    const found = links.find((a) => (a.textContent || '').includes('前へ'));
    return found || null;
  }

  findTocLink(): HTMLAnchorElement | null {
    if (typeof document === 'undefined') return null;
    // 1. 유효한 N코드 목차 링크 셀렉터 후보군 (.c-announce 공지 배너 완전 제외로 공지/작품정보 오매칭 차단)
    const selectors = [
      '.c-breadcrumbs a[href*="/n"]',
      '.p-novel__series-link a',
      'a.p-novel__series-link',
      '.novel_title a',
      'a.novel_title',
      'a.margin_r20[href*="/n"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector<HTMLAnchorElement>(sel);
      if (el && el.href) {
        const cleanHref = el.getAttribute('href') || el.href;
        // 쇼세츠 N코드 패턴 (/nXXXXXX/ 또는 /nXXXXXX) 검증하여 공지/뉴스/작품정보 오매칭 방지
        if (/\/n\d+[a-z]+(\/|$|\?)/i.test(cleanHref)) {
          return el;
        }
      }
    }

    // 2. 본문 페이지 DOM 전체에서 N코드 목차 형태의 앵커 탐색
    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
    const matched = allLinks.find((a) => {
      const raw = a.getAttribute('href') || a.href || '';
      return /\/n\d+[a-z]+\/?$/i.test(raw.split('?')[0].split('#')[0]);
    });
    return matched || null;
  }

  getTocEpisodes(rootDoc?: Document | Element): TocEpisodeItem[] {
    const doc = rootDoc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return [];
    const elements = Array.from(
      doc.querySelectorAll<HTMLAnchorElement>(
        'a.p-eplist__subtitle, .p-eplist a.p-eplist__subtitle, .p-eplist__sublist a, .p-eplist a, .index_box .subtitle a, .subtitle a'
      )
    ).filter((el) => {
      const rawHref = el.getAttribute('href') || el.href || '';
      const cleanHref = rawHref.split('#')[0].split('?')[0];
      return /\/\d+\/?$/.test(cleanHref);
    });
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
