import test from 'node:test';
import assert from 'node:assert';
import { chunkArray, createBudgetChunks } from '../src/core/chunker.ts';
import { isTranslatableText, isPurePunctuationOnly, hasJapaneseText } from '../src/core/filters.ts';
import {
  calculateAdaptiveChunkDelay,
  calculateAdaptiveEpisodeDelay,
  getNovelWorkKey,
  getCurrentQuotaWindow,
  sendProgressNotification,
  sendCompleteNotification,
} from '../src/core/adaptive_throttle.ts';

test('chunker: chunkArray splits array by exact size', () => {
  const input = [1, 2, 3, 4, 5];
  assert.deepStrictEqual(chunkArray(input, 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(chunkArray([], 2), []);
});

test('chunker: createBudgetChunks respects character budget and max item limit', () => {
  const items = [
    { text: 'A'.repeat(100) },
    { text: 'B'.repeat(150) },
    { text: 'C'.repeat(50) }
  ];

  // maxChars = 200: First chunk gets A (100), next B (150) exceeds 200, so B goes to chunk 2, C (50) fits in chunk 2 (150+50=200)
  const chunksByChar = createBudgetChunks(items, 200, 10);
  assert.strictEqual(chunksByChar.length, 2);
  assert.strictEqual(chunksByChar[0].length, 1);
  assert.strictEqual(chunksByChar[1].length, 2);

  // maxItems = 2: Split by count regardless of chars
  const chunksByCount = createBudgetChunks(items, 10000, 2);
  assert.strictEqual(chunksByCount.length, 2);
  assert.strictEqual(chunksByCount[0].length, 2);
  assert.strictEqual(chunksByCount[1].length, 1);

  // Empty items
  assert.deepStrictEqual(createBudgetChunks([]), []);
});

test('filters: isTranslatableText accurately detects Japanese dialogue and prose', () => {
  // 1. Japanese content
  assert.strictEqual(isTranslatableText('こんにちは世界'), true);
  assert.strictEqual(isTranslatableText('魔王を倒す旅に出た。'), true);

  // 2. Dialogue / quote brackets
  assert.strictEqual(isTranslatableText('「……」'), true);
  assert.strictEqual(isTranslatableText('『――』'), true);
  assert.strictEqual(isTranslatableText('「!?」'), true);

  // 3. Ellipsis and pauses
  assert.strictEqual(isTranslatableText('…………'), true);
  assert.strictEqual(isTranslatableText('――――'), true);

  // 4. Non-translatable items (empty, plain ascii symbols/whitespace)
  assert.strictEqual(isTranslatableText(''), false);
  assert.strictEqual(isTranslatableText('   '), false);
  assert.strictEqual(isTranslatableText('12345'), false);
});

test('filters: isPurePunctuationOnly fast-path detection', () => {
  assert.strictEqual(isPurePunctuationOnly('「……」'), true);
  assert.strictEqual(isPurePunctuationOnly('『！？』'), true);
  assert.strictEqual(isPurePunctuationOnly('……'), true);

  // Contains actual words -> false
  assert.strictEqual(isPurePunctuationOnly('「こんにちは」'), false);
  assert.strictEqual(isPurePunctuationOnly('Hello'), false);
  assert.strictEqual(isPurePunctuationOnly('안녕하세요'), false);
  assert.strictEqual(isPurePunctuationOnly(''), false);
});

test('filters: hasJapaneseText detects kana and kanji', () => {
  assert.strictEqual(hasJapaneseText('テスト'), true);
  assert.strictEqual(hasJapaneseText('漢字'), true);
  assert.strictEqual(hasJapaneseText('Hello World'), false);
  assert.strictEqual(hasJapaneseText('한국어 문장'), false);
  assert.strictEqual(hasJapaneseText('12345!'), false);
});

test('throttle: normal mode defaults to 5s chunk delay and 60s episode delay', () => {
  // Normal mode (isTurbo = false)
  assert.strictEqual(calculateAdaptiveChunkDelay(0, false), 5000);
  assert.strictEqual(calculateAdaptiveChunkDelay(4, false), 5000);
  assert.strictEqual(calculateAdaptiveChunkDelay(5, false), 6500);

  assert.strictEqual(calculateAdaptiveEpisodeDelay(0, false), 60000);
  assert.strictEqual(calculateAdaptiveEpisodeDelay(4, false), 60000);
  assert.strictEqual(calculateAdaptiveEpisodeDelay(5, false), 75000);
  assert.strictEqual(calculateAdaptiveEpisodeDelay(7, false), 90000);
});

test('throttle: turbo mode uses fast 2s chunk delay and 8s episode delay with scaling', () => {
  // Turbo mode (isTurbo = true)
  assert.strictEqual(calculateAdaptiveChunkDelay(0, true), 2000);
  assert.strictEqual(calculateAdaptiveChunkDelay(3, true), 2000);
  assert.strictEqual(calculateAdaptiveChunkDelay(4, true), 3000);
  assert.strictEqual(calculateAdaptiveChunkDelay(6, true), 4500);

  assert.strictEqual(calculateAdaptiveEpisodeDelay(0, true), 8000);
  assert.strictEqual(calculateAdaptiveEpisodeDelay(2, true), 8000);
  assert.strictEqual(calculateAdaptiveEpisodeDelay(3, true), 15000);
  assert.strictEqual(calculateAdaptiveEpisodeDelay(7, true), 55000);
});

test('counter: getNovelWorkKey extracts platform work key and getCurrentQuotaWindow respects cutoff hour', () => {
  assert.strictEqual(
    getNovelWorkKey('https://kakuyomu.jp/works/1177354054887975130/episodes/123', '테스트'),
    'kakuyomu_1177354054887975130'
  );
  assert.strictEqual(
    getNovelWorkKey('https://ncode.syosetu.com/n3298hj/15/', '테스트'),
    'syosetu_n3298hj'
  );
  assert.strictEqual(
    getNovelWorkKey('https://novelup.plus/story/987654/111', '테스트'),
    'novelup_987654'
  );
  assert.strictEqual(
    getNovelWorkKey('https://example.com/ch1', '마왕 학원의 부적합자'),
    'novel_마왕_학원의_부적합자'
  );

  const beforeCutoff = new Date(2026, 9, 17, 15, 30, 0); // Oct 17, 15:30 (< 16:00)
  const afterCutoff = new Date(2026, 9, 17, 16, 30, 0); // Oct 17, 16:30 (>= 16:00)
  assert.strictEqual(getCurrentQuotaWindow(beforeCutoff, 16), '2026-10-16_16');
  assert.strictEqual(getCurrentQuotaWindow(afterCutoff, 16), '2026-10-17_16');
});

test('notifications: sendProgressNotification and sendCompleteNotification call legacy server endpoints and payload keys', async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    calls.push({ url: String(input), body: JSON.parse(init.body) });
    return { ok: true } as any;
  }) as any;

  try {
    await sendProgressNotification('소설제목', '10화', 45, 45, 100, 'https://syosetu.com/n1234ab/10', 10);
    await sendCompleteNotification('소설제목', '25화', 50, 'https://syosetu.com/n1234ab/25', 25);

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].url, 'http://127.0.0.1:8001/api/notifications/progress');
    assert.deepStrictEqual(calls[0].body, {
      novel_title: '소설제목',
      episode_title: '10화',
      current: 45,
      total: 45,
      percentage: 100,
      url: 'https://syosetu.com/n1234ab/10',
      episode_count: 10,
    });

    assert.strictEqual(calls[1].url, 'http://127.0.0.1:8001/api/notifications/complete');
    assert.deepStrictEqual(calls[1].body, {
      novel_title: '소설제목',
      episode_title: '25화',
      total_count: 50,
      url: 'https://syosetu.com/n1234ab/25',
      episode_count: 25,
    });
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('separators: analyzeSeparatorSections preserves body paragraphs when scene breaks appear in the middle', async () => {
  const { analyzeSeparatorSections, DEFAULT_GLOBAL_SEPARATORS } = await import('../src/core/separators.ts');

  const paragraphs = Array.from({ length: 50 }, (_, idx) => ({
    pid: `p${idx + 1}`,
    text: idx === 20 || idx === 30 ? '***' : `본문 문장 ${idx + 1}`,
    element: {} as any,
  }));

  // 1) 기본 구분선(DEFAULT_GLOBAL_SEPARATORS) 사용 시 중간의 '***'는 전혀 제외되지 않아야 함
  const resDefault = analyzeSeparatorSections(paragraphs, DEFAULT_GLOBAL_SEPARATORS);
  assert.strictEqual(resDefault.prefacePids.size, 0);
  assert.strictEqual(resDefault.afterwordPids.size, 0);

  // 2) 커스텀 구분선에 '***'가 있더라도 본문 한가운데(21번째, 31번째)에 있으면 앞뒤 본문을 통째로 날리지 않아야 함
  const resCustom = analyzeSeparatorSections(paragraphs, [...DEFAULT_GLOBAL_SEPARATORS, '***']);
  assert.strictEqual(resCustom.prefacePids.size, 0);
  assert.strictEqual(resCustom.afterwordPids.size, 0);
  assert.strictEqual(resCustom.separatorPids.has('p21'), true);
  assert.strictEqual(resCustom.separatorPids.has('p31'), true);
});

test('separators: analyzeSeparatorSections populates excludedPidMap with preface, separator, and afterword metadata', async () => {
  const { analyzeSeparatorSections, DEFAULT_GLOBAL_SEPARATORS } = await import('../src/core/separators.ts');

  const paragraphs = Array.from({ length: 20 }, (_, idx) => {
    const pid = `p${idx + 1}`;
    let text = `본문 문장 ${idx + 1}`;
    if (idx === 1) text = '=================='; // p2: 상단 구분선
    if (idx === 17) text = '＜あとがき＞'; // p18: 하단 후기 구분선
    return { pid, text, element: {} as any };
  });

  const analysis = analyzeSeparatorSections(paragraphs, [...DEFAULT_GLOBAL_SEPARATORS, '==================']);

  // 상단 구분선 이전 잡글 (p1) 및 상단 구분선 자체 (p2)
  assert.strictEqual(analysis.prefacePids.has('p1'), true);
  assert.deepStrictEqual(analysis.excludedPidMap.get('p1'), {
    matchedSep: '==================',
    isSubsequent: false,
    isPreface: true,
  });
  assert.deepStrictEqual(analysis.excludedPidMap.get('p2'), {
    matchedSep: '==================',
    isSubsequent: false,
    isPreface: false,
  });

  // 본문 단락 (p10)은 제외되지 않음
  assert.strictEqual(analysis.excludedPidMap.has('p10'), false);

  // 하단 구분선 자체 (p18) 및 후기 단락 (p19, p20)
  assert.deepStrictEqual(analysis.excludedPidMap.get('p18'), {
    matchedSep: '＜あとがき＞',
    isSubsequent: false,
    isPreface: false,
  });
  assert.deepStrictEqual(analysis.excludedPidMap.get('p19'), {
    matchedSep: '＜あとがき＞',
    isSubsequent: true,
    isPreface: false,
  });
  assert.deepStrictEqual(analysis.excludedPidMap.get('p20'), {
    matchedSep: '＜あとがき＞',
    isSubsequent: true,
    isPreface: false,
  });
});

test('state & filters: isReviewMode and checkIsVerbatimOrParaphrased work as expected', async () => {
  const { ExtensionState } = await import('../src/core/state.ts');
  const { checkIsVerbatimOrParaphrased } = await import('../src/core/filters.ts');

  const s = new ExtensionState();
  assert.strictEqual(s.isReviewMode(), false);
  s.reviewTargetPids.add('p12');
  assert.strictEqual(s.isReviewMode(), true);
  s.reviewTargetPids.clear();
  s.isReviewSession = true;
  assert.strictEqual(s.isReviewMode(), true);

  // 원문 그대로 복제 또는 미세 변형(일본어 잔존, 한글 부재) 감지
  assert.strictEqual(checkIsVerbatimOrParaphrased('「おはよう、勇者様」', '「おはよう、勇者様」'), true);
  assert.strictEqual(checkIsVerbatimOrParaphrased('「おはよう、勇者様」', 'おはよう、勇者様！'), true);
  // 정상 한국어 번역문은 false
  assert.strictEqual(checkIsVerbatimOrParaphrased('「おはよう、勇者様」', '「좋은 아침이에요, 용사님」'), false);
});

test('kakuyomu & toc: KakuyomuScraper and normalizeUrlKey work accurately', async () => {
  const { KakuyomuScraper } = await import('../src/scrapers/kakuyomu.ts');
  const { normalizeUrlKey } = await import('../src/ui/toc_quick_jump.ts');

  const scraper = new KakuyomuScraper();

  // 1. matches
  assert.strictEqual(scraper.matches('https://kakuyomu.jp/works/123', 'kakuyomu.jp'), true);
  assert.strictEqual(scraper.matches('https://syosetu.com', 'syosetu.com'), false);

  // 2. getWorkKey
  assert.strictEqual(scraper.getWorkKey('https://kakuyomu.jp/works/1177354054887975130/episodes/123'), 'kakuyomu_1177354054887975130');
  assert.strictEqual(scraper.getWorkKey('https://kakuyomu.jp/works/1177354054887975130'), 'kakuyomu_1177354054887975130');

  // 3. isTocPage
  assert.strictEqual(scraper.isTocPage('https://kakuyomu.jp/works/1177354054887975130', '/works/1177354054887975130'), true);
  assert.strictEqual(scraper.isTocPage('https://kakuyomu.jp/works/1177354054887975130/', '/works/1177354054887975130/'), true);
  assert.strictEqual(scraper.isTocPage('https://kakuyomu.jp/works/1177354054887975130/episodes/999', '/works/1177354054887975130/episodes/999'), false);

  // 4. normalizeUrlKey
  assert.strictEqual(normalizeUrlKey('https://kakuyomu.jp/works/123/episodes/456/'), 'https://kakuyomu.jp/works/123/episodes/456');
  assert.strictEqual(normalizeUrlKey('https://kakuyomu.jp/works/123/episodes/456#comment'), 'https://kakuyomu.jp/works/123/episodes/456');
  assert.strictEqual(normalizeUrlKey('https://kakuyomu.jp/works/123/episodes/456?ref=top#toc'), 'https://kakuyomu.jp/works/123/episodes/456');

  // 5. getNovelTocUrl
  const { getNovelTocUrl } = await import('../src/ui/toc_quick_jump.ts');
  assert.strictEqual(
    getNovelTocUrl(scraper, 'https://kakuyomu.jp/works/1177354054887975130/episodes/1177354054887975145'),
    'https://kakuyomu.jp/works/1177354054887975130'
  );

  // 6. getTocEpisodes with __NEXT_DATA__
  const mockNextData = {
    query: { workId: '1177354054887975130' },
    props: {
      pageProps: {
        __APOLLO_STATE__: {
          'Work:1177354054887975130': {
            __typename: 'Work',
            id: '1177354054887975130',
            tableOfContentsV2: [
              { __ref: 'TableOfContentsChapter:chap1' },
              { __ref: 'Episode:ep3' },
            ],
          },
          'TableOfContentsChapter:chap1': {
            __typename: 'TableOfContentsChapter',
            id: 'chap1',
            episodeUnions: [
              { __ref: 'Episode:ep1' },
              { __ref: 'Episode:ep2' },
            ],
          },
          'Episode:ep1': {
            __typename: 'Episode',
            id: 'ep1',
            title: '제1화 프롤로그',
          },
          'Episode:ep2': {
            __typename: 'Episode',
            id: 'ep2',
            title: '제2화 시작',
          },
          'Episode:ep3': {
            __typename: 'Episode',
            id: 'ep3',
            title: '외전',
          },
        },
      },
    },
  };

  const fakeRootDoc = {
    querySelector(selector: string) {
      if (selector === '#__NEXT_DATA__') {
        return { textContent: JSON.stringify(mockNextData) };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  } as any;

  const parsedEpisodes = scraper.getTocEpisodes(fakeRootDoc);
  assert.strictEqual(parsedEpisodes.length, 3);
  assert.strictEqual(parsedEpisodes[0].title, '제1화 프롤로그');
  assert.strictEqual(parsedEpisodes[0].url, 'https://kakuyomu.jp/works/1177354054887975130/episodes/ep1');
  assert.strictEqual(parsedEpisodes[1].title, '제2화 시작');
  assert.strictEqual(parsedEpisodes[1].url, 'https://kakuyomu.jp/works/1177354054887975130/episodes/ep2');
  assert.strictEqual(parsedEpisodes[2].title, '외전');
  assert.strictEqual(parsedEpisodes[2].url, 'https://kakuyomu.jp/works/1177354054887975130/episodes/ep3');
});

test('kakuyomu: extractEpisodeTitle ignores previous episode pager link and picks current episode title', async () => {
  const { KakuyomuScraper } = await import('../src/scrapers/kakuyomu.ts');
  const scraper = new KakuyomuScraper();

  const prevPager = {
    textContent: '第２１５話　이전화',
    closest(sel: string) {
      if (sel === 'a' || sel === '#contentMain-readPreviousEpisode' || sel.includes('pager')) return true;
      return false;
    },
  };
  const headerTitle = {
    textContent: '第２１６話　현재화',
    closest(_sel: string) {
      return false;
    },
  };

  (globalThis as any).document = {
    title: '第２１６話　현재화 - 소설제목 - カクヨム',
    querySelectorAll(_sel: string) {
      return [prevPager, headerTitle];
    },
    querySelector(_sel: string) {
      return null;
    },
  };

  try {
    const title = scraper.extractEpisodeTitle();
    assert.strictEqual(title, '第２１６話　현재화');
  } finally {
    delete (globalThis as any).document;
  }
});



