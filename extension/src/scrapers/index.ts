// index.ts: 플랫폼별 스크래퍼 통합 팩토리
import type { PlatformScraper } from './base.ts';
import { KakuyomuScraper } from './kakuyomu.ts';
import { SyosetuScraper } from './syosetu.ts';
import { NovelUpScraper } from './novelup.ts';
import { HamelnScraper } from './hameln.ts';
import { AlphapolisScraper } from './alphapolis.ts';
import { GenericScraper } from './generic.ts';

const scrapers: PlatformScraper[] = [
  new KakuyomuScraper(),
  new SyosetuScraper(),
  new NovelUpScraper(),
  new HamelnScraper(),
  new AlphapolisScraper(),
];

const genericScraper = new GenericScraper();

export function getScraper(url: string = window.location.href): PlatformScraper {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    for (const scraper of scrapers) {
      if (scraper.matches(url, host)) {
        return scraper;
      }
    }
  } catch (e) {
    // fallback
  }
  return genericScraper;
}

export type * from './base.ts';
