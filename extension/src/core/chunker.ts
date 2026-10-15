// chunker.ts: 글자 수 및 토큰 예산 기반 가변 청킹 모듈

export const CHUNK_BUDGET_CHARACTERS = 2000; // 묶음당 최대 글자 수 예산 (약 1,000~1,500 토큰)
export const CHUNK_BUDGET_MAX_ITEMS = 40; // 묶음당 최대 문장 수 상한

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * ⚡ 글자 수 / 토큰 예산 기반 가변 청킹 함수
 * - 각 청크의 총 글자 수가 maxChars(기본 2,000자)를 초과하지 않도록 묶습니다.
 * - 단일 문장이 이미 maxChars를 초과하는 경우, 해당 문장 단독으로 단일 청크를 구성합니다.
 * - 한 묶음의 문장 수가 maxItems(기본 40개)에 도달하면 즉시 분할합니다.
 */
export function createBudgetChunks<T extends { text: string }>(
  items: T[],
  maxChars = CHUNK_BUDGET_CHARACTERS,
  maxItems = CHUNK_BUDGET_MAX_ITEMS
): T[][] {
  if (!items || items.length === 0) return [];

  const chunks: T[][] = [];
  let currentChunk: T[] = [];
  let currentChars = 0;

  for (const item of items) {
    const itemLength = item.text ? item.text.length : 0;

    if (
      currentChunk.length > 0 &&
      (currentChars + itemLength > maxChars || currentChunk.length >= maxItems)
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
