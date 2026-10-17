import test from 'node:test';
import assert from 'node:assert';
import { chunkArray, createBudgetChunks } from '../src/core/chunker.ts';
import { isTranslatableText, isPurePunctuationOnly, hasJapaneseText } from '../src/core/filters.ts';
import { calculateAdaptiveChunkDelay, calculateAdaptiveEpisodeDelay } from '../src/core/adaptive_throttle.ts';

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

