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

from server.settings import settings
from server.database import get_db
from server.models import Translation, UrlMetadata, AppliedUrl
import time

router = APIRouter()

# --- Helper to get DB path from URL ---
def get_db_path():
    # sqlite:///C:\path\to\db.db -> C:\path\to\db.db
    # Assumes the path is absolute after the third slash
    parsed_url = urlparse(settings.database_url)
    # On Windows, urlparse might add an extra leading slash if the path starts with a drive letter.
    # e.g., sqlite:///C:/... becomes /C:/...
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

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

# Helper
def dict_factory(cursor, row):
    """쿼리 결과를 사전 형태로 변환합니다."""
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

# API Endpoints
@router.get(
    "/translations",
    tags=["Data CRUD"],
    summary="번역 기록 조회",
    description="데이터베이스에서 번역 기록을 조회합니다. 폴더, 검색어, URL로 필터링할 수 있습니다."
)
def get_translations(skip: int = 0, limit: int = 100, folder: Optional[str] = None, search: Optional[str] = None, url: Optional[str] = None):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.text_factory = str
    conn.row_factory = dict_factory
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

    # 처리할 모든 URL을 한 번에 수집
    urls_in_batch = {item.url for item in items}

    # 데이터베이스에 이미 있는 URL 메타데이터를 한 번에 조회
    existing_metadata = db.query(UrlMetadata).filter(UrlMetadata.url.in_(urls_in_batch)).all()
    existing_metadata_urls = {meta.url for meta in existing_metadata}

    # 새 URL 메타데이터를 저장할 리스트
    new_metadata_list = []

    for url in urls_in_batch:
        if url not in existing_metadata_urls:
            new_metadata_list.append(UrlMetadata(url=url, first_accessed_at=int(time.time())))
    
    # 새 메타데이터를 한 번에 DB에 추가
    if new_metadata_list:
        db.add_all(new_metadata_list)
        db.commit()

    for item in items:
        # 기존 번역 데이터 조회
        existing_translation = db.query(Translation).filter_by(url=item.url, pid=item.pid).first()

        if existing_translation:
            # 데이터 업데이트
            existing_translation.translated = item.translated
            existing_translation.timestamp = item.timestamp
            existing_translation.folderName = item.folderName if item.folderName is not None else existing_translation.folderName
            if item.title:
                existing_translation.title = item.title
            updated_count += 1
        else:
            # 새 데이터 삽입
            new_translation = Translation(
                url=item.url,
                pid=item.pid,
                original=item.original,
                translated=item.translated,
                timestamp=item.timestamp,
                folderName=item.folderName,
                title=item.title
            )
            db.add(new_translation)
            inserted_count += 1

    db.commit()
    return {"inserted": inserted_count, "updated": updated_count}

@router.put(
    "/translations/move",
    tags=["Data CRUD"],
    summary="번역 기록 이동",
    description="지정된 ID의 번역 기록들을 새 폴더로 이동합니다."
)
def move_translations(req: MoveRequest):
    placeholders = ', '.join('?' * len(req.ids))
    query = f"UPDATE translations SET folderName = ? WHERE id IN ({placeholders})"
    params = [req.folder_name] + req.ids
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute(query, params)
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{updated_count}개의 항목이 이동되었습니다."}

@router.post(
    "/translations/delete",
    tags=["Data CRUD"],
    summary="번역 기록 삭제",
    description="지정된 ID의 번역 기록들을 삭제합니다."
)
def delete_translations(req: DeleteRequest):
    placeholders = ', '.join('?' * len(req.ids))
    query = f"DELETE FROM translations WHERE id IN ({placeholders})"
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute(query, req.ids)
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{deleted_count}개의 항목이 삭제되었습니다."}

@router.get(
    "/paged_translations",
    tags=["Data CRUD"],
    summary="페이지별 번역 기록 조회",
    description="페이지네이션을 지원하는 번역 기록 조회 엔드포인트입니다."
)
def get_paged_translations(page: int = 1, per_page: int = 20):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.text_factory = str
    conn.row_factory = dict_factory
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
    description="데이터베이스에서 모든 번역 기록을 폴더와 URL별로 그룹화하고, URL은 최초 접근 시간 순으로 정렬하여 조회합니다."
)
def get_translations_by_folder(db: Session = Depends(get_db)):
    
    # 모든 데이터를 한 번에 조회
    applied_urls_set = {row.url for row in db.query(AppliedUrl).all()}
    url_metadata = {meta.url: meta for meta in db.query(UrlMetadata).all()}
    translations = db.query(Translation).all()

    # 폴더 및 URL별로 그룹화
    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    for t in translations:
        folder_name = t.folderName or "폴더 추가 대기 상태"
        if t.url:
            # Translation 객체를 직렬화 가능한 dict로 변환
            grouped_by_folder[folder_name][t.url].append({
                "id": t.id,
                "url": t.url,
                "pid": t.pid,
                "original": t.original,
                "translated": t.translated,
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

        # 정렬: toc_sort_order를 기준으로 오름차순 정렬. 없는 경우 맨 뒤로 보냄.
        url_group_list.sort(key=lambda x: (x['toc_sort_order'] is None, x['toc_sort_order']))

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
    summary="이상 번역 기록 조회",
    description="비어 있거나, 공백으로만 이루어져 있거나, 일본어가 포함된 번역 기록을 조회합니다."
)
def get_abnormal_translations(db: Session = Depends(get_db)):
    
    # This regex now focuses on Japanese letters (Hiragana, Katakana, Kanji) 
    # and explicitly excludes the Katakana Middle Dot (・, U+30FB) and 
    # Katakana-Hiragana Prolonged Sound Mark (ー, U+30FC).
    JAPANESE_REGEX_PATTERN = r'[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]'
    
    # Perform filtering directly in the database using the custom REGEXP function
    query = text("""
        SELECT * FROM translations
        WHERE translated IS NULL
           OR translated = ''
           OR translated REGEXP :pattern
    """)
    
    abnormal_translations = db.execute(query, {"pattern": JAPANESE_REGEX_PATTERN}).fetchall()

    # Group by folder and URL (similar logic to /translations_by_folder)
    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    for t in abnormal_translations:
        # The result from a raw query is a Row object. Convert it to a dictionary.
        t_dict = t._asdict()
        folder_name = t_dict.get("folderName") or "폴더 추가 대기 상태"
        url = t_dict.get("url")
        if url:
            grouped_by_folder[folder_name][url].append({
                "id": t_dict.get("id"), "url": url, "pid": t_dict.get("pid"), "original": t_dict.get("original"),
                "translated": t_dict.get("translated"), "timestamp": t_dict.get("timestamp"), "folderName": t_dict.get("folderName"),
                "title": t_dict.get("title"), "toc_sort_order": t_dict.get("toc_sort_order")
            })

    final_response = {}
    for folder_name, url_groups in grouped_by_folder.items():
        url_group_list = []
        for url, items in url_groups.items():
            sort_order = items[0]['toc_sort_order'] if items and items[0]['toc_sort_order'] is not None else None
            url_group_list.append({"url": url, "items": items, "toc_sort_order": sort_order})
        
        url_group_list.sort(key=lambda x: (x['toc_sort_order'] is None, x['toc_sort_order']))
        final_response[folder_name] = url_group_list
            
    # Also include applied URLs in the response so the UI can render correctly
    applied_urls_set = {row.url for row in db.query(AppliedUrl).all()}
    final_response["_applied_urls"] = list(applied_urls_set)

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=final_response, headers=headers)

async def stream_translations(book: Optional[str] = None):
    """DB에서 번역 데이터를 스트리밍합니다. '미분류' 폴더를 지원합니다."""
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
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

    conn = sqlite3.connect(get_db_path(), timeout=15)
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