
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

@router.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok"}

@router.get("/api/settings/autostart")
def get_autostart_setting():
    """
    Retrieves the current auto-start setting.
    Note: This setting is read at startup and cannot be changed at runtime in the current version.
    """
    return {"autostart": settings.autostart}

@router.get("/api/logs")
async def get_logs():
    """Reads and returns the content of the latest log file."""
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

@router.get("/api/allowed_origins")
def get_allowed_origins():
    """CORS에 허용된 출처 목록을 반환합니다."""
    return settings.allowed_origins

@router.get("/debug/urls_by_folder", tags=["debug"])
def debug_get_urls_by_folder(folder_name: str):
    """Temporary debug endpoint to get distinct URLs for a folder."""
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT url FROM translations WHERE folderName = ? LIMIT 10", (folder_name,))
    urls = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"folder_name": folder_name, "urls": urls}

@router.get("/api/debug/find_translation", tags=["debug"])
def find_translation_by_query(q: str):
    """Finds translation records by a query string matching in URL, title, or original text."""
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
