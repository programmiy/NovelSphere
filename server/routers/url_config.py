import sqlite3
import os
import re
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
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
@router.post("/api/urls/apply")
def toggle_apply_url(req: ApplyUrlRequest):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    clean_url = req.url.split('#')[0].rstrip('/')
    
    if req.apply:
        cursor.execute("INSERT OR IGNORE INTO applied_urls (url) VALUES (?)", (clean_url,))
    else:
        urls_to_delete = set()
        urls_to_delete.add(clean_url)
        urls_to_delete.add(clean_url + '/')
        no_protocol_url = re.sub(r'^https?://', '', clean_url)
        urls_to_delete.add('http://' + no_protocol_url)
        urls_to_delete.add('https://' + no_protocol_url)
        urls_to_delete.add('http://' + no_protocol_url + '/')
        urls_to_delete.add('https://' + no_protocol_url + '/')
        
        placeholders = ', '.join('?' * len(urls_to_delete))
        cursor.execute(f"DELETE FROM applied_urls WHERE url IN ({placeholders})", list(urls_to_delete))

    conn.commit()
    conn.close()

@router.put("/api/url_metadata")
def update_url_metadata(req: UrlMetadataUpdate):
    conn = sqlite3.connect(get_db_path(), timeout=15)
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

@router.put("/api/url_metadata/batch")
def update_url_metadata_batch(req: UrlMetadataBatchUpdate):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    try:
        for update_item in req.updates:
            cursor.execute(
                "INSERT OR REPLACE INTO url_metadata (url, sort_order) VALUES (?, ?)",
                (update_item.url, update_item.sort_order)
            )
        conn.commit()
        return {"message": f"Successfully batch updated {len(req.updates)} URL metadata entries."}
    except Exception as e:
        conn.rollback()
        logger.error(f"Error during batch update of url_metadata: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred during batch update: {e}")
    finally:
        conn.close()

@router.get("/api/urls/apply_status")
def get_apply_status(url: str):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()

    urls_to_check = set()
    clean_url = url.split('#')[0]
    urls_to_check.add(clean_url.rstrip('/'))
    urls_to_check.add(clean_url.rstrip('/') + '/')
    no_protocol_url = re.sub(r'^https?://', '', clean_url).rstrip('/')
    urls_to_check.add('http://' + no_protocol_url)
    urls_to_check.add('http://' + no_protocol_url + '/')
    urls_to_check.add('https://' + no_protocol_url)
    urls_to_check.add('https://' + no_protocol_url + '/')
    if no_protocol_url.startswith('www.'):
        no_www_url = no_protocol_url.replace('www.', '', 1)
        urls_to_check.add('http://' + no_www_url)
        urls_to_check.add('http://' + no_www_url + '/')
        urls_to_check.add('https://' + no_www_url)
        urls_to_check.add('https://' + no_www_url + '/')
    else:
        with_www_url = 'www.' + no_protocol_url
        urls_to_check.add('http://' + with_www_url)
        urls_to_check.add('http://' + with_www_url + '/')
        urls_to_check.add('https://' + with_www_url)
        urls_to_check.add('https://' + with_www_url + '/')
    if 'kakuyomu.jp/works/' in clean_url:
        match = re.match(r'(https?://kakuyomu.jp/works/\d+)', clean_url)
        if match:
            work_url = match.group(1)
            urls_to_check.add(work_url)
            urls_to_check.add(work_url + '/')

    url_list = list(urls_to_check)
    placeholders = ', '.join('?' * len(url_list))
    
    query = f"SELECT 1 FROM applied_urls WHERE url IN ({placeholders}) LIMIT 1"
    cursor.execute(query, url_list)
    
    is_applied = cursor.fetchone() is not None
    conn.close()
    return {"applied": is_applied}