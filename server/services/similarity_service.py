"""
Similarity search and recommended translation examples service.
Finds similar Japanese phrases and human-approved Korean translations
to aid review and retranslation accuracy.
"""

from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session

from server.models import Translation


def get_similar_examples_data(
    keyword: str,
    folder: Optional[str],
    exclude_id: Optional[int],
    limit: int,
    db: Session
) -> Dict[str, Any]:
    """키워드를 기반으로 기존 데이터베이스의 유사 번역 단락 예시를 검색합니다."""
    kw = (keyword or "").strip()
    if not kw:
        return {"keyword": "", "examples": []}

    query = db.query(Translation).filter(
        (Translation.original.contains(kw)) | (Translation.translated.contains(kw))
    )
    if exclude_id:
        query = query.filter(Translation.id != exclude_id)
    if folder:
        query = query.filter(Translation.folderName == folder)

    candidates = query.order_by(Translation.timestamp.desc()).limit(limit * 4).all()

    valid_examples = []
    seen_ids = set()
    for item in candidates:
        if not item.translated or not item.translated.strip() or item.id in seen_ids:
            continue
        seen_ids.add(item.id)
        valid_examples.append({
            "id": item.id,
            "original": item.original,
            "translated": item.translated,
            "title": item.title,
            "folderName": item.folderName,
            "pid": item.pid,
            "url": item.url
        })
        if len(valid_examples) >= limit:
            break

    if len(valid_examples) < limit and folder:
        query_all = db.query(Translation).filter(
            (Translation.original.contains(kw)) | (Translation.translated.contains(kw)),
            Translation.folderName != folder
        )
        if exclude_id:
            query_all = query_all.filter(Translation.id != exclude_id)
        query_all = query_all.order_by(Translation.timestamp.desc()).limit((limit - len(valid_examples)) * 4).all()

        for item in query_all:
            if not item.translated or not item.translated.strip() or item.id in seen_ids:
                continue
            seen_ids.add(item.id)
            valid_examples.append({
                "id": item.id,
                "original": item.original,
                "translated": item.translated,
                "title": item.title,
                "folderName": item.folderName,
                "pid": item.pid,
                "url": item.url
            })
            if len(valid_examples) >= limit:
                break

    return {"keyword": kw, "examples": valid_examples}
