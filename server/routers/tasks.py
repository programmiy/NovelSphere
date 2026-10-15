
import re
import requests
import time
import uuid
import logging
from fastapi import APIRouter, BackgroundTasks
from typing import List
from server.celery_app import celery_app
from celery.result import AsyncResult
from server.database import get_sqlite_conn
from server.notifications import notify_task_event
from server.security import is_safe_external_url

router = APIRouter()
logger = logging.getLogger(__name__)

_fallback_status = {}

def _fetch_and_update_title_worker(url: str):
    """Internal worker to fetch a single title. Returns True if title is valid and updated."""
    if not is_safe_external_url(url):
        logger.warning(f"Skipping unsafe or private URL for SSRF protection: {url}")
        return False
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        with requests.Session() as s:
            s.headers.update(headers)
            if "novel18.syosetu.com" in url:
                s.cookies.set("over18", "yes", domain=".syosetu.com")
            response = s.get(url, timeout=10)
        response.raise_for_status()
        try:
            html_content = response.content.decode('utf-8')
        except UnicodeDecodeError:
            html_content = response.text
        title_match = re.search(r'<title>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = title_match.group(1).strip()
            invalid_titles = ["年齢確認", "Just a moment...", "Log in"]
            if not title or any(invalid in title for invalid in invalid_titles):
                logger.warning(f"Skipping invalid title for {url}: {title}")
                return False
            conn = get_sqlite_conn()
            cursor = conn.cursor()
            cursor.execute("UPDATE translations SET title = ? WHERE url = ?", (title, url))
            conn.commit()
            conn.close()
            logger.info(f"Updated title for {url}: {title}")
            return True
        else:
            logger.warning(f"Could not find title for {url}")
            return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to fetch {url}: {e}")
        return False
    except Exception as e:
        logger.error(f"An error occurred while processing {url}: {e}")
        return False

def _process_urls_fallback_worker(urls: List[str], task_id: str):
    """Fallback worker running in-process using BackgroundTasks."""
    total_urls = len(urls)
    logger.info(f"Starting fallback in-process task {task_id} for {total_urls} URLs.")
    _fallback_status[task_id] = {
        'state': 'PROGRESS',
        'current': 0,
        'total': total_urls,
        'percentage': 0,
        'status': 'Processing...'
    }
    for i, url in enumerate(urls):
        _fetch_and_update_title_worker(url)
        _fallback_status[task_id] = {
            'state': 'PROGRESS',
            'current': i + 1,
            'total': total_urls,
            'percentage': int(((i + 1) / total_urls) * 100),
            'status': f'Processing {i + 1}/{total_urls}'
        }
        time.sleep(1)
    _fallback_status[task_id] = {
        'state': 'SUCCESS',
        'current': total_urls,
        'total': total_urls,
        'percentage': 100,
        'status': 'Completed'
    }
    logger.info(f"Finished fallback in-process task {task_id}.")
    notify_task_event("누락 제목 가져오기", f"총 {total_urls}개 URL의 제목 수집이 완료되었습니다.")

@celery_app.task(bind=True)
def process_urls_in_background_task(self, urls: List[str]):
    """Celery task to loop through URLs with a delay and fetch titles."""
    total_urls = len(urls)
    logger.info(f"Starting Celery task {self.request.id} to process {total_urls} URLs.")
    for i, url in enumerate(urls):
        self.update_state(state='PROGRESS', meta={'current': i + 1, 'total': total_urls, 'percentage': int(((i + 1) / total_urls) * 100)})
        logger.info(f"Processing URL {i+1}/{total_urls}: {url}")
        _fetch_and_update_title_worker(url)
        time.sleep(1)
    logger.info(f"Finished Celery task {self.request.id}.")
    notify_task_event("누락 제목 가져오기", f"총 {total_urls}개 URL의 제목 수집이 완료되었습니다.")
    return {'current': total_urls, 'total': total_urls, 'percentage': 100, 'status': 'Completed'}

@router.post(
    "/fetch_missing_titles",
    tags=["Tasks"],
    summary="누락된 제목 가져오기",
    description="데이터베이스에서 제목이 없는 모든 항목의 제목을 가져옵니다. Celery 또는 BackgroundTasks로 수행됩니다."
)
async def fetch_missing_titles_endpoint(background_tasks: BackgroundTasks):
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    invalid_titles_tuple = ('年齢確認', 'Just a moment...', 'Log in', '')
    placeholders = ', '.join('?' * len(invalid_titles_tuple))
    query = f"SELECT DISTINCT url FROM translations WHERE title IS NULL OR title IN ({placeholders})"
    urls_to_fetch = cursor.execute(query, invalid_titles_tuple).fetchall()
    conn.close()
    urls = [row[0] for row in urls_to_fetch]
    if not urls:
        return {"message": "No missing titles to fetch."}
    
    try:
        task = process_urls_in_background_task.apply_async(args=[urls])
        return {"message": f"Started fetching titles for {len(urls)} URLs in the background.", "task_id": task.id}
    except Exception as e:
        logger.warning(f"Celery task dispatch failed ({e}). Falling back to in-process BackgroundTasks.")
        task_id = f"fallback-{uuid.uuid4().hex[:8]}"
        background_tasks.add_task(_process_urls_fallback_worker, urls, task_id)
        return {"message": f"Started fetching titles for {len(urls)} URLs via background task (Celery fallback).", "task_id": task_id}

@router.get(
    "/task_status/{task_id}",
    tags=["Tasks"],
    summary="작업 상태 조회",
    description="Celery 또는 인프로세스 백그라운드 작업의 현재 상태를 조회합니다."
)
async def get_task_status(task_id: str):
    if task_id.startswith("fallback-") or task_id in _fallback_status:
        info = _fallback_status.get(task_id, {'state': 'PENDING', 'status': 'Pending...'})
        return {
            'state': info.get('state', 'PROGRESS'),
            'meta': info,
            'status': info.get('status', 'Processing...')
        }

    try:
        task_result = AsyncResult(task_id, app=celery_app)
        if task_result.state == 'PENDING':
            response = {
                'state': task_result.state,
                'status': 'Pending...'
            }
        elif task_result.state != 'FAILURE':
            response = {
                'state': task_result.state,
                'meta': task_result.info if isinstance(task_result.info, dict) else {},
            }
            if isinstance(task_result.info, dict) and 'status' in task_result.info:
                response['status'] = task_result.info['status']
            else:
                response['status'] = 'Processing...' if task_result.state == 'PROGRESS' else str(task_result.state)
        else:
            response = {
                'state': task_result.state,
                'status': str(task_result.info),
            }
        return response
    except Exception as e:
        logger.error(f"Error checking task status: {e}")
        return {'state': 'FAILURE', 'status': str(e)}
