import json
import time
import os
import asyncio
import shutil
import subprocess
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Response
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
                shutil.copy2(get_db_path(), backup_path)
                logger.info(f"Successfully created backup: {backup_path}")
                
                SERVER_METADATA["cumulative_runtime_seconds"] = 0
                _update_runtime_metadata()
                
            except Exception as e:
                logger.error(f"Error during backup: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global APP_START_TIME, SERVER_METADATA
    
    try:
        with open(settings.metadata_file, "r") as f:
            SERVER_METADATA = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        SERVER_METADATA = {"cumulative_runtime_seconds": 0}

    APP_START_TIME = time.time()
    
    asyncio.create_task(backup_check_task())

    Base.metadata.create_all(bind=engine)
    
    logger.info("Server startup complete. Runtime tracking and backup task started.")
    yield
    
    if APP_START_TIME:
        session_duration = time.time() - APP_START_TIME
        SERVER_METADATA["cumulative_runtime_seconds"] += session_duration
        _update_runtime_metadata()
        logger.info("Server shutting down. Updated cumulative runtime.")

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
        content = content.replace("__GIT_HASH__", git_hash)
        
        return Response(content=content, media_type="application/javascript")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="service-worker.js not found.")

@app.get("/service-worker")
async def redirect_service_worker():
    """
    Redirects requests for /service-worker to /service-worker.js.
    """
    return RedirectResponse(url="/service-worker.js")

# --- Routers ---
from server.routers import ui, translation, data_crud, books, system, tasks, admin, url_config, db_editor, toc_importer
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