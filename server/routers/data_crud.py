
import sqlite3
import os
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional

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
