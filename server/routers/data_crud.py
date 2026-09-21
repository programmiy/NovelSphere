import sqlite3
import os
import re
import asyncio
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
from collections import defaultdict
from urllib.parse import urlparse
import uuid

from server.settings import settings
from server.database import get_db, get_sqlite_conn, dict_factory, get_db_path
from server.models import Translation, UrlMetadata, AppliedUrl, TranslationTrash, CleanupNotification, CleanupQueuedItem, AbnormalWhitelist
from server.rule_classifier import classify_translation, extract_untranslated_keywords, is_verbatim_copy
from server.utils import natural_sort_key
from server.routers.translation import handle_verbatim_cleanup_items
import time

router = APIRouter()

# Pydantic Models
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

class MoveToCleanupRequest(BaseModel):
    ids: List[int]

class CleanupDeleteRequest(BaseModel):
    ids: Optional[List[int]] = None
    all_queue: Optional[bool] = False

class RestoreRequest(BaseModel):
    trash_ids: Optional[List[int]] = None
    batch_id: Optional[str] = None
    all_trash: Optional[bool] = False

class AbnormalWhitelistRequest(BaseModel):
    ids: List[int]

# API Endpoints
@router.get(
    "/translations",
    tags=["Data CRUD"],
    summary="번역 기록 조회",
    description="데이터베이스에서 번역 기록을 조회합니다. 폴더, 검색어, URL로 필터링할 수 있습니다."
)
def get_translations(skip: int = 0, limit: int = 100, folder: Optional[str] = None, search: Optional[str] = None, url: Optional[str] = None):
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
            fts_rows = cursor.execute("SELECT rowid FROM translations_fts WHERE translations_fts MATCH ? LIMIT 1000", (clean_search,)).fetchall()
            matched_ids = [row['id'] if isinstance(row, dict) and 'id' in row else (row['rowid'] if isinstance(row, dict) and 'rowid' in row else row[0]) for row in fts_rows]
            if matched_ids:
                placeholders = ', '.join('?' * len(matched_ids))
                conditions.append(f"id IN ({placeholders})")
                params.extend(matched_ids)
                use_fts = True
            else:
                use_fts = False
        except Exception:
            use_fts = False

        if not use_fts:
            conditions.append("(original LIKE ? OR translated LIKE ?)")
            params.extend([f'%{search}%', f'%{search}%'])
    
    if url:
        urls_to_check = set()
        urls_to_check.add(url.rstrip('/'))
        urls_to_check.add(url.rstrip('/') + '/')
        no_protocol_url = re.sub(r'^https?://', '', url).rstrip('/')
        urls_to_check.add('http://' + no_protocol_url)
        urls_to_check.add('http://' + no_protocol_url + '/')
        urls_to_check.add('https://' + no_protocol_url)
        urls_to_check.add('https://' + no_protocol_url + '/')
        if no_protocol_url.startswith('www.'):
            no_www_url = no_protocol_url.replace('www.', '', 1)
            urls_to_check.add('http://' + no_www_url)
            urls_to_check.add('http://' + no_www_url + '/')
            urls_to_check.add('https://' + no_www_url)
            urls_to_check.add('https://' + no_www_url + '/')
        else:
            with_www_url = 'www.' + no_protocol_url
            urls_to_check.add('http://' + with_www_url)
            urls_to_check.add('http://' + with_www_url + '/')
            urls_to_check.add('https://' + with_www_url)
            urls_to_check.add('https://' + with_www_url + '/')

        url_list = list(urls_to_check)
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

    # 2. 배치 내 URL에 해당하는 기존 번역 데이터를 1회 쿼리로 일괄 조회하여 N+1 제거
    existing_translations = db.query(Translation).filter(Translation.url.in_(urls_in_batch)).all()
    existing_map = {(t.url, t.pid): t for t in existing_translations}

    verbatim_items_to_clean = []
    for item in items:
        key = (item.url, item.pid)
        existing_translation = existing_map.get(key)

        target_trans = item.translated
        # 원문 복붙(글자만 일치) 방어: DB에 일본어 원문이 번역문으로 적재되는 것을 차단하고 알림/휴지통 처리
        if target_trans and is_verbatim_copy(item.original, target_trans):
            verbatim_items_to_clean.append({
                "id": item.pid,
                "original": item.original,
                "translated": target_trans,
                "url": item.url,
                "folderName": item.folderName,
                "title": item.title
            })
            if existing_translation:
                db.delete(existing_translation)
                if key in existing_map:
                    del existing_map[key]
            continue

        # 번역문이 빈 문자열이나 None인 경우: Translation 테이블에 빈 레코드로 적재하지 않음
        if not target_trans or not str(target_trans).strip():
            if existing_translation:
                db.delete(existing_translation)
                if key in existing_map:
                    del existing_map[key]
            continue

        if existing_translation:
            # 데이터 업데이트
            existing_translation.translated = target_trans
            existing_translation.timestamp = item.timestamp
            if item.folderName is not None:
                existing_translation.folderName = item.folderName
            if item.title:
                existing_translation.title = item.title
            updated_count += 1
        else:
            # 새 데이터 삽입
            new_translation = Translation(
                url=item.url,
                pid=item.pid,
                original=item.original,
                translated=target_trans,
                timestamp=item.timestamp,
                folderName=item.folderName,
                title=item.title
            )
            db.add(new_translation)
            existing_map[key] = new_translation  # 배치 내 중복 항목 대비
            inserted_count += 1

    # 복붙 감지 항목이 있다면 handle_verbatim_cleanup_items를 통해 휴지통 및 알림에 등록
    if verbatim_items_to_clean:
        grouped = defaultdict(list)
        for v in verbatim_items_to_clean:
            grouped[v["url"]].append(v)
        for v_url, v_items in grouped.items():
            handle_verbatim_cleanup_items(
                db=db,
                url=v_url,
                verbatim_items=[{"id": x["id"], "original": x["original"], "translated": x["translated"]} for x in v_items],
                folder_name=v_items[0]["folderName"],
                title=v_items[0]["title"]
            )

    # 단일 트랜잭션으로 원자적(Atomic) 커밋
    db.commit()
    return {"inserted": inserted_count, "updated": updated_count}

CHUNK_SIZE = 500

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
        conn.commit()
    finally:
        conn.close()

    return {"message": f"{deleted_count}개의 항목이 삭제되었습니다."}

@router.get(
    "/paged_translations",
    tags=["Data CRUD"],
    summary="페이지별 번역 기록 조회",
    description="페이지네이션을 지원하는 번역 기록 조회 엔드포인트입니다."
)
def get_paged_translations(page: int = 1, per_page: int = 20):
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    # 전체 항목 수 계산
    count_query = "SELECT COUNT(*) as total_count FROM translations"
    total_count = cursor.execute(count_query).fetchone()['total_count']

    # 현재 페이지 데이터 조회
    offset = (page - 1) * per_page
    data_query = "SELECT * FROM translations ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    translations = cursor.execute(data_query, (per_page, offset)).fetchall()

    conn.close()

    return {
        "total_count": total_count,
        "translations": translations
    }

@router.get(
    "/translations_by_folder",
    tags=["Data CRUD"],
    summary="폴더별 번역 기록 조회",
    description="데이터베이스에서 모든 번역 기록을 폴더와 URL별로 그룹화하고 조회합니다. folder 지정 시 해당 폴더만 필터링하며, light=True 지정 시 본문 텍스트를 제외하여 전송 성능을 높입니다."
)
def get_translations_by_folder(
    light: bool = False,
    folder: Optional[str] = None,
    db: Session = Depends(get_db)
):
    
    # 모든 데이터를 한 번에 조회
    applied_urls_set = {row.url for row in db.query(AppliedUrl).all()}
    
    if light:
        query = db.query(
            Translation.id,
            Translation.url,
            Translation.pid,
            Translation.timestamp,
            Translation.folderName,
            Translation.title,
            Translation.toc_sort_order
        )
    else:
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
        if folder in ("폴더 추가 대기 상태", "미분류"):
            query = query.filter(Translation.folderName.is_(None))
        else:
            query = query.filter(Translation.folderName == folder)

    translations = query.all()

    # 폴더 및 URL별로 그룹화
    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    for t in translations:
        folder_name = t.folderName or "폴더 추가 대기 상태"
        if t.url:
            # Translation 객체를 직렬화 가능한 dict로 변환 (light=True 시 본문 필드를 빈 값으로 대체)
            grouped_by_folder[folder_name][t.url].append({
                "id": t.id,
                "url": t.url,
                "pid": t.pid,
                "original": "" if light else t.original,
                "translated": "" if light else t.translated,
                "timestamp": t.timestamp,
                "folderName": t.folderName,
                "title": t.title,
                "toc_sort_order": t.toc_sort_order
            })

    # 최종 응답 생성 및 정렬
    final_response = {}
    for folder_name, url_groups in grouped_by_folder.items():
        url_group_list = []
        for url, items in url_groups.items():
            # 그룹의 toc_sort_order를 첫 번째 아이템에서 가져옵니다.
            # 동일 URL 그룹 내 모든 아이템은 같은 값을 가집니다.
            sort_order = items[0]['toc_sort_order'] if items and items[0]['toc_sort_order'] is not None else None

            url_group_list.append({
                "url": url,
                "items": items,
                "toc_sort_order": sort_order
            })

        # 정렬: toc_sort_order를 기준으로 오름차순 정렬. 없는 경우 URL 자연 정렬(001 -> 002 -> 010 -> 100)
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

@router.get(
    "/translations/abnormal",
    tags=["Data CRUD"],
    summary="이상 번역 기록 조회 (규칙 3, 4)",
    description="일부 번역 안 함(규칙 4) 및 다른 언어로 번역(규칙 3) 이상 번역 기록을 조회합니다."
)
def get_abnormal_translations(category_filter: Optional[str] = None, db: Session = Depends(get_db)):
    queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}

    # Whitelisted items (excluded from abnormal detection)
    whitelisted_rows = db.query(AbnormalWhitelist).all()
    whitelisted_ids = {row.translation_id for row in whitelisted_rows}
    whitelisted_url_pids = {(row.url, row.pid) for row in whitelisted_rows if row.url and row.pid}

    # 1. 빠른 1차 후보군 필터링 (가나 또는 한자 포함 번역문)
    CANDIDATE_REGEX = r'[\u3040-\u309f\u30a0-\u30fa\u4e00-\u9faf\u3400-\u4dbf]'
    query = text("""
        SELECT id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order
        FROM translations
        WHERE translated REGEXP :pattern
    """)
    candidates = db.execute(query, {"pattern": CANDIDATE_REGEX}).fetchall()

    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    cat_counts = {"total": 0, "partial_untranslated": 0, "other_language": 0}

    for t in candidates:
        t_dict = t._asdict()
        t_id = t_dict.get("id")
        t_url = t_dict.get("url")
        t_pid = t_dict.get("pid")

        # Skip if whitelisted from abnormal detection
        if t_id in whitelisted_ids or (t_url, t_pid) in whitelisted_url_pids:
            continue

        cat = classify_translation(t_dict.get("original"), t_dict.get("translated"))
        # 오직 규칙 3 (other_language)과 규칙 4 (partial_untranslated)만 대상
        if cat not in ('other_language', 'partial_untranslated'):
            continue

        cat_counts["total"] += 1
        cat_counts[cat] += 1

        if category_filter and category_filter != 'all' and cat != category_filter:
            continue

        folder_name = t_dict.get("folderName") or "폴더 추가 대기 상태"
        url = t_dict.get("url")
        if url:
            untrans_kw = extract_untranslated_keywords(t_dict.get("original") or "", t_dict.get("translated") or "")
            grouped_by_folder[folder_name][url].append({
                "id": t_dict.get("id"),
                "url": url,
                "pid": t_dict.get("pid"),
                "original": t_dict.get("original"),
                "translated": t_dict.get("translated"),
                "timestamp": t_dict.get("timestamp"),
                "folderName": t_dict.get("folderName"),
                "title": t_dict.get("title"),
                "toc_sort_order": t_dict.get("toc_sort_order"),
                "category": cat,
                "category_label": "일부 번역 안 함" if cat == "partial_untranslated" else "다른 언어로 번역",
                "untranslated_keywords": untrans_kw,
                "is_queued_for_cleanup": t_dict.get("id") in queued_ids
            })

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

    applied_urls_set = {row.url for row in db.query(AppliedUrl).all()}
    final_response["_applied_urls"] = list(applied_urls_set)
    final_response["_category_counts"] = cat_counts

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=final_response, headers=headers)

@router.post(
    "/translations/abnormal_whitelist/add",
    tags=["Data CRUD"],
    summary="이상 번역 검사에서 단락 제외 (화이트리스트 등록)"
)
def add_to_abnormal_whitelist(req: AbnormalWhitelistRequest, db: Session = Depends(get_db)):
    now = int(time.time())
    added_count = 0
    translations = db.query(Translation).filter(Translation.id.in_(req.ids)).all()
    for t in translations:
        exists = db.query(AbnormalWhitelist).filter(
            (AbnormalWhitelist.translation_id == t.id) |
            ((AbnormalWhitelist.url == t.url) & (AbnormalWhitelist.pid == t.pid))
        ).first()
        if not exists:
            db.add(AbnormalWhitelist(
                translation_id=t.id,
                url=t.url,
                pid=t.pid,
                created_at=now
            ))
            added_count += 1
    db.commit()
    return {"success": True, "added_count": added_count, "message": f"{added_count}개의 단락이 이상번역 검사에서 제외되었습니다."}

@router.post(
    "/translations/abnormal_whitelist/remove",
    tags=["Data CRUD"],
    summary="이상 번역 화이트리스트에서 제외 해제"
)
def remove_from_abnormal_whitelist(req: AbnormalWhitelistRequest, db: Session = Depends(get_db)):
    deleted_count = db.query(AbnormalWhitelist).filter(
        (AbnormalWhitelist.translation_id.in_(req.ids)) | (AbnormalWhitelist.id.in_(req.ids))
    ).delete(synchronize_session=False)
    db.commit()
    return {"success": True, "deleted_count": deleted_count, "message": f"{deleted_count}개 단락의 이상번역 제외 설정이 해제되었습니다."}

@router.get(
    "/translations/abnormal_whitelist",
    tags=["Data CRUD"],
    summary="이상 번역 제외(화이트리스트) 목록 조회"
)
def get_abnormal_whitelist(db: Session = Depends(get_db)):
    items = (
        db.query(
            AbnormalWhitelist.id,
            AbnormalWhitelist.translation_id,
            AbnormalWhitelist.created_at,
            Translation.folderName,
            Translation.title,
            Translation.original,
            Translation.translated,
            Translation.url,
            Translation.pid
        )
        .outerjoin(Translation, AbnormalWhitelist.translation_id == Translation.id)
        .order_by(AbnormalWhitelist.created_at.desc())
        .all()
    )
    results = []
    for it in items:
        results.append({
            "id": it.id,
            "translation_id": it.translation_id,
            "created_at": it.created_at,
            "folderName": it.folderName or "미분류",
            "title": it.title or "회차",
            "original": it.original or "",
            "translated": it.translated or "",
            "url": it.url or "",
            "pid": it.pid or ""
        })
    return {"whitelist": results, "count": len(results)}

@router.post(
    "/translations/abnormal_whitelist/clear",
    tags=["Data CRUD"],
    summary="이상 번역 화이트리스트 전체 해제"
)
def clear_abnormal_whitelist(db: Session = Depends(get_db)):
    count = db.query(AbnormalWhitelist).delete(synchronize_session=False)
    db.commit()
    return {"success": True, "cleared_count": count, "message": f"전체 {count}개 단락의 이상번역 제외 설정이 해제되었습니다."}

@router.post(
    "/translations/move_to_cleanup",
    tags=["Data CRUD"],
    summary="선택한 이상 번역 항목을 원문 정리 섹션으로 이동"
)
def move_to_cleanup(req: MoveToCleanupRequest, db: Session = Depends(get_db)):
    now = int(time.time())
    moved_count = 0
    for t_id in req.ids:
        exists = db.query(CleanupQueuedItem).filter(CleanupQueuedItem.translation_id == t_id).first()
        if not exists:
            db.add(CleanupQueuedItem(translation_id=t_id, queued_at=now))
            moved_count += 1
    db.commit()
    return {"success": True, "moved_count": moved_count, "message": f"{moved_count}개의 항목이 원문 정리 섹션으로 이동되었습니다."}

@router.get(
    "/translations/cleanup_queue",
    tags=["Data CRUD"],
    summary="원문 복제·변형 정리 대기열 조회",
    description="규칙 1(원문 그대로), 규칙 2(원문 변형) 및 수동 이동된 항목들을 조회합니다."
)
def get_cleanup_queue(db: Session = Depends(get_db)):
    queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}

    # 1. 1차 후보 쿼리 (원문=번역문, 빈번역, 일본어 가나 포함 번역)
    CANDIDATE_REGEX = r'[\u3040-\u309f\u30a0-\u30fa]'
    query = text("""
        SELECT id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order
        FROM translations
        WHERE translated IS NULL
           OR translated = ''
           OR original = translated
           OR translated REGEXP :pattern
    """)
    candidates = db.execute(query, {"pattern": CANDIDATE_REGEX}).fetchall()

    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    counts = {"total": 0, "verbatim_count": 0, "paraphrased_count": 0, "moved_count": 0}
    seen_ids = set()

    for t in candidates:
        t_dict = t._asdict()
        t_id = t_dict.get("id")
        ori = t_dict.get("original") or ""
        tra = t_dict.get("translated") or ""

        cat = classify_translation(ori, tra)
        is_moved = t_id in queued_ids

        # 대상: verbatim_or_empty, paraphrased_jp, 또는 사용자가 수동 이동한 항목
        if cat in ('verbatim_or_empty', 'paraphrased_jp') or is_moved:
            seen_ids.add(t_id)
            counts["total"] += 1
            if is_moved:
                counts["moved_count"] += 1
                category_label = "다른 언어 (이동됨)"
            elif cat == "verbatim_or_empty":
                counts["verbatim_count"] += 1
                category_label = "원문 그대로 반환"
            else:
                counts["paraphrased_count"] += 1
                category_label = "원문 변형"

            folder_name = t_dict.get("folderName") or "폴더 추가 대기 상태"
            url = t_dict.get("url")
            if url:
                grouped_by_folder[folder_name][url].append({
                    "id": t_id,
                    "url": url,
                    "pid": t_dict.get("pid"),
                    "original": ori,
                    "translated": tra,
                    "timestamp": t_dict.get("timestamp"),
                    "folderName": t_dict.get("folderName"),
                    "title": t_dict.get("title"),
                    "toc_sort_order": t_dict.get("toc_sort_order"),
                    "category": "moved" if is_moved else cat,
                    "category_label": category_label
                })

    # 혹시 queued_ids 중 candidates 쿼리에 안 걸린 항목이 있다면 추가 로드
    remaining_queued_ids = queued_ids - seen_ids
    if remaining_queued_ids:
        extra_items = db.query(Translation).filter(Translation.id.in_(list(remaining_queued_ids))).all()
        for t in extra_items:
            counts["total"] += 1
            counts["moved_count"] += 1
            folder_name = t.folderName or "폴더 추가 대기 상태"
            grouped_by_folder[folder_name][t.url].append({
                "id": t.id,
                "url": t.url,
                "pid": t.pid,
                "original": t.original,
                "translated": t.translated,
                "timestamp": t.timestamp,
                "folderName": t.folderName,
                "title": t.title,
                "toc_sort_order": t.toc_sort_order,
                "category": "moved",
                "category_label": "다른 언어 (이동됨)"
            })

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

    final_response["_summary"] = counts
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=final_response, headers=headers)

@router.post(
    "/translations/cleanup_queue/delete",
    tags=["Data CRUD"],
    summary="원문 정리 항목 수동 삭제 및 휴지통/알림 생성"
)
def delete_cleanup_queue(req: CleanupDeleteRequest, db: Session = Depends(get_db)):
    if req.ids:
        target_translations = db.query(Translation).filter(Translation.id.in_(req.ids)).all()
    elif req.all_queue:
        queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}
        CANDIDATE_REGEX = r'[\u3040-\u309f\u30a0-\u30fa]'
        query = text("""
            SELECT id, original, translated FROM translations
            WHERE translated IS NULL OR translated = '' OR original = translated OR translated REGEXP :pattern
        """)
        candidates = db.execute(query, {"pattern": CANDIDATE_REGEX}).fetchall()
        target_ids = set()
        for t in candidates:
            t_dict = t._asdict()
            t_id = t_dict.get("id")
            cat = classify_translation(t_dict.get("original") or "", t_dict.get("translated") or "")
            if cat in ('verbatim_or_empty', 'paraphrased_jp') or t_id in queued_ids:
                target_ids.add(t_id)
        target_ids.update(queued_ids)
        target_translations = db.query(Translation).filter(Translation.id.in_(list(target_ids))).all()
    else:
        raise HTTPException(status_code=400, detail="삭제할 대상 ID가 지정되지 않았습니다.")

    if not target_translations:
        return {"success": True, "deleted_count": 0, "affected_episodes": [], "message": "삭제할 대상이 없습니다."}

    now = int(time.time())
    batch_id = str(uuid.uuid4())[:8]

    episodes_map = defaultdict(lambda: {"novel_title": "", "episode_title": "", "url": "", "count": 0})

    for t in target_translations:
        cat = classify_translation(t.original, t.translated)
        trash_item = TranslationTrash(
            original_translation_id=t.id,
            url=t.url,
            pid=t.pid,
            original=t.original,
            translated=t.translated,
            timestamp=t.timestamp,
            folderName=t.folderName,
            title=t.title,
            toc_sort_order=t.toc_sort_order,
            reason_category=cat,
            deleted_at=now,
            cleanup_batch_id=batch_id
        )
        db.add(trash_item)

        ep = episodes_map[t.url]
        ep["novel_title"] = t.folderName or "미분류"
        ep["episode_title"] = t.title or t.url
        ep["url"] = t.url
        ep["count"] += 1

        db.delete(t)

    deleted_ids = [t.id for t in target_translations]
    db.query(CleanupQueuedItem).filter(CleanupQueuedItem.translation_id.in_(deleted_ids)).delete(synchronize_session=False)

    affected_episodes_list = []
    for url, info in episodes_map.items():
        notif = CleanupNotification(
            batch_id=batch_id,
            novel_title=info["novel_title"],
            episode_title=info["episode_title"],
            url=info["url"],
            deleted_count=info["count"],
            is_dismissed=0,
            created_at=now,
            dismissed_at=None
        )
        db.add(notif)
        affected_episodes_list.append(info)

    db.commit()
    return {
        "success": True,
        "batch_id": batch_id,
        "deleted_count": len(target_translations),
        "affected_episodes": affected_episodes_list,
        "message": f"{len(target_translations)}개 단락이 삭제되어 휴지통에 보관되었습니다."
    }

@router.get(
    "/translations/trash",
    tags=["Data CRUD"],
    summary="휴지통 목록 조회"
)
def get_translation_trash(db: Session = Depends(get_db)):
    trash_items = db.query(TranslationTrash).order_by(TranslationTrash.deleted_at.desc()).limit(1000).all()
    results = []
    for item in trash_items:
        results.append({
            "id": item.id,
            "original_translation_id": item.original_translation_id,
            "url": item.url,
            "pid": item.pid,
            "original": item.original,
            "translated": item.translated,
            "timestamp": item.timestamp,
            "folderName": item.folderName,
            "title": item.title,
            "reason_category": item.reason_category,
            "deleted_at": item.deleted_at,
            "cleanup_batch_id": item.cleanup_batch_id
        })
    return {"trash": results}

@router.post(
    "/translations/trash/restore",
    tags=["Data CRUD"],
    summary="휴지통 항목 되돌리기 (복원)"
)
def restore_trash(req: RestoreRequest, db: Session = Depends(get_db)):
    query = db.query(TranslationTrash)
    if req.trash_ids:
        items_to_restore = query.filter(TranslationTrash.id.in_(req.trash_ids)).all()
    elif req.batch_id:
        items_to_restore = query.filter(TranslationTrash.cleanup_batch_id == req.batch_id).all()
    elif req.all_trash:
        items_to_restore = query.all()
    else:
        raise HTTPException(status_code=400, detail="복원할 대상이 지정되지 않았습니다.")

    if not items_to_restore:
        return {"success": True, "restored_count": 0, "message": "복원할 항목이 없습니다."}

    restored_count = 0
    for item in items_to_restore:
        existing = db.query(Translation).filter(
            Translation.url == item.url,
            Translation.pid == item.pid,
            Translation.original == item.original
        ).first()

        if existing:
            existing.translated = item.translated
            existing.timestamp = item.timestamp
            existing.folderName = item.folderName
            existing.title = item.title
            existing.toc_sort_order = item.toc_sort_order
        else:
            new_t = Translation(
                url=item.url,
                pid=item.pid,
                original=item.original,
                translated=item.translated,
                timestamp=item.timestamp,
                folderName=item.folderName,
                title=item.title,
                toc_sort_order=item.toc_sort_order
            )
            db.add(new_t)
        
        db.delete(item)
        restored_count += 1

    db.commit()
    return {"success": True, "restored_count": restored_count, "message": f"{restored_count}개의 항목이 복원되었습니다."}

@router.get(
    "/cleanup/notifications",
    tags=["Data CRUD"],
    summary="삭제 알림 및 7일 보존 이력 조회"
)
def get_cleanup_notifications(db: Session = Depends(get_db)):
    now = int(time.time())
    seven_days_ago = now - 7 * 86400

    # 7일 지난 해제된 알림 및 트래시 영구 정리
    db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 1,
        CleanupNotification.dismissed_at < seven_days_ago
    ).delete(synchronize_session=False)

    db.query(TranslationTrash).filter(
        TranslationTrash.deleted_at < seven_days_ago
    ).delete(synchronize_session=False)
    db.commit()

    active_notifs = db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 0
    ).order_by(CleanupNotification.created_at.desc()).all()

    dismissed_notifs = db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 1,
        CleanupNotification.dismissed_at >= seven_days_ago
    ).order_by(CleanupNotification.dismissed_at.desc()).all()

    def _to_dict(n):
        return {
            "id": n.id,
            "batch_id": n.batch_id,
            "novel_title": n.novel_title,
            "episode_title": n.episode_title,
            "url": n.url,
            "deleted_count": n.deleted_count,
            "is_dismissed": bool(n.is_dismissed),
            "created_at": n.created_at,
            "dismissed_at": n.dismissed_at
        }

    return {
        "active_notifications": [_to_dict(n) for n in active_notifs],
        "recent_dismissed": [_to_dict(n) for n in dismissed_notifs]
    }

@router.post(
    "/cleanup/notifications/{notif_id}/dismiss",
    tags=["Data CRUD"],
    summary="삭제 알림 개별 해제"
)
def dismiss_notification(notif_id: int, db: Session = Depends(get_db)):
    notif = db.query(CleanupNotification).filter(CleanupNotification.id == notif_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다.")
    notif.is_dismissed = 1
    notif.dismissed_at = int(time.time())
    db.commit()
    return {"success": True}

@router.post(
    "/cleanup/notifications/dismiss_all",
    tags=["Data CRUD"],
    summary="삭제 알림 전체 해제"
)
def dismiss_all_notifications(db: Session = Depends(get_db)):
    now = int(time.time())
    db.query(CleanupNotification).filter(CleanupNotification.is_dismissed == 0).update({
        CleanupNotification.is_dismissed: 1,
        CleanupNotification.dismissed_at: now
    })
    db.commit()
    return {"success": True}

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
    clean_url = (url or "").split('#')[0].strip()
    if not clean_url:
        return {"has_targets": False, "targets": [], "notif_id": None}

    # 1. 해당 URL에 대한 활성 알림 조회
    notif_query = db.query(CleanupNotification).filter(
        CleanupNotification.url == clean_url,
        CleanupNotification.is_dismissed == 0
    )
    if batch_id:
        notif_query = notif_query.filter(CleanupNotification.batch_id == batch_id)
    active_notif = notif_query.order_by(CleanupNotification.created_at.desc()).first()

    # 2. TranslationTrash에서 해당 URL의 삭제 이력 조회
    trash_query = db.query(TranslationTrash).filter(TranslationTrash.url == clean_url)
    if active_notif:
        trash_query = trash_query.filter(TranslationTrash.cleanup_batch_id == active_notif.batch_id)
    elif batch_id:
        trash_query = trash_query.filter(TranslationTrash.cleanup_batch_id == batch_id)
    else:
        twenty_four_hours_ago = int((time.time() - 86400) * 1000)
        trash_query = trash_query.filter(TranslationTrash.deleted_at >= twenty_four_hours_ago)

    trash_items = trash_query.order_by(TranslationTrash.deleted_at.desc()).all()

    seen_pids = set()
    targets = []
    for item in trash_items:
        pid = item.pid or ""
        if pid and pid in seen_pids:
            continue
        if pid:
            seen_pids.add(pid)
        targets.append({
            "pid": item.pid,
            "original": item.original,
            "reason_category": item.reason_category or "verbatim",
            "deleted_at": item.deleted_at,
            "batch_id": item.cleanup_batch_id
        })

    # 3. Translation 테이블에 남아있는 빈 번역문(None 또는 '') 또는 원문 복붙 미완성 문장도 검수 대상에 포함
    empty_or_bad_trans = db.query(Translation).filter(
        Translation.url == clean_url,
        (Translation.translated.is_(None) | (Translation.translated == ""))
    ).all()

    sample_meta = db.query(Translation.folderName, Translation.title).filter(Translation.url == clean_url).first()
    novel_title = active_notif.novel_title if active_notif else (sample_meta[0] if sample_meta else None)
    episode_title = active_notif.episode_title if active_notif else (sample_meta[1] if sample_meta else None)

    for item in empty_or_bad_trans:
        pid = item.pid or ""
        if pid and pid in seen_pids:
            continue
        if pid:
            seen_pids.add(pid)
        targets.append({
            "pid": item.pid,
            "original": item.original,
            "reason_category": "empty",
            "deleted_at": (item.timestamp * 1000) if item.timestamp else int(time.time() * 1000),
            "batch_id": active_notif.batch_id if active_notif else "db_empty"
        })

    return {
        "has_targets": len(targets) > 0,
        "notif_id": active_notif.id if active_notif else None,
        "batch_id": active_notif.batch_id if active_notif else (targets[0]["batch_id"] if targets else None),
        "novel_title": novel_title,
        "episode_title": episode_title,
        "targets": targets
    }

@router.get(
    "/translations/similar_examples",
    tags=["Data CRUD"],
    summary="유사 번역 단락 추천"
)
def get_similar_examples(keyword: str, folder: Optional[str] = None, exclude_id: Optional[int] = None, limit: int = 8, db: Session = Depends(get_db)):
    kw = (keyword or "").strip()
    if not kw:
        return {"keyword": "", "examples": []}

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

    return {"keyword": kw, "examples": valid_examples}

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
            # --- 날짜 변환 로직 수정 ---
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
            if not is_pm and hour == 12: # 오전 12시 (자정)
                hour = 0

            date_parts = [p.strip() for p in date_part_str.replace('.', ' ').split()]
            year = int(date_parts[0])
            month = int(date_parts[1])
            day = int(date_parts[2])

            dt_object = datetime(year, month, day, hour, minute, second)
            ts = int(dt_object.timestamp())
            # --- 로직 수정 끝 ---

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