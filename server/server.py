import json
import time
import os
import asyncio
import shutil
import subprocess
import logging
import logging.handlers
from functools import lru_cache
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import RedirectResponse

import sqlite3
from server.settings import settings
from server.database import engine
from server.models import Base

# --- Logging Configuration ---
# The settings object creates the log directory
log_file_path = os.path.join(settings.log_dir, "app.log")

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

handler = logging.handlers.TimedRotatingFileHandler(
    log_file_path,
    when="midnight",
    interval=1,
    backupCount=7,
    encoding="utf-8"
)
formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler.setFormatter(formatter)
logger.addHandler(handler)

console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

console_warning_handler = logging.StreamHandler()
console_warning_handler.setFormatter(formatter)
console_warning_handler.setLevel(logging.WARNING)

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.addHandler(handler)
root_logger.addHandler(console_warning_handler)

uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.setLevel(logging.INFO)
uvicorn_access_logger.propagate = False
uvicorn_access_logger.addHandler(handler)
uvicorn_access_logger.addHandler(console_handler)

# --- App state for Backup ---
APP_START_TIME = None
SERVER_METADATA = {}

def get_db_path():
    parsed_url = urlparse(settings.database_url)
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

# --- Backup and Metadata Logic ---
def _update_runtime_metadata():
    """Saves the current SERVER_METADATA to the metadata file."""
    try:
        with open(settings.metadata_file, "w") as f:
            json.dump(SERVER_METADATA, f)
    except Exception as e:
        logger.error(f"Error saving metadata: {e}")

def perform_sqlite_backup(src_path: str, dst_path: str):
    """Safely backs up a SQLite database (including WAL mode) using the online backup API."""
    src_conn = sqlite3.connect(src_path, timeout=30)
    try:
        dst_conn = sqlite3.connect(dst_path, timeout=30)
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
    finally:
        src_conn.close()

def rotate_backups(backup_dir: str, max_backups: int = 7):
    """Keep only the latest max_backups backup files and delete older ones."""
    try:
        backup_files = [
            f for f in os.listdir(backup_dir)
            if f.startswith("translations_backup_") and f.endswith(".db")
        ]
        if len(backup_files) > max_backups:
            backup_files.sort()  # Timestamps %Y%m%d_%H%M%S sort chronologically
            files_to_delete = backup_files[:-max_backups]
            for file_name in files_to_delete:
                file_path = os.path.join(backup_dir, file_name)
                try:
                    os.remove(file_path)
                    logger.info(f"Rotated and deleted old backup: {file_name}")
                except Exception as del_err:
                    logger.warning(f"Failed to delete old backup {file_name}: {del_err}")
    except Exception as e:
        logger.error(f"Error during backup rotation: {e}")

async def backup_check_task():
    """Periodically checks if a backup is needed based on cumulative runtime."""
    while True:
        await asyncio.sleep(600)

        if not APP_START_TIME:
            continue

        session_duration = time.time() - APP_START_TIME
        current_total_runtime = SERVER_METADATA.get("cumulative_runtime_seconds", 0) + session_duration

        if current_total_runtime > settings.backup_threshold_seconds:
            logger.info("Backup threshold exceeded. Performing backup...")
            
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"translations_backup_{timestamp}.db"
            backup_path = os.path.join(settings.backup_dir, backup_filename)

            try:
                await asyncio.to_thread(perform_sqlite_backup, get_db_path(), backup_path)
                logger.info(f"Successfully created backup: {backup_path}")
                rotate_backups(settings.backup_dir, max_backups=7)
                
                SERVER_METADATA["cumulative_runtime_seconds"] = 0
                _update_runtime_metadata()
                
            except Exception as e:
                logger.error(f"Error during backup: {e}")

def run_sync_bracket_restoration():
    """DB 커넥션을 열어 룰베이스 대사 괄호 누락 복원을 1회 실행합니다."""
    from server.database import get_sqlite_conn
    from server.rule_classifier import batch_restore_brackets_in_db
    conn = get_sqlite_conn()
    try:
        scanned, updated = batch_restore_brackets_in_db(conn)
        if updated > 0:
            logger.info(f"[주기적 괄호 복원] 대상 {scanned}건 검사 중 {updated}건의 누락 괄호 복원 완료.")
        else:
            logger.debug(f"[주기적 괄호 복원] 괄호 누락 없음 (검사: {scanned}건).")
    except Exception as e:
        logger.error(f"[주기적 괄호 복원] 실행 중 오류 발생: {e}")
    finally:
        conn.close()

async def periodic_bracket_restoration_task(interval_seconds: int = 1800):
    """
    주기적으로 DB를 스캔하여 원문 대사 괄호(「%」) 누락 및 변형 번역문을 자동 복구합니다.
    - 서버 시작 10초 후 1차 즉시 검사 실행
    - 이후 설정된 주기(기본 30분=1800초)마다 자동 실행
    """
    await asyncio.sleep(10)
    while True:
        try:
            await asyncio.to_thread(run_sync_bracket_restoration)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[주기적 괄호 복원] 태스크 오류: {e}")
        
        await asyncio.sleep(interval_seconds)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global APP_START_TIME, SERVER_METADATA
    
    try:
        with open(settings.metadata_file, "r") as f:
            SERVER_METADATA = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        SERVER_METADATA = {"cumulative_runtime_seconds": 0}

    APP_START_TIME = time.time()
    
    backup_task = asyncio.create_task(backup_check_task())
    bracket_task = asyncio.create_task(periodic_bracket_restoration_task(interval_seconds=1800))

    Base.metadata.create_all(bind=engine)
    try:
        with engine.begin() as connection:
            # Safe schema migration for book_activity
            try:
                connection.exec_driver_sql("ALTER TABLE book_activity ADD COLUMN last_read_chapter_title TEXT")
            except Exception:
                pass
            try:
                connection.exec_driver_sql("ALTER TABLE book_activity ADD COLUMN is_completed INTEGER DEFAULT 0")
            except Exception:
                pass
            try:
                connection.exec_driver_sql("ALTER TABLE book_activity ADD COLUMN is_visible INTEGER DEFAULT 1")
            except Exception:
                pass
            try:
                connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_book_activity_is_visible ON book_activity (is_visible)")
            except Exception:
                pass

            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_title ON translations (title)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_folder_title ON translations (folderName, title)")

            connection.exec_driver_sql("""
                CREATE VIRTUAL TABLE IF NOT EXISTS translations_fts USING fts5(
                    original,
                    translated,
                    content='translations',
                    content_rowid='id',
                    tokenize='unicode61'
                );
            """)
            connection.exec_driver_sql("""
                CREATE TRIGGER IF NOT EXISTS translations_ai AFTER INSERT ON translations BEGIN
                    INSERT INTO translations_fts(rowid, original, translated) VALUES (new.id, new.original, new.translated);
                END;
            """)
            connection.exec_driver_sql("""
                CREATE TRIGGER IF NOT EXISTS translations_ad AFTER DELETE ON translations BEGIN
                    INSERT INTO translations_fts(translations_fts, rowid, original, translated) VALUES('delete', old.id, old.original, old.translated);
                END;
            """)
            connection.exec_driver_sql("""
                CREATE TRIGGER IF NOT EXISTS translations_au AFTER UPDATE ON translations BEGIN
                    INSERT INTO translations_fts(translations_fts, rowid, original, translated) VALUES('delete', old.id, old.original, old.translated);
                    INSERT INTO translations_fts(rowid, original, translated) VALUES (new.id, new.original, new.translated);
                END;
            """)

            fts_count = connection.exec_driver_sql("SELECT COUNT(*) FROM translations_fts").scalar()
            if fts_count == 0:
                connection.exec_driver_sql("INSERT INTO translations_fts(translations_fts) VALUES('rebuild')")
                logger.info("Built translations_fts search index successfully.")
    except Exception as e:
        logger.error(f"Error initializing indexes and FTS5: {e}")
    
    logger.info("Server startup complete. Runtime tracking and backup task started.")
    yield
    
    # Graceful shutdown: cancel background tasks
    backup_task.cancel()
    bracket_task.cancel()
    try:
        await asyncio.gather(backup_task, bracket_task, return_exceptions=True)
    except Exception:
        pass

    if APP_START_TIME:
        session_duration = time.time() - APP_START_TIME
        SERVER_METADATA["cumulative_runtime_seconds"] += session_duration
        _update_runtime_metadata()
        logger.info("Server shutting down. Updated cumulative runtime.")

    # Dispose DB engine pool
    try:
        engine.dispose()
        logger.info("Database engine disposed successfully.")
    except Exception as e:
        logger.error(f"Error disposing database engine: {e}")

app = FastAPI(lifespan=lifespan, title=settings.app_name, debug=settings.debug)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex="chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Static Files and Templates ---
app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")
templates = Jinja2Templates(directory=settings.templates_dir)

# --- Dynamic Content ---
@lru_cache(maxsize=1)
def get_git_commit_hash():
    """Gets the short hash of the current git commit."""
    try:
        project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
        with open(os.path.join(settings.static_dir, "service-worker.js"), "r", encoding="utf-8") as f:
            content = f.read()
        
        git_hash = get_git_commit_hash()
        try:
            mtime = int(max(os.path.getmtime(os.path.join(settings.static_dir, f)) for f in ["admin.js", "admin.css", "service-worker.js"] if os.path.exists(os.path.join(settings.static_dir, f))))
            cache_version = f"{git_hash}-{mtime}"
        except Exception:
            cache_version = git_hash
        content = content.replace("__GIT_HASH__", cache_version)
        
        return Response(
            content=content, 
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="service-worker.js not found.")

@app.get("/service-worker")
async def redirect_service_worker():
    """
    Redirects requests for /service-worker to /service-worker.js.
    """
    return RedirectResponse(url="/service-worker.js")

# --- Routers ---
from server.routers import ui, translation, data_crud, books, system, tasks, admin, url_config, db_editor, toc_importer, separators, notifications, sync
app.include_router(ui.router)
app.include_router(translation.router)
app.include_router(data_crud.router)
app.include_router(books.router)
app.include_router(system.router)
app.include_router(tasks.router)
app.include_router(admin.router)
app.include_router(url_config.router)
app.include_router(db_editor.router)
app.include_router(toc_importer.router)
app.include_router(separators.router)
app.include_router(notifications.router)
app.include_router(sync.router)