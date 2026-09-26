import json
import time
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from server.database import get_sqlite_conn
from server.utils import normalize_url

router = APIRouter()
logger = logging.getLogger(__name__)

# 기본 공통 구분선: 명백한 후기 및 공지 키워드
DEFAULT_GLOBAL_SEPARATORS = [
    "＜あとがき＞",
    "&lt;あとがき&gt;",
    "【あとがき】",
    "＜解説＞",
    "【大事なお知らせ】",
    "【宣伝】",
    "お読み頂きありがとうございます！"
]

# 자주 쓰이는 프리셋 구분선 (소설에 따라 후기이거나 맥락구분선일 수 있는 기호들)
PRESET_SEPARATORS = [
    "◎◎◎",
    "----------",
    "++",
    "　☆☆☆☆☆",
    "――――",
    "***"
]

class SeparatorSettingRequest(BaseModel):
    novel_title: str
    separators: List[str]
    use_defaults: Optional[bool] = True

def ensure_table_exists(cursor):
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS novel_separator_settings (
            novel_title TEXT PRIMARY KEY,
            separators TEXT NOT NULL DEFAULT '[]',
            use_defaults INTEGER DEFAULT 1,
            updated_at INTEGER
        )
    """)

@router.get(
    "/api/separators",
    tags=["Separators"],
    summary="구분선 설정 조회",
    description="전체 소설의 구분선 설정 목록 또는 특정 소설의 구분선 설정을 조회합니다."
)
def get_separators(novel_title: Optional[str] = Query(None, description="소설 제목")):
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    try:
        ensure_table_exists(cursor)
        
        if novel_title:
            novel_title_clean = novel_title.strip()
            cursor.execute(
                "SELECT novel_title, separators, use_defaults, updated_at FROM novel_separator_settings WHERE novel_title = ?",
                (novel_title_clean,)
            )
            row = cursor.fetchone()
            
            if row:
                try:
                    custom_seps = json.loads(row["separators"])
                except Exception:
                    custom_seps = []
                use_defs = bool(row["use_defaults"])
                
                effective = []
                if use_defs:
                    effective.extend(DEFAULT_GLOBAL_SEPARATORS)
                for s in custom_seps:
                    if s not in effective:
                        effective.append(s)
                        
                return {
                    "novel_title": row["novel_title"],
                    "is_custom": True,
                    "use_defaults": use_defs,
                    "custom_separators": custom_seps,
                    "effective_separators": effective,
                    "global_defaults": DEFAULT_GLOBAL_SEPARATORS,
                    "presets": PRESET_SEPARATORS,
                    "updated_at": row["updated_at"]
                }
            else:
                return {
                    "novel_title": novel_title_clean,
                    "is_custom": False,
                    "use_defaults": True,
                    "custom_separators": [],
                    "effective_separators": DEFAULT_GLOBAL_SEPARATORS,
                    "global_defaults": DEFAULT_GLOBAL_SEPARATORS,
                    "presets": PRESET_SEPARATORS,
                    "updated_at": None
                }
        else:
            cursor.execute("SELECT novel_title, separators, use_defaults, updated_at FROM novel_separator_settings ORDER BY novel_title ASC")
            rows = cursor.fetchall()
            novels: Dict[str, Any] = {}
            for r in rows:
                try:
                    seps = json.loads(r["separators"])
                except Exception:
                    seps = []
                use_defs = bool(r["use_defaults"])
                effective = []
                if use_defs:
                    effective.extend(DEFAULT_GLOBAL_SEPARATORS)
                for s in seps:
                    if s not in effective:
                        effective.append(s)
                novels[r["novel_title"]] = {
                    "novel_title": r["novel_title"],
                    "custom_separators": seps,
                    "use_defaults": use_defs,
                    "effective_separators": effective,
                    "updated_at": r["updated_at"]
                }
            return {
                "global_defaults": DEFAULT_GLOBAL_SEPARATORS,
                "presets": PRESET_SEPARATORS,
                "novels": novels
            }
    finally:
        conn.close()

@router.post(
    "/api/separators",
    tags=["Separators"],
    summary="소설별 구분선 설정 저장",
    description="특정 소설의 번역 중단 구분선 설정을 저장하거나 업데이트합니다."
)
def save_separator_setting(req: SeparatorSettingRequest):
    novel_title = req.novel_title.strip()
    if not novel_title:
        raise HTTPException(status_code=400, detail="novel_title은 비어 있을 수 없습니다.")

    cleaned_seps = []
    seen = set()
    for s in req.separators:
        s_clean = s.strip()
        if s_clean and s_clean not in seen:
            seen.add(s_clean)
            cleaned_seps.append(s_clean)

    use_defaults_int = 1 if req.use_defaults else 0
    now_ts = int(time.time())

    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    try:
        ensure_table_exists(cursor)
        cursor.execute(
            """
            INSERT INTO novel_separator_settings (novel_title, separators, use_defaults, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(novel_title) DO UPDATE SET
                separators=excluded.separators,
                use_defaults=excluded.use_defaults,
                updated_at=excluded.updated_at
            """,
            (novel_title, json.dumps(cleaned_seps, ensure_ascii=False), use_defaults_int, now_ts)
        )
        conn.commit()

        effective = []
        if req.use_defaults:
            effective.extend(DEFAULT_GLOBAL_SEPARATORS)
        for s in cleaned_seps:
            if s not in effective:
                effective.append(s)

        return {
            "message": f"'{novel_title}' 구분선 설정이 저장되었습니다.",
            "novel_title": novel_title,
            "custom_separators": cleaned_seps,
            "use_defaults": bool(req.use_defaults),
            "effective_separators": effective,
            "updated_at": now_ts
        }
    except Exception as e:
        conn.rollback()
        logger.error(f"Error saving separator setting for {novel_title}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.delete(
    "/api/separators",
    tags=["Separators"],
    summary="소설별 구분선 설정 삭제",
    description="특정 소설의 커스텀 구분선 설정을 삭제하여 기본값으로 되돌립니다."
)
def delete_separator_setting(novel_title: str = Query(..., description="소설 제목")):
    novel_title = novel_title.strip()
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    try:
        ensure_table_exists(cursor)
        cursor.execute("DELETE FROM novel_separator_settings WHERE novel_title = ?", (novel_title,))
        conn.commit()
        return {
            "message": f"'{novel_title}' 설정이 삭제되어 기본 설정으로 복원되었습니다.",
            "novel_title": novel_title,
            "effective_separators": DEFAULT_GLOBAL_SEPARATORS
        }
    except Exception as e:
        conn.rollback()
        logger.error(f"Error deleting separator setting for {novel_title}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()

@router.get(
    "/api/novel_info",
    tags=["Separators"],
    summary="URL에 해당하는 소설 정보/폴더명 조회",
    description="URL을 기반으로 기존 번역 DB에서 매칭되는 folderName(소설명)을 조회합니다."
)
def get_novel_info(url: str = Query(..., description="페이지 URL")):
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    try:
        normalized = normalize_url(url)
        clean_url = url.split('#')[0].rstrip('/')
        
        # 1. 정확한 URL 일치 검사
        cursor.execute(
            "SELECT folderName, title FROM translations WHERE folderName IS NOT NULL AND (url = ? OR url = ? OR url = ?) LIMIT 1",
            (url, normalized, clean_url)
        )
        row = cursor.fetchone()
        if row and row["folderName"]:
            return {
                "url": url,
                "folderName": row["folderName"],
                "matched_by": "exact_url"
            }

        # 2. 동일 작품의 다른 에피소드 URL 프리픽스로 조회
        import re
        kakuyomu_match = re.search(r'(https?://kakuyomu\.jp/works/\d+)', url)
        syosetu_match = re.search(r'(https?://[^/]+\.syosetu\.com/n\w+)', url)
        novelup_match = re.search(r'(https?://novelup\.plus/story/\d+)', url)
        
        base_prefix = None
        if kakuyomu_match:
            base_prefix = kakuyomu_match.group(1) + '%'
        elif syosetu_match:
            base_prefix = syosetu_match.group(1) + '%'
        elif novelup_match:
            base_prefix = novelup_match.group(1) + '%'

        if base_prefix:
            cursor.execute(
                "SELECT folderName, COUNT(*) as cnt FROM translations WHERE folderName IS NOT NULL AND url LIKE ? GROUP BY folderName ORDER BY cnt DESC LIMIT 1",
                (base_prefix,)
            )
            prefix_row = cursor.fetchone()
            if prefix_row and prefix_row["folderName"]:
                return {
                    "url": url,
                    "folderName": prefix_row["folderName"],
                    "matched_by": "series_prefix"
                }

        return {
            "url": url,
            "folderName": None,
            "matched_by": "none"
        }
    finally:
        conn.close()
