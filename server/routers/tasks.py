import sqlite3
import re
import requests
import time
import os
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from typing import List

router = APIRouter()
logger = logging.getLogger(__name__)

script_dir = os.path.dirname(os.path.abspath(__file__))
DATABASE_FILE = os.path.join(script_dir, "..", "translations.db")

PROGRESS_STATUS = {"task": "none", "current": 0, "total": 0, "percentage": 0}

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
            conn = sqlite3.connect(DATABASE_FILE, timeout=15)
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

def process_urls_in_background(urls: List[str]):
    """Loops through URLs with a delay and fetches titles."""
    global PROGRESS_STATUS
    total_urls = len(urls)
    PROGRESS_STATUS = {"task": "fetch_titles", "current": 0, "total": total_urls, "percentage": 0}
    logger.info(f"Starting background task to process {total_urls} URLs.")
    for i, url in enumerate(urls):
        PROGRESS_STATUS["current"] = i + 1
        PROGRESS_STATUS["percentage"] = int(((i + 1) / total_urls) * 100)
        logger.info(f"Processing URL {i+1}/{total_urls}: {url} (Progress: {PROGRESS_STATUS['percentage']}%)")
        _fetch_and_update_title_worker(url)
        time.sleep(1)
    PROGRESS_STATUS = {"task": "none", "current": 0, "total": 0, "percentage": 100} # Reset on completion
    logger.info("Finished background task for fetching titles.")

@router.post("/fetch_missing_titles")
async def fetch_missing_titles_endpoint(background_tasks: BackgroundTasks):
    """
    Fetches titles for all entries in the database that do not have a title yet.
    This is a long-running background task.
    """
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    invalid_titles_tuple = ('年齢確認', 'Just a moment...', 'Log in', '')
    placeholders = ', '.join('?' * len(invalid_titles_tuple))
    query = f"SELECT DISTINCT url FROM translations WHERE title IS NULL OR title IN ({placeholders})"
    urls_to_fetch = cursor.execute(query, invalid_titles_tuple).fetchall()
    conn.close()
    urls = [row[0] for row in urls_to_fetch]
    if not urls:
        return {"message": "No missing titles to fetch."}
    background_tasks.add_task(process_urls_in_background, urls)
    return {"message": f"Started fetching titles for {len(urls)} URLs in the background. This will take time."}
