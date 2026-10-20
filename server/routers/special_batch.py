"""
LANOVEL Special Batch Router
특별 적재(special_batch_queue) 문단 검수, 본 DB(translations) 승인 반영, Undo 되돌리기,
및 전용 UI(/special_batch) 서빙 라우터.
"""

import time
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from server.database import get_db
from server.models import Translation, SpecialBatchQueue, UrlMetadata
from server.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Special Batch"])


class ApproveRequest(BaseModel):
    id: int
    translated_text: Optional[str] = None


class UndoRequest(BaseModel):
    id: int


class SkipRequest(BaseModel):
    id: int


class BatchApproveRequest(BaseModel):
    folder_name: Optional[str] = None
    batch_id: Optional[str] = None
    chapter_url: Optional[str] = None


class UpdateTextRequest(BaseModel):
    id: int
    translated_text: str


def resolve_clean_folder_name(db: Session, clean_url: str, explicit_folder: Optional[str]) -> Optional[str]:
    """
    폴더명을 안전하게 결정합니다:
    1. explicit_folder가 유효하고 'Unknown'이 아니면 우선 사용
    2. 동일 URL(회차)의 다른 Translation 레코드 중 이미 유효한 folderName이 지정되어 있다면 상속
    3. 어디에도 없으면 임의 폴더를 절대 생성하지 않고 None(미분류 보관함 규격)을 반환
    """
    if explicit_folder and explicit_folder.strip() and explicit_folder.strip() != "Unknown":
        return explicit_folder.strip()

    inherited = (
        db.query(Translation.folderName)
        .filter(Translation.url == clean_url)
        .filter(Translation.folderName.isnot(None))
        .filter(Translation.folderName != "")
        .filter(Translation.folderName != "Unknown")
        .first()
    )
    if inherited and inherited[0] and inherited[0].strip():
        return inherited[0].strip()

    return None


@router.get("/special_batch", response_class=HTMLResponse)
async def serve_special_batch_page(request: Request):
    """특별 적재 검수기 전용 UI 페이지"""
    from server.server import templates
    return templates.TemplateResponse(
        "special_batch.html",
        {"request": request, "app_name": settings.app_name}
    )


@router.get("/api/special_batch/novels")
def get_staged_novels(db: Session = Depends(get_db)):
    """특별 적재 큐에 보관된 소설 목록 및 상태별 통계 반환"""
    novels = (
        db.query(
            SpecialBatchQueue.folder_name,
            func.count(SpecialBatchQueue.id).label("total_count"),
            func.sum(case((SpecialBatchQueue.status == 'staged', 1), else_=0)).label("staged_count"),
            func.sum(case((SpecialBatchQueue.status == 'approved', 1), else_=0)).label("approved_count"),
            func.sum(case((SpecialBatchQueue.status == 'skipped', 1), else_=0)).label("skipped_count"),
        )
        .group_by(SpecialBatchQueue.folder_name)
        .order_by(func.max(SpecialBatchQueue.created_at).desc())
        .all()
    )

    result = []
    for row in novels:
        # None, 빈 문자열, Unknown은 '미분류'로 정규화 표기
        f_name = row.folder_name
        if not f_name or f_name.strip() in ("", "Unknown"):
            f_name = None
        result.append({
            "folder_name": f_name,
            "total_count": row.total_count or 0,
            "staged_count": row.staged_count or 0,
            "approved_count": row.approved_count or 0,
            "skipped_count": row.skipped_count or 0,
        })
    return {"novels": result}


@router.get("/api/special_batch/chapters")
def get_staged_chapters(folder_name: Optional[str] = None, db: Session = Depends(get_db)):
    """특정 소설의 회차 목록 반환"""
    query = db.query(
        SpecialBatchQueue.url,
        SpecialBatchQueue.chapter_title,
        SpecialBatchQueue.chapter_index,
        func.count(SpecialBatchQueue.id).label("total_count"),
        func.sum(case((SpecialBatchQueue.status == 'staged', 1), else_=0)).label("staged_count"),
        func.sum(case((SpecialBatchQueue.status == 'approved', 1), else_=0)).label("approved_count"),
    )

    if folder_name and folder_name not in ("미분류", "__unclassified__", "null", "None"):
        query = query.filter(SpecialBatchQueue.folder_name == folder_name)
    elif folder_name in ("미분류", "__unclassified__", "null", "None") or folder_name == "":
        query = query.filter(
            SpecialBatchQueue.folder_name.is_(None)
            | (SpecialBatchQueue.folder_name == "")
            | (SpecialBatchQueue.folder_name == "Unknown")
        )

    chapters = (
        query
        .group_by(SpecialBatchQueue.url, SpecialBatchQueue.chapter_title, SpecialBatchQueue.chapter_index)
        .order_by(SpecialBatchQueue.chapter_index.asc())
        .all()
    )

    result = []
    for row in chapters:
        result.append({
            "url": row.url,
            "chapter_title": row.chapter_title,
            "chapter_index": row.chapter_index,
            "total_count": row.total_count or 0,
            "staged_count": row.staged_count or 0,
            "approved_count": row.approved_count or 0,
        })
    return {"chapters": result}


@router.get("/api/special_batch/items")
def get_staged_items(
    folder_name: Optional[str] = None,
    chapter_url: Optional[str] = None,
    batch_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """특별 적재 문단 목록 및 상세 조회"""
    query = db.query(SpecialBatchQueue)

    if folder_name:
        if folder_name in ("미분류", "__unclassified__", "null", "None") or folder_name == "":
            query = query.filter(
                SpecialBatchQueue.folder_name.is_(None)
                | (SpecialBatchQueue.folder_name == "")
                | (SpecialBatchQueue.folder_name == "Unknown")
            )
        else:
            query = query.filter(SpecialBatchQueue.folder_name == folder_name)
    if chapter_url:
        query = query.filter(SpecialBatchQueue.url == chapter_url)
    if batch_id:
        query = query.filter(SpecialBatchQueue.batch_id == batch_id)
    if status and status != 'all':
        query = query.filter(SpecialBatchQueue.status == status)

    total_count = query.count()
    items = query.order_by(SpecialBatchQueue.id.asc()).offset(offset).limit(limit).all()

    # 전체 통계 카운트 계산
    counts_query = db.query(
        func.sum(case((SpecialBatchQueue.status == 'staged', 1), else_=0)).label("staged"),
        func.sum(case((SpecialBatchQueue.status == 'approved', 1), else_=0)).label("approved"),
        func.sum(case((SpecialBatchQueue.status == 'skipped', 1), else_=0)).label("skipped"),
    )
    if folder_name:
        if folder_name in ("미분류", "__unclassified__", "null", "None") or folder_name == "":
            counts_query = counts_query.filter(
                SpecialBatchQueue.folder_name.is_(None)
                | (SpecialBatchQueue.folder_name == "")
                | (SpecialBatchQueue.folder_name == "Unknown")
            )
        else:
            counts_query = counts_query.filter(SpecialBatchQueue.folder_name == folder_name)
    if chapter_url:
        counts_query = counts_query.filter(SpecialBatchQueue.url == chapter_url)
    
    counts_row = counts_query.first()

    return {
        "total": total_count,
        "counts": {
            "staged": counts_row.staged if counts_row and counts_row.staged else 0,
            "approved": counts_row.approved if counts_row and counts_row.approved else 0,
            "skipped": counts_row.skipped if counts_row and counts_row.skipped else 0,
        },
        "items": [
            {
                "id": it.id,
                "batch_id": it.batch_id,
                "url": it.url,
                "folder_name": it.folder_name,
                "chapter_title": it.chapter_title,
                "chapter_index": it.chapter_index,
                "pid": it.pid,
                "original_text": it.original_text,
                "translated_text": it.translated_text,
                "status": it.status,
                "created_at": it.created_at,
                "promoted_at": it.promoted_at,
            }
            for it in items
        ]
    }


@router.post("/api/special_batch/approve")
def approve_staged_item(req: ApproveRequest, db: Session = Depends(get_db)):
    """단일 카드를 승인하고 본 DB(translations)로 즉시 upsert 반영"""
    item = db.query(SpecialBatchQueue).filter(SpecialBatchQueue.id == req.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="해당 적재 항목을 찾을 수 없습니다.")

    now = int(time.time())
    final_text = req.translated_text.strip() if req.translated_text else item.translated_text.strip()
    if not final_text:
        raise HTTPException(status_code=400, detail="번역문이 비어 있어 승인할 수 없습니다.")

    item.translated_text = final_text
    item.status = "approved"
    item.promoted_at = now

    # UrlMetadata 최초 접근 기록
    clean_url = item.url.split('#')[0].strip()
    meta = db.query(UrlMetadata).filter(UrlMetadata.url == clean_url).first()
    if not meta:
        db.add(UrlMetadata(url=clean_url, first_accessed_at=now))

    # translations 테이블에 upsert
    existing_trans = (
        db.query(Translation)
        .filter(Translation.url == clean_url, Translation.pid == item.pid)
        .first()
    )

    resolved_folder = resolve_clean_folder_name(db, clean_url, item.folder_name)

    if existing_trans:
        existing_trans.translated = final_text
        existing_trans.original = item.original_text
        existing_trans.timestamp = now
        # 기존 번역의 folderName이 없거나 'Unknown'인 경우에만 상속받고, 이미 정상 폴더명이 있으면 보존
        if not existing_trans.folderName or existing_trans.folderName.strip() in ("", "Unknown"):
            existing_trans.folderName = resolved_folder
        if not existing_trans.title and item.chapter_title:
            existing_trans.title = item.chapter_title
    else:
        new_trans = Translation(
            url=clean_url,
            pid=item.pid,
            original=item.original_text,
            translated=final_text,
            timestamp=now,
            folderName=resolved_folder,
            title=item.chapter_title or f"제 {item.chapter_index}화",
        )
        db.add(new_trans)

    db.commit()
    return {"ok": True, "id": item.id, "status": "approved"}


@router.post("/api/special_batch/undo")
def undo_staged_item(req: UndoRequest, db: Session = Depends(get_db)):
    """방금 승인한 카드를 되돌리기(Undo): 상태를 staged로 복구하고 본 DB에서 롤백"""
    item = db.query(SpecialBatchQueue).filter(SpecialBatchQueue.id == req.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="해당 적재 항목을 찾을 수 없습니다.")

    item.status = "staged"
    item.promoted_at = None

    # 본 DB(translations)에서 해당 문단 삭제 (원복)
    clean_url = item.url.split('#')[0].strip()
    trans = (
        db.query(Translation)
        .filter(Translation.url == clean_url, Translation.pid == item.pid)
        .first()
    )
    if trans:
        db.delete(trans)

    db.commit()
    return {"ok": True, "id": item.id, "status": "staged"}


@router.post("/api/special_batch/skip")
def skip_staged_item(req: SkipRequest, db: Session = Depends(get_db)):
    """단일 카드 건너뛰기 처리"""
    item = db.query(SpecialBatchQueue).filter(SpecialBatchQueue.id == req.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="해당 적재 항목을 찾을 수 없습니다.")

    item.status = "skipped"
    db.commit()
    return {"ok": True, "id": item.id, "status": "skipped"}


@router.post("/api/special_batch/update_text")
def update_staged_text(req: UpdateTextRequest, db: Session = Depends(get_db)):
    """단일 카드의 번역문 직접 수정 저장"""
    item = db.query(SpecialBatchQueue).filter(SpecialBatchQueue.id == req.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="해당 적재 항목을 찾을 수 없습니다.")

    item.translated_text = req.translated_text.strip()
    db.commit()
    return {"ok": True, "id": item.id, "translated_text": item.translated_text}


@router.post("/api/special_batch/batch_approve")
def batch_approve_staged(req: BatchApproveRequest, db: Session = Depends(get_db)):
    """소설/회차/배치 단위의 대기 중인 모든 카드를 본 DB로 일괄 승인 반영"""
    query = db.query(SpecialBatchQueue).filter(SpecialBatchQueue.status == "staged")

    if req.folder_name:
        query = query.filter(SpecialBatchQueue.folder_name == req.folder_name)
    if req.chapter_url:
        query = query.filter(SpecialBatchQueue.url == req.chapter_url)
    if req.batch_id:
        query = query.filter(SpecialBatchQueue.batch_id == req.batch_id)

    staged_items = query.all()
    if not staged_items:
        return {"ok": True, "approved_count": 0, "message": "승인할 대기 항목이 없습니다."}

    now = int(time.time())
    urls = {it.url.split('#')[0].strip() for it in staged_items}

    # UrlMetadata 일괄 확보
    existing_meta = {m.url for m in db.query(UrlMetadata).filter(UrlMetadata.url.in_(urls)).all()}
    for u in urls:
        if u not in existing_meta:
            db.add(UrlMetadata(url=u, first_accessed_at=now))

    # 기존 Translation 일괄 조회
    existing_translations = db.query(Translation).filter(Translation.url.in_(urls)).all()
    trans_map = {(t.url, t.pid): t for t in existing_translations}

    # URL별 유효 소설 폴더명 매핑 구축 (동일 URL에 이미 지정된 정상 폴더가 있다면 상속)
    url_to_inherited_folder = {}
    for t in existing_translations:
        if t.url and t.folderName and t.folderName.strip() and t.folderName.strip() != "Unknown":
            if t.url not in url_to_inherited_folder:
                url_to_inherited_folder[t.url] = t.folderName.strip()

    approved_count = 0
    for item in staged_items:
        clean_url = item.url.split('#')[0].strip()
        t_text = item.translated_text.strip()
        if not t_text:
            continue

        item.status = "approved"
        item.promoted_at = now

        # 폴더명 결정: explicit(유효한 경우) -> 동일 URL 상속 -> None(미분류 보관함 규격)
        clean_folder = item.folder_name.strip() if item.folder_name and item.folder_name.strip() and item.folder_name.strip() != "Unknown" else None
        resolved_folder = clean_folder or url_to_inherited_folder.get(clean_url)

        key = (clean_url, item.pid)
        if key in trans_map:
            t = trans_map[key]
            t.translated = t_text
            t.original = item.original_text
            t.timestamp = now
            if not t.folderName or t.folderName.strip() in ("", "Unknown"):
                t.folderName = resolved_folder
        else:
            new_t = Translation(
                url=clean_url,
                pid=item.pid,
                original=item.original_text,
                translated=t_text,
                timestamp=now,
                folderName=resolved_folder,
                title=item.chapter_title or f"제 {item.chapter_index}화",
            )
            db.add(new_t)
            trans_map[key] = new_t

        approved_count += 1

    db.commit()
    return {"ok": True, "approved_count": approved_count}
