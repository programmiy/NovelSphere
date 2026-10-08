"""
Dictionary integration and accumulated translation corpus lookup service.
Enables translators and language learners to explore dictionary definitions
alongside real-world novel translation examples from the accumulated database.
STRICTLY NO AI (100% deterministic, rule-based & SQLite queries).
"""

import re
import random
from typing import Optional, Dict, Any, List
from urllib.parse import quote
from collections import Counter
from sqlalchemy.orm import Session
from sqlalchemy import func

from server.models import Translation

# Common Korean stop words to exclude from candidate term extraction
KOREAN_STOPWORDS = {
    "이", "그", "저", "것", "수", "등", "들", "및", "더", "또", "을", "를", "이", "가",
    "은", "는", "에", "의", "로", "으로", "에서", "에게", "과", "와", "도", "만", "하다",
    "했다", "하고", "하면", "하는", "이다", "있다", "없다", "되어", "되고", "된다", "않다",
    "같다", "때문", "자신", "그녀", "사람", "하나", "어떤", "지금", "다시", "매우", "너무",
    "어디", "누구", "무엇", "어떻게", "왜", "그것", "이것", "저것", "정말", "진짜"
}


def get_dictionary_links(keyword: str) -> Dict[str, str]:
    """
    주어진 일본어/한국어 검색어에 대한 주요 온라인 사전 다이렉트 검색 링크를 생성합니다.
    - 네이버 일본어사전: 가장 대중적인 일한/한일 사전 (예문/단어/한자 통합)
    - Weblio 일본어사전: 일본 현지 국어사전 및 유의어/용례사전
    - Jisho.org: 전세계 표준 일영/한자/요미가나/JLPT 레벨 사전
    - Goo 辞書: 일본 쇼가쿠칸 디지털 대사전 기반 정통 일일사전
    """
    kw = (keyword or "").strip()
    if not kw:
        return {
            "naver": "https://ja.dict.naver.com/",
            "weblio": "https://www.weblio.jp/",
            "jisho": "https://jisho.org/",
            "goo": "https://dictionary.goo.ne.jp/"
        }

    encoded = quote(kw)
    return {
        "naver": f"https://ja.dict.naver.com/#/search?range=all&q={encoded}",
        "weblio": f"https://www.weblio.jp/content/{encoded}",
        "jisho": f"https://jisho.org/search/{encoded}",
        "goo": f"https://dictionary.goo.ne.jp/srch/jn/{encoded}/m0u/"
    }


def extract_korean_candidate_terms(examples: List[Dict[str, Any]], keyword: str) -> List[str]:
    """
    검색된 번역문들 속에서 자주 함께 등장하는 핵심 한국어 어휘 후보(최대 5개)를 통계적으로 추출합니다.
    수동 번역 교정 시 대응되는 한국어 번역어를 빠르게 파악할 수 있도록 돕습니다.
    (100% 룰베이스 통계, No AI)
    """
    if not examples:
        return []

    word_counts = Counter()
    korean_word_regex = re.compile(r'[가-힣]{2,}')

    for ex in examples:
        trans = ex.get("translated", "")
        if not trans:
            continue
        words = korean_word_regex.findall(trans)
        for w in words:
            if w not in KOREAN_STOPWORDS and w != keyword:
                word_counts[w] += 1

    # 등장 빈도 상위 5개 어휘 추출 (최소 2회 이상 등장한 것 우선)
    candidates = []
    for word, count in word_counts.most_common(8):
        if count >= 2 or len(examples) <= 2:
            candidates.append(word)
        if len(candidates) >= 5:
            break

    return candidates


def search_dictionary_corpus(
    keyword: str,
    folder: Optional[str] = None,
    exclude_id: Optional[int] = None,
    limit: int = 25,
    db: Session = None
) -> Dict[str, Any]:
    """
    키워드(일본어 단어 또는 한국어 표현)를 기반으로:
    1. 온라인 주요 사전 링크 세트 반환
    2. 지금까지 누적된 translations DB에서 실제 소설 용례 검색 (현재 소설 우선 정렬)
    3. 누적 등장 빈도 및 학습 난이도/빈도 통계 산출
    4. 번역문 내 주요 대응 어휘 후보 추출
    (전 과정 No AI, 100% SQLite & 룰베이스)
    """
    raw_kw = (keyword or "").strip()
    # 대괄호, 따옴표 등 단순 장식 기호 제거
    kw = re.sub(r'^[「『（(\[\"\'\s]+|[」』）)\]\"\'\s]+$', '', raw_kw)
    if not kw:
        return {
            "keyword": "",
            "total_occurrences": 0,
            "novel_count": 0,
            "frequency_level": "미입력",
            "dictionary_links": get_dictionary_links(""),
            "candidate_terms": [],
            "examples": []
        }

    # 1. 예문 후보 쿼리 (현재 소설 우선)
    valid_examples = []
    seen_ids = set()

    # 현재 보고 있는 소설(folder) 내 검색 우선
    if folder:
        query_current = db.query(Translation).filter(
            Translation.folderName == folder,
            (Translation.original.contains(kw)) | (Translation.translated.contains(kw))
        )
        if exclude_id:
            query_current = query_current.filter(Translation.id != exclude_id)

        current_candidates = query_current.order_by(Translation.timestamp.desc()).limit(limit * 2).all()
        for item in current_candidates:
            if not item.translated or not item.translated.strip() or item.id in seen_ids:
                continue
            seen_ids.add(item.id)
            valid_examples.append({
                "id": item.id,
                "original": item.original,
                "translated": item.translated,
                "title": item.title,
                "folderName": item.folderName,
                "pid": item.pid,
                "url": item.url
            })
            if len(valid_examples) >= limit:
                break

    # 타 소설 / 전체 소설 확장 검색
    if len(valid_examples) < limit:
        query_other = db.query(Translation).filter(
            (Translation.original.contains(kw)) | (Translation.translated.contains(kw))
        )
        if folder:
            query_other = query_other.filter(Translation.folderName != folder)
        if exclude_id:
            query_other = query_other.filter(Translation.id != exclude_id)

        other_candidates = query_other.order_by(Translation.timestamp.desc()).limit((limit - len(valid_examples)) * 3).all()
        for item in other_candidates:
            if not item.translated or not item.translated.strip() or item.id in seen_ids:
                continue
            seen_ids.add(item.id)
            valid_examples.append({
                "id": item.id,
                "original": item.original,
                "translated": item.translated,
                "title": item.title,
                "folderName": item.folderName,
                "pid": item.pid,
                "url": item.url
            })
            if len(valid_examples) >= limit:
                break

    # 2. 통계: 누적 DB 전체 등장 횟수 및 관련 소설 수 계산 (빠른 COUNT 쿼리)
    total_count_query = db.query(func.count(Translation.id)).filter(
        (Translation.original.contains(kw)) | (Translation.translated.contains(kw))
    )
    total_occurrences = total_count_query.scalar() or 0

    novel_count_query = db.query(func.count(func.distinct(Translation.folderName))).filter(
        (Translation.original.contains(kw)) | (Translation.translated.contains(kw))
    )
    novel_count = novel_count_query.scalar() or 0

    # 3. 학습 빈도 등급 판정
    if total_occurrences >= 50:
        frequency_level = "고빈도 핵심어 (High)"
    elif total_occurrences >= 15:
        frequency_level = "중빈도 표현 (Medium)"
    elif total_occurrences > 0:
        frequency_level = "저빈도/특수 표현 (Low)"
    else:
        frequency_level = "미등장 표현"

    # 4. 번역문 주요 대응 어휘 통계
    candidate_terms = extract_korean_candidate_terms(valid_examples, kw)

    return {
        "keyword": kw,
        "total_occurrences": total_occurrences,
        "novel_count": novel_count,
        "frequency_level": frequency_level,
        "dictionary_links": get_dictionary_links(kw),
        "candidate_terms": candidate_terms,
        "examples": valid_examples
    }


def tokenize_japanese_sentence(sentence: str) -> List[Dict[str, Any]]:
    """
    일본어 문장을 순수 룰베이스로 정교하게 토큰화합니다. (외부 라이브러리/MeCab 불필요)
    - 한자 덩어리 + 옥리가나 (예: 見つめた, 食べた, 魔法, 約束)
    - 가타카나 덩어리 (예: スライム, レベル, ナイフ)
    - 히라가나 어휘 (2자 이상) 및 단일 조사 (は, が, を, に, で, と, の, も)
    - 구두점 및 기호
    """
    if not sentence:
        return []

    tokens: List[Dict[str, Any]] = []
    
    # 1. 토큰 정규식: 한자+옥리가나, 가타카나, 한자단독, 히라가나단어, 조사, 영숫자, 구두점
    pattern = re.compile(
        r'([一-龯々]+[ぁ-ん]*)|([ァ-ヴー]+)|([一-龯々]+)|([ぁ-ん]{2,})|([ぁ-ん])|([a-zA-Z0-9]+)|([「」『』（）()！？!?…―.,\s]+)'
    )

    PARTICLES = {"は", "が", "を", "に", "で", "と", "の", "も", "へ", "や", "か", "ね", "よ", "ぞ", "ぜ", "な", "さ"}

    for match in pattern.finditer(sentence):
        text = match.group(0)
        if not text or text.isspace():
            continue

        token_type = "unknown"
        
        # Split trailing particle if a noun is immediately followed by a particle
        # e.g. "魔導士の" -> "魔導士", "の"
        # "炸裂した" -> "炸裂した" (kept together since "した" is not in PARTICLES)
        split_particle = None
        if re.match(r'^[一-龯々]+[ぁ-ん]+$', text):
            m = re.match(r'^([一-龯々]+)([ぁ-ん]+)$', text)
            if m:
                kanji_part, hira_part = m.group(1), m.group(2)
                if hira_part in PARTICLES:
                    text = kanji_part
                    split_particle = hira_part

        if re.match(r'^[一-龯々]+[ぁ-ん]*$', text):
            token_type = "kanji"
        elif re.match(r'^[ァ-ヴー]+$', text):
            token_type = "katakana"
        elif text in PARTICLES:
            token_type = "particle"
        elif re.match(r'^[ぁ-ん]+$', text):
            token_type = "hiragana"
        elif re.match(r'^[a-zA-Z0-9]+$', text):
            token_type = "alphanumeric"
        elif re.match(r'^[「」『』（）()！？!?…―.,\s]+$', text):
            token_type = "punct"

        tokens.append({
            "text": text,
            "type": token_type,
            "start": match.start(),
            "end": match.start() + len(text),
            "is_word": token_type in ("kanji", "katakana", "hiragana") and len(text) >= 2
        })
        
        if split_particle:
            tokens.append({
                "text": split_particle,
                "type": "particle",
                "start": match.start() + len(text),
                "end": match.end(),
                "is_word": False
            })

    return tokens


def get_sentence_word_breakdown(
    j_text: str,
    k_text: Optional[str] = None,
    folder: Optional[str] = None,
    db: Optional[Session] = None
) -> List[Dict[str, Any]]:
    """
    원문 문장의 단어들을 분해하고, 각 단어별 34만 코퍼스 내 빈출 번역어 및 사전 링크를 매핑합니다.
    수동 번역 교정창의 '스마트 단어 블록 바' 및 듀오링고식 학습에 활용됩니다.
    """
    tokens = tokenize_japanese_sentence(j_text)
    if not tokens:
        return []

    results: List[Dict[str, Any]] = []
    k_text_clean = k_text or ""

    for item in tokens:
        t_text = item["text"]
        t_type = item["type"]
        is_word = item["is_word"]

        entry = {
            "token": t_text,
            "type": t_type,
            "is_word": is_word,
            "candidate_terms": [],
            "matched_term": "",
            "dict_links": get_dictionary_links(t_text) if is_word or t_type in ("kanji", "katakana") else {}
        }

        # 구두점이나 단순 조사는 코퍼스 무거운 검색 생략
        if is_word and db:
            query = db.query(Translation.translated).filter(
                Translation.original.contains(t_text)
            )
            if folder:
                query = query.filter(Translation.folderName == folder)

            sample_rows = query.order_by(Translation.timestamp.desc()).limit(15).all()
            if not sample_rows and folder:
                # 폴더에 없으면 전체 DB에서 10개 조회
                sample_rows = db.query(Translation.translated).filter(
                    Translation.original.contains(t_text)
                ).order_by(Translation.timestamp.desc()).limit(10).all()

            # 한국어 단어 빈도 카운팅
            korean_counter = Counter()
            ko_words_regex = re.compile(r'[가-힣]{2,}')
            for row in sample_rows:
                if row[0]:
                    for kw in ko_words_regex.findall(row[0]):
                        if kw not in KOREAN_STOPWORDS:
                            korean_counter[kw] += 1

            candidates = [w for w, _ in korean_counter.most_common(4)]
            entry["candidate_terms"] = candidates

            # 만약 현재 문장의 k_text에 이 후보가 포함되어 있다면 최우선 매칭어로 선정
            for c in candidates:
                if c in k_text_clean:
                    entry["matched_term"] = c
                    break

        results.append(entry)

    return results


def generate_duo_study_quiz(
    folder: Optional[str] = None,
    keyword: Optional[str] = None,
    count: int = 5,
    db: Optional[Session] = None
) -> Dict[str, Any]:
    """
    34만 실제 누적 번역 코퍼스에서 듀오링고(Duolingo) 스타일의 인터랙티브 일본어 학습 퀴즈 세트를 생성합니다.
    퀴즈 유형:
    1. tile_reorder: 원문 제시 후 한국어 단어 타일들을 탭하여 올바른 순서로 문장 조립 (방해 타일 포함)
    2. cloze: 원문 속 핵심 단어 빈칸 [ ___ ] 채우기 (4지선다)
    3. meaning_choice: 원문 속 핵심 어휘의 문맥상 한국어 뜻 맞추기 (4지선다)
    4. pair_match: 3쌍의 일본어 단어 - 한국어 뜻 짝맞추기
    """
    if not db:
        return {"items": [], "total_count": 0, "xp_reward": 0}

    # 1. 퀴즈에 적합한 적정 길이의 문장 후보군 검색 (12자~50자 사이의 자연스러운 소설 문장)
    query = db.query(Translation).filter(
        func.length(Translation.original) >= 12,
        func.length(Translation.original) <= 50,
        func.length(Translation.translated) >= 8,
        func.length(Translation.translated) <= 45
    )

    if folder:
        query = query.filter(Translation.folderName == folder)
    if keyword:
        kw = keyword.strip()
        if kw:
            query = query.filter(Translation.original.contains(kw))

    # 최근 문장 중 최대 30개 샘플링
    candidates = query.order_by(Translation.timestamp.desc()).limit(30).all()
    if len(candidates) < count and folder:
        # 현재 소설에 부족하면 전체 DB에서 추가 확보
        fallback = db.query(Translation).filter(
            func.length(Translation.original) >= 12,
            func.length(Translation.original) <= 50,
            func.length(Translation.translated) >= 8,
            func.length(Translation.translated) <= 45
        ).order_by(Translation.timestamp.desc()).limit(30).all()
        candidates.extend(fallback)

    if not candidates:
        return {"items": [], "total_count": 0, "xp_reward": 0}

    # 랜덤 셔플
    selected_items = random.sample(candidates, min(len(candidates), count * 2))
    quiz_types = ["tile_reorder", "cloze", "meaning_choice", "tile_reorder", "pair_match"]
    random.shuffle(quiz_types)

    quizzes: List[Dict[str, Any]] = []

    # 방해 타일/오답 보기를 위한 풀(pool) 구성
    distractor_words_ko = ["그러나", "어쩌면", "비록", "마치", "절대로", "스스로", "어째서", "잠시", "그것은"]
    distractor_words_ja = ["魔法", "世界", "約束", "真実", "記憶", "勇気", "運命", "力", "未来", "希望"]

    cand_idx = 0
    for q_idx in range(min(count, len(selected_items))):
        q_type = quiz_types[q_idx % len(quiz_types)]
        item = selected_items[cand_idx]
        cand_idx += 1

        orig = item.original.strip()
        trans = item.translated.strip()

        if q_type == "tile_reorder":
            # 한국어 어절 분해
            words = [w for w in re.split(r'\s+', trans) if w]
            if len(words) < 3:
                words = list(re.findall(r'[가-힣0-9a-zA-Z~！？]+', trans))
            if len(words) < 2:
                continue

            # 방해 타일 1~2개 추가
            extra_tiles = random.sample(distractor_words_ko, min(2, len(distractor_words_ko)))
            all_tiles = words + extra_tiles
            random.shuffle(all_tiles)

            quizzes.append({
                "id": f"q_{q_idx + 1}",
                "type": "tile_reorder",
                "title": "단어 타일을 탭하여 번역문을 완성하세요",
                "prompt": orig,
                "hint": "원문에 맞는 올바른 어순으로 단어를 나열하세요.",
                "solution": trans,
                "correct_tokens": words,
                "tiles": all_tiles,
                "novel_title": item.title or item.folderName
            })

        elif q_type == "cloze":
            # 원문에서 한자/가타카나 2자 이상 단어 찾기
            tokens = [t["text"] for t in tokenize_japanese_sentence(orig) if t["is_word"]]
            if not tokens:
                continue
            target_word = random.choice(tokens)
            masked_orig = orig.replace(target_word, " [ ___ ] ", 1)

            # 오답 보기 3개 구성
            other_options = [w for w in distractor_words_ja if w != target_word]
            random.shuffle(other_options)
            options = [target_word] + other_options[:3]
            random.shuffle(options)

            quizzes.append({
                "id": f"q_{q_idx + 1}",
                "type": "cloze",
                "title": "빈칸에 들어갈 알맞은 단어를 선택하세요",
                "prompt": masked_orig,
                "hint": f"번역: {trans}",
                "solution": target_word,
                "options": options,
                "novel_title": item.title or item.folderName
            })

        elif q_type == "meaning_choice":
            # 단어 뜻 4지선다
            tokens = [t["text"] for t in tokenize_japanese_sentence(orig) if t["is_word"]]
            if not tokens:
                continue
            target_word = random.choice(tokens)

            # 해당 단어의 코퍼스 번역어 추출
            cands = extract_korean_candidate_terms([{"translated": trans}], target_word)
            target_meaning = cands[0] if cands else trans[:6]

            other_meanings = ["희망", "마법", "약속", "운명", "기억", "진실", "어둠", "빛"]
            other_meanings = [m for m in other_meanings if m != target_meaning]
            random.shuffle(other_meanings)
            options = [target_meaning] + other_meanings[:3]
            random.shuffle(options)

            quizzes.append({
                "id": f"q_{q_idx + 1}",
                "type": "meaning_choice",
                "title": f"'{target_word}'의 문맥상 의미로 가장 알맞은 것은?",
                "prompt": f"예문: {orig}",
                "target_word": target_word,
                "hint": f"전체 문장: {trans}",
                "solution": target_meaning,
                "options": options,
                "novel_title": item.title or item.folderName
            })

        elif q_type == "pair_match":
            # 3쌍의 단어-뜻 짝맞추기
            pair_candidates = [
                ("本当に", "정말로"),
                ("魔法", "마법"),
                ("世界", "세계"),
                ("約束", "약속"),
                ("笑顔", "미소"),
                ("仲間", "동료"),
                ("時間", "시간"),
                ("運命", "운명")
            ]
            selected_pairs = random.sample(pair_candidates, 3)
            ja_items = [p[0] for p in selected_pairs]
            ko_items = [p[1] for p in selected_pairs]
            random.shuffle(ja_items)
            random.shuffle(ko_items)

            quizzes.append({
                "id": f"q_{q_idx + 1}",
                "type": "pair_match",
                "title": "알맞은 단어와 뜻을 짝지어 보세요",
                "pairs": [{"ja": p[0], "ko": p[1]} for p in selected_pairs],
                "ja_cards": ja_items,
                "ko_cards": ko_items,
                "novel_title": item.title or item.folderName
            })

    return {
        "items": quizzes,
        "total_count": len(quizzes),
        "xp_reward": len(quizzes) * 15,
        "folder": folder or ""
    }
