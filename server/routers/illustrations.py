import logging
import os
import time
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from server.database import get_db, get_sqlite_conn
from server.models import DeletedRecord, NovelIllustration
from server.services.illustration_service import (
    delete_stored_file,
    normalize_after_pid,
    resolve_chapter_metadata,
    resolve_illustration_abs_path,
    serialize_illustration,
    store_illustration_image,
)
from server.utils import natural_sort_key

logger = logging.getLogger("lanovel.illustrations")

router = APIRouter(prefix="/api/illustrations", tags=["Illustrations"])

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}


class IllustrationCreate(BaseModel):
    book_name: str
    chapter_url: Optional[str] = None
    chapter_title: Optional[str] = None
    after_pid: Optional[str] = "END"
    sort_order: int = 0
    caption: Optional[str] = None
    image_base64: Optional[str] = None
    source_path: Optional[str] = None


class IllustrationUpdate(BaseModel):
    chapter_url: Optional[str] = None
    chapter_title: Optional[str] = None
    after_pid: Optional[str] = None
    sort_order: Optional[int] = None
    caption: Optional[str] = None
    image_base64: Optional[str] = None
    source_path: Optional[str] = None


def _require_loopback_if_source_path(request: Request, source_path: Optional[str]) -> None:
    if not source_path:
        return
    client_host = request.client.host if request.client else ""
    if client_host not in _LOOPBACK_HOSTS:
        raise HTTPException(
            status_code=403,
            detail="source_path 임포트는 로컬 PC 루프백 요청에서만 허용됩니다.",
        )


def _load_book_metadata(
    book_name: str,
    chapter_url: Optional[str],
    chapter_title: Optional[str],
) -> tuple[str, str]:
    conn = get_sqlite_conn(as_dict=True)
    try:
        cursor = conn.cursor()
        return resolve_chapter_metadata(cursor, book_name, chapter_url, chapter_title)
    finally:
        conn.close()


@router.get("")
def list_illustrations(
    book_name: Optional[str] = None,
    chapter_url: Optional[str] = None,
    chapter_title: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """작품 또는 특정 회차의 삽화 목록을 조회합니다."""
    query = db.query(NovelIllustration)
    if book_name:
        query = query.filter(NovelIllustration.book_name == unquote(book_name))

    clean_url = (chapter_url or "").strip()
    clean_title = (chapter_title or "").strip()
    if clean_url and clean_title:
        trimmed = clean_url.rstrip("/")
        query = query.filter(
            or_(
                NovelIllustration.chapter_url == clean_url,
                NovelIllustration.chapter_url == trimmed,
                NovelIllustration.chapter_url == f"{trimmed}/",
                NovelIllustration.chapter_title == clean_title,
            )
        )
    elif clean_url:
        trimmed = clean_url.rstrip("/")
        query = query.filter(
            or_(
                NovelIllustration.chapter_url == clean_url,
                NovelIllustration.chapter_url == trimmed,
                NovelIllustration.chapter_url == f"{trimmed}/",
            )
        )
    elif clean_title:
        query = query.filter(NovelIllustration.chapter_title == clean_title)

    rows = query.order_by(NovelIllustration.sort_order.asc(), NovelIllustration.id.asc()).all()
    return [serialize_illustration(row) for row in rows]


@router.get("/book/{book_name}/chapters")
def list_book_chapters_for_illustrations(
    book_name: str,
    db: Session = Depends(get_db),
) -> List[Dict[str, Any]]:
    """삽화 관리 UI용 회차 목록 및 각 회차의 등록된 삽화 건수를 반환합니다."""
    decoded_book = unquote(book_name)
    conn = get_sqlite_conn(as_dict=True)
    try:
        cursor = conn.cursor()
        folder_clause = "folderName IS NULL" if decoded_book == "미분류" else "folderName = ?"
        params = [] if decoded_book == "미분류" else [decoded_book]
        cursor.execute(
            f"""
            SELECT
                url,
                COALESCE(
                    (SELECT t2.title FROM translations t2
                     WHERE t2.url = t1.url AND ({folder_clause})
                       AND t2.title IS NOT NULL AND t2.title != ''
                     ORDER BY t2.timestamp DESC LIMIT 1),
                    title,
                    url
                ) AS title,
                COUNT(*) AS sentence_count,
                MIN(toc_sort_order) AS toc_sort_order,
                MIN(id) AS min_id
            FROM translations t1
            WHERE {folder_clause}
            GROUP BY url
            """,
            tuple(params + params),
        )
        chapters = cursor.fetchall()
    finally:
        conn.close()

    chapters.sort(
        key=lambda x: (
            x.get("toc_sort_order") is None,
            x.get("toc_sort_order") if x.get("toc_sort_order") is not None else 0,
            x.get("min_id", 0),
            natural_sort_key(x.get("url") or ""),
            natural_sort_key(x.get("title") or ""),
        )
    )

    illu_rows = db.query(NovelIllustration).filter(NovelIllustration.book_name == decoded_book).all()
    counts_by_url: Dict[str, int] = {}
    for row in illu_rows:
        key = (row.chapter_url or "").rstrip("/")
        counts_by_url[key] = counts_by_url.get(key, 0) + 1

    result = []
    for idx, ch in enumerate(chapters, start=1):
        ch_url = ch.get("url") or ""
        result.append(
            {
                "index": idx,
                "url": ch_url,
                "title": ch.get("title") or ch_url,
                "sentence_count": ch.get("sentence_count") or 0,
                "illustration_count": counts_by_url.get(ch_url.rstrip("/"), 0),
            }
        )
    return result


@router.get("/book/{book_name}/pids")
def list_chapter_pids_for_illustrations(
    book_name: str,
    chapter_url: Optional[str] = Query(None),
    chapter_title: Optional[str] = Query(None),
) -> List[Dict[str, str]]:
    """특정 회차의 문단 PID 및 미리보기 텍스트 목록을 반환합니다."""
    decoded_book = unquote(book_name)
    resolved_url, resolved_title = _load_book_metadata(decoded_book, chapter_url, chapter_title)
    if not resolved_url and not resolved_title:
        raise HTTPException(status_code=400, detail="chapter_url 또는 chapter_title이 필요합니다.")

    conn = get_sqlite_conn(as_dict=True)
    try:
        cursor = conn.cursor()
        folder_clause = "folderName IS NULL" if decoded_book == "미분류" else "folderName = ?"
        params = [] if decoded_book == "미분류" else [decoded_book]
        if resolved_url:
            trimmed = resolved_url.rstrip("/")
            filter_sql = "(url = ? OR RTRIM(url, '/') = ?)"
            filter_params = [resolved_url, trimmed]
        else:
            filter_sql = "title = ?"
            filter_params = [resolved_title]

        cursor.execute(
            f"""
            SELECT pid, translated, original
            FROM translations
            WHERE {folder_clause} AND {filter_sql}
              AND pid IS NOT NULL AND pid != ''
            ORDER BY CASE
                WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%'
                THEN CAST(SUBSTR(pid, 2) AS INTEGER)
                ELSE 999999
            END ASC, timestamp ASC
            """,
            tuple(params + filter_params),
        )
        rows = cursor.fetchall()
    finally:
        conn.close()

    items = []
    for row in rows:
        preview_src = (row.get("translated") or row.get("original") or "").strip().replace("\n", " ")
        if len(preview_src) > 65:
            preview_src = preview_src[:62] + "..."
        items.append({"pid": row["pid"], "preview": preview_src})
    return items


@router.post("")
def create_illustration(
    req: IllustrationCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """새 본문 인라인 삽화를 등록하고 이미지를 저장합니다."""
    _require_loopback_if_source_path(request, req.source_path)

    book_name = (req.book_name or "").strip()
    if not book_name:
        raise HTTPException(status_code=400, detail="book_name은 필수입니다.")

    chapter_url, chapter_title = _load_book_metadata(book_name, req.chapter_url, req.chapter_title)
    if not chapter_url and not chapter_title:
        raise HTTPException(status_code=400, detail="대상 회차(chapter_url 또는 chapter_title)를 확인할 수 없습니다.")
    if not chapter_url:
        chapter_url = chapter_title

    try:
        stored = store_illustration_image(
            book_name=book_name,
            image_base64=req.image_base64,
            source_path=req.source_path,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    now_ts = int(time.time())
    item = NovelIllustration(
        book_name=book_name,
        chapter_url=chapter_url,
        chapter_title=chapter_title,
        after_pid=normalize_after_pid(req.after_pid),
        sort_order=int(req.sort_order or 0),
        caption=(req.caption or "").strip() or None,
        file_rel_path=stored["file_rel_path"],
        mime_type=stored["mime_type"],
        width=stored["width"],
        height=stored["height"],
        file_size=stored["file_size"],
        created_at=now_ts,
        updated_at=now_ts,
    )
    try:
        db.add(item)
        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        delete_stored_file(stored["file_rel_path"])
        raise

    return serialize_illustration(item)


@router.put("/{illustration_id}")
def update_illustration(
    illustration_id: int,
    req: IllustrationUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """등록된 삽화의 회차·문단 위치·캡션 또는 이미지를 수정합니다."""
    _require_loopback_if_source_path(request, req.source_path)

    item = db.query(NovelIllustration).filter(NovelIllustration.id == illustration_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="삽화 항목을 찾을 수 없습니다.")

    old_rel_path: Optional[str] = None
    new_rel_path: Optional[str] = None

    if req.image_base64 or req.source_path:
        try:
            stored = store_illustration_image(
                book_name=item.book_name,
                image_base64=req.image_base64,
                source_path=req.source_path,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        old_rel_path = item.file_rel_path
        new_rel_path = stored["file_rel_path"]
        item.file_rel_path = new_rel_path
        item.mime_type = stored["mime_type"]
        item.width = stored["width"]
        item.height = stored["height"]
        item.file_size = stored["file_size"]

    if req.chapter_url is not None or req.chapter_title is not None:
        resolved_url, resolved_title = _load_book_metadata(
            item.book_name,
            req.chapter_url if req.chapter_url is not None else item.chapter_url,
            req.chapter_title if req.chapter_title is not None else None,
        )
        if req.chapter_url is not None and req.chapter_url.strip():
            item.chapter_url = resolved_url or req.chapter_url.strip()
        if req.chapter_title is not None:
            item.chapter_title = req.chapter_title.strip() or resolved_title
        elif resolved_title:
            item.chapter_title = resolved_title

    if req.after_pid is not None:
        item.after_pid = normalize_after_pid(req.after_pid)
    if req.sort_order is not None:
        item.sort_order = int(req.sort_order)
    if req.caption is not None:
        item.caption = req.caption.strip() or None

    item.updated_at = int(time.time())

    try:
        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        if new_rel_path:
            delete_stored_file(new_rel_path)
        raise

    if old_rel_path and old_rel_path != item.file_rel_path:
        delete_stored_file(old_rel_path)

    return serialize_illustration(item)


@router.delete("/{illustration_id}")
def delete_illustration(illustration_id: int, db: Session = Depends(get_db)) -> Dict[str, Any]:
    """삽화를 삭제하고 모바일 동기화용 삭제 장부(Tombstone)에 기록합니다."""
    item = db.query(NovelIllustration).filter(NovelIllustration.id == illustration_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="삽화 항목을 찾을 수 없습니다.")

    rel_path = item.file_rel_path
    book_name = item.book_name
    now_ts = int(time.time())

    db.delete(item)
    db.add(
        DeletedRecord(
            entity_type="illustration",
            entity_id=str(illustration_id),
            parent_scope=book_name,
            deleted_at=now_ts,
        )
    )
    db.commit()

    delete_stored_file(rel_path)
    return {"success": True, "deleted_id": illustration_id}


@router.get("/{illustration_id}/image")
def get_illustration_image(illustration_id: int, db: Session = Depends(get_db)):
    """등록된 삽화의 이미지 파일을 반환합니다."""
    item = db.query(NovelIllustration).filter(NovelIllustration.id == illustration_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="삽화 항목을 찾을 수 없습니다.")

    abs_path = resolve_illustration_abs_path(item.file_rel_path)
    if not abs_path or not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="삽화 이미지 파일이 서버에 존재하지 않습니다.")

    return FileResponse(
        path=abs_path,
        media_type=item.mime_type or "image/png",
        headers={
            "Cache-Control": "public, max-age=86400",
        },
    )
