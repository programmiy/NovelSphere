import sqlite3
import os
import re
import asyncio
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from collections import defaultdict

router = APIRouter()

# Constants
script_dir = os.path.dirname(os.path.abspath(__file__))
DATABASE_FILE = os.path.join(script_dir, "..", "translations.db")

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
@router.get("/translations")
def get_translations(skip: int = 0, limit: int = 100, folder: Optional[str] = None, search: Optional[str] = None, url: Optional[str] = None):
    """데이터베이스에서 번역 기록을 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
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

@router.post("/translations/upsert")
def upsert_translations(items: List[TranslationItem]):
    """번역 기록을 데이터베이스에 추가하거나 업데이트합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    
    updated_count = 0
    inserted_count = 0

    for item in items:
        cursor.execute("SELECT id, folderName FROM translations WHERE url = ? AND pid = ?", (item.url, item.pid))
        result = cursor.fetchone()
        
        if result:
            existing_id, existing_folder = result
            folder_name_to_use = item.folderName if item.folderName is not None else existing_folder
            
            if item.title:
                cursor.execute("""
                UPDATE translations 
                SET translated = ?, timestamp = ?, folderName = ?, title = ?
                WHERE id = ?
                """, (item.translated, item.timestamp, folder_name_to_use, item.title, existing_id))
            else:
                cursor.execute("""
                UPDATE translations 
                SET translated = ?, timestamp = ?, folderName = ?
                WHERE id = ?
                """, (item.translated, item.timestamp, folder_name_to_use, existing_id))
            updated_count += 1
        else:
            folder_name_to_use = item.folderName
            if folder_name_to_use is None:
                cursor.execute("SELECT folderName FROM translations WHERE url = ? AND folderName IS NOT NULL LIMIT 1", (item.url,))
                existing_folder_res = cursor.fetchone()
                if existing_folder_res:
                    folder_name_to_use = existing_folder_res[0]

            cursor.execute("""
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (item.url, item.pid, item.original, item.translated, item.timestamp, folder_name_to_use, item.title))
            inserted_count += 1

    conn.commit()
    conn.close()
    return {"inserted": inserted_count, "updated": updated_count}

@router.put("/translations/move")
def move_translations(req: MoveRequest):
    """지정된 ID의 번역 기록들을 새 폴더로 이동합니다."""
    placeholders = ', '.join('?' * len(req.ids))
    query = f"UPDATE translations SET folderName = ? WHERE id IN ({placeholders})"
    params = [req.folder_name] + req.ids
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute(query, params)
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{updated_count}개의 항목이 이동되었습니다."}

@router.post("/translations/delete")
def delete_translations(req: DeleteRequest):
    """지정된 ID의 번역 기록들을 삭제합니다."""
    placeholders = ', '.join('?' * len(req.ids))
    query = f"DELETE FROM translations WHERE id IN ({placeholders})"
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute(query, req.ids)
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{deleted_count}개의 항목이 삭제되었습니다."}

@router.get("/paged_translations")
def get_paged_translations(page: int = 1, per_page: int = 20):
    """페이지네이션을 지원하는 번역 기록 조회 엔드포인트입니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
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

@router.get("/translations_by_folder")
def get_translations_by_folder():
    """데이터베이스에서 모든 번역 기록을 폴더와 URL별로 그룹화하여 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.text_factory = str
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    # Get all applied URLs first
    cursor.execute("SELECT url FROM applied_urls")
    applied_urls_set = {row['url'] for row in cursor.fetchall()}

    # Get all url_metadata
    cursor.execute("SELECT url, sort_order FROM url_metadata")
    url_metadata = {row['url']: row for row in cursor.fetchall()}

    translations = cursor.execute("SELECT * FROM translations").fetchall()
    conn.close()
    
    # Group translations by folder and then by URL
    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    for t in translations:
        folder_name = t.get("folderName") or "폴더 추가 대기 상태"
        url = t.get("url")
        if url:
            grouped_by_folder[folder_name][url].append(t)

    # Create the final response, sorting the URL groups within each folder
    final_response = {}
    for folder_name, url_groups in grouped_by_folder.items():
        
        url_group_list = []
        for url, items in url_groups.items():
            metadata = url_metadata.get(url)
            sort_order = metadata.get('sort_order') if metadata else None
            
            numeric_url_part = None
            try:
                clean_url = url.rstrip('/')
                last_part = clean_url.split('/')[-1]
                if last_part.isdigit():
                    numeric_url_part = int(last_part)
            except:
                pass

            url_group_list.append({
                "url": url,
                "items": items,
                "sort_order": sort_order,
                "numeric_url_part": numeric_url_part
            })

        url_group_list.sort(key=lambda x: (
            x['sort_order'] is None, 
            x['sort_order'], 
            x['numeric_url_part'] is None,
            x['numeric_url_part'],
            x['url']
        ))

        final_response[folder_name] = url_group_list
            
    final_response["_applied_urls"] = list(applied_urls_set)

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=final_response, headers=headers)

async def stream_translations(book: Optional[str] = None):
    """DB에서 번역 데이터를 스트리밍합니다. '미분류' 폴더를 지원합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
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

@router.get("/stream")
async def stream(book: Optional[str] = None):
    """번역 데이터를 SSE로 스트리밍하는 엔드포인트입니다."""
    return StreamingResponse(stream_translations(book=book), media_type="text/event-stream")

@router.post("/migrate")
def migrate_data():
    """migration_data.json 파일에서 데이터를 읽어 DB로 이전합니다."""
    try:
        with open("migration_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="migration_data.json 파일을 찾을 수 없습니다.")

    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
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
