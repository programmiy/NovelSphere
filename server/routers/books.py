import sqlite3
import os
import json
import re
import requests
import time
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import JSONResponse, HTMLResponse
from pydantic import BaseModel
from typing import List, Optional
from collections import defaultdict
from urllib.parse import unquote, urlparse
from fastapi.templating import Jinja2Templates

from server.settings import settings
from server.database import get_sqlite_conn, dict_factory, get_db_path
from server.utils import natural_sort_key

router = APIRouter()
logger = logging.getLogger(__name__)

templates = Jinja2Templates(directory=settings.templates_dir)

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
    last_read_chapter_title: Optional[str] = None
    is_completed: Optional[bool] = None
    is_visible: Optional[bool] = None
    is_bookmarked: Optional[bool] = None
    notes: Optional[str] = None
    summary: Optional[str] = None
    summary_source_url: Optional[str] = None

class BookVisibilityUpdate(BaseModel):
    is_visible: bool

class TocUrlItem(BaseModel):
    title: str
    url: str

class TocUrlUpdate(BaseModel):
    urls: List[TocUrlItem]

class CheckUrlsRequest(BaseModel):
    urls: List[str]

from server.services.book_service import get_all_folders, update_book_toc_order

# Endpoints
@router.put(
    "/api/books/{folder_name}/urls",
    tags=["Books"],
    summary="책 URL 순서 업데이트",
    description="지정된 폴더(책) 내 URL들의 순서를 업데이트하고, 제목을 변경합니다."
)
def update_book_urls_order(folder_name: str, req: TocUrlUpdate):
    decoded_folder_name = unquote(folder_name)
    try:
        urls_dict = [{"url": u.url, "title": u.title} for u in req.urls]
        updated_count = update_book_toc_order(decoded_folder_name, urls_dict)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"데이터베이스 오류: {e}")

    return {"message": f"'{decoded_folder_name}'의 순서 업데이트 완료. 총 {len(req.urls)}개 중 {updated_count}개가 일치했습니다."}

@router.get(
    "/folders",
    tags=["Books"],
    summary="모든 폴더(책) 목록 조회",
    description="모든 폴더(책) 목록과 각 폴더의 고정 상태, 태그, 활동 정보를 조회합니다. include_hidden=True 지정 시 숨김 처리된 책도 포함합니다."
)
def get_folders(include_hidden: bool = False):
    sorted_folders = get_all_folders(include_hidden=include_hidden)
    
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
def get_books(include_hidden: bool = False):
    return get_folders(include_hidden=include_hidden)

@router.post(
    "/api/folders",
    tags=["Books"],
    summary="새 폴더(책) 생성",
    description="새로운 폴더(책)를 생성합니다."
)
def create_folder(req: FolderCreate):
    conn = get_sqlite_conn()
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

    conn = get_sqlite_conn()
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
        cursor.execute("UPDATE pinned_books SET folderName = ? WHERE folderName = ?", (new_name, old_name))
        cursor.execute("UPDATE book_tags SET book_folderName = ? WHERE book_folderName = ?", (new_name, old_name))

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
    conn = get_sqlite_conn()
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
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    folder_clause = "folderName IS NULL" if decoded_folder_name == "미분류" else "folderName = ?"
    params = [] if decoded_folder_name == "미분류" else [decoded_folder_name]

    query = f"""
        SELECT 
            url, 
            COALESCE(
                (SELECT t2.title FROM translations t2 
                 WHERE t2.url = t1.url AND ({folder_clause}) AND t2.title IS NOT NULL AND t2.title != ''
                 ORDER BY t2.timestamp DESC LIMIT 1),
                title,
                url
            ) as title,
            COUNT(*) as count, 
            MIN(toc_sort_order) as toc_sort_order,
            MIN(id) as min_id
        FROM translations t1
        WHERE {folder_clause}
        GROUP BY url
    """

    cursor.execute(query, tuple(params + params))
    urls = cursor.fetchall()
    conn.close()

    # 자연 정렬: toc_sort_order 우선, 없으면 min_id 우선, 그 다음 URL 및 제목 자연 정렬 (001 -> 002 -> 010 -> 100)
    urls.sort(key=lambda x: (
        x.get('toc_sort_order') is None,
        x.get('toc_sort_order') if x.get('toc_sort_order') is not None else 0,
        x.get('min_id', 0),
        natural_sort_key(x.get('url') or ''),
        natural_sort_key(x.get('title') or '')
    ))
    
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
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    folder_clause = "folderName IS NULL" if decoded_folder_name == "미분류" else "folderName = ?"
    params = [] if decoded_folder_name == "미분류" else [decoded_folder_name]

    # 관리자 페이지와 동일하게: URL(회차) 기준으로 그룹화하여 챕터 목록을 구성
    # URL 내 단락별 제목 불일치가 있더라도 단일 회차로 병합되며 최신 제목을 대표 제목으로 사용
    query = f"""
        SELECT 
            COALESCE(url, title) as chapter_key,
            url,
            COALESCE(
                (SELECT t2.title FROM translations t2 
                 WHERE t2.url = t1.url AND ({folder_clause}) AND t2.title IS NOT NULL AND t2.title != ''
                 ORDER BY t2.timestamp DESC LIMIT 1),
                title,
                url
            ) as title,
            MIN(COALESCE(toc_sort_order, 999999)) as sort_order,
            MIN(id) as min_id,
            MIN(url) as min_url
        FROM translations t1
        WHERE {folder_clause} AND (title IS NOT NULL OR url IS NOT NULL)
        GROUP BY COALESCE(url, title)
    """

    cursor.execute(query, tuple(params + params))
    rows = cursor.fetchall()
    conn.close()

    # 자연 정렬: toc_sort_order 우선, 없으면 min_id 우선, 그 다음 URL 및 제목 자연 정렬 (001 -> 002 -> 010 -> 100)
    def chapter_sort_key(row):
        sort_order = row.get('sort_order')
        has_valid_toc = sort_order is not None and sort_order < 999999
        return (
            not has_valid_toc,
            sort_order if has_valid_toc else 0,
            row.get('min_id', 0),
            natural_sort_key(row.get('min_url') or ''),
            natural_sort_key(row.get('title') or '')
        )

    rows.sort(key=chapter_sort_key)
    chapters = [row['title'] for row in rows if row.get('title')]

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=chapters, headers=headers)

@router.get(
    "/api/books/{folder_name}/chapter",
    tags=["Books"],
    summary="특정 챕터 내용 조회",
    description="지정된 폴더(책)의 특정 챕터 내용을 조회합니다."
)
def get_chapter_content(folder_name: str, title: str, url: Optional[str] = None):
    decoded_folder_name = unquote(folder_name)
    decoded_title = unquote(title) if title else ""
    decoded_url = unquote(url) if url else None
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    order_by_clause = "ORDER BY CASE WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%' THEN CAST(SUBSTR(pid, 2) AS INTEGER) ELSE 999999 END ASC, timestamp ASC"
    folder_filter = "folderName IS NULL" if decoded_folder_name == "미분류" else "folderName = ?"
    folder_params = [] if decoded_folder_name == "미분류" else [decoded_folder_name]

    # 관리자 페이지와 데이터 불러오기 일치화:
    # URL이 직접 지정되었거나, title을 통해 해당 회차의 URL을 조회하여 해당 URL의 모든 단락을 함께 불러옴
    matched_urls = []
    if decoded_url:
        matched_urls = [decoded_url]
    elif decoded_title:
        cursor.execute(
            f"SELECT DISTINCT url FROM translations WHERE {folder_filter} AND title = ? AND url IS NOT NULL AND url != ''",
            tuple(folder_params + [decoded_title])
        )
        matched_urls = [row['url'] for row in cursor.fetchall() if row['url']]

    if matched_urls:
        placeholders = ', '.join(['?'] * len(matched_urls))
        query = f"SELECT * FROM translations WHERE {folder_filter} AND (url IN ({placeholders}) OR title = ?) {order_by_clause}"
        params = folder_params + matched_urls + [decoded_title]
    else:
        query = f"SELECT * FROM translations WHERE {folder_filter} AND title = ? {order_by_clause}"
        params = folder_params + [decoded_title]

    cursor.execute(query, tuple(params))
    content = cursor.fetchall()
    conn.close()

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=content, headers=headers)

@router.get(
    "/api/books/{folder_name}/export",
    tags=["Books"],
    summary="책을 HTML로 내보내기",
    description="지정된 폴더(책)의 내용을 HTML 파일로 내보냅니다."
)
async def export_book_as_html(folder_name: str):
    decoded_folder_name = unquote(folder_name)
    
    conn = get_sqlite_conn(as_dict=True)
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
    conn = get_sqlite_conn()
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
    description="지정된 폴더(책)의 마지막 읽은 시간, PID, 북마크 여부, 완료 여부, 노출 여부, 노트, 요약 등 활동 정보를 업데이트합니다."
)
def update_book_activity(folder_name: str, req: BookActivityUpdate):
    decoded_folder_name = unquote(folder_name)
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    activity = cursor.fetchone()
    if not activity:
        activity = {'folderName': decoded_folder_name, 'is_visible': 1}
    if hasattr(req, "model_dump"):
        update_data = req.model_dump(exclude_unset=True)
    else:
        update_data = req.dict(exclude_unset=True)
    activity.update(update_data)
    is_bookmarked_int = 1 if activity.get('is_bookmarked') else 0
    is_completed_int = 1 if activity.get('is_completed') else 0
    
    # is_visible: 명시적으로 False/0인 경우 0, 그 외(None 등)는 기존 값 또는 기본 1
    raw_visible = activity.get('is_visible')
    if raw_visible is not None:
        is_visible_int = 0 if not raw_visible else 1
    else:
        is_visible_int = 1

    cursor.execute("""
        INSERT OR REPLACE INTO book_activity (
            folderName, last_read_timestamp, last_read_pid, last_read_chapter_title, 
            is_completed, is_visible, is_bookmarked, notes, summary, summary_source_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        decoded_folder_name, 
        activity.get('last_read_timestamp'), 
        activity.get('last_read_pid'), 
        activity.get('last_read_chapter_title'),
        is_completed_int,
        is_visible_int,
        is_bookmarked_int, 
        activity.get('notes'), 
        activity.get('summary'), 
        activity.get('summary_source_url')
    ))
    conn.commit()
    conn.close()
    activity['is_completed'] = is_completed_int
    activity['is_visible'] = is_visible_int
    activity['is_bookmarked'] = is_bookmarked_int
    return {"message": f"Activity for '{decoded_folder_name}' updated.", "activity": activity}

@router.put(
    "/api/books/{folder_name}/visibility",
    tags=["Books"],
    summary="책 숨김/표시 상태 업데이트",
    description="지정된 폴더(책)의 is_visible 상태를 변경하여 서재 및 목록에서 숨기거나 다시 표시합니다."
)
def update_book_visibility(folder_name: str, req: BookVisibilityUpdate):
    decoded_folder_name = unquote(folder_name)
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
        activity = cursor.fetchone()
        is_visible_int = 1 if req.is_visible else 0
        if activity:
            cursor.execute("UPDATE book_activity SET is_visible = ? WHERE folderName = ?", (is_visible_int, decoded_folder_name))
        else:
            cursor.execute("INSERT INTO book_activity (folderName, is_visible) VALUES (?, ?)", (decoded_folder_name, is_visible_int))
        conn.commit()
    finally:
        conn.close()
    return {"message": f"'{decoded_folder_name}'의 표시 상태가 변경되었습니다.", "is_visible": req.is_visible}

@router.get(
    "/api/books/{folder_name}/activity",
    tags=["Books"],
    summary="책 활동 정보 조회",
    description="지정된 폴더(책)의 활동 정보를 조회합니다."
)
def get_book_activity(folder_name: str):
    decoded_folder_name = unquote(folder_name)
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    activity = cursor.fetchone()

    # last_read_chapter_title이 DB에 비어있을 때만 pid 기반 보조 조회 (기존 챕터 타이틀 오염 방지)
    if activity and not activity.get('last_read_chapter_title') and activity.get('last_read_pid'):
        cursor.execute("SELECT title FROM translations WHERE folderName = ? AND pid = ? LIMIT 1", (decoded_folder_name, activity['last_read_pid']))
        title_result = cursor.fetchone()
        if title_result and title_result.get('title'):
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
        # NovelUp: 에피소드 URL일 경우 작품 목차 URL로 변환하여 완전한 줄거리 원문 요청
        target_url = url
        if "novelup.plus" in url:
            nup_match = re.search(r'https?://novelup\.plus/story/(\d+)', url)
            if nup_match:
                target_url = f"https://novelup.plus/story/{nup_match.group(1)}"

        with requests.Session() as s:
            s.headers.update(headers)
            if "novel18.syosetu.com" in target_url:
                s.cookies.set("over18", "yes", domain=".syosetu.com")
            response = s.get(target_url, timeout=15)
        response.raise_for_status()
        html_content = response.text

        summary = None
        # 1. Syosetu (novel_ex) 줄거리 원문 추출 (축약/요약 없이 원문 그대로 보존)
        summary_match = re.search(r'<div id="novel_ex">(.*?)</div>', html_content, re.DOTALL)
        if summary_match:
            summary_html = summary_match.group(1).strip()
            summary = summary_html.replace('<br />', '\n').replace('<br>', '\n').replace('<br/>', '\n')
            summary = re.sub(r'<.*?>', '', summary).strip()
        
        # 2. Kakuyomu 줄거리 원문 추출
        if not summary:
            kakuyomu_match = re.search(r'<div[^>]*class="[^"]*WorkIntroductionText[^"]*"[^>]*>(.*?)</div>', html_content, re.DOTALL)
            if kakuyomu_match:
                k_html = kakuyomu_match.group(1).strip()
                summary = k_html.replace('<br />', '\n').replace('<br>', '\n').replace('<br/>', '\n')
                summary = re.sub(r'<.*?>', '', summary).strip()

        # 3. NovelUp 줄거리 원문 추출 (.novel_synopsis)
        if not summary:
            novelup_match = re.search(r'<div[^>]*class="[^"]*novel_synopsis[^"]*"[^>]*>(.*?)</div>', html_content, re.DOTALL)
            if novelup_match:
                n_html = novelup_match.group(1).strip()
                summary = n_html.replace('<br />', '\n').replace('<br>', '\n').replace('<br/>', '\n')
                summary = re.sub(r'<.*?>', '', summary).strip()

        # 4. Meta description 폴백
        if not summary:
            meta_match = re.search(r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']', html_content, re.IGNORECASE)
            if meta_match:
                summary = meta_match.group(1).strip()

        if summary:
            conn = get_sqlite_conn()
            cursor = conn.cursor()
            cursor.execute("""INSERT INTO book_activity (folderName, summary) VALUES (?, ?) ON CONFLICT(folderName) DO UPDATE SET summary = excluded.summary;""", (folder_name, summary))
            conn.commit()
            conn.close()
            logger.info(f"[줄거리 수집 성공] '{folder_name}' ({url}) - {len(summary)}자 원문 저장 완료")
            return True
        else:
            logger.warning(f"[줄거리 수집 실패] 본문에서 줄거리를 찾을 수 없습니다: '{folder_name}' ({url})")
            return False

    except requests.exceptions.RequestException as e:
        logger.error(f"[줄거리 수집 네트워크 오류] '{folder_name}' ({url}): {e}")
        return False
    except Exception as e:
        logger.error(f"[줄거리 수집 예외 발생] '{folder_name}' ({url}): {e}", exc_info=True)
        return False

@router.post(
    "/api/books/{folder_name}/crawl-summary",
    tags=["Books"],
    summary="책 요약 정보 크롤링 시작",
    description="지정된 폴더(책)의 요약 정보를 백그라운드에서 크롤링합니다."
)
async def crawl_summary_endpoint(folder_name: str, background_tasks: BackgroundTasks):
    decoded_folder_name = unquote(folder_name)

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT summary_source_url FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    result = cursor.fetchone()
    conn.close()

    if not result or not result[0]:
        raise HTTPException(status_code=404, detail="Summary source URL is not set for this book.")

    source_url = result[0]
    
    background_tasks.add_task(_crawl_and_update_summary_worker, decoded_folder_name, source_url)
    
    return {"message": "Summary crawling started in the background."}

@router.post(
    "/api/check_translated_urls",
    tags=["Books"],
    summary="URL 목록의 번역 여부 배치 확인",
    description="주어진 URL 목록 중 번역 DB에 데이터가 존재하는 URL들을 일괄 조회합니다."
)
def check_translated_urls(req: CheckUrlsRequest):
    if not req.urls:
        return {"translated_urls": []}
    
    # URL 정규화 (해시 제거, 슬래시 양방향 비교 준비)
    normalized_map = {}
    for raw_url in req.urls:
        if not raw_url:
            continue
        clean = raw_url.split('#')[0].strip()
        stripped = clean.rstrip('/')
        normalized_map[stripped] = raw_url
        normalized_map[stripped + '/'] = raw_url

    lookup_keys = list(normalized_map.keys())
    if not lookup_keys:
        return {"translated_urls": []}

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    
    translated_urls = set()
    chunk_size = 900
    for i in range(0, len(lookup_keys), chunk_size):
        chunk = lookup_keys[i:i + chunk_size]
        placeholders = ','.join(['?'] * len(chunk))
        cursor.execute(f"SELECT DISTINCT url FROM translations WHERE url IN ({placeholders})", chunk)
        for row in cursor.fetchall():
            if row[0]:
                orig = normalized_map.get(row[0]) or normalized_map.get(row[0].rstrip('/'))
                if orig:
                    translated_urls.add(orig)

    conn.close()
    return {"translated_urls": list(translated_urls)}