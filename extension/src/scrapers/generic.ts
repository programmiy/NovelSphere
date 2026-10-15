// generic.ts: 기본 폴백 스크래퍼
import { PlatformScraper, TocEpisodeItem } from './base';

export class GenericScraper implements PlatformScraper {
  readonly name = 'generic';

  matches(_url: string, _host: string): boolean {
    return true; // 최후의 폴백
  }

  detectNovelTitle(): string | null {
    const cleanDocTitle = document.title.split(/[-|–—]/)[0].trim();
    if (cleanDocTitle && cleanDocTitle !== '閉じる') {
      return cleanDocTitle;
    }
    return '기본 소설';
  }

  extractEpisodeTitle(): string {
    if (document.title) {
      let clean = document.title
        .replace(/\s*-\s*(カクヨム|小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ|ノベルアップ).*$/i, '')
        .trim();
      clean = clean.replace(/\s*\|\s*小説投稿サイトノベルアップ.*$/i, '').trim();
      const parts = clean.split(/\s*-\s*/);
      if (parts.length > 1 && parts[0].trim()) {
        return parts[0].trim();
      }
      return clean;
    }
    return '';
  }

  getWorkKey(_url: string): string | null {
    return null;
  }

  isTocPage(_url: string, _path: string): boolean {
    return false;
  }

  findNextEpisodeLink(): HTMLAnchorElement | null {
    const relNext = document.querySelector<HTMLAnchorElement>('a[rel="next"]');
    if (relNext && relNext.href) return relNext;

    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    return (
      allLinks.find((a) => {
        const txt = (a.textContent || '').trim();
        return txt === '次へ' || txt === '다음화' || txt === '다음 화' || txt === '다음';
      }) || null
    );
  }

  findPrevEpisodeLink(): HTMLAnchorElement | null {
    const relPrev = document.querySelector<HTMLAnchorElement>('a[rel="prev"]');
    if (relPrev && relPrev.href) return relPrev;

    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    return (
      allLinks.find((a) => {
        const txt = (a.textContent || '').trim();
        return txt === '前へ' || txt === '이전화' || txt === '이전 화' || txt === '이전';
      }) || null
    );
  }

  findTocLink(): HTMLAnchorElement | null {
    const relIndex = document.querySelector<HTMLAnchorElement>('a[rel="index"]');
    if (relIndex && relIndex.href) return relIndex;

    const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
    return (
      allLinks.find((a) => {
        const txt = (a.textContent || '').trim();
        return txt === '目次' || txt === '목차' || txt === 'TOC';
      }) || null
    );
  }

  getTocEpisodes(): TocEpisodeItem[] {
    return [];
  }
}
