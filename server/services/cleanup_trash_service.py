"""
Cleanup queue, trashbin, and notification management service.
Handles verbatim repetition cleanup queues, deletion with trash archiving,
restoring trash items, and 7-day cleanup notification lifecycles.
"""

from collections import defaultdict
import time
from typing import Optional, List, Dict, Any
import uuid

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from server.models import Translation, TranslationTrash, CleanupNotification, CleanupQueuedItem
from server.rule_classifier import classify_translation
from server.utils import natural_sort_key


class MoveToCleanupRequest(BaseModel):
    ids: List[int]


class CleanupDeleteRequest(BaseModel):
    ids: Optional[List[int]] = None
    all_queue: Optional[bool] = False


class RestoreRequest(BaseModel):
    trash_ids: Optional[List[int]] = None
    batch_id: Optional[str] = None
    all_trash: Optional[bool] = False


def move_items_to_cleanup(ids: List[int], db: Session) -> Dict[str, Any]:
    """선택한 이상 번역 항목을 원문 정리 섹션으로 이동합니다."""
    now = int(time.time())
    moved_count = 0
    for t_id in ids:
        exists = db.query(CleanupQueuedItem).filter(CleanupQueuedItem.translation_id == t_id).first()
        if not exists:
            db.add(CleanupQueuedItem(translation_id=t_id, queued_at=now))
            moved_count += 1
    db.commit()
    return {"success": True, "moved_count": moved_count, "message": f"{moved_count}개의 항목이 원문 정리 섹션으로 이동되었습니다."}


def get_cleanup_queue_data(db: Session) -> Dict[str, Any]:
    """원문 복제·변형 정리 대기열을 조회합니다."""
    queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}

    # 1. 1차 후보 쿼리 (원문=번역문, 빈번역, 일본어 가나 및 한자/중국어 포함 번역)
    candidate_regex = r'[\u3040-\u309f\u30a0-\u30fa\u4e00-\u9faf\u3400-\u4dbf]'
    query = text("""
        SELECT id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order
        FROM translations
        WHERE translated IS NULL
           OR translated = ''
           OR original = translated
           OR translated REGEXP :pattern
    """)
    candidates = db.execute(query, {"pattern": candidate_regex}).fetchall()

    grouped_by_folder = defaultdict(lambda: defaultdict(list))
    counts = {"total": 0, "verbatim_count": 0, "paraphrased_count": 0, "moved_count": 0}
    seen_ids = set()

    for t in candidates:
        t_dict = t._asdict()
        t_id = t_dict.get("id")
        ori = t_dict.get("original") or ""
        tra = t_dict.get("translated") or ""

        cat = classify_translation(ori, tra)
        is_moved = t_id in queued_ids

        # 대상: verbatim_or_empty, paraphrased_jp, paraphrased_zh, 또는 사용자가 수동 이동한 항목
        if cat in ('verbatim_or_empty', 'paraphrased_jp', 'paraphrased_zh') or is_moved:
            seen_ids.add(t_id)
            counts["total"] += 1
            if is_moved:
                counts["moved_count"] += 1
                category_label = "다른 언어 (이동됨)"
            elif cat == "verbatim_or_empty":
                counts["verbatim_count"] += 1
                category_label = "원문 그대로 반환"
            elif cat == "paraphrased_zh":
                counts["paraphrased_count"] += 1
                category_label = "원문 변형 (중국어)"
            else:
                counts["paraphrased_count"] += 1
                category_label = "원문 변형"

            folder_name = t_dict.get("folderName")
            if not folder_name:
                continue
            url = t_dict.get("url")
            if url:
                grouped_by_folder[folder_name][url].append({
                    "id": t_id,
                    "url": url,
                    "pid": t_dict.get("pid"),
                    "original": ori,
                    "translated": tra,
                    "timestamp": t_dict.get("timestamp"),
                    "folderName": t_dict.get("folderName"),
                    "title": t_dict.get("title"),
                    "toc_sort_order": t_dict.get("toc_sort_order"),
                    "category": "moved" if is_moved else cat,
                    "category_label": category_label
                })

    # 혹시 queued_ids 중 candidates 쿼리에 안 걸린 항목이 있다면 추가 로드
    remaining_queued_ids = queued_ids - seen_ids
    if remaining_queued_ids:
        extra_items = db.query(Translation).filter(Translation.id.in_(list(remaining_queued_ids))).all()
        for t in extra_items:
            counts["total"] += 1
            counts["moved_count"] += 1
            folder_name = t.folderName
            if not folder_name:
                continue
            grouped_by_folder[folder_name][t.url].append({
                "id": t.id,
                "url": t.url,
                "pid": t.pid,
                "original": t.original,
                "translated": t.translated,
                "timestamp": t.timestamp,
                "folderName": t.folderName,
                "title": t.title,
                "toc_sort_order": t.toc_sort_order,
                "category": "moved",
                "category_label": "다른 언어 (이동됨)"
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

    final_response["_summary"] = counts
    return final_response


def delete_cleanup_queue_items(req: CleanupDeleteRequest, db: Session) -> Dict[str, Any]:
    """원문 정리 항목을 삭제하고 휴지통에 보관하며 알림을 생성합니다."""
    if req.ids:
        target_translations = db.query(Translation).filter(Translation.id.in_(req.ids)).all()
    elif req.all_queue:
        queued_ids = {row.translation_id for row in db.query(CleanupQueuedItem).all()}
        candidate_regex = r'[\u3040-\u309f\u30a0-\u30fa\u4e00-\u9faf\u3400-\u4dbf]'
        query = text("""
            SELECT id, original, translated FROM translations
            WHERE translated IS NULL OR translated = '' OR original = translated OR translated REGEXP :pattern
        """)
        candidates = db.execute(query, {"pattern": candidate_regex}).fetchall()
        target_ids = set()
        for t in candidates:
            t_dict = t._asdict()
            t_id = t_dict.get("id")
            cat = classify_translation(t_dict.get("original") or "", t_dict.get("translated") or "")
            if cat in ('verbatim_or_empty', 'paraphrased_jp', 'paraphrased_zh') or t_id in queued_ids:
                target_ids.add(t_id)
        target_ids.update(queued_ids)
        target_translations = db.query(Translation).filter(Translation.id.in_(list(target_ids))).all()
    else:
        raise HTTPException(status_code=400, detail="삭제할 대상 ID가 지정되지 않았습니다.")

    if not target_translations:
        return {"success": True, "deleted_count": 0, "affected_episodes": [], "message": "삭제할 대상이 없습니다."}

    now = int(time.time())
    batch_id = str(uuid.uuid4())[:8]

    episodes_map = defaultdict(lambda: {"novel_title": "", "episode_title": "", "url": "", "count": 0})

    for t in target_translations:
        cat = classify_translation(t.original, t.translated)
        trash_item = TranslationTrash(
            original_translation_id=t.id,
            url=t.url,
            pid=t.pid,
            original=t.original,
            translated=t.translated,
            timestamp=t.timestamp,
            folderName=t.folderName,
            title=t.title,
            toc_sort_order=t.toc_sort_order,
            reason_category=cat,
            deleted_at=now,
            cleanup_batch_id=batch_id
        )
        db.add(trash_item)

        ep = episodes_map[t.url]
        ep["novel_title"] = t.folderName or "미분류"
        ep["episode_title"] = t.title or t.url
        ep["url"] = t.url
        ep["count"] += 1

        db.delete(t)

    deleted_ids = [t.id for t in target_translations]
    db.query(CleanupQueuedItem).filter(CleanupQueuedItem.translation_id.in_(deleted_ids)).delete(synchronize_session=False)

    affected_episodes_list = []
    for url, info in episodes_map.items():
        notif = CleanupNotification(
            batch_id=batch_id,
            novel_title=info["novel_title"],
            episode_title=info["episode_title"],
            url=info["url"],
            deleted_count=info["count"],
            is_dismissed=0,
            created_at=now,
            dismissed_at=None
        )
        db.add(notif)
        affected_episodes_list.append(info)

    db.commit()
    return {
        "success": True,
        "batch_id": batch_id,
        "deleted_count": len(target_translations),
        "affected_episodes": affected_episodes_list,
        "message": f"{len(target_translations)}개 단락이 삭제되어 휴지통에 보관되었습니다."
    }


def get_translation_trash_data(db: Session) -> Dict[str, Any]:
    """휴지통 목록을 조회합니다."""
    trash_items = db.query(TranslationTrash).order_by(TranslationTrash.deleted_at.desc()).limit(1000).all()
    results = []
    for item in trash_items:
        results.append({
            "id": item.id,
            "original_translation_id": item.original_translation_id,
            "url": item.url,
            "pid": item.pid,
            "original": item.original,
            "translated": item.translated,
            "timestamp": item.timestamp,
            "folderName": item.folderName,
            "title": item.title,
            "reason_category": item.reason_category,
            "deleted_at": item.deleted_at,
            "cleanup_batch_id": item.cleanup_batch_id
        })
    return {"trash": results}


def restore_trash_items(req: RestoreRequest, db: Session) -> Dict[str, Any]:
    """휴지통 항목을 translations 테이블로 복원합니다."""
    query = db.query(TranslationTrash)
    if req.trash_ids:
        items_to_restore = query.filter(TranslationTrash.id.in_(req.trash_ids)).all()
    elif req.batch_id:
        items_to_restore = query.filter(TranslationTrash.cleanup_batch_id == req.batch_id).all()
    elif req.all_trash:
        items_to_restore = query.all()
    else:
        raise HTTPException(status_code=400, detail="복원할 대상이 지정되지 않았습니다.")

    if not items_to_restore:
        return {"success": True, "restored_count": 0, "message": "복원할 항목이 없습니다."}

    restored_count = 0
    for item in items_to_restore:
        existing = db.query(Translation).filter(
            Translation.url == item.url,
            Translation.pid == item.pid,
            Translation.original == item.original
        ).first()

        if existing:
            existing.translated = item.translated
            existing.timestamp = item.timestamp
            existing.folderName = item.folderName
            existing.title = item.title
            existing.toc_sort_order = item.toc_sort_order
        else:
            new_t = Translation(
                url=item.url,
                pid=item.pid,
                original=item.original,
                translated=item.translated,
                timestamp=item.timestamp,
                folderName=item.folderName,
                title=item.title,
                toc_sort_order=item.toc_sort_order
            )
            db.add(new_t)

        db.delete(item)
        restored_count += 1

    db.commit()
    return {"success": True, "restored_count": restored_count, "message": f"{restored_count}개의 항목이 복원되었습니다."}


def get_cleanup_notifications_data(db: Session) -> Dict[str, Any]:
    """활성 삭제 알림 및 최근 7일 내 해제된 알림 이력을 반환합니다."""
    now = int(time.time())
    seven_days_ago = now - 7 * 86400

    # 7일 지난 해제된 알림 및 트래시 영구 정리
    db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 1,
        CleanupNotification.dismissed_at < seven_days_ago
    ).delete(synchronize_session=False)

    db.query(TranslationTrash).filter(
        TranslationTrash.deleted_at < seven_days_ago
    ).delete(synchronize_session=False)
    db.commit()

    active_notifs = db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 0
    ).order_by(CleanupNotification.created_at.desc()).all()

    dismissed_notifs = db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 1,
        CleanupNotification.dismissed_at >= seven_days_ago
    ).order_by(CleanupNotification.dismissed_at.desc()).all()

    def _to_dict(n):
        return {
            "id": n.id,
            "batch_id": n.batch_id,
            "novel_title": n.novel_title,
            "episode_title": n.episode_title,
            "url": n.url,
            "deleted_count": n.deleted_count,
            "is_dismissed": bool(n.is_dismissed),
            "created_at": n.created_at,
            "dismissed_at": n.dismissed_at
        }

    return {
        "active_notifications": [_to_dict(n) for n in active_notifs],
        "recent_dismissed": [_to_dict(n) for n in dismissed_notifs]
    }


def dismiss_cleanup_notification(
    notif_id: int,
    url: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """특정 삭제 알림을 해제 처리합니다."""
    notif = db.query(CleanupNotification).filter(CleanupNotification.id == notif_id).first()
    now = int(time.time())

    target_clean_url = None
    if notif:
        notif.is_dismissed = 1
        notif.dismissed_at = now
        target_clean_url = (notif.url or "").split('#')[0].strip()

    if url:
        param_clean_url = (url or "").split('#')[0].strip()
        if param_clean_url:
            target_clean_url = param_clean_url

    # 해당 회차(동일 URL)에 남아있는 다른 활성 알림(중복 생성되었거나 해시 포함 URL)도 함께 일괄 해제
    if target_clean_url:
        related_notifs = db.query(CleanupNotification).filter(
            CleanupNotification.is_dismissed == 0,
            (
                (CleanupNotification.url == target_clean_url) |
                (CleanupNotification.url.startswith(target_clean_url + "#"))
            )
        ).all()
        for rn in related_notifs:
            rn.is_dismissed = 1
            rn.dismissed_at = now

    if not notif and not target_clean_url:
        raise HTTPException(status_code=404, detail="알림을 찾을 수 없습니다.")

    db.commit()
    return {"success": True}


def dismiss_all_cleanup_notifications(db: Session) -> Dict[str, Any]:
    """모든 활성 삭제 알림을 일괄 해제합니다."""
    now = int(time.time())
    db.query(CleanupNotification).filter(CleanupNotification.is_dismissed == 0).update({
        CleanupNotification.is_dismissed: 1,
        CleanupNotification.dismissed_at: now
    })
    db.commit()
    return {"success": True}


def get_cleanup_review_targets_data(
    url: str,
    batch_id: Optional[str],
    db: Session
) -> Dict[str, Any]:
    """특정 URL에 대한 최근 정리 이력과 알림 연계 재검수 대상 단락 목록을 조회합니다."""
    clean_url = (url or "").split('#')[0].strip()
    if not clean_url:
        return {"has_targets": False, "targets": [], "notif_id": None}

    # 1. 해당 URL에 대한 활성 알림 조회
    url_condition = (
        (CleanupNotification.url == clean_url) |
        (CleanupNotification.url.startswith(clean_url + "#"))
    )
    notif_query = db.query(CleanupNotification).filter(
        url_condition,
        CleanupNotification.is_dismissed == 0
    )

    active_notif = None
    if batch_id:
        int_id = None
        try:
            int_id = int(batch_id)
        except ValueError:
            pass

        if int_id is not None:
            batch_query = notif_query.filter(
                (CleanupNotification.batch_id == batch_id) | (CleanupNotification.id == int_id)
            )
        else:
            batch_query = notif_query.filter(CleanupNotification.batch_id == batch_id)

        active_notif = batch_query.order_by(CleanupNotification.created_at.desc()).first()

    # batch_id로 매칭되지 않았거나 batch_id가 없는 경우 해당 URL의 가장 최근 활성 알림을 fallback으로 매칭
    if not active_notif:
        active_notif = notif_query.order_by(CleanupNotification.created_at.desc()).first()

    # 2. TranslationTrash에서 해당 URL의 삭제 이력 조회
    trash_url_condition = (
        (TranslationTrash.url == clean_url) |
        (TranslationTrash.url.startswith(clean_url + "#"))
    )
    trash_query = db.query(TranslationTrash).filter(trash_url_condition)
    if active_notif:
        trash_query = trash_query.filter(TranslationTrash.cleanup_batch_id == active_notif.batch_id)
    elif batch_id:
        trash_query = trash_query.filter(TranslationTrash.cleanup_batch_id == batch_id)
    else:
        twenty_four_hours_ago = int((time.time() - 86400) * 1000)
        trash_query = trash_query.filter(TranslationTrash.deleted_at >= twenty_four_hours_ago)

    trash_items = trash_query.order_by(TranslationTrash.deleted_at.desc()).all()

    seen_pids = set()
    targets = []
    for item in trash_items:
        pid = item.pid or ""
        if pid and pid in seen_pids:
            continue
        if pid:
            seen_pids.add(pid)
        targets.append({
            "pid": item.pid,
            "original": item.original,
            "reason_category": item.reason_category or "verbatim",
            "deleted_at": item.deleted_at,
            "batch_id": item.cleanup_batch_id
        })

    # 3. Translation 테이블에 남아있는 빈 번역문(None 또는 '') 또는 원문 복붙 미완성 문장도 검수 대상에 포함
    trans_url_condition = (
        (Translation.url == clean_url) |
        (Translation.url.startswith(clean_url + "#"))
    )
    empty_or_bad_trans = db.query(Translation).filter(
        trans_url_condition,
        (Translation.translated.is_(None) | (Translation.translated == ""))
    ).all()

    sample_meta = db.query(Translation.folderName, Translation.title).filter(trans_url_condition).first()
    novel_title = active_notif.novel_title if active_notif else (sample_meta[0] if sample_meta else None)
    episode_title = active_notif.episode_title if active_notif else (sample_meta[1] if sample_meta else None)

    for item in empty_or_bad_trans:
        pid = item.pid or ""
        if pid and pid in seen_pids:
            continue
        if pid:
            seen_pids.add(pid)
        targets.append({
            "pid": item.pid,
            "original": item.original,
            "reason_category": "empty",
            "deleted_at": (item.timestamp * 1000) if item.timestamp else int(time.time() * 1000),
            "batch_id": active_notif.batch_id if active_notif else "db_empty"
        })

    return {
        "has_targets": len(targets) > 0,
        "notif_id": active_notif.id if active_notif else None,
        "batch_id": active_notif.batch_id if active_notif else (targets[0]["batch_id"] if targets else None),
        "novel_title": novel_title,
        "episode_title": episode_title,
        "targets": targets
    }
