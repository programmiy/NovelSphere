"""
Similarity search and recommended translation examples service.
Finds similar Japanese phrases and human-approved Korean translations
to aid review and retranslation accuracy.
Includes Top 5 frequent Korean translation expressions analysis for cause keywords.
"""

import re
from typing import Optional, Dict, Any, List
from collections import Counter
from sqlalchemy.orm import Session

from server.models import Translation
from server.rule_classifier import extract_untranslated_keywords

# 한국어 불용어 (일반적인 문법 어휘, 보조 용언, 대명사, 서술어 등)
STOPWORDS = {
    "있는", "있다", "없다", "없는", "했다", "한다", "하고", "하면", "하지", "그것", "그녀", "그는",
    "자신", "내가", "네가", "나는", "너는", "그의", "그녀의", "것이다", "것이", "것을", "수도",
    "수가", "말했다", "생각했다", "그리고", "하지만", "그러나", "그런", "이런", "저런", "정말",
    "너무", "다시", "지금", "그렇게", "이렇게", "어떤", "모든", "때문", "위해", "대한", "통해",
    "처럼", "같이", "정도", "아니", "아니다", "되었다", "됐다", "된다", "같은", "보았다", "봤다",
    "있었다", "없었다", "않았다", "않는다", "사람", "문장", "순간", "모습", "소리", "생각", "마음",
    "하나", "다들", "우리", "너희", "그들", "어디", "무엇", "무슨", "어떻게", "왜냐하면", "모두",
    "같다", "거야", "모른다", "건지", "잖아", "텐데", "니까", "텐가", "뿐이다", "셈이다"
}

# 한국어 어미/조사 단순 정규화 (끝부분 조사 제거)
JOSA_REGEX = re.compile(r'(은|는|이|가|을|를|의|에|에게|한테|와|과|도|만|로|으로|에서|부터|까지|마저|조차|라고|이라|처럼|마다|이란|이야)$')
KANA_FILTER_REGEX = re.compile(r'[\u3040-\u309f\u30a0-\u30fa]')


def clean_ko_token(word: str) -> str:
    """한국어 단어에서 구두점 및 끝 조사를 제거하여 순수 어간을 추출합니다."""
    w = re.sub(r'[^가-힣]', '', word)
    if len(w) < 2:
        return ""
    # 조사 분리/제거
    stripped = JOSA_REGEX.sub('', w)
    if len(stripped) >= 2 and stripped not in STOPWORDS:
        return stripped
    if w not in STOPWORDS and len(w) >= 2:
        return w
    return ""


def get_cause_keywords(
    original: Optional[str] = None,
    old_translated: Optional[str] = None,
    ai_translated: Optional[str] = None
) -> List[str]:
    """
    이상번역의 원인이 된 텍스트 후보들을 우선순위대로 추출합니다.
    1. 구번역/AI번역에 남아있는 미번역 가나, 간체자, 외래어 토큰
    2. 번역문에서 감지되지 않을 경우 원문(original)의 핵심 가나/한자 어휘
    """
    keywords: List[str] = []
    
    # 1. 이전 번역문과 AI 번역문에서 미번역 키워드 추출
    for text_val in (old_translated, ai_translated):
        if text_val:
            for kw in extract_untranslated_keywords(original or "", text_val):
                if kw not in keywords:
                    keywords.append(kw)

    # 2. 번역문에서 추출되지 않은 경우 원문의 주요 가나 어휘 (2~6자)
    if not keywords and original:
        # 가나 연속 2자 이상 (조사 제외 의미어)
        kana_matches = re.findall(r'[\u3040-\u309f\u30a0-\u30fa]{2,8}', original)
        for km in kana_matches:
            if km not in keywords and km not in ('こと', 'よう', 'そう', 'どう', 'ため', 'から'):
                keywords.append(km)
                if len(keywords) >= 3:
                    break
                    
    # 3. 원문의 한자 어휘 (2자 이상)
    if not keywords and original:
        hanja_matches = re.findall(r'[\u4e00-\u9faf]{2,6}', original)
        for hm in hanja_matches:
            if hm not in keywords:
                keywords.append(hm)
                if len(keywords) >= 3:
                    break

    return keywords


def get_top5_expressions(
    keyword: str,
    folder: Optional[str],
    db: Session,
    max_scan: int = 120
) -> List[Dict[str, Any]]:
    """
    원인 텍스트(keyword)가 원문/번역문에 포함된 코퍼스 문장들을 분석하여,
    가장 자주 등장하는 정상 한국어 번역 표현 상위 5개를 추출합니다.
    """
    kw = (keyword or "").strip()
    if not kw:
        return []

    # 1. 원문에 키워드가 포함되거나 번역문에 키워드가 포함된 문장 조회
    # (번역문에 가나가 잔존하지 않는 양질의 한국어 문장 우선)
    query = db.query(Translation).filter(
        (Translation.original.contains(kw)) | (Translation.translated.contains(kw)),
        Translation.translated.isnot(None),
        Translation.translated != ""
    )
    
    candidates = query.order_by(Translation.timestamp.desc()).limit(max_scan).all()
    if not candidates:
        return []

    counter = Counter()
    for item in candidates:
        tra = item.translated or ""
        # 번역문에 가나가 섞여 있는 불량 번역은 빈도 분석에서 제외
        if KANA_FILTER_REGEX.search(tra):
            continue

        weight = 2 if (folder and item.folderName == folder) else 1
        words = re.findall(r'[가-힣]+', tra)
        for w in words:
            token = clean_ko_token(w)
            if token and len(token) >= 2 and token not in STOPWORDS:
                counter[token] += weight

    top_items = counter.most_common(5)
    return [{"word": word, "count": count} for word, count in top_items]


def get_similar_examples_data(
    keyword: str,
    folder: Optional[str],
    exclude_id: Optional[int],
    limit: int,
    db: Session,
    include_top5: bool = False
) -> Dict[str, Any]:
    """키워드를 기반으로 기존 데이터베이스의 유사 번역 단락 예시를 검색합니다."""
    kw = (keyword or "").strip()
    if not kw:
        return {"keyword": "", "examples": [], "top5_expressions": []}

    query = db.query(Translation).filter(
        (Translation.original.contains(kw)) | (Translation.translated.contains(kw))
    )
    if exclude_id:
        query = query.filter(Translation.id != exclude_id)
    if folder:
        query = query.filter(Translation.folderName == folder)

    candidates = query.order_by(Translation.timestamp.desc()).limit(limit * 4).all()

    valid_examples = []
    seen_ids = set()
    for item in candidates:
        if not item.translated or not item.translated.strip() or item.id in seen_ids:
            continue
        # 가나가 남아있는 오염 문장은 유사 예시에서 배제
        if KANA_FILTER_REGEX.search(item.translated):
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

    if len(valid_examples) < limit and folder:
        query_all = db.query(Translation).filter(
            (Translation.original.contains(kw)) | (Translation.translated.contains(kw)),
            Translation.folderName != folder
        )
        if exclude_id:
            query_all = query_all.filter(Translation.id != exclude_id)
        query_all = query_all.order_by(Translation.timestamp.desc()).limit((limit - len(valid_examples)) * 4).all()

        for item in query_all:
            if not item.translated or not item.translated.strip() or item.id in seen_ids:
                continue
            if KANA_FILTER_REGEX.search(item.translated):
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

    top5 = get_top5_expressions(kw, folder, db) if include_top5 else []

    return {
        "keyword": kw,
        "examples": valid_examples,
        "top5_expressions": top5
    }


def get_cause_reference_data(
    keyword: Optional[str],
    folder: Optional[str],
    exclude_id: Optional[int],
    limit: int,
    db: Session
) -> Dict[str, Any]:
    """
    AI 리뷰 전용: 이상번역 원인 텍스트에 대한 다른 단락 번역 사례 및 빈출 Top 5 표현을 반환합니다.
    """
    kw = (keyword or "").strip()
    return get_similar_examples_data(
        keyword=kw,
        folder=folder,
        exclude_id=exclude_id,
        limit=limit,
        db=db,
        include_top5=True
    )
