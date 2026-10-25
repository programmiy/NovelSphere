// syosetu.ts: 소설가가 되자/녹턴/문라이트/미드나이트(syosetu.com) DOM 스크래퍼
import type { PlatformScraper, TocEpisodeItem } from './base.ts';

export class SyosetuScraper implements PlatformScraper {
  readonly name = 'syosetu';

  matches(_url: string, host: string): boolean {
    return host.includes('syosetu.com');
  }

  detectNovelTitle(): string | null {
    if (typeof document === 'undefined') return null;

    // 1. 소설 상단 배너(.c-announce) 중 로그인 배너(.c-announce--note) 제외하고 순수 소설 목차 링크 추출
    const candidates = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '.c-announce:not(.c-announce--note) a, .novel_title a, a.p-novel__series-link, .p-novel__series-link a, a.margin_r20'
      )
    );

    for (const a of candidates) {
      const rawHref = a.getAttribute('href') || a.href || '';
      const clean = rawHref.split('?')[0].split('#')[0];
      // login, novelview, infotop, notice, mypage 제외 및 순수 /nXXXXXX/ 패턴 검증
      if (
        !/(login|novelview|infotop|notice|mypage)/i.test(clean) &&
        /^\/?(https?:\/\/[^\/]+)?\/?n\d+[a-z]+\/?$/i.test(clean)
      ) {
        const text = (a.textContent || '').trim();
        if (text) return text;
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
    return (
      (/\/n[a-z0-9]+\/?$/i.test(path) && !/\/\d+\/?$/.test(path)) ||
      (typeof document !== 'undefined' && !!document.querySelector('.p-eplist, .index_box'))
    );
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

    // 1. 회차 하단/상단 목차 직접 링크 (예: 目次 텍스트를 포함하는 페이저 링크)
    const pagerLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.c-pager a, a.c-pager__item, .novel_bn a')
    );
    const tocPagerLink = pagerLinks.find((a) => (a.textContent || '').includes('目次'));
    if (tocPagerLink && tocPagerLink.href) {
      return tocPagerLink;
    }

    // 2. 상단 소설 헤더(.c-announce:not(.c-announce--note)) 중 순수 N코드 목차 링크
    const candidates = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '.c-announce:not(.c-announce--note) a, .novel_title a, a.p-novel__series-link, .p-novel__series-link a'
      )
    );

    for (const a of candidates) {
      const rawHref = a.getAttribute('href') || a.href || '';
      const clean = rawHref.split('?')[0].split('#')[0];
      // login, novelview, infotop, notice, mypage 오매칭 차단
      if (
        !/(login|novelview|infotop|notice|mypage)/i.test(clean) &&
        /^\/?(https?:\/\/[^\/]+)?\/?n\d+[a-z]+\/?$/i.test(clean)
      ) {
        return a;
      }
    }

    return null;
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
