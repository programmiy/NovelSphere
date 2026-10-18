import json
import time
import os
# Ensure server process has production database write authorization
os.environ["ALLOW_PROD_DB_WRITE"] = "1"
import asyncio
import subprocess
import logging
import logging.handlers
from functools import lru_cache
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import ORJSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import RedirectResponse

from server.settings import settings
from server.database import engine
from server.models import Base

# --- Logging Configuration ---
# The settings object creates the log directory
log_file_path = os.path.join(settings.log_dir, "app.log")

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
handler = None
try:
    handler = logging.handlers.TimedRotatingFileHandler(
        log_file_path,
        when="midnight",
        interval=1,
        backupCount=7,
        encoding="utf-8"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
except Exception:
    pass

console_handler = logging.StreamHandler()
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

console_warning_handler = logging.StreamHandler()
console_warning_handler.setFormatter(formatter)
console_warning_handler.setLevel(logging.WARNING)

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
if handler:
    root_logger.addHandler(handler)
root_logger.addHandler(console_warning_handler)

uvicorn_access_logger = logging.getLogger("uvicorn.access")
uvicorn_access_logger.setLevel(logging.INFO)
uvicorn_access_logger.propagate = False
if handler:
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

from server.backup_utils import (
    create_unified_backup,
)

async def backup_check_task():
    """
    Periodically checks every 10 minutes if an automated backup is needed.
    Dynamically creates a unified backup every 3 days and rotates to keep the latest 3 backups.
    """
    while True:
        await asyncio.sleep(600)

        try:
            # Check and perform unified smart backup in thread pool (1 hour cooldown)
            result = await asyncio.to_thread(
                create_unified_backup,
                src_db_path=get_db_path(),
                backup_dir=settings.backup_dir,
                force=False,
                cooldown_hours=1.0,
                max_backups=5
            )
            if result.get("created"):
                logger.info(f"[Periodic Backup] Successfully created automated backup: {result['backup_file']}")
                if APP_START_TIME:
                    SERVER_METADATA["cumulative_runtime_seconds"] = 0
                    _update_runtime_metadata()
        except Exception as e:
            logger.error(f"[Periodic Backup] Error during automatic backup check: {e}")

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
    from server.remote_control import alert_monitor_loop
    remote_alert_task = asyncio.create_task(alert_monitor_loop())

    Base.metadata.create_all(bind=engine)
    try:
        with engine.begin() as connection:

            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_title ON translations (title)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_folder_title ON translations (folderName, title)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_translations_folder_url ON translations (folderName, url)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_translations_url ON translations (url)")

            row = connection.exec_driver_sql("SELECT sql FROM sqlite_master WHERE type='table' AND name='translations_fts'").fetchone()
            need_recreate = True
            if row and row[0] and "trigram" in row[0].lower():
                need_recreate = False

            if need_recreate:
                logger.info("Migrating translations_fts to Trigram tokenizer...")
                connection.exec_driver_sql("DROP TABLE IF EXISTS translations_fts;")
                connection.exec_driver_sql("""
                    CREATE VIRTUAL TABLE translations_fts USING fts5(
                        original,
                        translated,
                        content='translations',
                        content_rowid='id',
                        tokenize='trigram'
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
                connection.exec_driver_sql("INSERT INTO translations_fts(translations_fts) VALUES('rebuild');")
                logger.info("Rebuilt translations_fts search index with Trigram successfully.")
            else:
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
                    connection.exec_driver_sql("INSERT INTO translations_fts(translations_fts) VALUES('rebuild');")
                    logger.info("Built translations_fts search index successfully.")
    except Exception as e:
        logger.error(f"Error initializing indexes and FTS5: {e}")
    
    from server.services.task_manager import task_manager
    await task_manager.startup()

    logger.info("Server startup complete. Runtime tracking, TaskManager and backup task started.")
    yield
    
    # Graceful shutdown: cancel background tasks
    await task_manager.shutdown()
    backup_task.cancel()
    bracket_task.cancel()
    remote_alert_task.cancel()
    try:
        await asyncio.gather(backup_task, bracket_task, remote_alert_task, return_exceptions=True)
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

app = FastAPI(
    lifespan=lifespan,
    title=settings.app_name,
    debug=settings.debug,
    default_response_class=ORJSONResponse
)

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex="chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Security Middleware (로컬 루프백 프리패스 + 외부 LAN 암호화 토큰 검증) ---
from server.security import verify_token

import ipaddress

TAILSCALE_NETWORK = ipaddress.ip_network("100.64.0.0/10")

@app.middleware("http")
async def lanovel_security_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else ""
    is_loopback = client_ip in ("127.0.0.1", "::1", "localhost", "testclient")
    is_tailscale = False
    if not is_loopback and client_ip:
        try:
            is_tailscale = ipaddress.ip_address(client_ip) in TAILSCALE_NETWORK
        except Exception:
            is_tailscale = False

    stored_credential = (
        settings.lanovel_auth_hash
        or settings.lanovel_auth_token
        or settings.remote_token
        or ""
    ).strip()

    # 1. PC 내부 로컬호스트(루프백) 및 Tailscale 가상 사설망(100.64.0.0/10) 접근:
    # 1인 소유 기기 간 WireGuard 암호화 통신이 보장되므로 편의를 위해 프리패스 허용
    if is_loopback or is_tailscale:
        # 단, 브라우저를 통한 미허가 외부 사이트의 Cross-Origin CSRF 요청은 차단
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins and not origin.startswith("chrome-extension://"):
            return Response(
                status_code=403,
                content='{"detail": "Cross-Origin CSRF request blocked"}',
                media_type="application/json"
            )
        response = await call_next(request)
        if "origin" in request.headers or request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    # 2. 외부 LAN(공유기 Wi-Fi 등) 접근 제어
    path = request.url.path
    # 읽기 전용 정적 에셋, 랜딩 페이지, 헬스체크, 앱 다운로드/버전 확인, 핑 확인은 허용
    if path.startswith("/static") or path in ("/download", "/favicon.ico", "/service-worker.js", "/service-worker", "/health", "/api/app/version", "/api/app/download", "/api/sync/ping"):
        response = await call_next(request)
        if "origin" in request.headers or request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    # 토큰이 설정되어 있는 경우 암호화 해시와 상수 시간 비교 검증
    if stored_credential:
        auth_token = (
            request.headers.get("X-Lanovel-Key")
            or request.headers.get("X-Remote-Token")
            or request.query_params.get("key")
            or request.query_params.get("token")
        )
        if not verify_token(auth_token, stored_credential):
            return Response(
                status_code=401,
                content='{"detail": "LAN Access Denied: Valid X-Lanovel-Key required"}',
                media_type="application/json"
            )

    response = await call_next(request)
    if "origin" in request.headers or request.headers.get("access-control-request-private-network") == "true":
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response



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
            mtime = int(max(os.path.getmtime(os.path.join(settings.static_dir, f)) for f in ["admin.js", "admin.css", "service-worker.js", "library.css", "viewer.css", "steampunk-sound.js"] if os.path.exists(os.path.join(settings.static_dir, f))))
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
from server.routers import ui, translation, data_crud, books, system, tasks, admin, url_config, db_editor, toc_importer, separators, notifications, sync, app_release, unclassified, dictionary, corpus_ai, ai_review, remote, special_batch
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
app.include_router(app_release.router)
app.include_router(unclassified.router)
app.include_router(dictionary.router)
app.include_router(corpus_ai.router)
app.include_router(ai_review.router)
app.include_router(remote.router)
app.include_router(special_batch.router)

@app.get("/api/status/summary", tags=["Status"])
def get_api_status_summary():
    """모바일 앱 상단 대시보드 현황판용 통합 요약 엔드포인트"""
    from server.routers.notifications import get_status_summary
    return get_status_summary()