// novelup.ts: 노벨업플러스(novelup.plus) DOM 스크래퍼
import type { PlatformScraper, TocEpisodeItem } from './base.ts';

export class NovelUpScraper implements PlatformScraper {
  readonly name = 'novelup';

  matches(_url: string, host: string): boolean {
    return host.includes('novelup.plus');
  }

  detectNovelTitle(): string | null {
    const novelTitleEl =
      document.querySelector<HTMLElement>('.episodeHeader .storyTitle') ||
      document.querySelector<HTMLElement>('.storyTitle') ||
      document.querySelector<HTMLElement>('.story_title');

    if (novelTitleEl && novelTitleEl.textContent && novelTitleEl.textContent.trim()) {
      return novelTitleEl.textContent.trim();
    }

    const titleText = document.title.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, '').trim();
    const parts = titleText.split(/\s*-\s*/);
    if (parts.length > 0 && parts[0].trim()) {
      let novelPart = parts[0].trim();
      novelPart = novelPart.replace(/（[^）]+）$/, '').trim();
      novelPart = novelPart.replace(/\([^)]+\)$/, '').trim();
      if (novelPart) return novelPart;
    }
    return null;
  }

  extractEpisodeTitle(): string {
    const epEl = document.querySelector<HTMLElement>('.episode_title, #section_episode .episode_title, h1');
    if (epEl && !epEl.closest('a') && epEl.textContent && epEl.textContent.trim()) {
      return epEl.textContent.trim();
    }
    if (document.title) {
      const clean = document.title.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, '').trim();
      const parts = clean.split(/\s*-\s*/);
      if (parts.length > 1 && parts[parts.length - 1].trim()) {
        return parts[parts.length - 1].trim();
      }
      if (parts[0].trim()) return parts[0].trim();
    }
    return '';
  }

  getWorkKey(url: string): string | null {
    const match = url.match(/\/story\/(\d+)/);
    return match ? `novelup_${match[1]}` : null;
  }

  isTocPage(_url: string, path: string): boolean {
    if (document.getElementById('episode_content')) {
      return false;
    }
    return (
      (/\/story\/\d+\/?$/.test(path) && !/\/\d+\/\d+/.test(path)) ||
      !!document.querySelector('#section_episode, .episodeListItem, a.episodeTitle, .storyList')
    );
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.episodeNavi .nextEpisode a') ||
      document.querySelector<HTMLAnchorElement>('.btn_next') ||
      document.querySelector<HTMLAnchorElement>('.episode_navigation .next a');
    if (direct && direct.href) return direct;

    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    const contextual = allLinks.find(
      (a) =>
        (a.closest('.episodeHeaderPager') || a.closest('#section_episode') || a.closest('.storyIndexFooter')) &&
        (a.textContent || '').includes('次へ') &&
        a.href &&
        !(a.textContent || '').includes('前へ')
    );
    if (contextual) return contextual;

    const storyLink = allLinks.find(
      (a) =>
        (a.textContent || '').includes('次へ') &&
        a.href &&
        a.href.includes('/story/') &&
        !(a.textContent || '').includes('前へ')
    );
    return storyLink || null;
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.episodeNavi .prevEpisode a') ||
      document.querySelector<HTMLAnchorElement>('.btn_prev') ||
      document.querySelector<HTMLAnchorElement>('.episode_navigation .prev a');
    if (direct && direct.href) return direct;

    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    const contextual = allLinks.find(
      (a) =>
        (a.closest('.episodeHeaderPager') || a.closest('#section_episode') || a.closest('.storyIndexFooter')) &&
        (a.textContent || '').includes('前へ') &&
        a.href &&
        !(a.textContent || '').includes('次へ')
    );
    return contextual || null;
  }

  findTocLink(): HTMLAnchorElement | null {
    const direct =
      document.querySelector<HTMLAnchorElement>('.episodeHeader .storyTitle a') ||
      document.querySelector<HTMLAnchorElement>('.storyTitle a') ||
      document.querySelector<HTMLAnchorElement>('.story_title a') ||
      document.querySelector<HTMLAnchorElement>('a.storyTitle');
    if (direct && direct.href) return direct;

    const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/story/"]'));
    const found = candidates.find((a) =>
      /\/story\/\d+\/?$/.test((a.getAttribute('href') || '').split('?')[0].split('#')[0])
    );
    return (found && found.href) ? found : null;
  }

  prepareContent(): void {
    const epContent = document.getElementById('episode_content');
    if (!epContent || epContent.dataset.lanovelPreprocessed) return;

    if (epContent.tagName.toLowerCase() === 'div' && epContent.querySelectorAll('p[id]').length > 0) {
      return;
    }

    const rawHtml = epContent.innerHTML;
    let lines = rawHtml.split(/\r?\n/);
    if (lines.length <= 1 && epContent.querySelectorAll('p').length > 1) {
      epContent.querySelectorAll('p').forEach((p, idx) => {
        if (!p.id) p.id = `L${idx + 1}`;
      });
      epContent.dataset.lanovelPreprocessed = 'true';
      return;
    }
    if (lines.length <= 1 && /<br\s*\/?>/i.test(rawHtml)) {
      lines = rawHtml.split(/<br\s*\/?>/i);
    }

    const container = document.createElement('div');
    container.id = 'episode_content';
    container.dataset.lanovelPreprocessed = 'true';
    container.className = epContent.className;
    if (epContent.getAttribute('style')) {
      container.setAttribute('style', epContent.getAttribute('style') || '');
    }

    lines.forEach((line, index) => {
      const p = document.createElement('p');
      p.id = `L${index + 1}`;
      const trimmed = line.replace(/<[^>]*>/g, '').trim();
      if (!trimmed) {
        p.className = 'blank';
        p.innerHTML = '<br>';
      } else {
        p.innerHTML = line;
      }
      container.appendChild(p);
    });

    epContent.replaceWith(container);
    console.log(`[LANOVEL] NovelUp content transformed into ${lines.length} paragraphs for translation.`);
  }

  getTocEpisodes(rootDoc: Document | Element = document): TocEpisodeItem[] {
    let elements = Array.from(
      rootDoc.querySelectorAll<HTMLAnchorElement>(
        '.episodeListItem a.episodeTitle, #section_episode a.episodeTitle, .episodeListItem a, a.episodeTitle, .storyList .episode a, .episode_list a, .storyList a[href*="/story/"]'
      )
    ).filter((el) => {
      const rawHref = el.getAttribute('href') || el.href || '';
      const cleanHref = rawHref.split('#')[0].split('?')[0];
      return /\/story\/\d+\/\d+\/?$/.test(cleanHref);
    });

    if (!elements.length) {
      elements = Array.from(rootDoc.querySelectorAll<HTMLAnchorElement>('a[href*="/story/"]')).filter((el) => {
        const rawHref = el.getAttribute('href') || el.href || '';
        const cleanHref = rawHref.split('#')[0].split('?')[0];
        return /\/story\/\d+\/\d+\/?$/.test(cleanHref);
      });
    }

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
