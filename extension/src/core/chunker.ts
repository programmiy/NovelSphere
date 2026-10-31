// chunker.ts: 사전 전수 계획 기반 스마트 동적 균형 청킹 모듈 (Global Pre-planned Balanced Chunker)

export const CHUNK_BUDGET_CHARACTERS = 2000; // 묶음당 절대 글자 수 상한 (약 1,000~1,500 토큰)
export const CHUNK_SOFT_BUDGET_CHARACTERS = 1840; // 다중 묶음 계획 시 스위트 스폿 소프트 글자 수 상한 (verbatim·타임아웃 방어 및 자연 경계 여유 마진)
export const CHUNK_SINGLE_SHOT_MAX_CHARS = 1850; // 1묶음 원샷 흡수 시 최대 허용 글자 수
export const CHUNK_BUDGET_MAX_ITEMS = 45; // 고밀도 서술문 기준 표준 문장 수 상한 (하위 호환 상수)
export const CHUNK_SINGLE_SHOT_DENSE_ITEMS = 54; // 1묶음 원샷 흡수 시 서술문 최대 문장 수 (10초반 자투리 흡수 스위트 스폿)
export const CHUNK_HARD_MAX_ITEMS = 75; // 짧은 대화문 위주일 때 허용되는 절대 문장 수 상한 (1:1 인덱스 안전 마진)
export const CHUNK_DENSE_CHARS_THRESHOLD = 1300; // 밀도 판정 기준 글자 수 (하위 호환 유지)
export const CHUNK_OUTLIER_CHAR_THRESHOLD = 1400; // 단일 거대 문장 사전 격리 임계 글자 수
export const CHUNK_PIGGYBACK_MAX_ITEMS = 68; // 마지막 청크 미완료 빈칸 합류(Piggyback) 시 안전 문장 수 상한

export interface BudgetChunkOptions {
  hardMaxItems?: number;
  denseCharsThreshold?: number;
  isRetranslation?: boolean;
  enableNaturalBoundary?: boolean;
  firstChunkWeightFactor?: number;
}

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

const DIALOGUE_START_RE = /^[\s\u3000]*[「『（(“"']/u;
const SCENE_BREAK_CONTENT_RE = /[\p{L}\p{N}]/u;

/**
 * 대사/독백 인용부호로 시작하는 단락인지 판별합니다.
 */
export function isDialogueLine(text: string): boolean {
  if (!text) return false;
  return DIALOGUE_START_RE.test(text);
}

/**
 * 장면 전환 기호(***, ◇, ◆, ―― 등)나 공백만으로 이루어진 경계 단락인지 판별합니다.
 */
export function isSceneBreakLine(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 24) return false;
  return !SCENE_BREAK_CONTENT_RE.test(trimmed);
}

/**
 * 마지막 청크에 이전 미완료 빈칸(emptyItems)을 합류시킬 때,
 * 하드 글자 수 상한 및 안전 문장 수 상한을 초과하지 않는 범위까지만 안전하게 선별합니다.
 * 초과분(deferred)은 번역 완료 직전 보완 꾸러미 단계로 자연스럽게 이관됩니다.
 */
export function selectSafePiggybackItems<T extends { text: string }>(
  baseChunk: T[],
  candidateEmptyItems: T[],
  maxChars = CHUNK_BUDGET_CHARACTERS,
  maxItems = CHUNK_PIGGYBACK_MAX_ITEMS
): { fitted: T[]; deferred: T[] } {
  if (!candidateEmptyItems || candidateEmptyItems.length === 0) {
    return { fitted: [], deferred: [] };
  }

  let currentChars = baseChunk.reduce((sum, it) => sum + (it.text ? it.text.length : 0), 0);
  let currentCount = baseChunk.length;

  const fitted: T[] = [];
  const deferred: T[] = [];

  for (const item of candidateEmptyItems) {
    const itemLen = item.text ? item.text.length : 0;
    if (currentCount + 1 <= maxItems && currentChars + itemLen <= maxChars) {
      fitted.push(item);
      currentCount += 1;
      currentChars += itemLen;
    } else {
      deferred.push(item);
    }
  }

  return { fitted, deferred };
}

/**
 * 연속된 일반 문장 세그먼트를 제약 조건부 동적 계획법(Constrained Optimal Partitioning DP)으로
 * 정확히 targetK개(불가능 시 자동 증분)의 균형 잡힌 청크로 분할합니다.
 */
function solveBalancedPartition<T extends { text: string }>(
  seg: T[],
  prefixChars: Int32Array,
  initialK: number,
  effectiveHardCharLimit: number,
  effectiveSoftCharLimit: number,
  resolvedHardLimit: number,
  isCustomLimits: boolean,
  enableNaturalBoundary: boolean,
  firstChunkWeightFactor: number
): T[][] {
  const n = seg.length;
  const totalChars = prefixChars[n];

  const boundaryAdjust = new Float64Array(n + 1);
  if (enableNaturalBoundary) {
    for (let i = 1; i < n; i++) {
      const prevText = seg[i - 1].text || '';
      const nextText = seg[i].text || '';
      if (isSceneBreakLine(prevText) || isSceneBreakLine(nextText)) {
        boundaryAdjust[i] = -0.08; // 장면 전환 경계 최우선 스내핑 보너스
      } else {
        const prevDiag = isDialogueLine(prevText);
        const nextDiag = isDialogueLine(nextText);
        if (prevDiag && nextDiag) {
          boundaryAdjust[i] = 0.06; // 연속 대화 티키타카 중간 절단 회피 페널티
        } else if (prevDiag && !nextDiag) {
          boundaryAdjust[i] = -0.03; // 대사 종료 후 서술문 전환 보너스
        }
      }
    }
  }

  const charPressure = totalChars > 0 ? Math.min(1, totalChars / Math.max(1, effectiveHardCharLimit)) : 0;
  const charWeight = totalChars > 0 ? (isCustomLimits ? 0.65 * charPressure : 0.65) : 0;
  const itemWeight = 1 - charWeight;

  for (let targetK = Math.max(1, Math.min(initialK, n)); targetK <= n; targetK++) {
    const targetShares = new Float64Array(targetK + 1);
    if (!isCustomLimits && targetK >= 2 && firstChunkWeightFactor < 1.0) {
      const firstShare = (1 / targetK) * firstChunkWeightFactor;
      const restShare = (1 - firstShare) / (targetK - 1);
      targetShares[1] = firstShare;
      for (let c = 2; c <= targetK; c++) targetShares[c] = restShare;
    } else {
      for (let c = 1; c <= targetK; c++) targetShares[c] = 1 / targetK;
    }

    const stride = n + 1;
    const dp = new Float64Array((targetK + 1) * stride);
    dp.fill(Infinity);
    const parent = new Int32Array((targetK + 1) * stride);
    dp[0] = 0;

    for (let c = 1; c <= targetK; c++) {
      const maxI = n - (targetK - c);
      const prevRowOffset = (c - 1) * stride;
      const currRowOffset = c * stride;
      const targetShare = targetShares[c];

      for (let i = c; i <= maxI; i++) {
        const minP = Math.max(c - 1, i - resolvedHardLimit);
        let bestCost = Infinity;
        let bestP = -1;

        for (let p = i - 1; p >= minP; p--) {
          const segChars = prefixChars[i] - prefixChars[p];
          if (segChars > effectiveHardCharLimit) {
            break; // p가 감소할수록 segChars는 단조 증가하므로 즉시 가지치기
          }

          const prevCost = dp[prevRowOffset + p];
          if (prevCost === Infinity) continue;

          const segLen = i - p;
          const actualShare =
            charWeight * (totalChars > 0 ? segChars / totalChars : 0) + itemWeight * (segLen / n);
          const diff = actualShare - targetShare;
          let cost = prevCost + diff * diff * 100;

          if (!isCustomLimits) {
            // 자투리 청크(12문장 미만) 생성 강력 억제
            if (n >= 30 && segLen < 12) {
              const shortfall = 12 - segLen;
              cost += shortfall * shortfall * 0.25;
            }
            // 소프트 글자 수 상한 초과 시 탄성 페널티 부과
            if (segChars > effectiveSoftCharLimit) {
              const overRatio = (segChars - effectiveSoftCharLimit) / Math.max(1, effectiveHardCharLimit);
              cost += overRatio * overRatio * 25;
            }
          }

          if (i < n) {
            cost += boundaryAdjust[i];
          }

          if (cost < bestCost) {
            bestCost = cost;
            bestP = p;
          }
        }

        if (bestP !== -1) {
          dp[currRowOffset + i] = bestCost;
          parent[currRowOffset + i] = bestP;
        }
      }
    }

    if (dp[targetK * stride + n] < Infinity) {
      const result: T[][] = new Array(targetK);
      let curr = n;
      for (let c = targetK; c >= 1; c--) {
        const p = parent[c * stride + curr];
        result[c - 1] = seg.slice(p, curr);
        curr = p;
      }
      return result;
    }
  }

  // 안전 폴백: 어떠한 예외 상황에서도 하드 상한을 준수하는 순차 분할 보장
  const fallback: T[][] = [];
  let cur: T[] = [];
  let curChars = 0;
  for (const item of seg) {
    const len = item.text ? item.text.length : 0;
    if (cur.length > 0 && (curChars + len > effectiveHardCharLimit || cur.length >= resolvedHardLimit)) {
      fallback.push(cur);
      cur = [];
      curChars = 0;
    }
    cur.push(item);
    curChars += len;
  }
  if (cur.length > 0) fallback.push(cur);
  return fallback;
}

/**
 * ⚡ 사전 전수 계획 기반 스마트 동적 균형 청킹 함수
 * - 번역 시작 전 회차 전체 문장 수와 글자 수 밀도를 사전에 조망하여 자투리 묶음(10개 초반)을 원천 제거합니다.
 * - 핵심 보호 메커니즘:
 *   1) 단일 거대 문장(Outlier) 사전 격리: 초장문 단락이 평균과 예산을 왜곡하지 않도록 독립 청크로 분리합니다.
 *   2) 어텐션 스위트 스폿 원샷 흡수: 50~54문장(대화문 최대 72문장) & 1,800자 이내 분량은 불필요한 분할 없이 1묶음으로 완결합니다.
 *   3) 다중 묶음 듀얼 균등 배분(DP): 2묶음 이상일 때 45+12나 45+45+15 대신 29+28, 50+55, 35+35+35 형태로 균등 배분하여
 *      API 호출 횟수를 절감하고 verbatim 역소모 및 MV3 타임아웃 리스크를 차단합니다.
 *   4) 자연 경계 스내핑 & TTFB 가속: 연속 대사 티키타카 절단을 피하고 1번 묶음을 살짝 가볍게 배분해 첫 화면 응답을 앞당깁니다.
 *   5) 재번역 모델 비대칭 보호: isRetranslation 시 상위 모델 레이턴시·503 방어를 위해 보수적 예산을 적용합니다.
 */
export function createBudgetChunks<T extends { text: string }>(
  items: T[],
  maxChars = CHUNK_BUDGET_CHARACTERS,
  maxItems = CHUNK_BUDGET_MAX_ITEMS,
  hardMaxItemsOrOptions?: number | BudgetChunkOptions,
  denseCharsThreshold?: number
): T[][] {
  if (!items || items.length === 0) return [];
  if (items.length === 1) return [[items[0]]];

  const opts: BudgetChunkOptions =
    typeof hardMaxItemsOrOptions === 'object' && hardMaxItemsOrOptions !== null
      ? hardMaxItemsOrOptions
      : { hardMaxItems: hardMaxItemsOrOptions, denseCharsThreshold };

  const explicitHardMax = opts.hardMaxItems;
  const isCustomLimits =
    maxChars !== CHUNK_BUDGET_CHARACTERS ||
    maxItems !== CHUNK_BUDGET_MAX_ITEMS ||
    explicitHardMax !== undefined ||
    opts.denseCharsThreshold !== undefined;

  const isRetranslation = Boolean(opts.isRetranslation);
  const resolvedHardLimit = Math.max(
    1,
    explicitHardMax ??
      (maxItems !== CHUNK_BUDGET_MAX_ITEMS ? maxItems : isRetranslation ? 60 : CHUNK_HARD_MAX_ITEMS)
  );

  const effectiveHardCharLimit = Math.max(
    1,
    !isCustomLimits && isRetranslation ? Math.min(maxChars, 1750) : maxChars
  );
  const effectiveSoftCharLimit = isCustomLimits
    ? effectiveHardCharLimit
    : isRetranslation
      ? 1550
      : CHUNK_SOFT_BUDGET_CHARACTERS;
  const singleShotCharLimit = isCustomLimits
    ? effectiveHardCharLimit
    : isRetranslation
      ? 1600
      : CHUNK_SINGLE_SHOT_MAX_CHARS;

  const enableNaturalBoundary = !isCustomLimits && opts.enableNaturalBoundary !== false;
  const firstChunkWeightFactor = opts.firstChunkWeightFactor ?? 0.92;

  const lengths = new Int32Array(items.length);
  for (let i = 0; i < items.length; i++) {
    lengths[i] = items[i].text ? items[i].text.length : 0;
  }

  const partitionNormalSegment = (seg: T[]): T[][] => {
    const n = seg.length;
    if (n === 0) return [];
    if (n === 1) return [seg];

    const prefixChars = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      prefixChars[i + 1] = prefixChars[i] + (seg[i].text ? seg[i].text.length : 0);
    }
    const totalChars = prefixChars[n];

    if (isCustomLimits) {
      if (n <= resolvedHardLimit && totalChars <= effectiveHardCharLimit) {
        return [seg];
      }
      const k = Math.max(
        2,
        Math.ceil(totalChars / effectiveHardCharLimit),
        Math.ceil(n / resolvedHardLimit)
      );
      return solveBalancedPartition(
        seg,
        prefixChars,
        k,
        effectiveHardCharLimit,
        effectiveSoftCharLimit,
        resolvedHardLimit,
        true,
        false,
        1.0
      );
    }

    const avgChars = totalChars / n;
    // 밀도 비율: 18자 이하(0.0, 대화문 위주) ~ 34자 이상(1.0, 고밀도 서술문) 선형 보간
    const densityRatio = Math.max(0, Math.min(1, (avgChars - 18) / (34 - 18)));

    const maxDialogueSingle = isRetranslation ? 58 : 74;
    const maxDenseSingle = isRetranslation ? 45 : CHUNK_SINGLE_SHOT_DENSE_ITEMS;
    const singleShotItemCap = Math.min(
      resolvedHardLimit,
      Math.round(maxDialogueSingle - densityRatio * (maxDialogueSingle - maxDenseSingle))
    );

    // 1묶음 원샷 흡수 스위트 스폿 판정 (JSON 구조 오버헤드 여유 마진 포함)
    if (
      n <= singleShotItemCap &&
      totalChars <= singleShotCharLimit &&
      totalChars + n * 2 <= effectiveHardCharLimit
    ) {
      return [seg];
    }

    const maxDialogueMulti = isRetranslation ? 52 : 70;
    const maxDenseMulti = isRetranslation ? 42 : 50;
    const multiChunkItemCap = Math.min(
      resolvedHardLimit,
      Math.round(maxDialogueMulti - densityRatio * (maxDialogueMulti - maxDenseMulti))
    );

    const k = Math.max(
      2,
      Math.ceil(totalChars / effectiveSoftCharLimit),
      Math.ceil(n / multiChunkItemCap)
    );

    return solveBalancedPartition(
      seg,
      prefixChars,
      k,
      effectiveHardCharLimit,
      effectiveSoftCharLimit,
      resolvedHardLimit,
      false,
      enableNaturalBoundary,
      firstChunkWeightFactor
    );
  };

  // 단일 거대 문장(Outlier) 사전 격리 및 연속 일반 세그먼트 청킹
  const outlierCharCutoff = isRetranslation ? 1250 : CHUNK_OUTLIER_CHAR_THRESHOLD;
  const allChunks: T[][] = [];
  let normalBuffer: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const len = lengths[i];
    const cannotMergePrev = i === 0 || lengths[i - 1] + len > effectiveHardCharLimit;
    const cannotMergeNext = i === items.length - 1 || len + lengths[i + 1] > effectiveHardCharLimit;
    const isOutlier =
      len >= effectiveHardCharLimit ||
      (!isCustomLimits && len >= outlierCharCutoff) ||
      (cannotMergePrev && cannotMergeNext);

    if (isOutlier) {
      if (normalBuffer.length > 0) {
        allChunks.push(...partitionNormalSegment(normalBuffer));
        normalBuffer = [];
      }
      allChunks.push([items[i]]);
    } else {
      normalBuffer.push(items[i]);
    }
  }

  if (normalBuffer.length > 0) {
    allChunks.push(...partitionNormalSegment(normalBuffer));
  }

  return allChunks;
}
