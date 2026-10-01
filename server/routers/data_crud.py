"""
LANOVEL Data CRUD Router
Coordinates basic translation CRUD, chapter title normalization, abnormal detection,
cleanup queues, trash restoration, and similar translation example queries.
Underlying services are cleanly modularized in server.services.
"""

import asyncio
from collections import defaultdict
from datetime import datetime
import json
import logging
import os
import re
import sqlite3
import time
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from server.database import dict_factory, get_db, get_db_path, get_sqlite_conn
from server.models import (
    AppliedUrl,
    BookActivity,
    CleanupNotification,
    CleanupQueuedItem,
    Translation,
    TranslationTrash,
    UrlMetadata,
)
from server.notifications import update_translation_status
from server.routers.translation import handle_verbatim_cleanup_items
from server.rule_classifier import (
    classify_translation,
    extract_untranslated_keywords,
    is_verbatim_copy,
    restore_brackets,
)
from server.settings import settings
from server.utils import natural_sort_key, get_url_variants

# --- Sub-Services Re-exports for High Cohesion & Backward Compatibility ---
from server.services.chapter_service import clean_chapter_title
from server.services.abnormal_service import (
    AbnormalWhitelistRequest,
    add_abnormal_whitelist_items,
    clear_abnormal_whitelist_data,
    get_abnormal_translations_data,
    get_abnormal_whitelist_data,
    remove_abnormal_whitelist_items,
)
from server.services.cleanup_trash_service import (
    CleanupDeleteRequest,
    MoveToCleanupRequest,
    RestoreRequest,
    delete_cleanup_queue_items,
    dismiss_all_cleanup_notifications,
    dismiss_cleanup_notification,
    get_cleanup_notifications_data,
    get_cleanup_queue_data,
    get_cleanup_review_targets_data,
    get_translation_trash_data,
    move_items_to_cleanup,
    restore_trash_items,
)
from server.services.similarity_service import get_similar_examples_data

router = APIRouter()
logger = logging.getLogger(__name__)

CHUNK_SIZE = 999


# --- Pydantic Models ---
class TranslationItem(BaseModel):
    url: str
    pid: Optional[str] = None
    original: str
    translated: str
    timestamp: int
    folderName: Optional[str] = None
    title: Optional[str] = None


class MoveRequest(BaseModel):
    ids: List[int]
    folder_name: Optional[str]


class DeleteRequest(BaseModel):
    ids: List[int]


# =========================================================================
# 1. Basic Translation CRUD Endpoints
# =========================================================================

@router.get(
    "/translations",
    tags=["Data CRUD"],
    summary="번역 기록 조회",
    description="데이터베이스에서 번역 기록을 조회합니다. 폴더, 검색어, URL로 필터링할 수 있습니다."
)
def get_translations(
    skip: int = 0,
    limit: int = 100,
    folder: Optional[str] = None,
    search: Optional[str] = None,
    url: Optional[str] = None
):
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    base_query = "FROM translations"
    count_query = "SELECT COUNT(*) as total_count " + base_query
    data_query = "SELECT * " + base_query

    conditions = []
    params = []

    if folder:
        if folder == '폴더 없음':
            conditions.append("folderName IS NULL")
        else:
            conditions.append("folderName = ?")
            params.append(folder)

    if search:
        use_fts = False
        try:
            clean_search = '"' + search.replace('"', '""') + '"'
            fts_rows = cursor.execute(
                "SELECT rowid FROM translations_fts WHERE translations_fts MATCH ? LIMIT 1000",
                (clean_search,)
            ).fetchall()
            matched_ids = [
                row['id'] if isinstance(row, dict) and 'id' in row
                else (row['rowid'] if isinstance(row, dict) and 'rowid' in row else row[0])
                for row in fts_rows
            ]
            if matched_ids:
                placeholders = ', '.join('?' * len(matched_ids))
                conditions.append(f"id IN ({placeholders})")
                params.extend(matched_ids)
                use_fts = True
        except Exception:
            use_fts = False

        if not use_fts:
            conditions.append("(original LIKE ? OR translated LIKE ?)")
            params.extend([f'%{search}%', f'%{search}%'])

    if url:
        url_list = get_url_variants(url)
        placeholders = ', '.join('?' * len(url_list))
        conditions.append(f"url IN ({placeholders})")
        params.extend(url_list)

    if conditions:
        where_clause = " WHERE " + " AND ".join(conditions)
        count_query += where_clause
        data_query += where_clause

    total_count = cursor.execute(count_query, tuple(params)).fetchone()['total_count']

    data_query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, skip])

    translations = cursor.execute(data_query, tuple(params)).fetchall()
    conn.close()

    return JSONResponse(content={
        "total_count": total_count,
        "translations": translations
    })


@router.post(
    "/translations/upsert",
    tags=["Data CRUD"],
    summary="번역 기록 추가 또는 업데이트",
    description="번역 기록을 데이터베이스에 추가하거나 업데이트하고, URL 최초 접근 시간을 기록합니다."
)
def upsert_translations(items: List[TranslationItem], db: Session = Depends(get_db)):
    updated_count = 0
    inserted_count = 0

    # 0. 모든 항목의 URL에서 #lanovel_review 등 해시를 완벽히 제거하여 정규화
    for item in items:
        if item.url:
            item.url = item.url.split('#')[0].strip()

    # 1. 처리할 모든 URL 수집 및 새 메타데이터 일괄 등록
    urls_in_batch = {item.url for item in items}
    existing_metadata = db.query(UrlMetadata).filter(UrlMetadata.url.in_(urls_in_batch)).all()
    existing_metadata_urls = {meta.url for meta in existing_metadata}

    new_metadata_list = [
        UrlMetadata(url=url, first_accessed_at=int(time.time()))
        for url in urls_in_batch if url not in existing_metadata_urls
    ]
    if new_metadata_list:
        db.add_all(new_metadata_list)

    # 2. 배치 내 URL에 해당하는 기존 번역 데이터를 1번 쿼리로 일괄 조회하여 N+1 제거
    existing_translations = db.query(Translation).filter(Translation.url.in_(urls_in_batch)).all()
    existing_map = {(t.url, t.pid): t for t in existing_translations}

    # URL별 기존 제목 맵 및 이번 배치에서 새로 적용할 최신 제목 맵 구성
    url_to_title = {}
    for t in existing_translations:
        if t.url and t.title and t.url not in url_to_title:
            url_to_title[t.url] = t.title

    for item in items:
        if item.url and item.title:
            cleaned_title = clean_chapter_title(item.title, item.url)
            if cleaned_title:
                url_to_title[item.url] = cleaned_title

    verbatim_items_to_clean = []
    target_title = None

    for item in items:
        key = (item.url, item.pid)
        existing_translation = existing_map.get(key)
        target_title = url_to_title.get(item.url) if item.url else (clean_chapter_title(item.title, item.url) if item.title else None)

        target_trans = item.translated
        # 룰베이스 원문 괄호(「」, 『』) 누락 복원
        if target_trans:
            target_trans = restore_brackets(item.original, target_trans)

        # 원문 복붙(글자만 일치) 및 원문 변형(일본어/중국어) 방어
        cls_cat = classify_translation(item.original, target_trans)
        if target_trans and (is_verbatim_copy(item.original, target_trans) or cls_cat in ('verbatim_or_empty', 'paraphrased_jp', 'paraphrased_zh')):
            item_cat = cls_cat if (cls_cat in ('paraphrased_jp', 'paraphrased_zh')) else 'verbatim'
            verbatim_items_to_clean.append({
                "id": item.pid,
                "original": item.original,
                "translated": target_trans,
                "url": item.url,
                "folderName": item.folderName,
                "title": target_title or item.title,
                "category": item_cat
            })
            if existing_translation:
                db.delete(existing_translation)
                if key in existing_map:
                    del existing_map[key]
            continue

        # 번역문이 빈 문자열이거나 None인 경우: Translation 테이블에 빈 레코드로 적재하지 않음
        if not target_trans or not str(target_trans).strip():
            if existing_translation:
                db.delete(existing_translation)
                if key in existing_map:
                    del existing_map[key]
            continue

        if existing_translation:
            existing_translation.translated = target_trans
            existing_translation.timestamp = item.timestamp
            if item.folderName is not None:
                existing_translation.folderName = item.folderName
            if target_title:
                existing_translation.title = target_title
            updated_count += 1
        else:
            new_translation = Translation(
                url=item.url,
                pid=item.pid,
                original=item.original,
                translated=target_trans,
                timestamp=item.timestamp,
                folderName=item.folderName,
                title=target_title or item.title
            )
            db.add(new_translation)
            existing_map[key] = new_translation
            inserted_count += 1

    # 동일 URL을 공유하는 모든 단락의 제목을 최신 title로 원자적 동기화
    for u, resolved_title in url_to_title.items():
        if resolved_title:
            db.query(Translation).filter(Translation.url == u).update(
                {Translation.title: resolved_title},
                synchronize_session=False
            )

    # 복붙/변형 감지 항목이 있다면 handle_verbatim_cleanup_items를 통해 휴지통 및 알림에 등록
    if verbatim_items_to_clean:
        grouped = defaultdict(list)
        for v in verbatim_items_to_clean:
            grouped[v["url"]].append(v)
        for v_url, v_items in grouped.items():
            handle_verbatim_cleanup_items(
                db=db,
                url=v_url,
                verbatim_items=[{
                    "id": x["id"],
                    "original": x["original"],
                    "translated": x["translated"],
                    "category": x.get("category", "verbatim")
                } for x in v_items],
                folder_name=v_items[0]["folderName"],
                title=v_items[0]["title"]
            )

    db.commit()

    if items:
        latest_item = items[-1]
        t_title = target_title or latest_item.title
        b_title = latest_item.folderName or (t_title.split()[0] if t_title else "번역 작업")
        update_translation_status(
            book_title=b_title,
            episode_title=t_title,
            current_sentence=inserted_count + updated_count,
            total_sentences=len(items),
            percentage=None,
            is_active=True,
            status_text=None
        )

    return {
        "inserted": inserted_count,
        "updated": updated_count,
        "verbatim_count": len(verbatim_items_to_clean)
    }


@router.put(
    "/translations/move",
    tags=["Data CRUD"],
    summary="번역 기록 이동",
    description="지정된 ID의 번역 기록들을 새 폴더로 이동합니다."
)
def move_translations(req: MoveRequest):
    if not req.ids:
        return {"message": "0개의 항목이 이동되었습니다."}

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    updated_count = 0
    try:
        for i in range(0, len(req.ids), CHUNK_SIZE):
            chunk = req.ids[i:i + CHUNK_SIZE]
            placeholders = ', '.join('?' * len(chunk))
            query = f"UPDATE translations SET folderName = ? WHERE id IN ({placeholders})"
            params = [req.folder_name] + chunk
            cursor.execute(query, params)
            updated_count += cursor.rowcount
        conn.commit()
    finally:
        conn.close()

    return {"message": f"{updated_count}개의 항목이 이동되었습니다."}


@router.post(
    "/translations/delete",
    tags=["Data CRUD"],
    summary="번역 기록 삭제",
    description="지정된 ID의 번역 기록들을 삭제합니다."
)
def delete_translations(req: DeleteRequest):
    if not req.ids:
        return {"message": "0개의 항목이 삭제되었습니다."}

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    deleted_count = 0
    try:
        for i in range(0, len(req.ids), CHUNK_SIZE):
            chunk = req.ids[i:i + CHUNK_SIZE]
            placeholders = ', '.join('?' * len(chunk))
            query = f"DELETE FROM translations WHERE id IN ({placeholders})"
            cursor.execute(query, chunk)
            deleted_count += cursor.rowcount
            cursor.execute(f"DELETE FROM cleanup_queued_items WHERE translation_id IN ({placeholders})", chunk)
        conn.commit()
    finally:
        conn.close()

    return {"message": f"{deleted_count}개의 항목이 삭제되었습니다."}


@router.get(
    "/paged_translations",
    tags=["Data CRUD"],
    summary="페이지별 번역 기록 조회"
)
@router.get(
    "/translations/paged",
    tags=["Data CRUD"],
    summary="페이지별 번역 기록 조회 (별칭)"
)
def get_paged_translations(page: int = 1, per_page: int = 20):
    offset = (page - 1) * per_page
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    total_records = cursor.execute("SELECT COUNT(*) as count FROM translations").fetchone()['count']
    translations = cursor.execute(
        "SELECT * FROM translations ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (per_page, offset)
    ).fetchall()

    conn.close()

    total_pages = (total_records + per_page - 1) // per_page
    return {
        "page": page,
        "per_page": per_page,
        "total_records": total_records,
        "total_pages": total_pages,
        "translations": translations
    }


@router.get(
    "/translations_by_folder",
    tags=["Data CRUD"],
    summary="폴더별 번역 기록 조회 (관리자 UI용 - 레거시 호환)"
)
@router.get(
    "/translations/by_folder",
    tags=["Data CRUD"],
    summary="폴더별 번역 기록 조회 (관리자 UI용)",
    description="번역 기록을 폴더와 URL별로 그룹화하여 계층 구조로 반환합니다."
)
def get_translations_by_folder(
    folder: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db)
):
    queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}

    query = db.query(
        Translation.id,
        Translation.url,
        Translation.pid,
        Translation.original,
        Translation.translated,
        Translation.timestamp,
        Translation.folderName,
        Translation.title,
        Translation.toc_sort_order
    )

    if folder:
        if folder == '폴더 추가 대기 상태':
            query = query.filter(Translation.folderName.is_(None))
        else:
            query = query.filter(Translation.folderName == folder)

    if search:
        query = query.filter(
            (Translation.original.contains(search)) |
            (Translation.translated.contains(search)) |
            (Translation.title.contains(search))
        )

    all_translations = query.all()

    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    for t in all_translations:
        folder_name = t.folderName or "폴더 추가 대기 상태"
        url = t.url
        if url:
            grouped_by_folder[folder_name][url].append({
                "id": t.id,
                "url": t.url,
                "pid": t.pid,
                "original": t.original,
                "translated": t.translated,
                "timestamp": t.timestamp,
                "folderName": t.folderName,
                "title": t.title,
                "toc_sort_order": t.toc_sort_order,
                "is_queued_for_cleanup": t.id in queued_ids
            })

    applied_urls_set = {row.url for row in db.query(AppliedUrl).all()}

    final_response = {}
    for folder_name, url_groups in grouped_by_folder.items():
        url_group_list = []
        for url, items in url_groups.items():
            sort_order = items[0]['toc_sort_order'] if items and items[0]['toc_sort_order'] is not None else None
            url_group_list.append({"url": url, "items": items, "toc_sort_order": sort_order})

        url_group_list.sort(key=lambda x: (
            x['toc_sort_order'] is None,
            x['toc_sort_order'] if x['toc_sort_order'] is not None else 0,
            natural_sort_key(x['url'])
        ))
        final_response[folder_name] = url_group_list

    final_response["_applied_urls"] = list(applied_urls_set)

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=final_response, headers=headers)


# =========================================================================
# 2. Abnormal Detection & Whitelist Endpoints (via abnormal_service)
# =========================================================================

@router.get(
    "/translations/abnormal",
    tags=["Data CRUD"],
    summary="이상 번역 기록 조회 (규칙 3, 4)",
    description="일부 번역 안 함(규칙 4) 및 다른 언어로 번역(규칙 3) 이상 번역 기록을 조회합니다."
)
def get_abnormal_translations(
    category_filter: Optional[str] = None,
    response: Response = None,
    db: Session = Depends(get_db)
):
    data = get_abnormal_translations_data(category_filter, db)
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return data


@router.post(
    "/translations/abnormal_whitelist/add",
    tags=["Data CRUD"],
    summary="이상 번역 검사에서 단락 제외 (화이트리스트 등록)"
)
def add_to_abnormal_whitelist(req: AbnormalWhitelistRequest, db: Session = Depends(get_db)):
    return add_abnormal_whitelist_items(req.ids, db)


@router.post(
    "/translations/abnormal_whitelist/remove",
    tags=["Data CRUD"],
    summary="이상 번역 화이트리스트에서 제외 해제"
)
def remove_from_abnormal_whitelist(req: AbnormalWhitelistRequest, db: Session = Depends(get_db)):
    return remove_abnormal_whitelist_items(req.ids, db)


@router.get(
    "/translations/abnormal_whitelist",
    tags=["Data CRUD"],
    summary="이상 번역 제외(화이트리스트) 목록 조회"
)
def get_abnormal_whitelist(db: Session = Depends(get_db)):
    return get_abnormal_whitelist_data(db)


@router.post(
    "/translations/abnormal_whitelist/clear",
    tags=["Data CRUD"],
    summary="이상 번역 화이트리스트 전체 해제"
)
def clear_abnormal_whitelist(db: Session = Depends(get_db)):
    return clear_abnormal_whitelist_data(db)


# =========================================================================
# 3. Cleanup Queue & Trash Restoration Endpoints (via cleanup_trash_service)
# =========================================================================

@router.post(
    "/translations/move_to_cleanup",
    tags=["Data CRUD"],
    summary="선택한 이상 번역 항목을 원문 정리 섹션으로 이동"
)
def move_to_cleanup(req: MoveToCleanupRequest, db: Session = Depends(get_db)):
    return move_items_to_cleanup(req.ids, db)


@router.get(
    "/translations/cleanup_queue",
    tags=["Data CRUD"],
    summary="원문 복제·변형 정리 대기열 조회",
    description="규칙 1(원문 그대로), 규칙 2(원문 변형) 및 수동 이동된 항목들을 조회합니다."
)
def get_cleanup_queue(response: Response = None, db: Session = Depends(get_db)):
    data = get_cleanup_queue_data(db)
    if response:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return data


@router.post(
    "/translations/cleanup_queue/delete",
    tags=["Data CRUD"],
    summary="원문 정리 항목 수동 삭제 및 휴지통/알림 생성"
)
def delete_cleanup_queue(req: CleanupDeleteRequest, db: Session = Depends(get_db)):
    return delete_cleanup_queue_items(req, db)


@router.get(
    "/translations/trash",
    tags=["Data CRUD"],
    summary="휴지통 목록 조회"
)
def get_translation_trash(db: Session = Depends(get_db)):
    return get_translation_trash_data(db)


@router.post(
    "/translations/trash/restore",
    tags=["Data CRUD"],
    summary="휴지통 항목 되돌리기 (복원)"
)
def restore_trash(req: RestoreRequest, db: Session = Depends(get_db)):
    return restore_trash_items(req, db)


@router.get(
    "/cleanup/notifications",
    tags=["Data CRUD"],
    summary="삭제 알림 및 7일 보존 이력 조회"
)
def get_cleanup_notifications(db: Session = Depends(get_db)):
    return get_cleanup_notifications_data(db)


@router.post(
    "/cleanup/notifications/{notif_id}/dismiss",
    tags=["Data CRUD"],
    summary="삭제 알림 개별 해제"
)
def dismiss_notification(
    notif_id: int,
    url: Optional[str] = None,
    db: Session = Depends(get_db)
):
    return dismiss_cleanup_notification(notif_id, url, db)


@router.post(
    "/cleanup/notifications/dismiss_all",
    tags=["Data CRUD"],
    summary="삭제 알림 전체 해제"
)
def dismiss_all_notifications(db: Session = Depends(get_db)):
    return dismiss_all_cleanup_notifications(db)


@router.get(
    "/cleanup/review_targets",
    tags=["Data CRUD"],
    summary="알림 연계 재번역 검수 대상 조회",
    description="특정 URL(또는 batch_id)에 대해 최근 삭제/정리된 이력(문제 문장 PID 및 원문)과 활성 알림 정보를 반환합니다."
)
def get_cleanup_review_targets(
    url: str,
    batch_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    return get_cleanup_review_targets_data(url, batch_id, db)


# =========================================================================
# 4. Similarity Search & Streaming & Migration Endpoints
# =========================================================================

@router.get(
    "/translations/similar_examples",
    tags=["Data CRUD"],
    summary="유사 번역 단락 추천"
)
def get_similar_examples(
    keyword: str,
    folder: Optional[str] = None,
    exclude_id: Optional[int] = None,
    limit: int = 8,
    db: Session = Depends(get_db)
):
    return get_similar_examples_data(keyword, folder, exclude_id, limit, db)


async def stream_translations(book: Optional[str] = None):
    """DB에서 번역 데이터를 스트리밍합니다. '미분류' 폴더를 지원합니다."""
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    query = "SELECT * FROM translations"
    params = []
    if book:
        if book == "미분류":
            query += " WHERE folderName IS NULL"
        else:
            query += " WHERE folderName = ?"
            params.append(book)

    query += " ORDER BY timestamp ASC"
    cursor.execute(query, tuple(params))

    try:
        while True:
            record = cursor.fetchone()
            if not record:
                break
            yield f"data: {json.dumps(record)}\n\n"
            await asyncio.sleep(0.05)
    finally:
        conn.close()


@router.get(
    "/stream",
    tags=["Data CRUD"],
    summary="번역 데이터 스트리밍",
    description="번역 데이터를 SSE(Server-Sent Events)로 스트리밍하는 엔드포인트입니다. 특정 책(폴더)의 데이터만 스트리밍할 수 있습니다."
)
async def stream(book: Optional[str] = None):
    return StreamingResponse(stream_translations(book=book), media_type="text/event-stream")


@router.post(
    "/migrate",
    tags=["Data CRUD"],
    summary="데이터 마이그레이션",
    description="`migration_data.json` 파일에서 데이터를 읽어 데이터베이스로 이전합니다."
)
def migrate_data():
    try:
        with open("migration_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="migration_data.json 파일을 찾을 수 없습니다.")

    conn = get_sqlite_conn()
    cursor = conn.cursor()

    migrated_count = 0
    skipped_count = 0

    for record in data:
        try:
            date_str = record['날짜']
            if '오후' in date_str:
                parts = date_str.split(' 오후 ')
                is_pm = True
            else:
                parts = date_str.split(' 오전 ')
                is_pm = False

            date_part_str = parts[0]
            time_part_str = parts[1]
            time_parts = time_part_str.split(':')
            hour = int(time_parts[0])
            minute = int(time_parts[1])
            second = int(time_parts[2])

            if is_pm and hour != 12:
                hour += 12
            if not is_pm and hour == 12:
                hour = 0

            date_parts = [p.strip() for p in date_part_str.replace('.', ' ').split()]
            year = int(date_parts[0])
            month = int(date_parts[1])
            day = int(date_parts[2])

            dt_object = datetime(year, month, day, hour, minute, second)
            ts = int(dt_object.timestamp())

            cursor.execute("""
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                record['URL'],
                record['PID'],
                record['원문'],
                record['번역'],
                ts,
                record['폴더'] if record['폴더'] != '폴더 없음' else None
            ))
            migrated_count += 1
        except sqlite3.IntegrityError:
            skipped_count += 1
        except Exception as e:
            logger.error(f"레코드 처리 중 오류 발생: {record}, 오류: {e}")
            skipped_count += 1

    conn.commit()
    conn.close()

    return {
        "message": "데이터 이전 완료",
        "total_records": len(data),
        "migrated_count": migrated_count,
        "skipped_count": skipped_count
    }