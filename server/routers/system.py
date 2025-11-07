from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.server import SETTINGS, save_settings, PROGRESS_STATUS
from server.config import DATABASE_FILE, allowed_origins_list, LOG_DIR
import os
import logging
import sqlite3

router = APIRouter()
logger = logging.getLogger(__name__)

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
    """Retrieves the current auto-start setting."""
    return {"autostart": SETTINGS.get("autostart", False)}

@router.post("/api/settings/autostart")
def set_autostart_setting(settings_update: AutoStartSettings):
    """Updates the auto-start setting."""
    SETTINGS["autostart"] = settings_update.autostart
    save_settings()
    return {"message": "Auto-start setting updated successfully."}

@router.get("/api/progress")
def get_progress_status():
    """Retrieves the current progress status of background tasks."""
    return PROGRESS_STATUS

@router.get("/api/logs")
async def get_logs():
    """Reads and returns the content of the latest log file."""
    try:
        log_files = sorted([f for f in os.listdir(LOG_DIR) if f.startswith("app.log")], reverse=True)
        if not log_files:
            return {"message": "No log files found.", "logs": []}

        latest_log_file = os.path.join(LOG_DIR, log_files[0])
        
        with open(latest_log_file, "r", encoding="utf-8") as f:
            logs = f.readlines()
        
        return {"message": "Success", "logs": logs}
    except Exception as e:
        logger.error(f"Error reading log files: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading log files: {e}")

@router.get("/api/allowed_origins")
def get_allowed_origins():
    """CORS에 허용된 출처 목록을 반환합니다."""
    return allowed_origins_list

@router.get("/debug/urls_by_folder", tags=["debug"])
def debug_get_urls_by_folder(folder_name: str):
    """Temporary debug endpoint to get distinct URLs for a folder."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT url FROM translations WHERE folderName = ? LIMIT 10", (folder_name,))
    urls = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"folder_name": folder_name, "urls": urls}

@router.get("/api/debug/find_translation", tags=["debug"])
def find_translation_by_query(q: str):
    """Finds translation records by a query string matching in URL, title, or original text."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
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