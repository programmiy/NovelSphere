import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from server.database import get_sqlite_conn
from server.utils import normalize_url

router = APIRouter()
logger = logging.getLogger(__name__)

# Pydantic Models
class ApplyUrlRequest(BaseModel):
    url: str
    apply: bool

class UrlMetadataUpdate(BaseModel):
    url: str
    sort_order: Optional[int] = None

class UrlMetadataBatchUpdate(BaseModel):
    updates: List[UrlMetadataUpdate]

# API Endpoints
@router.post(
    "/api/urls/apply",
    tags=["URL Config"],
    summary="URL 적용 상태 토글",
    description="주어진 URL의 적용 상태를 토글합니다 (적용/미적용)."
)
def toggle_apply_url(req: ApplyUrlRequest):
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    clean_url = normalize_url(req.url)
    
    if req.apply:
        cursor.execute("INSERT OR IGNORE INTO applied_urls (url) VALUES (?)", (clean_url,))
    else:
        urls_to_delete = {clean_url, clean_url + '/'}
        raw_clean = req.url.split('#')[0].rstrip('/')
        urls_to_delete.add(raw_clean)
        urls_to_delete.add(raw_clean + '/')
        no_protocol_url = re.sub(r'^https?://', '', clean_url)
        urls_to_delete.update([
            'http://' + no_protocol_url,
            'https://' + no_protocol_url,
            'http://' + no_protocol_url + '/',
            'https://' + no_protocol_url + '/'
        ])
        
        placeholders = ', '.join('?' * len(urls_to_delete))
        cursor.execute(f"DELETE FROM applied_urls WHERE url IN ({placeholders})", list(urls_to_delete))

    conn.commit()
    conn.close()
    return {"message": "Success", "applied": req.apply}

@router.put(
    "/api/url_metadata",
    tags=["URL Config"],
    summary="URL 메타데이터 업데이트",
    description="단일 URL의 메타데이터(예: 정렬 순서)를 업데이트합니다."
)
def update_url_metadata(req: UrlMetadataUpdate):
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT OR REPLACE INTO url_metadata (url, sort_order) VALUES (?, ?)",
            (req.url, req.sort_order)
        )
        conn.commit()
        return {"message": f"Successfully updated metadata for {req.url}."}
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating url_metadata for {req.url}: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred: {e}")
    finally:
        conn.close()

@router.put(
    "/api/url_metadata/batch",
    tags=["URL Config"],
    summary="URL 메타데이터 일괄 업데이트",
    description="여러 URL의 메타데이터(예: 정렬 순서)를 일괄적으로 업데이트합니다."
)
def update_url_metadata_batch(req: UrlMetadataBatchUpdate):
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    try:
        data = [(update_item.url, update_item.sort_order) for update_item in req.updates]
        cursor.executemany(
            "INSERT OR REPLACE INTO url_metadata (url, sort_order) VALUES (?, ?)",
            data
        )
        conn.commit()
        return {"message": f"Successfully batch updated {len(req.updates)} URL metadata entries."}
    except Exception as e:
        conn.rollback()
        logger.error(f"Error during batch update of url_metadata: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred during batch update: {e}")
    finally:
        conn.close()

@router.get(
    "/api/urls/apply_status",
    tags=["URL Config"],
    summary="URL 적용 상태 조회",
    description="주어진 URL의 현재 적용 상태를 조회합니다."
)
def get_apply_status(url: str):
    conn = get_sqlite_conn()
    cursor = conn.cursor()

    normalized = normalize_url(url)
    raw_clean = url.split('#')[0].rstrip('/')
    urls_to_check = {normalized, normalized + '/', raw_clean, raw_clean + '/'}
    
    no_protocol = re.sub(r'^https?://', '', normalized)
    urls_to_check.update([
        'http://' + no_protocol,
        'https://' + no_protocol,
        'http://' + no_protocol + '/',
        'https://' + no_protocol + '/'
    ])
    
    if no_protocol.startswith('www.'):
        no_www = no_protocol.replace('www.', '', 1)
        urls_to_check.update(['http://' + no_www, 'https://' + no_www, 'http://' + no_www + '/', 'https://' + no_www + '/'])
    else:
        with_www = 'www.' + no_protocol
        urls_to_check.update(['http://' + with_www, 'https://' + with_www, 'http://' + with_www + '/', 'https://' + with_www + '/'])
        
    if 'kakuyomu.jp/works/' in url:
        match = re.match(r'(https?://kakuyomu\.jp/works/\d+)', url)
        if match:
            work_url = match.group(1)
            urls_to_check.update([work_url, work_url + '/', normalize_url(work_url)])

    if 'novelup.plus/story/' in url:
        match = re.match(r'(https?://novelup\.plus/story/\d+)', url)
        if match:
            story_url = match.group(1)
            urls_to_check.update([story_url, story_url + '/', normalize_url(story_url)])

    if 'syosetu.com/' in url:
        match = re.match(r'(https?://[^/]+\.syosetu\.com/n\w+)', url)
        if match:
            syosetu_work_url = match.group(1)
            urls_to_check.update([syosetu_work_url, syosetu_work_url + '/', normalize_url(syosetu_work_url)])

    url_list = list(urls_to_check)
    placeholders = ', '.join('?' * len(url_list))
    
    query = f"SELECT 1 FROM applied_urls WHERE url IN ({placeholders}) LIMIT 1"
    cursor.execute(query, url_list)
    
    is_applied = cursor.fetchone() is not None
    conn.close()
    return {"applied": is_applied}