import logging
import re
import time
from typing import List
from fastapi import APIRouter
import requests

from server.database import get_sqlite_conn
from server.notifications import notify_task_event
from server.security import is_safe_external_url
from server.services.task_manager import task_manager

router = APIRouter()
logger = logging.getLogger(__name__)


def _fetch_and_update_title_worker(url: str) -> bool:
    """단일 URL의 소설 제목을 스크래핑하여 translations 테이블에 업데이트합니다."""
    if not is_safe_external_url(url):
        logger.warning(f"Skipping unsafe or private URL for SSRF protection: {url}")
        return False
    try:
        headers = {
            'User-Agent': (
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                'AppleWebKit/537.36 (KHTML, like Gecko) '
                'Chrome/91.0.4472.124 Safari/537.36'
            )
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


def _run_fetch_missing_titles(urls: List[str], task_id: str):
    """TaskManager에 의해 백그라운드 스레드에서 실행되는 제목 일괄 수집 워커."""
    total_urls = len(urls)
    logger.info(f"[TaskManager] Starting title fetch for {total_urls} URLs (Task ID: {task_id}).")

    for i, url in enumerate(urls):
        if task_manager.is_cancelled(task_id):
            logger.info(f"[TaskManager] Title fetch task {task_id} was cancelled at {i}/{total_urls}.")
            return {"processed": i, "total": total_urls, "status": "Cancelled"}

        _fetch_and_update_title_worker(url)
        task_manager.report_progress(
            task_id=task_id,
            current=i + 1,
            total=total_urls,
            status_text=f"Processing {i + 1}/{total_urls}"
        )
        time.sleep(0.5)

    logger.info(f"[TaskManager] Finished title fetch task {task_id}.")
    notify_task_event("누락 제목 가져오기", f"총 {total_urls}개 URL의 제목 수집이 완료되었습니다.")
    return {"processed": total_urls, "total": total_urls, "status": "Completed"}


@router.post(
    "/fetch_missing_titles",
    tags=["Tasks"],
    summary="누락된 제목 가져오기",
    description="데이터베이스에서 제목이 없는 모든 항목의 제목을 TaskManager 백그라운드 큐를 통해 수집합니다."
)
async def fetch_missing_titles_endpoint():
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

    task_id = task_manager.enqueue(
        task_type="fetch_titles",
        func=_run_fetch_missing_titles,
        urls=urls,
        total_items=len(urls),
        pass_task_id=True
    )
    return {
        "message": f"Started fetching titles for {len(urls)} URLs in the background.",
        "task_id": task_id
    }


@router.get(
    "/task_status/{task_id}",
    tags=["Tasks"],
    summary="작업 상태 조회 (호환용)",
    description="TaskManager 작업의 실시간 진행 상태를 조회합니다. (library.js 및 이전 클라이언트 호환)"
)
async def get_task_status_compat(task_id: str):
    return task_manager.get_status(task_id)


@router.get(
    "/tasks/{task_id}",
    tags=["Tasks"],
    summary="작업 상태 조회 (REST)",
    description="TaskManager 작업의 실시간 진행 상태를 조회합니다."
)
async def get_task_status(task_id: str):
    return task_manager.get_status(task_id)


@router.post(
    "/tasks/{task_id}/cancel",
    tags=["Tasks"],
    summary="작업 취소",
    description="진행 중이거나 대기 중인 백그라운드 작업을 취소합니다."
)
async def cancel_task_endpoint(task_id: str):
    success = task_manager.cancel(task_id)
    return {"task_id": task_id, "cancelled": success}


@router.get(
    "/tasks",
    tags=["Tasks"],
    summary="작업 목록 조회",
    description="최근 등록된 백그라운드 작업 이력을 조회합니다."
)
async def list_tasks_endpoint(limit: int = 50):
    return task_manager.list_tasks(limit=limit)
