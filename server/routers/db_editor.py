import os
import json
import re
import sqlite3
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Request, Body
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from server.settings import settings
from server.database import get_db, get_sqlite_conn, get_db_path
from server.models import Translation

logger = logging.getLogger(__name__)

router = APIRouter()
templates = Jinja2Templates(directory=settings.templates_dir)

RULES_FILE_PATH = os.path.join(settings.data_dir, "character_rules.json")

DEFAULT_RULES = {
    "누나가 마 니 선생이라고 느그 좋아하면 안되나?": [
        {
            "id": "rule-1",
            "source": "悠",
            "target": "유우",
            "enabled": True,
            "description": "남주인공 아카시 유우",
            "misreadings": [
                "하루토",
                "유토",
                "하루카",
                "유카루",
                "유카",
                "유키"
            ]
        },
        {
            "id": "rule-2",
            "source": "百合華",
            "target": "유리카",
            "enabled": True,
            "description": "여주인공 아카시 유리카",
            "misreadings": [
                "유리화",
                "유리하",
                "유리리카"
            ]
        },
        {
            "id": "rule-3",
            "source": "中将",
            "target": "츄죠",
            "enabled": True,
            "description": "같은 반 친구",
            "misreadings": [
                "츄조",
                "쥬조",
                "나카조",
                "나카죠",
                "주죠",
                "중장",
                "추",
                "추주",
                "추중",
                "나카미",
                "주장",
                "주",
                "주조"
            ]
        }
    ]
}


def load_character_rules() -> Dict[str, List[Dict[str, Any]]]:
    """Load character rules from character_rules.json, creating with default if missing."""
    os.makedirs(settings.data_dir, exist_ok=True)
    if not os.path.exists(RULES_FILE_PATH):
        try:
            with open(RULES_FILE_PATH, "w", encoding="utf-8") as f:
                json.dump(DEFAULT_RULES, f, ensure_ascii=False, indent=2)
            return DEFAULT_RULES
        except Exception as e:
            logger.error(f"Error creating default character rules: {e}")
            return DEFAULT_RULES

    try:
        with open(RULES_FILE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else DEFAULT_RULES
    except Exception as e:
        logger.error(f"Error loading character rules: {e}")
        return DEFAULT_RULES


def save_character_rules(data: Dict[str, List[Dict[str, Any]]]) -> bool:
    """Save character rules to character_rules.json."""
    os.makedirs(settings.data_dir, exist_ok=True)
    try:
        with open(RULES_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving character rules: {e}")
        return False


def create_name_fix_backup() -> str:
    """Creates a timestamped SQLite database backup before applying fixes."""
    os.makedirs(settings.backup_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"translations_backup_before_name_fix_{timestamp}.db"
    backup_path = os.path.join(settings.backup_dir, backup_filename)
    src_db_path = get_db_path()

    src_conn = sqlite3.connect(src_db_path, timeout=30)
    try:
        dst_conn = sqlite3.connect(backup_path, timeout=30)
        try:
            src_conn.backup(dst_conn)
            logger.info(f"[DB Backup] Successfully created backup at {backup_path}")
        finally:
            dst_conn.close()
    finally:
        src_conn.close()

    return backup_filename


def generate_smart_suggestion(
    orig: str,
    trans: str,
    active_rules: List[Dict[str, Any]]
) -> tuple[str, List[str], List[str]]:
    """
    Rule-based smart auto suggestion engine.
    Returns (suggested_text, reasons, tags).
    """
    after = trans or ""
    reasons = []
    tags = set()

    for rule in active_rules:
        if not rule.get("enabled", True):
            continue

        source = rule.get("source", "").strip()
        target = rule.get("target", "").strip()
        if not source or not target:
            continue

        misreadings = rule.get("misreadings", [])
        if not isinstance(misreadings, list):
            misreadings = []

        # If source is present in original and target is not in current translation
        if source in orig and target not in after:
            # 1. Custom misreadings (sorted by length descending for greedy match)
            sorted_misreadings = sorted(
                [m.strip() for m in misreadings if m.strip()],
                key=len,
                reverse=True
            )
            for wrong in sorted_misreadings:
                if wrong in after:
                    after = after.replace(wrong, target)
                    reasons.append(f"{wrong} ➔ {target}")
                    tags.add(wrong)

            # 2. Domain-specific heuristics for known Japanese novel patterns
            # Heuristics for '悠' -> '유우'
            if source == "悠" and target == "유우":
                # '유카' (유카는, 유카가 등)
                if "유카" in after:
                    pat_yuka = re.compile(
                        r'(?<![가-힣])유카(?=(?:는|가|를|의|에게|한테|와|과|도|만|뿐|보다|로|랑|였|군|\s+군|\s+씨|\s+녀석|\s+자식|\s+입장|\s+자신|다웠|라고|란|이지만|\s|[.,!?\'"』」\)]|$))'
                    )
                    if pat_yuka.search(after):
                        after = pat_yuka.sub('유우', after)
                        reasons.append("유카 ➔ 유우")
                        tags.add("유카")

                # '유리' (有利가 원문에 없고 유리카가 아닐 때)
                if "有利" not in orig:
                    pattern_yuri = re.compile(
                        r'(?<![가-힣])유리(?![카])(?=(?:가|는|를|의|에게|한테|와|과|도|만|뿐|보다|로|랑|였|군|\s+군|\s+씨|\s+녀석|\s+자식|\s+입장|\s+자신|마저|다웠|라고|란|이지만|\s|[.,!?\'"』」\)]|$))'
                    )
                    if pattern_yuri.search(after):
                        after = pattern_yuri.sub('유우', after)
                        reasons.append("유리 ➔ 유우")
                        tags.add("유리")

                # '하루' (Protect '하루 종일', '하루종일', '하루의 피로' when 一日 is present)
                protected_placeholders = {}
                if "一日" in orig or "1日" in orig:
                    for phrase in ["하루 종일", "하루종일", "하루의 피로"]:
                        if phrase in after:
                            ph_key = f"__PROTECTED_{len(protected_placeholders)}__"
                            protected_placeholders[ph_key] = phrase
                            after = after.replace(phrase, ph_key)

                if not any(k in orig for k in ["春", "晴"]) and (not any(k in orig for k in ["一日", "1日"]) or protected_placeholders):
                    pattern_haru = re.compile(
                        r'(?<![가-힣])하루(?=(?:가|는|를|의|에게|한테|와|과|도|만|뿐|보다|로|랑|였|군|\s+군|\s+씨|\s+녀석|\s+자신|다웠|라고|란|이지만|라는|\s|[.,!?\'"』」\)]|$))'
                    )
                    if pattern_haru.search(after):
                        after = pattern_haru.sub('유우', after)
                        reasons.append("하루 ➔ 유우")
                        tags.add("하루")

                for ph_key, orig_phrase in protected_placeholders.items():
                    after = after.replace(ph_key, orig_phrase)

                # '유' + 한국어 조사/접미사/호칭/구두점
                reg_yu = re.compile(
                    r'(?<![가-힣])유(?![유우])(?=(?:가|는|를|의|에게|한테|와|과|도|만|뿐|보다|로|랑|였|군|\s+군|\s+씨|\s+녀석|\s+자식|\s+입장|\s+덕분|\s+말야|\s+자신|다웠|라고|란|이지만|라면|네|입니다|뿐|조차|마저|님|\s*[!?,.~…』」"\'\)]|\s+|$))'
                )
                if reg_yu.search(after):
                    after = reg_yu.sub('유우', after)
                    reasons.append("유+조사 ➔ 유우")
                    tags.add("유+조사")

                # 인용부호 단독 이름: 『유』, 「유」, "유", '유'
                for q_open, q_close in [('『', '』'), ('「', '」'), ('"', '"'), ("'", "'")]:
                    q_target = f"{q_open}유{q_close}"
                    if q_target in after:
                        after = after.replace(q_target, f"{q_open}유우{q_close}")
                        reasons.append("유 ➔ 유우")
                        tags.add("유+조사")

            # Heuristics for '百合華' -> '유리카'
            elif source == "百合華" and target == "유리카":
                for wrong in ["유리리카", "유리화", "유리하"]:
                    if wrong in after:
                        after = after.replace(wrong, "유리카")
                        reasons.append(f"{wrong} ➔ 유리카")
                        tags.add("유리카")

    # If target is still missing after applying rules
    for rule in active_rules:
        if not rule.get("enabled", True):
            continue
        src = rule.get("source", "").strip()
        tgt = rule.get("target", "").strip()
        if src in orig and tgt not in after:
            reason_text = f"{src} ➔ {tgt} 누락"
            if reason_text not in reasons:
                reasons.append(reason_text)
            tags.add(f"{tgt} 누락")

    if not reasons:
        reasons.append("검토 대상")
        tags.add("기타")

    return after, list(dict.fromkeys(reasons)), list(tags)


# --- Pydantic Request Models ---

class RuleItem(BaseModel):
    id: Optional[str] = None
    source: str
    target: str
    enabled: bool = True
    description: Optional[str] = ""
    misreadings: Optional[List[str]] = []

class SaveRulesRequest(BaseModel):
    folderName: str
    rules: List[RuleItem]

class ScanRequest(BaseModel):
    folderName: str
    rules: Optional[List[RuleItem]] = None

class ApproveSingleRequest(BaseModel):
    id: int
    translated: str
    backup: bool = False

class BatchItem(BaseModel):
    id: int
    translated: str

class ApproveBatchRequest(BaseModel):
    items: List[BatchItem]
    backup: bool = True

class DiscoverMisreadingsRequest(BaseModel):
    folderName: str
    source: str
    target: Optional[str] = ""


# --- Endpoints ---

@router.get(
    "/db_editor",
    response_class=HTMLResponse,
    tags=["DB Editor"],
    summary="인명·용어 교정기 웹 UI 페이지"
)
async def db_editor_page(request: Request, db: Session = Depends(get_db), folderName: Optional[str] = None):
    """
    Renders the Character Fixer & Tinder-Style Review System interface.
    """
    query = text("""
        SELECT DISTINCT folderName, COUNT(*) as cnt
        FROM translations
        WHERE folderName IS NOT NULL AND folderName != ''
        GROUP BY folderName
        ORDER BY folderName ASC
    """)
    rows = db.execute(query).fetchall()
    folders = [{"folderName": r[0], "count": r[1]} for r in rows]

    # Select active novel folder
    default_target = "누나가 마 니 선생이라고 느그 좋아하면 안되나?"
    active_folder = folderName
    if not active_folder:
        folder_names = [f["folderName"] for f in folders]
        if default_target in folder_names:
            active_folder = default_target
        elif folders:
            active_folder = folders[0]["folderName"]
        else:
            active_folder = ""

    return templates.TemplateResponse(
        request=request,
        name="db_editor.html",
        context={
            "folders": folders,
            "current_folder": active_folder
        }
    )


@router.get(
    "/api/db_editor/novels",
    tags=["DB Editor"],
    summary="소설 목록 조회"
)
async def get_novels(db: Session = Depends(get_db)):
    """Returns list of all available novel folders and paragraph counts."""
    query = text("""
        SELECT DISTINCT folderName, COUNT(*) as cnt
        FROM translations
        WHERE folderName IS NOT NULL AND folderName != ''
        GROUP BY folderName
        ORDER BY folderName ASC
    """)
    rows = db.execute(query).fetchall()
    return [{"folderName": r[0], "count": r[1]} for r in rows]


@router.get(
    "/api/db_editor/folders",
    tags=["DB Editor"],
    summary="소설 목록 조회 (모바일/웹 공용 폴더 형식)"
)
async def get_folders(db: Session = Depends(get_db)):
    """Returns list of all available novel folders in dictionary format with 'folders' key."""
    query = text("""
        SELECT DISTINCT folderName, COUNT(*) as cnt
        FROM translations
        WHERE folderName IS NOT NULL AND folderName != ''
        GROUP BY folderName
        ORDER BY folderName ASC
    """)
    rows = db.execute(query).fetchall()
    folders = [{"folderName": r[0], "count": r[1]} for r in rows]
    return {
        "status": "success",
        "folders": folders,
        "count": len(folders)
    }


@router.get(
    "/api/db_editor/rules",
    tags=["DB Editor"],
    summary="소설별 인명/단어 규칙 조회"
)
async def get_rules(folderName: Optional[str] = None):
    """Returns character rules for a specific novel or all novels."""
    all_rules = load_character_rules()
    if folderName:
        rules = all_rules.get(folderName, [])
        return {"folderName": folderName, "rules": rules}
    return {"rules": all_rules}


@router.post(
    "/api/db_editor/rules",
    tags=["DB Editor"],
    summary="소설별 인명/단어 규칙 저장"
)
async def save_rules(req: SaveRulesRequest):
    """Saves character rules for the specified novel folder."""
    all_rules = load_character_rules()
    rules_list = [r.model_dump() for r in req.rules]
    all_rules[req.folderName] = rules_list
    if save_character_rules(all_rules):
        return {"status": "success", "folderName": req.folderName, "rules": rules_list}
    raise HTTPException(status_code=500, detail="규칙 파일 저장에 실패했습니다.")


@router.post(
    "/api/db_editor/scan",
    tags=["DB Editor"],
    summary="불변 조건 기반 정밀 스캔 및 자동 교정 제안"
)
async def scan_sentences(req: ScanRequest, db: Session = Depends(get_db)):
    """
    Scans sentences in the novel folder where original contains source
    but translated lacks target, and generates rule-based suggestions.
    """
    if req.rules is not None:
        active_rules = [r.model_dump() for r in req.rules if r.enabled]
    else:
        all_rules = load_character_rules()
        active_rules = [r for r in all_rules.get(req.folderName, []) if r.get("enabled", True)]

    if not active_rules:
        return {
            "folderName": req.folderName,
            "total_matched": 0,
            "items": [],
            "tag_counts": {}
        }

    # Build invariant filter conditions
    conditions = []
    params: Dict[str, Any] = {"folder": req.folderName}

    for idx, rule in enumerate(active_rules):
        src_param = f"src_{idx}"
        tgt_param = f"tgt_{idx}"
        params[src_param] = f"%{rule['source']}%"
        params[tgt_param] = f"%{rule['target']}%"
        conditions.append(f"(original LIKE :{src_param} AND (translated IS NULL OR translated NOT LIKE :{tgt_param}))")

    where_clause = " OR ".join(conditions)
    sql = f"""
        SELECT id, title, url, pid, original, translated
        FROM translations
        WHERE folderName = :folder AND ({where_clause})
        ORDER BY id ASC
    """

    rows = db.execute(text(sql), params).fetchall()

    items = []
    tag_counts: Dict[str, int] = {}

    for row in rows:
        _id, title, url, pid, orig, trans = row
        suggested, reasons, tags = generate_smart_suggestion(orig or "", trans or "", active_rules)

        for tag in tags:
            tag_counts[tag] = tag_counts.get(tag, 0) + 1

        items.append({
            "id": _id,
            "title": title or "제목 없음",
            "url": url or "",
            "pid": pid or "",
            "original": orig or "",
            "translated": trans or "",
            "suggested": suggested,
            "reasons": reasons,
            "tags": tags
        })

    return {
        "folderName": req.folderName,
        "total_matched": len(items),
        "items": items,
        "tag_counts": tag_counts
    }


@router.post(
    "/api/db_editor/approve_single",
    tags=["DB Editor"],
    summary="단일 문장 승인 및 즉시 DB 반영 (틴더 모드)"
)
async def approve_single(req: ApproveSingleRequest, db: Session = Depends(get_db)):
    """
    Approves and updates a single translation record.
    Optionally creates a backup before the first approval.
    """
    backup_file = None
    if req.backup:
        try:
            backup_file = create_name_fix_backup()
        except Exception as e:
            logger.error(f"Backup creation failed: {e}")
            raise HTTPException(status_code=500, detail=f"백업 생성 실패: {str(e)}")

    record = db.query(Translation).filter(Translation.id == req.id).first()
    if not record:
        raise HTTPException(status_code=404, detail="해당 문장을 찾을 수 없습니다.")

    try:
        now_ts = int(datetime.now().timestamp())
        record.translated = req.translated
        record.timestamp = now_ts
        db.commit()
        return {
            "status": "success",
            "id": req.id,
            "backup_created": bool(backup_file),
            "backup_file": backup_file
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to update translation ID {req.id}: {e}")
        raise HTTPException(status_code=500, detail=f"DB 저장 실패: {str(e)}")


@router.post(
    "/api/db_editor/approve_batch",
    tags=["DB Editor"],
    summary="다중 문장 일괄 승인 및 트랜잭션 DB 반영 (일괄 모드)"
)
async def approve_batch(req: ApproveBatchRequest, db: Session = Depends(get_db)):
    """
    Batch approves multiple items with automatic backup and atomic transaction.
    """
    if not req.items:
        return {"status": "success", "count": 0, "backup_file": None}

    backup_file = None
    if req.backup:
        try:
            backup_file = create_name_fix_backup()
        except Exception as e:
            logger.error(f"Auto backup creation failed: {e}")
            raise HTTPException(status_code=500, detail=f"안전 백업 생성 실패: {str(e)}")

    updated_count = 0
    try:
        now_ts = int(datetime.now().timestamp())
        # Batch update inside an atomic transaction
        for item in req.items:
            db.execute(
                text("UPDATE translations SET translated = :trans, timestamp = :ts WHERE id = :id"),
                {"trans": item.translated, "ts": now_ts, "id": item.id}
            )
            updated_count += 1
        db.commit()

        logger.info(f"[Batch Approve] Successfully updated {updated_count} translations.")
        return {
            "status": "success",
            "count": updated_count,
            "backup_file": backup_file
        }
    except Exception as e:
        db.rollback()
        logger.error(f"Batch approve failed, rolled back: {e}")
        raise HTTPException(status_code=500, detail=f"일괄 업데이트 중 오류가 발생하여 롤백되었습니다: {str(e)}")


@router.post(
    "/api/db_editor/backup",
    tags=["DB Editor"],
    summary="수동 온디맨드 백업 생성"
)
async def manual_backup():
    """Triggers an on-demand SQLite database backup."""
    try:
        backup_file = create_name_fix_backup()
        return {"status": "success", "backup_file": backup_file}
    except Exception as e:
        logger.error(f"Manual backup failed: {e}")
        raise HTTPException(status_code=500, detail=f"백업 생성 실패: {str(e)}")


PARTICLES_FOR_DISCOVERY = [
    '에게서', '에게', '한테', '으로', '에서', '부터', '까지', '처럼', '보다', '마저',
    '조차', '라면', '지만', '이며', '하고', '이나', '이라', '이란', '이다', '였다',
    '였고', '로서', '로써', '은', '는', '이', '가', '을', '를', '의',
    '와', '과', '도', '로', '에', '랑', '였', '네', '군', '씨', '님'
]
PARTICLES_SORTED_DISC = sorted(PARTICLES_FOR_DISCOVERY, key=len, reverse=True)
_particle_disc_alt = '|'.join(PARTICLES_SORTED_DISC)

_disc_stem_regex = re.compile(r'(?<![가-힣])([가-힣]{1,5})(?:' + _particle_disc_alt + r')(?![가-힣])')
_disc_quote_regex = re.compile(r'[『「"\'\(]([가-힣]{1,5})[』」"\'\)]')

DISCOVERY_STOPWORDS = {
    '그', '이', '저', '것', '수', '등', '더', '또', '때', '안', '못', '잘', '왜', 
    '참', '좀', '막', '다', '더욱', '그냥', '지금', '다시', '정말', '진짜', '아주',
    '너무', '매우', '가장', '제일', '이미', '벌써', '자꾸', '계속', '항상', '언제',
    '어디', '누구', '무엇', '어떻게', '아마', '혹시', '설마', '과연', '비록', '만약',
    '자신', '그녀', '생각', '사람', '우리', '모습', '순간', '얼굴', '마음', '소리', '이야기'
}

def clean_discovered_word(w: str) -> str:
    w = w.strip()
    changed = True
    while changed:
        changed = False
        for p in PARTICLES_SORTED_DISC:
            if w.endswith(p) and len(w) > len(p):
                w = w[:-len(p)]
                changed = True
                break
    return w


@router.post(
    "/api/db_editor/discover_misreadings",
    tags=["DB Editor"],
    summary="원문 한자 기반 오역 단어 로컬 통계 자동 발굴"
)
async def discover_misreadings(req: DiscoverMisreadingsRequest, db: Session = Depends(get_db)):
    """
    Analyzes co-occurrence frequency of Korean words in sentences with the source character
    versus baseline sentences without the source character to automatically discover misreadings.
    """
    source = req.source.strip()
    target = req.target.strip()
    if not source:
        raise HTTPException(status_code=400, detail="원문 한자/단어를 입력하세요.")

    params = {"folder": req.folderName, "src": f"%{source}%"}
    if target:
        err_sql = """
            SELECT translated FROM translations
            WHERE folderName = :folder AND original LIKE :src AND (translated IS NULL OR translated NOT LIKE :tgt)
        """
        params["tgt"] = f"%{target}%"
    else:
        err_sql = """
            SELECT translated FROM translations
            WHERE folderName = :folder AND original LIKE :src
        """
    err_rows = db.execute(text(err_sql), params).fetchall()
    err_trans = [r[0] for r in err_rows if r[0]]
    if not err_trans:
        return {"status": "success", "candidates": []}

    norm_sql = """
        SELECT translated FROM translations
        WHERE folderName = :folder AND original NOT LIKE :src
    """
    norm_rows = db.execute(text(norm_sql), {"folder": req.folderName, "src": f"%{source}%"}).fetchall()
    norm_trans = [r[0] for r in norm_rows if r[0]]

    err_counts = Counter()
    for t in err_trans:
        for w in _disc_stem_regex.findall(t):
            cw = clean_discovered_word(w)
            if cw and cw != target and cw not in DISCOVERY_STOPWORDS:
                err_counts[cw] += 1
        for w in _disc_quote_regex.findall(t):
            cw = clean_discovered_word(w)
            if cw and cw != target and cw not in DISCOVERY_STOPWORDS:
                err_counts[cw] += 1

    norm_counts = Counter()
    for t in norm_trans:
        for w in _disc_stem_regex.findall(t):
            cw = clean_discovered_word(w)
            if cw in err_counts:
                norm_counts[cw] += 1
        for w in _disc_quote_regex.findall(t):
            cw = clean_discovered_word(w)
            if cw in err_counts:
                norm_counts[cw] += 1

    candidates = []
    for word, err_c in err_counts.items():
        if len(word) < 1:
            continue
        norm_c = norm_counts[word]
        ratio = err_c / (err_c + norm_c)
        if (err_c >= 2 and ratio >= 0.70) or (err_c >= 1 and ratio >= 0.90 and len(word) >= 2):
            candidates.append({
                "word": word,
                "count": err_c,
                "norm_count": norm_c,
                "ratio": round(ratio, 3)
            })

    candidates.sort(key=lambda x: (x["count"], x["ratio"]), reverse=True)
    return {
        "status": "success",
        "folderName": req.folderName,
        "source": source,
        "target": target,
        "candidates": candidates
    }