from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from server.server import SETTINGS, save_settings, PROGRESS_STATUS, LOG_DIR
import os
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

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