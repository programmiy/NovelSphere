
import sqlite3
import re
import requests
import time
import os
import logging
from fastapi import APIRouter, HTTPException
from typing import List
from server.celery_app import celery_app
from celery.result import AsyncResult
from urllib.parse import urlparse
from server.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

def get_db_path():
    parsed_url = urlparse(settings.database_url)
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

def _fetch_and_update_title_worker(url: str):
    """Internal worker to fetch a single title. Returns True if title is valid and updated."""
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
            conn = sqlite3.connect(get_db_path(), timeout=15)
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
    return {'current': total_urls, 'total': total_urls, 'percentage': 100, 'status': 'Completed'}

@router.post(
    "/fetch_missing_titles",
    tags=["Tasks"],
    summary="누락된 제목 가져오기",
    description="데이터베이스에서 제목이 없는 모든 항목의 제목을 가져옵니다. Celery를 사용하는 장기 백그라운드 작업입니다."
)
async def fetch_missing_titles_endpoint():
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    invalid_titles_tuple = ('年齢確認', 'Just a moment...', 'Log in', '')
    placeholders = ', '.join('?' * len(invalid_titles_tuple))
    query = f"SELECT DISTINCT url FROM translations WHERE title IS NULL OR title IN ({placeholders})"
    urls_to_fetch = cursor.execute(query, invalid_titles_tuple).fetchall()
    conn.close()
    urls = [row[0] for row in urls_to_fetch]
    if not urls:
        return {"message": "No missing titles to fetch."}
    
    task = process_urls_in_background_task.apply_async(args=[urls])
    return {"message": f"Started fetching titles for {len(urls)} URLs in the background.", "task_id": task.id}

@router.get(
    "/task_status/{task_id}",
    tags=["Tasks"],
    summary="Celery 작업 상태 조회",
    description="Celery 작업의 현재 상태를 조회합니다."
)
async def get_task_status(task_id: str):
    task_result = AsyncResult(task_id, app=celery_app)
    if task_result.state == 'PENDING':
        response = {
            'state': task_result.state,
            'status': 'Pending...'
        }
    elif task_result.state != 'FAILURE':
        response = {
            'state': task_result.state,
            'meta': task_result.info,
        }
        if 'status' in task_result.info:
            response['status'] = task_result.info['status']
    else:
        response = {
            'state': task_result.state,
            'status': str(task_result.info),  # This is the exception raised
        }
    return response
