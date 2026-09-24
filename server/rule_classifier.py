import re
import unicodedata
from typing import Optional, List, Tuple

# 정규식 패턴 정의
HANGUL_RE = re.compile(r'[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]')
KANA_RE = re.compile(r'[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff]') # 히라가나, 가타카나
HANJA_RE = re.compile(r'[\u4e00-\u9faf\u3400-\u4dbf]')
LATIN_RE = re.compile(r'[a-zA-Z]')

# 한국에서 쓰이지 않는 대표적인 중국어 간체자(Simplified Chinese) 집합
SIMPLIFIED_CHINESE_SET = set(
    '伤体国爱时门学书电见后发长气车开为过么这头经动问应现实关点进从总将内间来'
    '说话对给会把没让样怎么去里两起带听说变'
)

def normalize_text(text: Optional[str]) -> str:
    """NFKC 유니코드 정규화 및 앞뒤 공백 제거"""
    return unicodedata.normalize('NFKC', text or '').strip()

def is_symbol_or_punct_only(text: Optional[str]) -> bool:
    """
    글자(의미 있는 언어 문자)가 아닌 기호, 문장부호, 공백, 숫자, 반복 구분선만으로 구성되었는지 검사합니다.
    - 「…………」, 「……？」, 「！？！？！？！？？？！？！！！！？」
    - ◆◆◆, ***, --------------------, ーーーーー, 〇　　　〇　　　〇
    - 숨소리/감탄 단독 소자(っ, ッ 등)만 기호 사이에 있는 경우(「……っ！」 등)
    """
    if not text:
        return True
    norm = normalize_text(text)
    # 1. 공백, 숫자, ASCII 기호/문장부호, 유니코드 구두점(P)/기호(S)/공백(Z)
    # 2. 일본어 전각 구분자/기호 (〇, ー, ――, ・ 등)
    cleaned = re.sub(
        r'[\s\d_〇ー―~～\W'
        r'\u2000-\u206f\u25a0-\u25ff\u2600-\u26ff\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]',
        '',
        norm
    )
    # 기호 사이에 단독으로 끼어있는 숨소리 단독 소자(っ, ッ 등) 제거
    cleaned = re.sub(r'^[っッ]+$', '', cleaned)
    return len(cleaned) == 0

def has_japanese_text(text: Optional[str]) -> bool:
    """
    텍스트에 일본어 문자(히라가나, 가타카나, 한자)가 최소 1자 이상 포함되어 있는지 검사합니다.
    순수 영문(Fin, Title 등), 숫자, 기호만 있는 문장은 번역 누락 대상이 아닙니다.
    """
    if not text:
        return False
    norm = normalize_text(text)
    return bool(KANA_RE.search(norm) or HANJA_RE.search(norm))

def is_verbatim_copy(original: str, translated: Optional[str]) -> bool:
    """
    원문과 번역문이 단순 원문 복붙인지 판별합니다.
    - 순수 기호/부호/문장부호 문장(예: 「……!」, ◆◆◆ 등)은 정상 번역으로 간주하여 제외
    - 원문에 일본어 글자(가나/한자)가 최소 1자 이상 있고, 번역문이 원문과 동일하거나 한글 없이 일본어가 그대로 유지된 경우 True
    """
    if not translated or not str(translated).strip():
        return False

    n_ori = normalize_text(original)
    n_tra = normalize_text(translated)

    if is_symbol_or_punct_only(n_ori) or not has_japanese_text(n_ori):
        return False
    if is_symbol_or_punct_only(n_tra):
        return False

    # 1. 완전 일치 또는 공백 제거 후 완전 일치
    if n_ori == n_tra or re.sub(r'\s+', '', n_ori) == re.sub(r'\s+', '', n_tra):
        return True

    # 2. 한글이 1글자도 없고 일본어 가나가 포함된 상태에서 원문과 대부분 일치하는 경우
    has_hangul = bool(HANGUL_RE.search(n_tra))
    if not has_hangul and bool(KANA_RE.search(n_tra)):
        if n_ori in n_tra or n_tra in n_ori:
            return True

    return False

def extract_untranslated_keywords(original: str, translated: str) -> List[str]:
    """
    번역문에 남아있는 미번역 일본어 단어(가나 연속 토큰) 또는 간체자 키워드를 추출합니다.
    유사 사례 추천 단락 검색 시 키워드로 활용됩니다.
    """
    n_tra = normalize_text(translated)
    keywords = []
    
    # 1. 가나 단어 추출 (단독 조사 포함 최대 10자, 단독 'っ' 제외)
    kana_tokens = re.findall(r'[\u3040-\u309f\u30a0-\u30fa]{1,10}', n_tra)
    for tok in kana_tokens:
        tok_clean = tok.strip()
        if tok_clean and tok_clean not in ('っ', 'ッ') and tok_clean not in keywords:
            keywords.append(tok_clean)
            
    # 2. 간체자 추출
    for ch in n_tra:
        if ch in SIMPLIFIED_CHINESE_SET and ch not in keywords:
            keywords.append(ch)
            
    return keywords

def classify_translation(original: str, translated: Optional[str]) -> str:
    """
    AI 없이 100% 결정론적 유니코드/정규식 룰베이스로 번역 품질을 분류합니다.

    반환값:
    - 'verbatim_or_empty': 규칙 1 (원문 그대로 반환 또는 빈 번역)
    - 'paraphrased_jp': 규칙 2 (원문 변형: 한국어 없이 일본어 가나가 포함된 일본어 패러프레이징)
    - 'other_language': 규칙 3 (다른 언어로 번역: 간체자 혼입 또는 한국어 없이 타언어/한자만 존재)
    - 'partial_untranslated': 규칙 4 (일부 번역 안 함: 한국어가 존재하지만 일본어 가나가 잔류)
    - 'normal': 정상 번역
    """
    n_ori = normalize_text(original)
    
    # 0. 원문 자체가 순수 기호/문장부호/구분선/숫자이거나 일본어 글자(가나/한자)가 없는 경우:
    # 번역 대상 문장이 아니므로 그대로 유지되는 것이 정상입니다.
    if is_symbol_or_punct_only(n_ori) or not has_japanese_text(n_ori):
        return 'normal'

    # 원문에 실제 일본어 문장이 있었는데 번역문이 비어있는 경우 -> 규칙 1 (빈 번역)
    if not translated or not str(translated).strip():
        return 'verbatim_or_empty'

    n_tra = normalize_text(translated)

    # 1. 규칙 1: 원문 그대로 반환 (원문에 일본어 글자가 있는데 번역문이 원문과 동일)
    if n_ori == n_tra or re.sub(r'\s+', '', n_ori) == re.sub(r'\s+', '', n_tra):
        return 'verbatim_or_empty'

    # 원문에 실제 문장이 있었는데 번역문이 순수 기호/부호만으로 바뀐 경우 (번역 누락)
    if is_symbol_or_punct_only(n_tra):
        return 'verbatim_or_empty'

    has_hangul = bool(HANGUL_RE.search(n_tra))
    has_kana = bool(KANA_RE.search(n_tra))
    
    # 2. 한국어(Hangul)가 전혀 없는 경우
    if not has_hangul:
        if has_kana:
            # 일본어 가나가 포함되어 있으면 원문 변형 (동일 언어 패러프레이징)
            return 'paraphrased_jp'
        else:
            # 한글도 없고 가나도 없는데 기호 외 글자가 있음 -> 타 언어로 번역 (영어, 간체자 등)
            return 'other_language'
            
    # 3. 한국어가 존재하는 경우
    if has_kana:
        # 한국어가 있는데 일본어 가나가 섞여 있음 -> 일부 번역 안 함 (조사/어휘 누출)
        return 'partial_untranslated'
        
    # 간체자 등 중국어 글자 혼입 여부 체크 -> 다른 언어로 번역
    if set(n_tra).intersection(SIMPLIFIED_CHINESE_SET):
        return 'other_language'
        
    return 'normal'


QUOTE_PAIRS = [
    ('"', '"'),
    ("'", "'"),
    ('“', '”'),
    ('‘', '’'),
    ('«', '»'),
    ('「', '»'),
]

def count_leading_brackets(s: str, char: str = '「') -> int:
    """문자열 시작 부분의 특정 괄호 문자 개수를 반환합니다."""
    count = 0
    for c in s:
        if c == char:
            count += 1
        else:
            break
    return count

def count_trailing_brackets(s: str, char: str = '」') -> int:
    """문자열 끝 부분의 특정 괄호 문자 개수를 반환합니다."""
    count = 0
    for c in reversed(s):
        if c == char:
            count += 1
        else:
            break
    return count

def restore_brackets(original: Optional[str], translated: Optional[str]) -> Optional[str]:
    """
    원문이 「%」로 시작하고 끝나는 대사 문장인데
    번역문에 「」 괄호가 누락되었거나 일반 따옴표("", '', “”, ‘’, «»)로 치환/누락된 경우,
    결정론적 룰베이스로 「」 괄호를 복원/추가합니다.

    사용자 규칙:
    - 문장의 처음과 끝부분이 「%」인 대사 문장에만 한정 적용 (문장 중간 괄호나 독백 제외).
    """
    if not original or not translated:
        return translated

    o = original.strip()
    t = str(translated).strip()
    if not t:
        return translated

    # 원문 조건: 반드시 「로 시작하고 」로 끝나야 함
    if not (o.startswith('「') and o.endswith('」')):
        return translated

    o_open = count_leading_brackets(o, '「')
    o_close = count_trailing_brackets(o, '」')
    if o_open == 0 or o_close == 0:
        return translated

    k = min(o_open, o_close)
    target_open = '「' * k
    target_close = '」' * k

    # 이미 「와 」로 둘러싸여 있는 경우
    if t.startswith('「') and t.endswith('」'):
        return translated

    # HTML 태그(<span> 등)로 감싸져 있는 경우 내부 텍스트 재귀 처리
    html_match = re.match(r'^(<[a-zA-Z0-9]+[^>]*>)(.*)(</[a-zA-Z0-9]+>)$', t, re.DOTALL)
    if html_match:
        tag_open, inner, tag_close = html_match.groups()
        fixed_inner = restore_brackets(o, inner)
        return f"{tag_open}{fixed_inner}{tag_close}"

    # 화자 표기 접두어가 있는 경우 (예: 쿄코「...」)
    if '「' in t and t.endswith('」'):
        return translated

    # 따옴표("", '', “”, ‘’, «», 「»)로 둘러싸인 경우 해당 따옴표 제거 후 「」로 치환
    for q_open, q_close in QUOTE_PAIRS:
        if t.startswith(q_open) and t.endswith(q_close) and len(t) >= len(q_open) + len(q_close):
            inner = t[len(q_open):-len(q_close)].strip()
            return f"{target_open}{inner}{target_close}"

    # 마침표/물음표 등으로 닫는 괄호 뒤에 붙은 경우 (예: 「...」.)
    if t.startswith('「') and t.rstrip('.!? ').endswith('」'):
        return translated

    # 시작만 「인 경우: 닫는 괄호 」가 없으면 추가
    if t.startswith('「') and not t.endswith('」'):
        if t.count('「') > t.count('」'):
            return f"{t}{target_close * (t.count('「') - t.count('」'))}"
        return translated

    # 끝만 」인 경우: 여는 괄호 「가 없으면 추가
    if t.endswith('」') and not t.startswith('「'):
        if '「' not in t:
            return f"{target_open}{t}"
        return translated

    # 양쪽 모두 괄호가 없는 경우 (일반 텍스트)
    if '「' not in t and '」' not in t:
        return f"{target_open}{t}{target_close}"

    return translated

def batch_restore_brackets_in_db(db_conn) -> Tuple[int, int]:
    """
    SQLite 데이터베이스 커넥션을 전달받아,
    original이 「%」로 시작하고 끝나지만 translated에 괄호가 누락/변형된 레코드를
    스캔하여 룰베이스로 일괄 복원합니다.
    반환값: (scanned_count, updated_count)
    """
    cursor = db_conn.cursor()
    cursor.execute('''
        SELECT id, original, translated FROM translations 
        WHERE original LIKE '「%」'
          AND (translated NOT LIKE '「%」' OR translated IS NULL)
    ''')
    rows = cursor.fetchall()
    
    updated_items = []
    for row in rows:
        if isinstance(row, dict):
            r_id, orig, trans = row['id'], row['original'], row['translated']
        else:
            r_id, orig, trans = row[0], row[1], row[2]
            
        fixed = restore_brackets(orig, trans)
        if fixed != trans:
            updated_items.append((fixed, r_id))
            
    if updated_items:
        cursor.executemany(
            'UPDATE translations SET translated = ? WHERE id = ?',
            updated_items
        )
        db_conn.commit()
        
    return len(rows), len(updated_items)

