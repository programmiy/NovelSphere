
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.settings import settings
import os
import logging
import sqlite3
from urllib.parse import urlparse

router = APIRouter()
logger = logging.getLogger(__name__)

def get_db_path():
    parsed_url = urlparse(settings.database_url)
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

class AutoStartSettings(BaseModel):
    autostart: bool

@router.get(
    "/health",
    tags=["System"],
    summary="상태 확인",
    description="API 서버의 상태를 확인합니다."
)
async def health_check():
    return {"status": "ok"}

@router.get(
    "/api/settings/autostart",
    tags=["System"],
    summary="자동 시작 설정 조회",
    description="현재 자동 시작 설정을 조회합니다. 이 설정은 시작 시 읽히며 런타임에는 변경할 수 없습니다."
)
def get_autostart_setting():
    return {"autostart": settings.autostart}

@router.get(
    "/api/logs",
    tags=["System"],
    summary="최신 로그 조회",
    description="최신 로그 파일의 내용을 읽어 반환합니다."
)
async def get_logs():
    try:
        log_files = sorted(
            [f for f in os.listdir(settings.log_dir) if f.startswith("app.log")], 
            reverse=True
        )
        if not log_files:
            return {"message": "No log files found.", "logs": []}

        latest_log_file = os.path.join(settings.log_dir, log_files[0])
        
        with open(latest_log_file, "r", encoding="utf-8") as f:
            logs = f.readlines()
        
        return {"message": "Success", "logs": logs}
    except Exception as e:
        logger.error(f"Error reading log files: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading log files: {e}")

@router.get(
    "/api/allowed_origins",
    tags=["System"],
    summary="허용된 CORS 출처 조회",
    description="CORS(Cross-Origin Resource Sharing)에 허용된 출처 목록을 반환합니다."
)
def get_allowed_origins():
    return settings.allowed_origins

@router.get(
    "/debug/urls_by_folder",
    tags=["Debug"],
    summary="폴더별 URL 디버그 조회",
    description="특정 폴더에 대한 고유 URL을 조회하는 임시 디버그 엔드포인트입니다."
)
def debug_get_urls_by_folder(folder_name: str):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT url FROM translations WHERE folderName = ? LIMIT 10", (folder_name,))
    urls = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"folder_name": folder_name, "urls": urls}

@router.get(
    "/api/debug/find_translation",
    tags=["Debug"],
    summary="쿼리로 번역 기록 찾기",
    description="URL, 제목 또는 원문 텍스트에서 쿼리 문자열과 일치하는 번역 기록을 찾습니다."
)
def find_translation_by_query(q: str):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    
    search_term = f"%{q}%"
    
    cursor.execute(
        "SELECT id, url, title, pid, toc_sort_order, original FROM translations WHERE url LIKE ? OR title LIKE ? OR original LIKE ?",
        (search_term, search_term, search_term)
    )
    
    results = cursor.fetchall()
    conn.close()
    
    if not results:
        raise HTTPException(status_code=404, detail="No matching translations found.")
        
    return results
