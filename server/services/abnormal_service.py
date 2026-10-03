"""
Abnormal translation detection and whitelist management service.
Identifies partial untranslated (Rule 4) and other-language (Rule 3) translations,
and provides whitelist functionality to ignore intentional foreign terms.
"""

from collections import defaultdict
import time
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from server.models import Translation, AbnormalWhitelist, CleanupQueuedItem, AppliedUrl
from server.rule_classifier import classify_translation, extract_untranslated_keywords
from server.utils import natural_sort_key


class AbnormalWhitelistRequest(BaseModel):
    ids: List[int]


def get_abnormal_translations_data(
    category_filter: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """
    일부 번역 안 함(규칙 4) 및 다른 언어로 번역(규칙 3) 이상 번역 기록을 조회하고 그룹화합니다.
    """
    queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}

    # Whitelisted items (excluded from abnormal detection)
    whitelisted_rows = db.query(AbnormalWhitelist).all()
    whitelisted_ids = {row.translation_id for row in whitelisted_rows}
    whitelisted_url_pids = {(row.url, row.pid) for row in whitelisted_rows if row.url and row.pid}

    # 1. 빠른 1차 후보군 필터링 (가나 또는 한자 포함 번역문)
    candidate_regex = r'[\u3040-\u309f\u30a0-\u30fa\u4e00-\u9faf\u3400-\u4dbf]'
    query = text("""
        SELECT id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order
        FROM translations
        WHERE translated REGEXP :pattern
    """)
    candidates = db.execute(query, {"pattern": candidate_regex}).fetchall()

    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    cat_counts = {"total": 0, "partial_untranslated": 0, "other_language": 0}

    for t in candidates:
        t_dict = t._asdict()
        t_id = t_dict.get("id")
        t_url = t_dict.get("url")
        t_pid = t_dict.get("pid")

        # Skip if whitelisted from abnormal detection
        if t_id in whitelisted_ids or (t_url, t_pid) in whitelisted_url_pids:
            continue

        cat = classify_translation(t_dict.get("original"), t_dict.get("translated"))
        # 오직 규칙 3 (other_language)과 규칙 4 (partial_untranslated)만 대상
        if cat not in ('other_language', 'partial_untranslated'):
            continue

        cat_counts["total"] += 1
        cat_counts[cat] += 1

        if category_filter and category_filter != 'all' and cat != category_filter:
            continue

        folder_name = t_dict.get("folderName")
        if not folder_name:
            continue
        url = t_dict.get("url")
        if url:
            untrans_kw = extract_untranslated_keywords(t_dict.get("original") or "", t_dict.get("translated") or "")
            grouped_by_folder[folder_name][url].append({
                "id": t_dict.get("id"),
                "url": url,
                "pid": t_dict.get("pid"),
                "original": t_dict.get("original"),
                "translated": t_dict.get("translated"),
                "timestamp": t_dict.get("timestamp"),
                "folderName": t_dict.get("folderName"),
                "title": t_dict.get("title"),
                "toc_sort_order": t_dict.get("toc_sort_order"),
                "category": cat,
                "category_label": "일부 번역 안 함" if cat == "partial_untranslated" else "다른 언어로 번역",
                "untranslated_keywords": untrans_kw,
                "is_queued_for_cleanup": t_dict.get("id") in queued_ids
            })

    final_response = {}
    for folder_name, url_groups in grouped_by_folder.items():
        url_group_list = []
        for url, items in url_groups.items():
            sort_order = items[0]['toc_sort_order'] if items and items[0]['toc_sort_order'] is not None else None
            min_id = min((t['id'] for t in items if t.get('id')), default=0)
            url_group_list.append({"url": url, "items": items, "toc_sort_order": sort_order, "min_id": min_id})

        url_group_list.sort(key=lambda x: (
            x['toc_sort_order'] is None,
            x['toc_sort_order'] if x['toc_sort_order'] is not None else 0,
            x.get('min_id', 0),
            natural_sort_key(x['url'])
        ))
        final_response[folder_name] = url_group_list

    applied_urls_set = {row.url for row in db.query(AppliedUrl).all()}
    final_response["_applied_urls"] = list(applied_urls_set)
    final_response["_category_counts"] = cat_counts

    return final_response


def add_abnormal_whitelist_items(ids: List[int], db: Session) -> Dict[str, Any]:
    """단락들을 이상 번역 화이트리스트에 등록합니다."""
    now = int(time.time())
    added_count = 0
    translations = db.query(Translation).filter(Translation.id.in_(ids)).all()
    for t in translations:
        exists = db.query(AbnormalWhitelist).filter(
            (AbnormalWhitelist.translation_id == t.id) |
            ((AbnormalWhitelist.url == t.url) & (AbnormalWhitelist.pid == t.pid))
        ).first()
        if not exists:
            db.add(AbnormalWhitelist(
                translation_id=t.id,
                url=t.url,
                pid=t.pid,
                created_at=now
            ))
            added_count += 1
    db.commit()
    return {"success": True, "added_count": added_count, "message": f"{added_count}개의 단락이 이상번역 검사에서 제외되었습니다."}


def remove_abnormal_whitelist_items(ids: List[int], db: Session) -> Dict[str, Any]:
    """이상 번역 화이트리스트에서 단락을 제거합니다."""
    deleted_count = db.query(AbnormalWhitelist).filter(
        (AbnormalWhitelist.translation_id.in_(ids)) | (AbnormalWhitelist.id.in_(ids))
    ).delete(synchronize_session=False)
    db.commit()
    return {"success": True, "deleted_count": deleted_count, "message": f"{deleted_count}개 단락의 이상번역 제외 설정이 해제되었습니다."}


def get_abnormal_whitelist_data(db: Session) -> Dict[str, Any]:
    """이상 번역 화이트리스트 목록을 조회합니다."""
    items = (
        db.query(
            AbnormalWhitelist.id,
            AbnormalWhitelist.translation_id,
            AbnormalWhitelist.created_at,
            Translation.folderName,
            Translation.title,
            Translation.original,
            Translation.translated,
            Translation.url,
            Translation.pid
        )
        .outerjoin(Translation, AbnormalWhitelist.translation_id == Translation.id)
        .order_by(AbnormalWhitelist.created_at.desc())
        .all()
    )
    results = []
    for it in items:
        results.append({
            "id": it.id,
            "translation_id": it.translation_id,
            "created_at": it.created_at,
            "folderName": it.folderName or "미분류",
            "title": it.title or "회차",
            "original": it.original or "",
            "translated": it.translated or "",
            "url": it.url or "",
            "pid": it.pid or ""
        })
    return {"whitelist": results, "count": len(results)}


def clear_abnormal_whitelist_data(db: Session) -> Dict[str, Any]:
    """이상 번역 화이트리스트 전체를 삭제합니다."""
    count = db.query(AbnormalWhitelist).delete(synchronize_session=False)
    db.commit()
    return {"success": True, "cleared_count": count, "message": f"전체 {count}개 단락의 이상번역 제외 설정이 해제되었습니다."}
