import time
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import func

from server.database import get_db
from server.models import SentenceHighlight

logger = logging.getLogger("lanovel.highlights")

router = APIRouter(prefix="/api/highlights", tags=["Highlights"])


class HighlightCreate(BaseModel):
    book_name: str
    chapter_title: str
    url: str
    pid: str
    original: str
    translated: str
    note: Optional[str] = None


class HighlightResolve(BaseModel):
    id: Optional[int] = None
    url: Optional[str] = None
    pid: Optional[str] = None


class HighlightItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_name: str
    chapter_title: str
    url: str
    pid: str
    original: str
    translated: str
    note: Optional[str] = None
    created_at: int
    updated_at: Optional[int] = None
    is_resolved: int


@router.get("", response_model=List[HighlightItemResponse])
def get_highlights(
    book_name: Optional[str] = None,
    is_resolved: Optional[int] = Query(0, description="0: 대기중, 1: 해결됨, None: 전체"),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db)
):
    """
    하이라이트(수정 대기 문장) 목록을 조회합니다.
    - 태블릿/모바일/PC 어디서든 수정 대기 목록을 고속 확인 가능.
    """
    query = db.query(SentenceHighlight)
    if book_name:
        query = query.filter(SentenceHighlight.book_name == book_name)
    if is_resolved is not None:
        query = query.filter(SentenceHighlight.is_resolved == is_resolved)
    
    return query.order_by(SentenceHighlight.created_at.desc(), SentenceHighlight.id.desc()).limit(limit).all()


@router.get("/counts")
def get_highlight_counts(db: Session = Depends(get_db)) -> Dict[str, Any]:
    """
    서재 화면 및 관리자 대시보드용 도서별 미해결 하이라이트 카운트 집계.
    """
    rows = (
        db.query(SentenceHighlight.book_name, func.count(SentenceHighlight.id))
        .filter(SentenceHighlight.is_resolved == 0)
        .group_by(SentenceHighlight.book_name)
        .all()
    )
    by_book = {book: cnt for book, cnt in rows}
    total = sum(by_book.values())
    return {
        "total": total,
        "by_book": by_book,
    }


@router.post("", response_model=HighlightItemResponse)
def upsert_highlight(req: HighlightCreate, db: Session = Depends(get_db)):
    """
    단락 하이라이트(수정 대기)를 등록하거나 갱신합니다.
    동일한 url+pid가 이미 존재하면 내용을 갱신하고 is_resolved=0으로 재활성화합니다.
    """
    now_ts = int(time.time())
    item = db.query(SentenceHighlight).filter(
        SentenceHighlight.url == req.url,
        SentenceHighlight.pid == req.pid,
    ).first()

    if item:
        item.book_name = req.book_name
        item.chapter_title = req.chapter_title
        item.original = req.original
        item.translated = req.translated
        item.note = req.note
        item.updated_at = now_ts
        item.is_resolved = 0
    else:
        item = SentenceHighlight(
            book_name=req.book_name,
            chapter_title=req.chapter_title,
            url=req.url,
            pid=req.pid,
            original=req.original,
            translated=req.translated,
            note=req.note,
            created_at=now_ts,
            updated_at=now_ts,
            is_resolved=0,
        )
        db.add(item)

    db.commit()
    db.refresh(item)
    return item


@router.post("/resolve")
def resolve_highlight(req: HighlightResolve, db: Session = Depends(get_db)):
    """
    하이라이트 해결(수정 완료) 처리.
    """
    now_ts = int(time.time())
    query = db.query(SentenceHighlight)
    if req.id:
        query = query.filter(SentenceHighlight.id == req.id)
    elif req.url and req.pid:
        query = query.filter(SentenceHighlight.url == req.url, SentenceHighlight.pid == req.pid)
    else:
        raise HTTPException(status_code=400, detail="id 또는 (url, pid)가 필요합니다.")

    items = query.all()
    for it in items:
        it.is_resolved = 1
        it.updated_at = now_ts
    
    db.commit()
    return {"success": True, "resolved_count": len(items)}


@router.delete("/{highlight_id}")
def delete_highlight(highlight_id: int, db: Session = Depends(get_db)):
    """
    하이라이트 삭제(취소).
    """
    item = db.query(SentenceHighlight).filter(SentenceHighlight.id == highlight_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="하이라이트 항목을 찾을 수 없습니다.")
    db.delete(item)
    db.commit()
    return {"success": True, "deleted_id": highlight_id}
