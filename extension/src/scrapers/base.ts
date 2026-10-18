// base.ts: 웹소설 플랫폼 공통 스크래퍼 인터페이스

export interface TocEpisodeItem {
  element?: HTMLElement;
  url: string;
  title: string;
}

export interface PlatformScraper {
  readonly name: string;
  matches(url: string, host: string): boolean;
  detectNovelTitle(): Promise<string | null> | string | null;
  extractEpisodeTitle(): string;
  getWorkKey(url: string): string | null;
  isTocPage(url: string, path: string): boolean;
  findNextEpisodeLink(): HTMLAnchorElement | null;
  findPrevEpisodeLink(): HTMLAnchorElement | null;
  findTocLink(): HTMLAnchorElement | null;
  prepareContent?(): void;
  getTocEpisodes?(rootDoc?: Document | Element): TocEpisodeItem[];
}
