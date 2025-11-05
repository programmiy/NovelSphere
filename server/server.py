import sqlite3
import json
import requests
import time
import os
import asyncio
import re
import shutil
import subprocess
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response
from contextlib import asynccontextmanager 
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import StreamingResponse
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
from collections import defaultdict
from urllib.parse import unquote
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError

from server.config import DATABASE_FILE, allowed_origins_list, LOG_DIR

script_dir = os.path.dirname(os.path.abspath(__file__))
API_KEY_FILE = os.path.join(script_dir, "api_key.txt")

import logging
from logging.handlers import TimedRotatingFileHandler

# --- Logging Configuration ---
os.makedirs(LOG_DIR, exist_ok=True)

log_file_path = os.path.join(LOG_DIR, "app.log")

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Create a rotating file handler
handler = TimedRotatingFileHandler(
    log_file_path,
    when="midnight",  # Rotate daily
    interval=1,
    backupCount=7,    # Keep 7 days of logs
    encoding="utf-8"
)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
logger.addHandler(handler)

# If you also want to log to console (optional, good for development)
console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# --- Configure Uvicorn Access Logger ---
uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.setLevel(logging.INFO)
uvicorn_access_logger.propagate = False # Prevent messages from going to root logger if it has other handlers

# Add the same handlers to uvicorn.access logger
uvicorn_access_logger.addHandler(handler) # File handler
uvicorn_access_logger.addHandler(console_handler) # Console handler

static_dir = os.path.join(script_dir, "server/static")
templates_dir = os.path.join(script_dir, "server/templates")
# --- Backup and Metadata Logic ---
def _update_runtime_metadata():
    """Saves the current SERVER_METADATA to the metadata file."""
    try:
        with open(METADATA_FILE, "w") as f:
            json.dump(SERVER_METADATA, f)
    except Exception as e:
        logger.error(f"Error saving metadata: {e}")

async def backup_check_task():
    """Periodically checks if a backup is needed based on cumulative runtime."""
    while True:
        await asyncio.sleep(600)  # Check every 10 minutes

        if not APP_START_TIME:
            continue

        session_duration = time.time() - APP_START_TIME
        current_total_runtime = SERVER_METADATA.get("cumulative_runtime_seconds", 0) + session_duration

        if current_total_runtime > BACKUP_THRESHOLD_SECONDS:
            logger.info("Backup threshold exceeded. Performing backup...")
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"translations_backup_{timestamp}.db"
            backup_path = os.path.join(BACKUP_DIR, backup_filename)

            try:
                shutil.copy2(DATABASE_FILE, backup_path)
                logger.info(f"Successfully created backup: {backup_path}")
                
                # Reset counter and save immediately
                SERVER_METADATA["cumulative_runtime_seconds"] = 0
                _update_runtime_metadata()
                
            except Exception as e:
                logger.error(f"Error during backup: {e}")

def init_db():
    """데이터베이스를 초기화하고 테이블을 생성합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        pid TEXT,
        original TEXT NOT NULL,
        translated TEXT,
        timestamp INTEGER NOT NULL,
        folderName TEXT,
        UNIQUE(url, pid, original) -- 중복 방지
    );
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_url ON translations (url);");
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_folderName ON translations (folderName);");

    cursor.execute("PRAGMA table_info(translations)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'title' not in columns:
        cursor.execute("ALTER TABLE translations ADD COLUMN title TEXT")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS excluded_sentences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        original TEXT NOT NULL,
        UNIQUE(url, original)
    );
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_excluded_url_original ON excluded_sentences (url, original);")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pinned_books (
        folderName TEXT PRIMARY KEY
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS book_tags (
        book_folderName TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (book_folderName, tag_id),
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS book_activity (
        folderName TEXT PRIMARY KEY,
        last_read_timestamp INTEGER,
        last_read_pid TEXT,
        is_bookmarked INTEGER DEFAULT 0,
        notes TEXT
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS applied_urls (
        url TEXT PRIMARY KEY
    );
    """
    )
    
    # Safely add new columns for summary
    cursor.execute("PRAGMA table_info(book_activity)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'summary' not in columns:
        cursor.execute("ALTER TABLE book_activity ADD COLUMN summary TEXT")
    if 'summary_source_url' not in columns:
        cursor.execute("ALTER TABLE book_activity ADD COLUMN summary_source_url TEXT")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS url_metadata (
        url TEXT PRIMARY KEY,
        sort_order INTEGER
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_url_metadata_sort_order ON url_metadata (sort_order);");

    conn.commit()
    conn.close()

# 스크립트 디렉토리 기준 절대 경로 설정
script_dir = os.path.dirname(os.path.abspath(__file__))

# --- Constants for Backup ---
METADATA_FILE = os.path.join(script_dir, "server_meta.json")
BACKUP_DIR = os.path.join(script_dir, "backups")
BACKUP_THRESHOLD_SECONDS = 24 * 3600  # 24 hours

# --- App state for Backup ---
APP_START_TIME = None
SERVER_METADATA = {}

# --- Constants for Settings ---
SETTINGS_FILE = os.path.join(script_dir, "settings.json")

# --- App state for Settings ---
SETTINGS = {}

# --- App state for Progress Tracking ---
PROGRESS_STATUS = {"task": "none", "current": 0, "total": 0, "percentage": 0}

def load_settings():
    global SETTINGS
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            SETTINGS = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        SETTINGS = {"autostart": False} # Default setting
    logger.info(f"Loaded settings: {SETTINGS}")

def save_settings():
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(SETTINGS, f, ensure_ascii=False, indent=4)
    except Exception as e:
        logger.error(f"Error saving settings: {e}")

static_dir = os.path.join(script_dir, "static")
templates_dir = os.path.join(script_dir, "templates")

# FastAPI 앱 생성
# app = FastAPI()
@asynccontextmanager
async def lifespan(app: FastAPI):
    global APP_START_TIME, SERVER_METADATA
    
    # Load metadata on startup
    try:
        with open(METADATA_FILE, "r") as f:
            SERVER_METADATA = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        SERVER_METADATA = {"cumulative_runtime_seconds": 0}

    APP_START_TIME = time.time()
    
    # Start background task
    asyncio.create_task(backup_check_task())

    # Load settings
    load_settings()

    # DB initialization
    init_db()
    
    logger.info("Server startup complete. Runtime tracking and backup task started.")
    yield
    
    # Shutdown logic
    if APP_START_TIME:
        session_duration = time.time() - APP_START_TIME
        SERVER_METADATA["cumulative_runtime_seconds"] += session_duration
        _update_runtime_metadata()
        logger.info("Server shutting down. Updated cumulative runtime.")

app = FastAPI(lifespan=lifespan)
# 정적 파일 및 템플릿 설정
app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

def get_git_commit_hash():
    """Gets the short hash of the current git commit."""
    try:
        project_dir = os.path.dirname(script_dir) 
        commit_hash = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=project_dir,
            encoding='utf-8'
        ).strip()
        return commit_hash
    except (subprocess.CalledProcessError, FileNotFoundError):
        return datetime.now().strftime("%Y%m%d%H%M%S")

@app.get("/service-worker.js")
async def serve_service_worker():
    """
    Serves the service-worker.js file dynamically, injecting the current git hash
    as the cache version to enable automatic cache busting on new commits.
    """
    try:
        with open(os.path.join(static_dir, "service-worker.js"), "r", encoding="utf-8") as f:
            content = f.read()
        
        git_hash = get_git_commit_hash()
        content = content.replace("__GIT_HASH__", git_hash)
        
        return Response(content=content, media_type="application/javascript")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="service-worker.js not found.")

@app.get("/service-worker")
async def redirect_service_worker():
    """
    Redirects requests for /service-worker to /service-worker.js.
    This handles cases where browsers or extensions might request the service worker without the .js extension.
    """
    return RedirectResponse(url="/service-worker.js")



app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list,
    allow_origin_regex="chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)













from fastapi.responses import JSONResponse, HTMLResponse





















from server.routers import ui, translation, data_crud, books, system, tasks, admin, url_config
app.include_router(ui.router)
app.include_router(translation.router)
app.include_router(data_crud.router)
app.include_router(books.router)
app.include_router(system.router)
app.include_router(tasks.router)
app.include_router(admin.router)
app.include_router(url_config.router)

# --- Root and Admin Endpoints ---



# uvicorn server:app --reload --port 8001

