import sqlite3
import os
import json
import re
import requests
import time
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
from collections import defaultdict
from urllib.parse import unquote, urlparse
from fastapi.templating import Jinja2Templates

from server.settings import settings

router = APIRouter()

templates = Jinja2Templates(directory=settings.templates_dir)

def get_db_path():
    parsed_url = urlparse(settings.database_url)
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

# Helper
def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

# Pydantic Models
class PinRequest(BaseModel):
    folderName: str

class FolderCreate(BaseModel):
    folder_name: str

class FolderUpdate(BaseModel):
    new_name: str

class BookTagUpdate(BaseModel):
    tag_ids: List[int]

class BookActivityUpdate(BaseModel):
    last_read_timestamp: Optional[int] = None
    last_read_pid: Optional[str] = None
    is_bookmarked: Optional[bool] = None
    notes: Optional[str] = None
    summary: Optional[str] = None
    summary_source_url: Optional[str] = None

class TocUrlItem(BaseModel):
    title: str
    url: str

class TocUrlUpdate(BaseModel):
    urls: List[TocUrlItem]

# Endpoints
@router.put(
    "/api/books/{folder_name}/urls",
    tags=["Books"],
    summary="책 URL 순서 업데이트",
    description="지정된 폴더(책) 내 URL들의 순서를 업데이트하고, 제목을 변경합니다."
)
def update_book_urls_order(folder_name: str, req: TocUrlUpdate):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    updated_count = 0

    try:
        # Reset existing sort orders for this book
        cursor.execute("UPDATE translations SET toc_sort_order = NULL WHERE folderName = ?", (decoded_folder_name,))

        # Update with new sort order
        for i, item in enumerate(req.urls):
            # Normalize URL by removing trailing slash for more robust matching
            normalized_url = item.url.rstrip('/')
            
            cursor.execute(
                "UPDATE translations SET toc_sort_order = ?, title = ? WHERE folderName = ? AND RTRIM(url, '/') = ?",
                (i, item.title, decoded_folder_name, normalized_url)
            )
            if cursor.rowcount > 0:
                updated_count += 1

        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"데이터베이스 오류: {e}")
    finally:
        conn.close()

    return {"message": f"'{decoded_folder_name}'의 순서 업데이트 완료. 총 {len(req.urls)}개 중 {updated_count}개가 일치했습니다."}

@router.get(
    "/folders",
    tags=["Books"],
    summary="모든 폴더(책) 목록 조회",
    description="모든 폴더(책) 목록과 각 폴더의 고정 상태, 태그, 활동 정보를 조회합니다."
)
def get_folders():
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity")
    activity_map = {row['folderName']: row for row in cursor.fetchall()}
    cursor.execute("SELECT bt.book_folderName, t.id, t.name FROM book_tags bt JOIN tags t ON bt.tag_id = t.id")
    book_tags_map = defaultdict(list)
    for row in cursor.fetchall():
        book_tags_map[row['book_folderName']].append({'id': row['id'], 'name': row['name']})
    cursor.execute("SELECT folderName FROM pinned_books")
    pinned_set = {row['folderName'] for row in cursor.fetchall()}
    cursor.execute("SELECT DISTINCT folderName FROM translations WHERE folderName IS NOT NULL")
    translation_folders = {row['folderName'] for row in cursor.fetchall()}

    cursor.execute("SELECT DISTINCT folderName FROM book_activity WHERE folderName IS NOT NULL")
    activity_folders = {row['folderName'] for row in cursor.fetchall()}

    all_folders_set = translation_folders.union(activity_folders)

    cursor.execute("SELECT 1 FROM translations WHERE folderName IS NULL LIMIT 1")
    if cursor.fetchone():
        all_folders_set.add("폴더 추가 대기 상태")
    conn.close()
    folder_objects = [
        {
            'name': f,
            'pinned': f in pinned_set,
            'tags': book_tags_map.get(f, []),
            'activity': activity_map.get(f)
        } for f in all_folders_set
    ]
    sorted_folders = sorted(folder_objects, key=lambda x: (not x['pinned'], x['name']))
    
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=sorted_folders, headers=headers)

@router.get(
    "/api/books",
    tags=["Books"],
    summary="모든 책 목록 조회 (폴더와 동일)",
    description="모든 책 목록을 조회합니다. 이는 /folders 엔드포인트와 동일한 기능을 제공합니다."
)
def get_books():
    return get_folders()

@router.post(
    "/api/folders",
    tags=["Books"],
    summary="새 폴더(책) 생성",
    description="새로운 폴더(책)를 생성합니다."
)
def create_folder(req: FolderCreate):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO book_activity (folderName) VALUES (?)", (req.folder_name,))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return {"message": f"폴더 ''{req.folder_name}''가 이미 존재합니다."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"데이터베이스 오류: {e}")
    finally:
        conn.close()
    return {"message": f"폴더 ''{req.folder_name}''가 생성되었습니다."}

@router.put(
    "/api/folders/{folder_name}",
    tags=["Books"],
    summary="폴더(책) 이름 변경",
    description="기존 폴더(책)의 이름을 변경합니다."
)
def update_folder_name(folder_name: str, req: FolderUpdate):
    old_name = unquote(folder_name)
    new_name = req.new_name

    if not new_name or old_name == new_name:
        raise HTTPException(status_code=400, detail="잘못된 폴더 이름입니다.")

    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT 1 FROM translations WHERE folderName = ? LIMIT 1", (new_name,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail=f"폴더 '{new_name}'이(가) 이미 존재합니다.")
        cursor.execute("SELECT 1 FROM book_activity WHERE folderName = ? LIMIT 1", (new_name,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail=f"폴더 '{new_name}'이(가) 이미 존재합니다.")

        cursor.execute("UPDATE translations SET folderName = ? WHERE folderName = ?", (new_name, old_name))
        cursor.execute("UPDATE book_activity SET folderName = ? WHERE folderName = ?", (new_name, old_name))

        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"데이터베이스 오류: {e}")
    finally:
        conn.close()

    return {"message": f"폴더 이름이 '{old_name}'에서 '{new_name}'(으)로 변경되었습니다."}

@router.post(
    "/api/books/pin",
    tags=["Books"],
    summary="책 고정/고정 해제",
    description="지정된 책(폴더)을 고정하거나 고정을 해제합니다."
)
def toggle_pin_book(req: PinRequest):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT folderName FROM pinned_books WHERE folderName = ?", (req.folderName,))
    is_pinned = cursor.fetchone()
    if is_pinned:
        cursor.execute("DELETE FROM pinned_books WHERE folderName = ?", (req.folderName,))
        message = f"'{req.folderName}' 책 고정을 해제했습니다."
    else:
        cursor.execute("INSERT INTO pinned_books (folderName) VALUES (?)", (req.folderName,))
        message = f"'{req.folderName}' 책을 고정했습니다."
    conn.commit()
    conn.close()
    return {"message": message}

@router.get(
    "/api/books/{folder_name}/urls",
    tags=["Books"],
    summary="책의 URL 목록 조회",
    description="지정된 폴더(책)에 속한 URL 목록을 조회합니다."
)
def get_book_urls(folder_name: str):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    base_query = """SELECT url, title, COUNT(*) as count, MIN(toc_sort_order) as toc_sort_order
                  FROM translations
                  WHERE {folder_clause}
                  GROUP BY url, title
                  ORDER BY toc_sort_order IS NULL, toc_sort_order ASC"""

    if decoded_folder_name == "미분류":
        query = base_query.format(folder_clause="folderName IS NULL")
        params = []
    else:
        query = base_query.format(folder_clause="folderName = ?")
        params = [decoded_folder_name]

    cursor.execute(query, tuple(params))
    urls = cursor.fetchall()
    conn.close()
    
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=urls, headers=headers)

@router.get(
    "/api/books/{folder_name}/chapters",
    tags=["Books"],
    summary="책의 챕터 목록 조회",
    description="지정된 폴더(책)에 속한 챕터(제목) 목록을 조회합니다."
)
def get_book_chapters(folder_name: str):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()

    base_order_by = "ORDER BY MIN(url) ASC, MIN(CASE WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%' THEN CAST(SUBSTR(pid, 2) AS INTEGER) ELSE 999999 END) ASC"

    if decoded_folder_name == "미분류":
        query = f"""SELECT title FROM translations WHERE folderName IS NULL AND title IS NOT NULL GROUP BY title {base_order_by}"""
        params = []
    else:
        query = f"""SELECT title FROM translations WHERE folderName = ? AND title IS NOT NULL GROUP BY title {base_order_by}"""
        params = [decoded_folder_name]

    cursor.execute(query, tuple(params))
    chapters = [row[0] for row in cursor.fetchall()]
    conn.close()
    return chapters

@router.get(
    "/api/books/{folder_name}/chapter",
    tags=["Books"],
    summary="특정 챕터 내용 조회",
    description="지정된 폴더(책)의 특정 챕터 내용을 조회합니다."
)
def get_chapter_content(folder_name: str, title: str):
    decoded_folder_name = unquote(folder_name)
    decoded_title = unquote(title)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    order_by_clause = "ORDER BY CASE WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%' THEN CAST(SUBSTR(pid, 2) AS INTEGER) ELSE 999999 END ASC, timestamp ASC"

    query = f"SELECT * FROM translations WHERE folderName = ? AND title = ? {order_by_clause}"
    params = [decoded_folder_name, decoded_title]
    if decoded_folder_name == "미분류":
        query = f"SELECT * FROM translations WHERE folderName IS NULL AND title = ? {order_by_clause}"
        params = [decoded_title]

    cursor.execute(query, tuple(params))
    content = cursor.fetchall()
    conn.close()
    return content

@router.get(
    "/api/books/{folder_name}/export",
    tags=["Books"],
    summary="책을 HTML로 내보내기",
    description="지정된 폴더(책)의 내용을 HTML 파일로 내보냅니다."
)
async def export_book_as_html(folder_name: str):
    decoded_folder_name = unquote(folder_name)
    
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    order_by_clause = "ORDER BY CASE WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%' THEN CAST(SUBSTR(pid, 2) AS INTEGER) ELSE 999999 END ASC, timestamp ASC"
    
    query = f"SELECT * FROM translations WHERE folderName = ? {order_by_clause}"
    params = [decoded_folder_name]
    if decoded_folder_name == "미분류":
        query = f"SELECT * FROM translations WHERE folderName IS NULL {order_by_clause}"
        params = []

    cursor.execute(query, tuple(params))
    book_data = cursor.fetchall()
    conn.close()

    if not book_data:
        raise HTTPException(status_code=404, detail="Book not found or has no content.")

    try:
        with open(os.path.join(settings.static_dir, "viewer.css"), "r", encoding="utf-8") as f:
            viewer_css = f.read()
        with open(os.path.join(settings.static_dir, "viewer.js"), "r", encoding="utf-8") as f:
            viewer_js = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Viewer assets (CSS/JS) not found.")

    template_context = {
        "request": None,
        "book_name": decoded_folder_name,
        "viewer_css": viewer_css,
        "book_data_json": json.dumps(book_data, ensure_ascii=False),
        "viewer_js": viewer_js
    }
    
    html_content = templates.get_template("export_template.html").render(template_context)
    
    safe_filename = "".join(c for c in decoded_folder_name if c.isalnum() or c in (' ', '_')).rstrip()
    headers = {
        'Content-Disposition': f'attachment; filename="{safe_filename}.html"'
    }
    return HTMLResponse(content=html_content, headers=headers)

@router.put(
    "/api/books/{folder_name}/tags",
    tags=["Books"],
    summary="책 태그 업데이트",
    description="지정된 폴더(책)의 태그를 업데이트합니다."
)
def update_book_tags(folder_name: str, req: BookTagUpdate):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM book_tags WHERE book_folderName = ?", (decoded_folder_name,))
        if req.tag_ids:
            values = [(decoded_folder_name, tag_id) for tag_id in req.tag_ids]
            cursor.executemany("INSERT INTO book_tags (book_folderName, tag_id) VALUES (?, ?)", values)
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        conn.close()
    return {"message": f"Tags for '{decoded_folder_name}' updated successfully."}

@router.put(
    "/api/books/{folder_name}/activity",
    tags=["Books"],
    summary="책 활동 정보 업데이트",
    description="지정된 폴더(책)의 마지막 읽은 시간, PID, 북마크 여부, 노트, 요약 등 활동 정보를 업데이트합니다."
)
def update_book_activity(folder_name: str, req: BookActivityUpdate):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    activity = cursor.fetchone()
    if not activity:
        activity = {'folderName': decoded_folder_name}
    update_data = req.dict(exclude_unset=True)
    activity.update(update_data)
    is_bookmarked_int = 1 if activity.get('is_bookmarked') else 0
    cursor.execute("""INSERT OR REPLACE INTO book_activity (folderName, last_read_timestamp, last_read_pid, is_bookmarked, notes, summary, summary_source_url) VALUES (?, ?, ?, ?, ?, ?, ?)""", (decoded_folder_name, activity.get('last_read_timestamp'), activity.get('last_read_pid'), is_bookmarked_int, activity.get('notes'), activity.get('summary'), activity.get('summary_source_url')))
    conn.commit()
    conn.close()
    return {"message": f"Activity for '{decoded_folder_name}' updated."}

@router.get(
    "/api/books/{folder_name}/activity",
    tags=["Books"],
    summary="책 활동 정보 조회",
    description="지정된 폴더(책)의 활동 정보를 조회합니다."
)
def get_book_activity(folder_name: str):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(get_db_path(), timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    activity = cursor.fetchone()

    if activity and activity.get('last_read_pid'):
        cursor.execute("SELECT title FROM translations WHERE folderName = ? AND pid = ? LIMIT 1", (decoded_folder_name, activity['last_read_pid']))
        title_result = cursor.fetchone()
        if title_result:
            activity['last_read_chapter_title'] = title_result['title']

    conn.close()
    if not activity:
        return {"folderName": decoded_folder_name, "last_read_pid": None}
    return activity

def _crawl_and_update_summary_worker(folder_name: str, url: str):
    # This function is not an endpoint, but a helper for an endpoint.
    # It's kept here as it's tightly coupled with the crawl-summary endpoint.
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        with requests.Session() as s:
            s.headers.update(headers)
            if "novel18.syosetu.com" in url:
                s.cookies.set("over18", "yes", domain=".syosetu.com")
            response = s.get(url, timeout=15)
        response.raise_for_status()
        html_content = response.text

        summary = None
        summary_match = re.search(r'<div id="novel_ex">(.*?)</div>', html_content, re.DOTALL)
        if summary_match:
            summary_html = summary_match.group(1).strip()
            summary = summary_html.replace('<br />', '\n')
            summary = re.sub('<.*?>', '', summary)
        
        if not summary:
            meta_match = re.search(r'<meta name="description" content="(.*?)">', html_content, re.IGNORECASE)
            if meta_match:
                summary = meta_match.group(1).strip()

        if summary:
            conn = sqlite3.connect(get_db_path(), timeout=15)
            cursor = conn.cursor()
            cursor.execute("""INSERT INTO book_activity (folderName, summary) VALUES (?, ?) ON CONFLICT(folderName) DO UPDATE SET summary = excluded.summary;""", (folder_name, summary))
            conn.commit()
            conn.close()
            return True
        else:
            return False

    except Exception as e:
        # Consider logging the error
        return False

@router.post(
    "/api/books/{folder_name}/crawl-summary",
    tags=["Books"],
    summary="책 요약 정보 크롤링 시작",
    description="지정된 폴더(책)의 요약 정보를 백그라운드에서 크롤링합니다."
)
async def crawl_summary_endpoint(folder_name: str, background_tasks: BackgroundTasks):
    decoded_folder_name = unquote(folder_name)

    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT summary_source_url FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    result = cursor.fetchone()
    conn.close()

    if not result or not result[0]:
        raise HTTPException(status_code=404, detail="Summary source URL is not set for this book.")

    source_url = result[0]
    
    background_tasks.add_task(_crawl_and_update_summary_worker, decoded_folder_name, source_url)
    
    return {"message": "Summary crawling started in the background."}