// index.ts: 플랫폼별 스크래퍼 통합 팩토리
import { PlatformScraper } from './base';
import { KakuyomuScraper } from './kakuyomu';
import { SyosetuScraper } from './syosetu';
import { NovelUpScraper } from './novelup';
import { HamelnScraper } from './hameln';
import { AlphapolisScraper } from './alphapolis';
import { GenericScraper } from './generic';

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

export * from './base';
