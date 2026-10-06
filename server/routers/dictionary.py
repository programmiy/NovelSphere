"""
Dictionary Integration & Corpus Exploration Router.
Enables translators and learners to lookup dictionary definitions and
query real-world novel translation examples from accumulated database.
STRICTLY NO AI (100% deterministic, rule-based & SQLite queries).
"""

from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from server.database import get_db
from server.services.dictionary_service import (
    get_dictionary_links,
    search_dictionary_corpus
)

router = APIRouter(prefix="/api/dictionary", tags=["Dictionary & Study"])


@router.get(
    "/lookup",
    summary="사전 연동 및 누적 번역 코퍼스 검색",
    description="주어진 일본어/한국어 키워드로 온라인 사전 링크 및 누적 DB의 실제 소설 번역 용례/통계를 조회합니다. (No AI)"
)
def lookup_dictionary_and_corpus(
    keyword: str = Query(..., description="조회할 단어 또는 문구 (일본어 또는 한국어)"),
    folder: Optional[str] = Query(None, description="현재 읽거나 교정 중인 소설명 (우선 검색 대상)"),
    exclude_id: Optional[int] = Query(None, description="제외할 번역 레코드 ID"),
    limit: int = Query(25, ge=1, le=100, description="최대 조회할 예문 수"),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    온라인 사전 바로가기 링크와 함께
    지금까지 쌓인 translations DB의 실제 소설 용례를 추출하여 반환합니다.
    """
    return search_dictionary_corpus(
        keyword=keyword,
        folder=folder,
        exclude_id=exclude_id,
        limit=limit,
        db=db
    )


@router.get(
    "/links",
    summary="사전 바로가기 링크 목록",
    description="키워드에 대한 네이버, Weblio, Jisho, Goo 사전 검색 URL을 반환합니다."
)
def get_dictionary_direct_links(
    keyword: str = Query(..., description="검색할 단어")
) -> Dict[str, Any]:
    links = get_dictionary_links(keyword)
    return {
        "keyword": keyword,
        "links": links
    }
