// chunker.ts: 글자 수 및 토큰 예산 기반 가변 청킹 모듈

export const CHUNK_BUDGET_CHARACTERS = 2000; // 묶음당 최대 글자 수 예산 (약 1,000~1,500 토큰)
export const CHUNK_BUDGET_MAX_ITEMS = 45; // 묶음당 기본(표준) 문장 수 상한
export const CHUNK_HARD_MAX_ITEMS = 75; // 짧은 대화문 위주일 때 허용되는 절대 문장 수 상한 (1:1 인덱스 안전 마진)
export const CHUNK_DENSE_CHARS_THRESHOLD = 1300; // 표준 문장 수(45개) 도달 시 분할 발동 기준 글자 수

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * ⚡ 글자 수 / 토큰 예산 기반 가변 청킹 함수 (글자 수 연동 적응형 상한)
 * - 각 청크의 총 글자 수가 maxChars(기본 2,000자)를 초과하지 않도록 묶습니다.
 * - 단일 문장이 이미 maxChars를 초과하는 경우, 해당 문장 단독으로 단일 청크를 구성합니다.
 * - 문장 수 상한은 고정하지 않고 누적 글자 수의 밀도에 따라 가변 적용합니다:
 *   1) 문장이 아무리 짧아도 hardMaxItems(기본 75개)에 도달하면 LLM 1:1 매핑 누락 방지 안전을 위해 분할합니다.
 *   2) 문장 수가 maxItems(기본 45개)에 도달했더라도 누적 글자 수가 denseThreshold(기본 1,300자) 미만이면
 *      짧은 대화문 위주 구간으로 판정하여 최대 75문장까지 계속 담습니다.
 *   3) 문장 수가 maxItems(기본 45개) 이상이면서 누적 글자 수가 denseThreshold(기본 1,300자) 이상이면 충분한 분량으로 분할합니다.
 */
export function createBudgetChunks<T extends { text: string }>(
  items: T[],
  maxChars = CHUNK_BUDGET_CHARACTERS,
  maxItems = CHUNK_BUDGET_MAX_ITEMS,
  hardMaxItems?: number,
  denseCharsThreshold?: number
): T[][] {
  if (!items || items.length === 0) return [];

  // 호출자가 maxItems를 기본값과 다르게 임의 지정한 경우(예: 단위 테스트), 지정값을 엄격 상한으로 존중
  const resolvedHardLimit =
    hardMaxItems ??
    (maxItems !== CHUNK_BUDGET_MAX_ITEMS ? maxItems : CHUNK_HARD_MAX_ITEMS);
  const resolvedDenseThreshold =
    denseCharsThreshold ??
    (maxItems !== CHUNK_BUDGET_MAX_ITEMS ? 0 : CHUNK_DENSE_CHARS_THRESHOLD);

  const chunks: T[][] = [];
  let currentChunk: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemLength = item.text ? item.text.length : 0;

    const isCharOverflow = currentChars + itemLength > maxChars;
    const isHardItemLimit = currentChunk.length >= resolvedHardLimit;
    const isStandardItemLimit =
      currentChunk.length >= maxItems && currentChars >= resolvedDenseThreshold;

    if (
      currentChunk.length > 0 &&
      (isCharOverflow || isHardItemLimit || isStandardItemLimit)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(item);
    currentChars += itemLength;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}
