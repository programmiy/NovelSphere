import base64
import hashlib
import io
import logging
import os
import time
import uuid
from typing import Any, Dict, Optional, Tuple

from PIL import Image, UnidentifiedImageError

from server.models import NovelIllustration
from server.settings import settings

logger = logging.getLogger("lanovel.illustrations")

MAX_ILLUSTRATION_BYTES = 20 * 1024 * 1024

_FORMAT_META = {
    "PNG": (".png", "image/png"),
    "JPEG": (".jpg", "image/jpeg"),
    "WEBP": (".webp", "image/webp"),
}


def get_illustrations_root() -> str:
    """현재 settings.data_dir 하위의 삽화 저장 루트 디렉토리를 반환합니다."""
    root = os.path.join(settings.data_dir, "illustrations")
    os.makedirs(root, exist_ok=True)
    return root


def book_dir_slug(book_name: str) -> str:
    """작품명에서 OS 안전 디렉토리 슬러그를 생성합니다."""
    digest = hashlib.sha1((book_name or "").encode("utf-8")).hexdigest()[:12]
    return f"b_{digest}"


def normalize_after_pid(after_pid: Optional[str]) -> str:
    """삽입 위치 PID를 정규화합니다 ('TOP', 'END', 또는 단락 PID)."""
    cleaned = (after_pid or "").strip()
    if not cleaned:
        return "END"
    upper = cleaned.upper()
    if upper in ("TOP", "END"):
        return upper
    return cleaned


def resolve_illustration_abs_path(file_rel_path: str) -> Optional[str]:
    """상대 경로를 삽화 저장 루트 기준의 안전한 절대 경로로 검증 변환합니다."""
    if not file_rel_path:
        return None
    root_abs = os.path.abspath(get_illustrations_root())
    normalized_rel = file_rel_path.replace("\\", "/").lstrip("/")
    target_abs = os.path.abspath(os.path.join(root_abs, normalized_rel))
    try:
        if os.path.commonpath([root_abs, target_abs]) != root_abs:
            return None
    except ValueError:
        return None
    return target_abs


def delete_stored_file(file_rel_path: str) -> None:
    """삽화 루트 내부에 속한 이미지 파일만 안전하게 삭제합니다."""
    abs_path = resolve_illustration_abs_path(file_rel_path)
    if abs_path and os.path.isfile(abs_path):
        try:
            os.remove(abs_path)
        except OSError as exc:
            logger.warning(f"Failed to remove illustration file {abs_path}: {exc}")


def _extract_raw_image_bytes(
    image_base64: Optional[str] = None,
    source_path: Optional[str] = None,
) -> bytes:
    if image_base64:
        payload = image_base64.strip()
        if payload.startswith("data:") and "," in payload:
            payload = payload.split(",", 1)[1]
        try:
            raw_bytes = base64.b64decode(payload, validate=True)
        except Exception as exc:
            raise ValueError(f"유효하지 않은 Base64 이미지 데이터입니다: {exc}") from exc
    elif source_path:
        abs_src = os.path.abspath(source_path)
        if not os.path.isfile(abs_src):
            raise FileNotFoundError(f"원본 이미지 파일을 찾을 수 없습니다: {source_path}")
        if os.path.getsize(abs_src) > MAX_ILLUSTRATION_BYTES:
            raise ValueError("이미지 파일 크기가 20MB 제한을 초과했습니다.")
        with open(abs_src, "rb") as f:
            raw_bytes = f.read()
    else:
        raise ValueError("image_base64 또는 source_path 중 하나는 필수입니다.")

    if not raw_bytes:
        raise ValueError("이미지 데이터가 비어 있습니다.")
    if len(raw_bytes) > MAX_ILLUSTRATION_BYTES:
        raise ValueError("이미지 파일 크기가 20MB 제한을 초과했습니다.")
    return raw_bytes


def store_illustration_image(
    book_name: str,
    image_base64: Optional[str] = None,
    source_path: Optional[str] = None,
) -> Dict[str, Any]:
    """이미지 바이너리를 검증하고 삽화 루트에 저장한 뒤 메타데이터를 반환합니다."""
    raw_bytes = _extract_raw_image_bytes(image_base64=image_base64, source_path=source_path)

    try:
        with Image.open(io.BytesIO(raw_bytes)) as img:
            fmt = (img.format or "").upper()
            width, height = img.size
            img.verify()
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError(f"지원하지 않거나 손상된 이미지 파일입니다: {exc}") from exc

    if fmt not in _FORMAT_META:
        raise ValueError(f"지원하지 않는 이미지 형식입니다: {fmt} (PNG/JPEG/WEBP만 허용)")

    ext, mime_type = _FORMAT_META[fmt]
    slug = book_dir_slug(book_name)
    root = get_illustrations_root()
    target_dir = os.path.join(root, slug)
    os.makedirs(target_dir, exist_ok=True)

    filename = f"illu_{int(time.time())}_{uuid.uuid4().hex[:8]}{ext}"
    abs_path = os.path.join(target_dir, filename)
    with open(abs_path, "wb") as f:
        f.write(raw_bytes)

    return {
        "file_rel_path": f"{slug}/{filename}",
        "mime_type": mime_type,
        "width": int(width),
        "height": int(height),
        "file_size": len(raw_bytes),
    }


def resolve_chapter_metadata(
    cursor,
    book_name: str,
    chapter_url: Optional[str],
    chapter_title: Optional[str],
) -> Tuple[str, str]:
    """translations 테이블을 조회해 누락된 chapter_url 또는 chapter_title을 보완합니다."""
    clean_url = (chapter_url or "").strip()
    clean_title = (chapter_title or "").strip()
    folder_clause = "folderName IS NULL" if book_name == "미분류" else "folderName = ?"
    base_params = [] if book_name == "미분류" else [book_name]

    if clean_url and not clean_title:
        cursor.execute(
            f"""
            SELECT title FROM translations
            WHERE {folder_clause} AND (url = ? OR RTRIM(url, '/') = ?)
              AND title IS NOT NULL AND title != ''
            ORDER BY timestamp DESC LIMIT 1
            """,
            tuple(base_params + [clean_url, clean_url.rstrip("/")]),
        )
        row = cursor.fetchone()
        if row:
            clean_title = row[0] if not isinstance(row, dict) else (row.get("title") or "")

    elif clean_title and not clean_url:
        cursor.execute(
            f"""
            SELECT url FROM translations
            WHERE {folder_clause} AND title = ? AND url IS NOT NULL AND url != ''
            ORDER BY timestamp DESC LIMIT 1
            """,
            tuple(base_params + [clean_title]),
        )
        row = cursor.fetchone()
        if row:
            clean_url = row[0] if not isinstance(row, dict) else (row.get("url") or "")

    return clean_url, clean_title


def serialize_illustration(item: NovelIllustration) -> Dict[str, Any]:
    """NovelIllustration ORM 인스턴스를 API/뷰어 응답 JSON 딕셔너리로 변환합니다."""
    return {
        "id": item.id,
        "book_name": item.book_name,
        "chapter_url": item.chapter_url,
        "chapter_title": item.chapter_title or "",
        "after_pid": item.after_pid or "END",
        "sort_order": item.sort_order or 0,
        "caption": item.caption or "",
        "file_rel_path": item.file_rel_path,
        "mime_type": item.mime_type or "image/png",
        "width": item.width,
        "height": item.height,
        "file_size": item.file_size,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
        "image_url": f"/api/illustrations/{item.id}/image?v={item.updated_at}",
    }
