import re
import time
import zlib
import logging
import requests
from typing import Optional, Dict, Any
from selectolax.lexbor import LexborHTMLParser
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.database import get_sqlite_conn
from server.security import is_safe_external_url

router = APIRouter(prefix="/api/unclassified_novels", tags=["UnclassifiedNovels"])
logger = logging.getLogger(__name__)

# Table initialization helper
def ensure_novel_works_table():
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS novel_works (
            work_id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            novel_title TEXT NOT NULL,
            work_url TEXT NOT NULL,
            matched_folder TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    """)
    conn.commit()
    conn.close()

# Ensure table on module import
ensure_novel_works_table()

def parse_work_metadata(url: str) -> Dict[str, str]:
    """Extracts work_id, platform, and base work_url from an episode URL."""
    clean = url.strip()

    # 1. Kakuyomu: https://kakuyomu.jp/works/16816452218390962442/episodes/...
    m_kakuyomu = re.search(r'kakuyomu\.jp/works/(\d+)', clean)
    if m_kakuyomu:
        work_num = m_kakuyomu.group(1)
        return {
            "work_id": f"kakuyomu:{work_num}",
            "platform": "Kakuyomu",
            "work_url": f"https://kakuyomu.jp/works/{work_num}",
            "url_pattern": f"%kakuyomu.jp/works/{work_num}%"
        }

    # 2. Syosetu: https://ncode.syosetu.com/nXXXXxx/ or https://novel18.syosetu.com/nXXXXxx/
    m_syosetu = re.search(r'(https?://[^/]+\.syosetu\.com)/([nN]\w+)', clean)
    if m_syosetu:
        host = m_syosetu.group(1)
        ncode = m_syosetu.group(2).lower()
        return {
            "work_id": f"syosetu:{ncode}",
            "platform": "Syosetu",
            "work_url": f"{host}/{ncode}/",
            "url_pattern": f"%syosetu.com/{ncode}%"
        }

    # 3. NovelUp: https://novelup.plus/story/123456789/...
    m_novelup = re.search(r'novelup\.plus/story/(\d+)', clean)
    if m_novelup:
        story_id = m_novelup.group(1)
        return {
            "work_id": f"novelup:{story_id}",
            "platform": "NovelUp",
            "work_url": f"https://novelup.plus/story/{story_id}",
            "url_pattern": f"%novelup.plus/story/{story_id}%"
        }

    # 4. Hameln: https://syosetu.org/novel/123456/
    m_hameln = re.search(r'syosetu\.org/novel/(\d+)', clean)
    if m_hameln:
        nid = m_hameln.group(1)
        return {
            "work_id": f"hameln:{nid}",
            "platform": "Hameln",
            "work_url": f"https://syosetu.org/novel/{nid}/",
            "url_pattern": f"%syosetu.org/novel/{nid}%"
        }

    # Fallback
    base_part = clean.split('?')[0].rstrip('/')
    tokens = base_part.split('/')
    prefix = '/'.join(tokens[:5]) if len(tokens) >= 5 else base_part
    work_id = f"custom:{zlib.crc32(prefix.encode('utf-8')) & 0xffffffff}"
    return {
        "work_id": work_id,
        "platform": "기타 웹",
        "work_url": prefix,
        "url_pattern": f"{prefix}%"
    }

def fetch_novel_title_from_web(platform: str, work_url: str) -> Optional[str]:
    """Scrapes the main novel title from the novel top page."""
    if not is_safe_external_url(work_url):
        logger.warning(f"Blocked unsafe/internal URL from being fetched for novel title: {work_url}")
        return None

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    cookies = {}
    if "novel18.syosetu.com" in work_url:
        cookies['over18'] = 'yes'

    try:
        resp = requests.get(work_url, headers=headers, cookies=cookies, timeout=8, allow_redirects=True)
        if resp.history and not is_safe_external_url(resp.url):
            logger.warning(f"Blocked unsafe redirect target for novel title fetch: {resp.url}")
            return None

        if resp.status_code != 200:
            return None
        resp.encoding = resp.apparent_encoding
        parser = LexborHTMLParser(resp.text)

        title_candidate = None
        if platform == "Kakuyomu":
            title_el = (
                parser.css_first('#workTitle') or
                parser.css_first('.widget-toc-main-title') or
                parser.css_first('#app-main header h1') or
                parser.css_first('header h1')
            )
            if title_el and title_el.text().strip():
                clean_title = title_el.text().strip().replace(' - カクヨム', '').strip()
                title_candidate = re.sub(r'（[^）]+）$', '', clean_title).strip() or clean_title
            else:
                title_tag = parser.css_first('title')
                if title_tag and title_tag.text().strip():
                    t = title_tag.text().strip().replace(' - カクヨム', '').strip()
                    t_sub = t.split(' - ')[-1].strip() if ' - ' in t else t
                    title_candidate = re.sub(r'（[^）]+）$', '', t_sub).strip() or t_sub

        elif platform == "Syosetu":
            title_el = (
                parser.css_first('.novel_title') or
                parser.css_first('p.novel_title') or
                parser.css_first('.c-announce a') or
                parser.css_first('a.margin_r20')
            )
            if title_el and title_el.text().strip():
                t = title_el.text().strip()
                title_candidate = re.sub(r'（[^）]+）$', '', t).strip() or t
            else:
                title_tag = parser.css_first('title')
                if title_tag and title_tag.text().strip():
                    t = title_tag.text().strip().split(' - ')[0].strip()
                    title_candidate = re.sub(r'（[^）]+）$', '', t).strip() or t

        elif platform == "NovelUp":
            title_el = parser.css_first('.storyTitle') or parser.css_first('.story_title')
            if title_el and title_el.text().strip():
                t = title_el.text().strip()
                title_candidate = re.sub(r'（[^）]+）$', '', t).strip() or t
            else:
                title_tag = parser.css_first('title')
                if title_tag and title_tag.text().strip():
                    t = title_tag.text().strip().split('|')[0].strip()
                    title_candidate = re.sub(r'（[^）]+）$', '', t).strip() or t

        # Generic title
        if not title_candidate:
            title_tag = parser.css_first('title')
            if title_tag and title_tag.text().strip():
                raw_t = re.split(r'[-|]', title_tag.text().strip())[0].strip()
                title_candidate = re.sub(r'（[^）]+）$', '', raw_t).strip() or raw_t

        return title_candidate

    except Exception as e:
        logger.warning(f"Failed to scrape novel title for {work_url}: {e}")
        return None

def get_or_create_novel_title(work_id: str, platform: str, work_url: str, fallback_title: str) -> str:
    """Retrieves title from cache or scrapes from web, then saves to cache."""
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    cursor.execute("SELECT novel_title FROM novel_works WHERE work_id = ?", (work_id,))
    row = cursor.fetchone()
    if row and row["novel_title"]:
        conn.close()
        return row["novel_title"]

    # Scrape from web
    scraped_title = fetch_novel_title_from_web(platform, work_url)
    final_title = scraped_title or fallback_title or "제목 미상 소설"

    now_ts = int(time.time())
    cursor.execute("""
        INSERT INTO novel_works (work_id, platform, novel_title, work_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_id) DO UPDATE SET
            novel_title = excluded.novel_title,
            updated_at = excluded.updated_at
    """, (work_id, platform, final_title, work_url, now_ts, now_ts))
    conn.commit()
    conn.close()
    return final_title

@router.get("")
def get_unclassified_novels():
    """
    Returns unclassified translations grouped by novel work,
    along with platform, title, episode stats, and smart folder match.
    """
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    # 1. Fetch unclassified rows (distinct URLs and paragraph counts)
    cursor.execute("""
        SELECT url, title, COUNT(*) as paragraph_count, MIN(id) as min_id
        FROM translations
        WHERE folderName IS NULL OR TRIM(folderName) = ''
        GROUP BY url
        ORDER BY MIN(id) ASC
    """)
    url_rows = cursor.fetchall()

    if not url_rows:
        conn.close()
        return {
            "total_unclassified_paragraphs": 0,
            "total_unclassified_novels": 0,
            "novels": []
        }

    # 2. Group by work
    works_map: Dict[str, Dict[str, Any]] = {}
    total_paras = 0

    for r in url_rows:
        url = r["url"]
        ep_title = r["title"] or url
        para_cnt = r["paragraph_count"]
        min_id = r["min_id"]
        total_paras += para_cnt

        meta = parse_work_metadata(url)
        wid = meta["work_id"]

        if wid not in works_map:
            works_map[wid] = {
                "work_id": wid,
                "platform": meta["platform"],
                "work_url": meta["work_url"],
                "url_pattern": meta["url_pattern"],
                "fallback_title": ep_title,
                "episodes": [],
                "total_paragraphs": 0
            }

        works_map[wid]["episodes"].append({
            "url": url,
            "title": ep_title,
            "paragraph_count": para_cnt,
            "min_id": min_id
        })
        works_map[wid]["total_paragraphs"] += para_cnt

    # 3. For each novel work, resolve title and smart-matched existing folder
    novels = []
    for wid, data in works_map.items():
        title = get_or_create_novel_title(
            wid,
            data["platform"],
            data["work_url"],
            data["fallback_title"]
        )

        # Smart match existing folder in translations
        cursor.execute("""
            SELECT folderName, COUNT(*) as cnt
            FROM translations
            WHERE folderName IS NOT NULL AND TRIM(folderName) != '' AND folderName != '폴더 추가 대기 상태'
              AND url LIKE ?
            GROUP BY folderName
            ORDER BY cnt DESC LIMIT 1
        """, (data["url_pattern"],))
        matched_row = cursor.fetchone()
        matched_folder = matched_row["folderName"] if matched_row else None

        # Sort episodes strictly by min_id ASC (reading/translation order)
        data["episodes"].sort(key=lambda x: x.get("min_id", 0))

        novels.append({
            "work_id": wid,
            "platform": data["platform"],
            "work_url": data["work_url"],
            "novel_title": title,
            "matched_existing_folder": matched_folder,
            "total_episodes": len(data["episodes"]),
            "total_paragraphs": data["total_paragraphs"],
            "episodes": data["episodes"]
        })

    conn.close()

    # Sort novels by total_paragraphs descending
    novels.sort(key=lambda x: x["total_paragraphs"], reverse=True)

    return {
        "total_unclassified_paragraphs": total_paras,
        "total_unclassified_novels": len(novels),
        "novels": novels
    }

class AssignFolderRequest(BaseModel):
    work_id: str
    target_folder: str
    work_url: Optional[str] = None

@router.post("/assign_folder")
def assign_unclassified_novel_folder(req: AssignFolderRequest):
    """
    Assigns all unclassified episodes belonging to the specified novel work
    into a given folder.
    """
    target_folder = req.target_folder.strip()
    if not target_folder:
        raise HTTPException(status_code=400, detail="유효한 대상 폴더명을 입력해주세요.")

    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    try:
        # Determine URL pattern
        meta = parse_work_metadata(req.work_url or "") if req.work_url else None
        url_pattern = meta["url_pattern"] if meta else None

        if not url_pattern:
            # Fallback: lookup cached work_url in novel_works
            cursor.execute("SELECT work_url FROM novel_works WHERE work_id = ?", (req.work_id,))
            cw = cursor.fetchone()
            if cw and cw["work_url"]:
                meta = parse_work_metadata(cw["work_url"])
                url_pattern = meta["url_pattern"]

        if not url_pattern:
            raise HTTPException(status_code=400, detail="소설 식별 패턴을 찾을 수 없습니다.")

        # Update translations
        cursor.execute("""
            UPDATE translations
            SET folderName = ?
            WHERE (folderName IS NULL OR TRIM(folderName) = '')
              AND url LIKE ?
        """, (target_folder, url_pattern))
        updated_count = cursor.rowcount

        # Automatically assign sequential toc_sort_order to unindexed episodes in target_folder
        cursor.execute("""
            SELECT MAX(toc_sort_order) as max_sort
            FROM translations
            WHERE folderName = ? AND toc_sort_order IS NOT NULL
        """, (target_folder,))
        max_row = cursor.fetchone()
        current_max = max_row["max_sort"] if (max_row and max_row["max_sort"] is not None) else None

        cursor.execute("""
            SELECT url, MIN(id) as first_id
            FROM translations
            WHERE folderName = ? AND toc_sort_order IS NULL
            GROUP BY url
            ORDER BY MIN(id) ASC
        """, (target_folder,))
        unindexed_urls = cursor.fetchall()

        base_order = (current_max + 1) if current_max is not None else 0
        for idx, u_row in enumerate(unindexed_urls, start=base_order):
            cursor.execute("""
                UPDATE translations
                SET toc_sort_order = ?
                WHERE folderName = ? AND url = ?
            """, (idx, target_folder, u_row["url"]))

        # Ensure target folder is in book_activity
        now_ts = int(time.time())
        cursor.execute("""
            INSERT INTO book_activity (folderName, last_read_timestamp, is_visible)
            VALUES (?, ?, 1)
            ON CONFLICT(folderName) DO UPDATE SET
                is_visible = 1
        """, (target_folder, now_ts))

        # Update novel_works cache
        cursor.execute("""
            UPDATE novel_works
            SET matched_folder = ?, updated_at = ?
            WHERE work_id = ?
        """, (target_folder, now_ts, req.work_id))

        conn.commit()
        return {
            "success": True,
            "message": f"'{target_folder}' 폴더로 {updated_count}개 단락이 성공적으로 등록되었습니다.",
            "updated_count": updated_count,
            "folderName": target_folder
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        logger.error(f"Error assigning unclassified folder: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

class DeleteNovelRequest(BaseModel):
    work_id: str
    work_url: Optional[str] = None

@router.post("/delete")
def delete_unclassified_novel(req: DeleteNovelRequest):
    """
    Deletes all unclassified translations belonging to the specified novel work.
    """
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    try:
        meta = parse_work_metadata(req.work_url or "") if req.work_url else None
        url_pattern = meta["url_pattern"] if meta else None

        if not url_pattern:
            cursor.execute("SELECT work_url FROM novel_works WHERE work_id = ?", (req.work_id,))
            cw = cursor.fetchone()
            if cw and cw["work_url"]:
                meta = parse_work_metadata(cw["work_url"])
                url_pattern = meta["url_pattern"]

        if not url_pattern:
            raise HTTPException(status_code=400, detail="소설 식별 패턴을 찾을 수 없습니다.")

        cursor.execute("""
            DELETE FROM translations
            WHERE (folderName IS NULL OR TRIM(folderName) = '')
              AND url LIKE ?
        """, (url_pattern,))
        deleted_count = cursor.rowcount

        conn.commit()
        from server.backup_utils import record_legitimate_deletion
        record_legitimate_deletion(deleted_count, reason=f"unclassified_delete_{req.work_id}")
        return {
            "success": True,
            "message": f"{deleted_count}개 미분류 번역 단락이 삭제되었습니다.",
            "deleted_count": deleted_count
        }
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        logger.error(f"Error deleting unclassified novel: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

class RenameNovelRequest(BaseModel):
    work_id: str
    new_title: str

@router.post("/rename")
def rename_unclassified_novel(req: RenameNovelRequest):
    """Updates the cached title of an unclassified novel work."""
    new_title = req.new_title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="새 소설 제목을 입력해주세요.")

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    now_ts = int(time.time())
    cursor.execute("""
        UPDATE novel_works
        SET novel_title = ?, updated_at = ?
        WHERE work_id = ?
    """, (new_title, now_ts, req.work_id))
    conn.commit()
    conn.close()

    return {"success": True, "novel_title": new_title}

@router.get("/paragraphs")
def get_unclassified_episode_paragraphs(url: str):
    """
    Returns paragraphs of a specific unclassified episode URL,
    matching the format required by admin.js renderItem.
    """
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order
        FROM translations
        WHERE (folderName IS NULL OR TRIM(folderName) = '')
          AND (url = ? OR url = ? OR RTRIM(url, '/') = RTRIM(?, '/'))
        ORDER BY id ASC
    """, (url, url.split('#')[0], url))
    rows = cursor.fetchall()

    # Query queued for cleanup
    cursor.execute("SELECT translation_id FROM cleanup_queued_items")
    queued_ids = {r["translation_id"] for r in cursor.fetchall()}

    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "url": r["url"],
            "pid": r["pid"],
            "original": r["original"],
            "translated": r["translated"],
            "timestamp": r["timestamp"],
            "folderName": r["folderName"] or "",
            "title": r["title"] or "",
            "toc_sort_order": r["toc_sort_order"],
            "is_queued_for_cleanup": r["id"] in queued_ids
        })

    conn.close()
    return {"url": url, "count": len(items), "items": items}
