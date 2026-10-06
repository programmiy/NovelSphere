"""
Dictionary integration and accumulated translation corpus lookup service.
Enables translators and language learners to explore dictionary definitions
alongside real-world novel translation examples from the accumulated database.
STRICTLY NO AI (100% deterministic, rule-based & SQLite queries).
"""

import re
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
