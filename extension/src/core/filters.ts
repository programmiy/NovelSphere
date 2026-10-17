// filters.ts: 텍스트 및 번역 품질 필터 (일본어, 기호 전용 fast-path, 간체자, 원문 복붙 감지)

export const JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]/;
export const PID_REGEX = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * 웹소설 본문 문단이 번역 대상인지 판별합니다.
 * 1. 일본어 문자 (히라가나, 가타카나, 한자) 포함 시 번역 대상.
 * 2. 대화/인용 괄호가 포함된 문장 (예: 「……」, 「……？」, 『……』, （……） 등).
 * 3. 소설 지문의 말줄임표/대시/부호로 구성된 침묵·호흡 문단.
 */
export function isTranslatableText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 1. 일본어 문자 (히라가나, 가타카나, 한자) 포함
  if (JAPANESE_REGEX.test(trimmed)) {
    return true;
  }

  // 2. 대화/인용 괄호가 포함된 문장 (예: 「……」, 「……？」, 『……』, （……）, 「――」 등)
  if (/[「」『』【】《》〈〉〔〕（）“”"']/.test(trimmed)) {
    return true;
  }

  // 3. 소설 지문의 말줄임표(…, ‥), 대시(―, —), 물음표/느낌표 등으로 구성된 침묵/호흡 문단
  if (/^[…‥・―—ー~～!?！？\s]+$/.test(trimmed)) {
    if (/[…‥―—]/.test(trimmed) || trimmed.length >= 2) {
      return true;
    }
  }

  return false;
}

/**
 * 문장 내에 의미 있는 문자(가나, 한자, 한글, 영문 등)가 전혀 없고,
 * 오직 문장부호, 괄호, 기호(「」『』…―!? 등) 및 공백으로만 이루어져 있는지 검사합니다.
 * -> Fast-path: API 번역 호출 없이 즉시 원문 그대로 번역문으로 자동 대입합니다.
 */
export function isPurePunctuationOnly(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // 히라가나, 가타카나, 한자(CJK), 한글, 알파벳 문자가 하나라도 있으면 순수 기호 문장이 아님
  if (/[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf\uac00-\ud7a3a-zA-Z]/.test(trimmed)) {
    return false;
  }

  return true;
}

export function hasJapaneseText(text: string): boolean {
  if (!text) return false;
  if (/^[っッ\s]+$/.test(text)) return false;
  return JAPANESE_REGEX.test(text);
}

export function isSymbolOrPunctOnly(text: string): boolean {
  if (!text) return true;
  return isPurePunctuationOnly(text);
}

const SIMPLIFIED_CHINESE_CHARS = new Set(
  '伤体国爱时门学书电见后发长气车开为过么这头经动问应现实关点进从总将内间来' +
    '说话对给会把没让样怎么去里两起带听说变' +
    '们这为么着说对让给样怎两带听变头经动问应关进从间长车门见书电伤发过时还开写话边东处' +
    '办帮宝备笔产场视认机业张节语虽随岁孙损缩锁态摊贪滩坛叹汤烫涛讨腾铁厅铜统图涂团颓腿' +
    '托脱洼袜网伪违围纬伟卫温闻稳涡窝呜坞妩雾务误锡牺袭习戏细虾吓显险线宪县响项销晓些泄' +
    '谢锌兴汹绣锈须虚嘘许叙绪续轩悬选询寻训讯逊压鸦鸭哑亚讶严岩盐厌扬阳养瑶摇尧遥窑药爷' +
    '页叶医亿义艺议译异荫阴银饮隐鹰婴莹营荧蝇赢颖哟拥佣咏踊涌痈优犹油邮铀游诱鱼渔娱与' +
    '屿吁驭狱誉预渊员圆园辕远怨愿约跃钥岳粤悦阅云匀陨运蕴酝晕韵杂灾载攒暂赞凿灶则择泽责' +
    '贼闸扎斋债毡战栈占粘涨帐账胀赵照折哲针侦珍真诊镇阵争征挣睁狰证支只织职执纸指掷帜质' +
    '钟终种肿重周洲昼朱猪诸诛烛瞩属著助铸筑抓拽专砖转赚庄桩装壮状锥追准浊纵邹阻组钻' +
    '别没么为什么怎么如果因为所以但是而且然后知道看见觉得'
);

const CHINESE_INDICATOR_CHARS = new Set(
  '的了是在我有个人这为说和时要你㑹后对着里去过发都经当与学进还没现她他们' +
    '写听头问话带让样给从关变总两应间长车门见书电伤动开条边东处办帮宝备笔产' +
    '场视认机实业张节语虽随岁孙损缩锁态滩坛叹汤讨体铁厅统图团脱网伪违围卫闻' +
    '稳务误袭习戏细显险线县响项销些谢兴须虚许叙续选询寻训压严岩盐厌扬阳养药' +
    '页叶医亿义艺议译异隐鹰婴营赢优犹油邮油游诱鱼渔娱与屿语吁狱誉预员圆园远怨' +
    '愿约跃运杂灾载暂赞则择泽责贼战张赵照针侦珍诊镇阵争征挣睁证只织职执纸指' +
    '质钟终种重周昼诸朱珠瞩助专砖转赚庄装壮状追准总组' +
    '吗吧呢啊么怎谁为什么怎么因为所以如果但是'
);

export function containsChinese(text: string): boolean {
  if (!text) return false;
  // 일본어 가나(히라가나/가타카나)가 포함되어 있다면 일본어이므로 중국어 판별 제외
  if (/[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]/.test(text)) return false;
  for (const ch of text) {
    if (SIMPLIFIED_CHINESE_CHARS.has(ch)) return true;
  }
  const hasHangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text);
  const hasHanja = /[\u4e00-\u9faf\u3400-\u4dbf]/.test(text);
  if (!hasHangul && hasHanja) {
    for (const ch of text) {
      if (CHINESE_INDICATOR_CHARS.has(ch)) return true;
    }
    if (/[，：“”]/.test(text)) return true;
  }
  return false;
}

export function checkIsVerbatimOrParaphrased(original: string, translated: string): boolean {
  if (!original || !translated) return false;
  const cleanOri = original.trim();
  const cleanTra = translated.trim();
  if (!cleanTra) return false;

  // 원문에 사실상 일본어(가나/한자)가 없거나 순수 기호/부호/문장부호(예: 「……」)인 경우 복제/변형 감지에서 제외
  if (!hasJapaneseText(cleanOri) || isSymbolOrPunctOnly(cleanOri)) {
    return false;
  }

  // 1. 공백 제거 후 완전 일치 (원문 복제)
  const noSpaceOri = cleanOri.replace(/\s+/g, '');
  const noSpaceTra = cleanTra.replace(/\s+/g, '');
  if (noSpaceOri === noSpaceTra) return true;

  // 2. 중국어 감지 (사용자 정의: 변형은 중국어 기준)
  if (containsChinese(cleanTra)) return true;

  // 3. 한글이 전혀 없고 일본어 가나가 포함된 경우 (원문 변형 및 패러프레이징)
  const hasHangul = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(cleanTra);
  const hasKana = /[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]/.test(cleanTra);
  if (!hasHangul && hasKana) {
    if (noSpaceOri.includes(noSpaceTra) || noSpaceTra.includes(noSpaceOri)) {
      return true;
    }
    return true;
  }

  return false;
}

export function isItemEmptyTranslation(
  item: any,
  translationCache?: Map<string, any>,
  userDeletedPids?: Set<string>,
  exclusionSet?: Set<string>,
  activeSeparators?: string[]
): boolean {
  if (!item) return false;
  const pid = String(item.id || item.pid || '');

  // 1. 사용자가 직접 삭제했거나 제외된 문장인지 확인
  if (pid && userDeletedPids && userDeletedPids.has(pid)) return false;
  if (pid && typeof document !== 'undefined') {
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row && (row.dataset.userDeleted === 'true' || row.getAttribute('data-user-deleted') === 'true')) {
      return false;
    }
  }

  const original = (item.original || item.text || '').trim();
  if (!original) return false;
  if (exclusionSet && exclusionSet.has(original)) return false;
  if (isPurePunctuationOnly(original)) return false;

  // 2. 캐시 내 유효한 번역문 존재 여부 확인
  let hasValidCached = false;
  if (pid && translationCache) {
    const cached = translationCache.get(pid);
    const cachedText = cached && cached.translated ? String(cached.translated).trim() : '';
    if (
      cachedText.length > 0 &&
      !cachedText.includes('번역 실패') &&
      !cachedText.includes('API 오류') &&
      !cachedText.includes('[검열로 인해 번역 생략]')
    ) {
      hasValidCached = true;
    }
  }

  // 3. 사이드바 DOM 내 유효한 번역문 존재 여부 확인
  let hasValidDOM = false;
  if (pid && typeof document !== 'undefined') {
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row) {
      const cell = row.querySelector('.translated-text');
      const domText = cell ? (cell.textContent || '').trim() : '';
      if (
        domText.length > 0 &&
        !domText.includes('⏳ 번역 중') &&
        !domText.includes('⏳ 재번역 중') &&
        !domText.includes('번역 실패') &&
        !domText.includes('API 오류') &&
        !domText.includes('[검열로 인해 번역 생략]')
      ) {
        hasValidDOM = true;
      }
    }
  }

  // 4. item 자체에 번역문이 유효한지 확인
  const itemTranslated = (item.translated || '').trim();
  const hasValidItem =
    itemTranslated.length > 0 &&
    !itemTranslated.includes('번역 실패') &&
    !itemTranslated.includes('API 오류');

  if (hasValidCached || hasValidDOM || hasValidItem) {
    return false;
  }

  return true;
}

export function getPendingEmptyItems(
  candidateItems: any[],
  excludeItemIds: Set<string> = new Set(),
  translationCache?: Map<string, any>,
  userDeletedPids?: Set<string>,
  exclusionSet?: Set<string>,
  activeSeparators?: string[]
): any[] {
  if (!Array.isArray(candidateItems) || candidateItems.length === 0) return [];

  const pending: any[] = [];
  const seenIds = new Set<string>();

  for (const item of candidateItems) {
    if (!item) continue;
    const pid = String(item.id || item.pid || '');
    if (!pid || excludeItemIds.has(pid) || seenIds.has(pid)) continue;

    if (isItemEmptyTranslation(item, translationCache, userDeletedPids, exclusionSet, activeSeparators)) {
      pending.push({
        id: pid,
        text: (item.original || item.text || '').trim(),
      });
      seenIds.add(pid);
    }
  }

  return pending;
}
