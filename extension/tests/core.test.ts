import test from 'node:test';
import assert from 'node:assert';
import { chunkArray, createBudgetChunks, selectSafePiggybackItems, isDialogueLine, isSceneBreakLine, CHUNK_BUDGET_CHARACTERS, CHUNK_HARD_MAX_ITEMS, CHUNK_PIGGYBACK_MAX_ITEMS } from '../src/core/chunker.ts';
import { isTranslatableText, isPurePunctuationOnly, hasJapaneseText } from '../src/core/filters.ts';
import {
  calculateAdaptiveChunkDelay,
  calculateAdaptiveEpisodeDelay,
  getNovelWorkKey,
  getCurrentQuotaWindow,
  sendProgressNotification,
  sendCompleteNotification,
} from '../src/core/adaptive_throttle.ts';
import { SyosetuScraper } from '../src/scrapers/syosetu.ts';
import { getNovelTocUrl } from '../src/ui/toc_quick_jump.ts';

test('chunker: chunkArray splits array by exact size', () => {
  const input = [1, 2, 3, 4, 5];
  assert.deepStrictEqual(chunkArray(input, 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(chunkArray([], 2), []);
});

test('chunker: createBudgetChunks respects character budget and max item limit with balanced load', () => {
  const items = [
    { text: 'A'.repeat(100) },
    { text: 'B'.repeat(150) },
    { text: 'C'.repeat(50) }
  ];

  // maxChars = 200: [100] (100 chars) + [150, 50] (200 chars)
  const chunksByChar = createBudgetChunks(items, 200, 10);
  assert.strictEqual(chunksByChar.length, 2);
  assert.strictEqual(chunksByChar[0].length, 1);
  assert.strictEqual(chunksByChar[1].length, 2);

  // maxItems = 2: Balanced split keeps each chunk <= 2 items and balances char load (100 vs 200 instead of 250 vs 50)
  const chunksByCount = createBudgetChunks(items, 10000, 2);
  assert.strictEqual(chunksByCount.length, 2);
  assert.ok(chunksByCount.every((c) => c.length <= 2));
  assert.deepStrictEqual(chunksByCount.flat(), items);

  // Empty & single items
  assert.deepStrictEqual(createBudgetChunks([]), []);
  assert.deepStrictEqual(createBudgetChunks([{ text: '단문' }]), [[{ text: '단문' }]]);
});

test('chunker: smart pre-planned balanced chunking eliminates small remainder chunks and saves API calls', () => {
  // 1. 짧은 대화문 70개 (총 ~700자): 1개 청크(70개) 원샷 완결
  const shortDialogueItems = Array.from({ length: 70 }, (_, i) => ({
    text: '「대화문_' + i + '」'
  }));
  const chunksShort = createBudgetChunks(shortDialogueItems);
  assert.strictEqual(chunksShort.length, 1);
  assert.strictEqual(chunksShort[0].length, 70);

  // 2. 짧은 대화문 80개: 구형(75+5 자투리) 대신 균등 2청크로 분할하여 자투리 원천 제거
  const eightyDialogueItems = Array.from({ length: 80 }, (_, i) => ({
    text: '「단문_' + i + '」'
  }));
  const chunksEighty = createBudgetChunks(eightyDialogueItems);
  assert.strictEqual(chunksEighty.length, 2);
  assert.ok(chunksEighty[0].length >= 34 && chunksEighty[0].length <= 42);
  assert.ok(chunksEighty[1].length >= 38 && chunksEighty[1].length <= 46);
  assert.deepStrictEqual(chunksEighty.flat(), eightyDialogueItems);

  // 3. 서술문 50개 (문장당 35자 = 1,750자): 구형(45+5 자투리) 대신 스위트 스폿 내 1묶음 원샷 흡수!
  const dense50Items = Array.from({ length: 50 }, (_, i) => ({
    id: 'p' + i,
    text: '서'.repeat(35)
  }));
  const chunksDense50 = createBudgetChunks(dense50Items);
  assert.strictEqual(chunksDense50.length, 1, "50문장 1,750자는 5개 자투리를 남기지 않고 1묶음으로 완결되어야 함");
  assert.strictEqual(chunksDense50[0].length, 50);

  // 4. 서술문 60개 (문장당 35자 = 2,100자): 2,000자 초과로 2묶음 분할하되 45+15 대신 가벼운 균등 2묶음(TTFB 가속 반영)
  const dense60Items = Array.from({ length: 60 }, (_, i) => ({
    id: 'p' + i,
    text: '서'.repeat(35)
  }));
  const chunksDense60 = createBudgetChunks(dense60Items);
  assert.strictEqual(chunksDense60.length, 2);
  assert.ok(chunksDense60[0].length >= 25 && chunksDense60[0].length <= 31);
  assert.ok(chunksDense60[1].length >= 29 && chunksDense60[1].length <= 35);
  assert.ok(chunksDense60[0].length <= chunksDense60[1].length, "첫 묶음은 TTFB 체감 가속을 위해 뒤 묶음보다 가볍거나 같아야 함");

  // 5. 105문장 혼합형 (문장당 26자 = 2,730자): 구형(45+45+15 = 3묶음) 대신 균등 2묶음(~48 + ~57)으로 압축 완결!
  const mixed105Items = Array.from({ length: 105 }, (_, i) => ({
    id: 'm' + i,
    text: '혼'.repeat(26)
  }));
  const chunksMixed105 = createBudgetChunks(mixed105Items);
  assert.strictEqual(chunksMixed105.length, 2, "45+45+15 자투리 3묶음 대신 균형 2묶음으로 API 호출 1회 절감");
  assert.ok(chunksMixed105.every((c) => c.length >= 45 && c.length <= 60));
  assert.deepStrictEqual(chunksMixed105.flat(), mixed105Items);

  // 6. 고밀도 장편 105문장 (문장당 36자 = 3,780자): 3묶음 불가피 시 45+45+15 대신 ~32+36+37 균등 3분할
  const heavy105Items = Array.from({ length: 105 }, (_, i) => ({
    id: 'h' + i,
    text: '장'.repeat(36)
  }));
  const chunksHeavy105 = createBudgetChunks(heavy105Items);
  assert.strictEqual(chunksHeavy105.length, 3);
  assert.ok(chunksHeavy105.every((c) => c.length >= 30 && c.length <= 40), "모든 묶음이 자투리 없이 30~40개 사이로 고르게 분배되어야 함");
});

test('chunker: handles skewed lengths, isolates giant outliers, snaps to natural boundaries, and guards retranslation', () => {
  // 1. 극심한 글자 수 편차(Skewness): 전반부 100자 서술문 18개(1,800자) + 후반부 12자 대화문 50개(600자)
  const skewedItems = [
    ...Array.from({ length: 18 }, (_, i) => ({ id: 'long_' + i, text: '長'.repeat(100) })),
    ...Array.from({ length: 50 }, (_, i) => ({ id: 'short_' + i, text: '「' + '短'.repeat(10) + '」' }))
  ];
  const skewedChunks = createBudgetChunks(skewedItems);
  for (const ch of skewedChunks) {
    const chars = ch.reduce((s, x) => s + x.text.length, 0);
    assert.ok(chars <= CHUNK_BUDGET_CHARACTERS, `청크 글자 수(${chars})가 2,000자 상한을 초과하면 안 됨`);
    assert.ok(ch.length <= CHUNK_HARD_MAX_ITEMS, `청크 문장 수(${ch.length})가 75개 상한을 초과하면 안 됨`);
  }
  assert.deepStrictEqual(skewedChunks.flat(), skewedItems);

  // 2. 단일 거대 문장(Outlier >= 1,400자) 사전 격리
  const withOutlier = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'pre_' + i, text: '前'.repeat(25) })),
    { id: 'giant', text: '巨'.repeat(1600) },
    ...Array.from({ length: 20 }, (_, i) => ({ id: 'post_' + i, text: '後'.repeat(25) }))
  ];
  const outlierChunks = createBudgetChunks(withOutlier);
  assert.strictEqual(outlierChunks.length, 3);
  assert.strictEqual(outlierChunks[1].length, 1);
  assert.strictEqual(outlierChunks[1][0].id, 'giant');
  assert.deepStrictEqual(outlierChunks.flat(), withOutlier);

  // 3. 자연 경계 스내핑(Natural Boundary Snapping): 연속 대사 한복판을 피하고 장면 전환 기호 경계 선호
  assert.strictEqual(isDialogueLine('　「おはよう！」'), true);
  assert.strictEqual(isDialogueLine('地の文です。'), false);
  assert.strictEqual(isSceneBreakLine('　◇　◇　◇　'), true);
  assert.strictEqual(isSceneBreakLine('普通の文章'), false);

  const dialogueAndBreakItems = Array.from({ length: 64 }, (_, i) => {
    if (i === 29) return { id: String(i), text: "◇　◇　◇" }; // 목표 분할선(29~30 부근) 자연 장면전환 경계
    if (i >= 26 && i <= 34) return { id: String(i), text: "「" + "あ".repeat(30) + "」" }; // 연속 대사 구간
    return { id: String(i), text: "あ".repeat(32) };
  });
  const snappedChunks = createBudgetChunks(dialogueAndBreakItems);
  assert.strictEqual(snappedChunks.length, 2);
  // 절단점이 연속 대사 한복판이 아닌 장면 전환 기호(index 29) 전후로 스내핑되는지 확인
  assert.ok(snappedChunks[0].length === 29 || snappedChunks[0].length === 30);

  // 4. 재번역 모델(isRetranslation: true) 보수적 분할 보호
  const borderItems = Array.from({ length: 52 }, (_, i) => ({ id: String(i), text: "文".repeat(33) })); // 1,716자
  const normalModeChunks = createBudgetChunks(borderItems, CHUNK_BUDGET_CHARACTERS, 45, { isRetranslation: false });
  const retranslateChunks = createBudgetChunks(borderItems, CHUNK_BUDGET_CHARACTERS, 45, { isRetranslation: true });
  assert.strictEqual(normalModeChunks.length, 1, "기본 모델은 52문장 1,716자를 1묶음 원샷 처리");
  assert.strictEqual(retranslateChunks.length, 2, "상위 재번역 모델은 레이턴시/503 보호를 위해 안전하게 2묶음 균등 분할");
});

test('chunker: selectSafePiggybackItems caps last-chunk empty item merge within budget and defers overflow', () => {
  const baseChunk = Array.from({ length: 52 }, (_, i) => ({ id: "b" + i, text: "基".repeat(30) })); // 52개, 1,560자
  const emptyCandidates = Array.from({ length: 25 }, (_, i) => ({ id: "e" + i, text: "空".repeat(30) })); // 25개, 750자

  const { fitted, deferred } = selectSafePiggybackItems(baseChunk, emptyCandidates);
  // 잔여 글자 예산: 2000 - 1560 = 440자 -> 30자 문장 최대 14개 수용 가능 (52 + 14 = 66 <= 68)
  assert.strictEqual(fitted.length, 14);
  assert.strictEqual(deferred.length, 11);
  const mergedCount = baseChunk.length + fitted.length;
  const mergedChars = [...baseChunk, ...fitted].reduce((s, x) => s + x.text.length, 0);
  assert.ok(mergedCount <= CHUNK_PIGGYBACK_MAX_ITEMS);
  assert.ok(mergedChars <= CHUNK_BUDGET_CHARACTERS);
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

test('separators: analyzeSeparatorSections correctly excludes preface on top and afterword on bottom', async () => {
  const { analyzeSeparatorSections, DEFAULT_GLOBAL_SEPARATORS } = await import('../src/core/separators.ts');

  // 1) 기본 구분선(DEFAULT_GLOBAL_SEPARATORS) 미등록 기호는 제외되지 않음
  const pNoSep = Array.from({ length: 50 }, (_, idx) => ({
    pid: `p${idx + 1}`,
    text: idx === 20 ? '***' : `본문 문장 ${idx + 1}`,
    element: {} as any,
  }));
  const resDefault = analyzeSeparatorSections(pNoSep, DEFAULT_GLOBAL_SEPARATORS);
  assert.strictEqual(resDefault.prefacePids.size, 0);
  assert.strictEqual(resDefault.afterwordPids.size, 0);

  // 2) 상단에 구분선이 1개만 있는 경우 (idx 2): 상단(p1, p2)과 구분선(p3)만 제외되고 본문(p4~p50)은 보존
  const pTopOnly = Array.from({ length: 50 }, (_, idx) => ({
    pid: `p${idx + 1}`,
    text: idx === 2 ? '――――' : `본문 문장 ${idx + 1}`,
    element: {} as any,
  }));
  const resTop = analyzeSeparatorSections(pTopOnly, [...DEFAULT_GLOBAL_SEPARATORS, '――――']);
  assert.strictEqual(resTop.prefacePids.size, 2);
  assert.strictEqual(resTop.prefacePids.has('p1'), true);
  assert.strictEqual(resTop.prefacePids.has('p2'), true);
  assert.strictEqual(resTop.separatorPids.has('p3'), true);
  assert.strictEqual(resTop.afterwordPids.size, 0);

  // 3) 하단에 구분선이 1개 있는 경우 (idx 20): 구분선(p21) 및 밑의 모든 후기 문단(p22~p50, 총 29문단) 제외
  const pBottomOnly = Array.from({ length: 50 }, (_, idx) => ({
    pid: `p${idx + 1}`,
    text: idx === 20 ? '――――' : `본문 문장 ${idx + 1}`,
    element: {} as any,
  }));
  const resBottom = analyzeSeparatorSections(pBottomOnly, [...DEFAULT_GLOBAL_SEPARATORS, '――――']);
  assert.strictEqual(resBottom.prefacePids.size, 0);
  assert.strictEqual(resBottom.separatorPids.has('p21'), true);
  assert.strictEqual(resBottom.afterwordPids.size, 29);
  assert.strictEqual(resBottom.afterwordPids.has('p22'), true);
  assert.strictEqual(resBottom.afterwordPids.has('p50'), true);
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

test('novelup: NovelUpScraper matches, isTocPage, extractEpisodeTitle', async () => {
  const { NovelUpScraper } = await import('../src/scrapers/novelup.ts');
  const scraper = new NovelUpScraper();

  assert.strictEqual(scraper.matches('https://novelup.plus/story/12345/678', 'novelup.plus'), true);
  assert.strictEqual(scraper.matches('https://kakuyomu.jp', 'kakuyomu.jp'), false);
  assert.strictEqual(scraper.getWorkKey('https://novelup.plus/story/987654/111'), 'novelup_987654');

  (globalThis as any).document = {
    getElementById(id: string) {
      if (id === 'episode_content') return { id: 'episode_content' };
      return null;
    },
    querySelector() { return null; },
  };
  try {
    assert.strictEqual(scraper.isTocPage('https://novelup.plus/story/987654/111', '/story/987654/111'), false);
  } finally {
    delete (globalThis as any).document;
  }

  (globalThis as any).document = {
    getElementById() { return null; },
    querySelector(sel: string) {
      if (sel.includes('storyList')) return {};
      return null;
    },
  };
  try {
    assert.strictEqual(scraper.isTocPage('https://novelup.plus/story/987654', '/story/987654'), true);
    assert.strictEqual(scraper.isTocPage('https://novelup.plus/story/987654/111', '/story/987654/111'), false);
  } finally {
    delete (globalThis as any).document;
  }
});

test('sidebar: sortSidebarDescending sorts rows in reverse DOM order and sortSidebar sorts in natural DOM order', () => { {
  function createMockRow(pid: string) {
    return { dataset: { pid }, tagName: 'TR' };
  }

  const r1 = createMockRow('p1');
  const r2 = createMockRow('p2');
  const r3 = createMockRow('p3');

  let tableChildren = [r1, r2, r3];
  const mockTableBody = {
    querySelectorAll(selector: string) {
      if (selector === 'tr[data-pid]') return tableChildren;
      return [];
    },
    set innerHTML(val: string) {
      if (val === '') tableChildren = [];
    },
    appendChild(node: any) {
      tableChildren.push(node);
    },
  };

  const pids = ['p1', 'p2', 'p3'];

  // Test sortSidebarDescending logic
  const rowsDesc = Array.from(mockTableBody.querySelectorAll('tr[data-pid]'));
  const pidMapDesc = new Map<string, any>(rowsDesc.map((row) => [row.dataset.pid, row]));
  mockTableBody.innerHTML = '';
  for (let i = pids.length - 1; i >= 0; i--) {
    const pid = pids[i];
    const row = pidMapDesc.get(pid);
    if (row) {
      mockTableBody.appendChild(row);
      pidMapDesc.delete(pid);
    }
  }
  assert.deepStrictEqual(tableChildren.map((r) => r.dataset.pid), ['p3', 'p2', 'p1']);

  // Test sortSidebar logic
  const rowsAsc = Array.from(mockTableBody.querySelectorAll('tr[data-pid]'));
  const pidMapAsc = new Map<string, any>(rowsAsc.map((row) => [row.dataset.pid, row]));
  mockTableBody.innerHTML = '';
  pids.forEach((pid) => {
    const row = pidMapAsc.get(pid);
    if (row) {
      mockTableBody.appendChild(row);
      pidMapAsc.delete(pid);
    }
  });
  assert.deepStrictEqual(tableChildren.map((r) => r.dataset.pid), ['p1', 'p2', 'p3']);
  }
});

test('syosetu: SyosetuScraper accurately resolves workKey, TOC URL and ignores .c-announce banners', () => {
  const scraper = new SyosetuScraper();
  assert.strictEqual(scraper.matches('https://ncode.syosetu.com/n5955en/128/', 'ncode.syosetu.com'), true);
  assert.strictEqual(scraper.getWorkKey('https://ncode.syosetu.com/n5955en/128/'), 'syosetu_n5955en');

  // getNovelTocUrl pattern fallback test
  const tocUrl = getNovelTocUrl(scraper, 'https://ncode.syosetu.com/n5955en/128/');
  assert.strictEqual(tocUrl, 'https://ncode.syosetu.com/n5955en/');
});



