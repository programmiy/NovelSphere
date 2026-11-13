"""Isolated API & sync tests for inline novel illustrations."""

from __future__ import annotations

import base64
import gzip
import io
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from server.database import SessionLocal, get_sqlite_conn
from server.models import DeletedRecord, NovelIllustration
from server.routers.illustrations import _require_loopback_if_source_path
from server.server import app
from server.services.illustration_service import resolve_illustration_abs_path
from server.settings import settings

BOOK_A = "__테스트_삽화소설_A__"
BOOK_B = "__테스트_삽화소설_B__"
CH1_URL = "https://novelup.plus/story/test999/101"
CH2_URL = "https://novelup.plus/story/test999/102"


def _make_png_bytes(width: int = 32, height: int = 48, color: tuple[int, int, int] = (180, 70, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), color=color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def isolated_illu_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "data_dir", str(data_dir))

    conn = get_sqlite_conn()
    try:
        conn.execute(
            "DELETE FROM translations WHERE folderName IN (?, ?) OR url IN (?, ?)",
            (BOOK_A, BOOK_B, CH1_URL, CH2_URL),
        )
        rows = [
            (CH1_URL, "L1", "一話一行目", "1화 1행", 1000, BOOK_A, "제1화 만남", 1),
            (CH1_URL, "L5", "一話五行目", "1화 5행", 1001, BOOK_A, "제1화 만남", 1),
            (CH1_URL, "L10", "一話十行目", "1화 10행", 1002, BOOK_A, "제1화 만남", 1),
            (CH1_URL, "L15", "一話十五行目", "1화 15행", 1003, BOOK_A, "제1화 만남", 1),
            (CH2_URL, "L1", "二話一行目", "2화 1행", 1004, BOOK_A, "제2화 밤", 2),
        ]
        conn.executemany(
            """
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title, toc_sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
    finally:
        conn.close()

    with TestClient(app) as client:
        yield client, data_dir

    db = SessionLocal()
    try:
        db.query(NovelIllustration).filter(NovelIllustration.book_name.in_([BOOK_A, BOOK_B])).delete(
            synchronize_session=False
        )
        db.query(DeletedRecord).filter(
            DeletedRecord.entity_type == "illustration",
            DeletedRecord.parent_scope.in_([BOOK_A, BOOK_B]),
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()

    conn = get_sqlite_conn()
    try:
        conn.execute(
            "DELETE FROM translations WHERE folderName IN (?, ?) OR url IN (?, ?)",
            (BOOK_A, BOOK_B, CH1_URL, CH2_URL),
        )
        conn.commit()
    finally:
        conn.close()


def test_illustrations_crud_chapters_pids_and_image_stream(isolated_illu_env, tmp_path: Path):
    client, data_dir = isolated_illu_env

    # 1. 잘못된 입력 / 손상 이미지 거부 및 Path Traversal 방어 검증
    bad_res = client.post(
        "/api/illustrations",
        json={
            "book_name": BOOK_A,
            "chapter_url": CH1_URL,
            "after_pid": "L10",
            "image_base64": base64.b64encode(b"not-an-image").decode("ascii"),
        },
    )
    assert bad_res.status_code == 400
    assert resolve_illustration_abs_path("../../outside.png") is None

    fake_remote_req = SimpleNamespace(client=SimpleNamespace(host="192.168.0.55"))
    with pytest.raises(HTTPException) as exc_info:
        _require_loopback_if_source_path(fake_remote_req, "C:/temp/illu.png")
    assert exc_info.value.status_code == 403

    # 2. Base64 PNG 업로드 등록
    png_bytes = _make_png_bytes(32, 48)
    data_uri = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    create_res = client.post(
        "/api/illustrations",
        json={
            "book_name": BOOK_A,
            "chapter_url": CH1_URL,
            "after_pid": "L10",
            "caption": "레몬캔 장면",
            "sort_order": 1,
            "image_base64": data_uri,
        },
    )
    assert create_res.status_code == 200, create_res.text
    created = create_res.json()
    illu_id = created["id"]
    assert created["book_name"] == BOOK_A
    assert created["chapter_url"] == CH1_URL
    assert created["chapter_title"] == "제1화 만남"
    assert created["after_pid"] == "L10"
    assert created["width"] == 32
    assert created["height"] == 48
    assert created["mime_type"] == "image/png"
    assert created["image_url"] == f"/api/illustrations/{illu_id}/image?v={created['updated_at']}"

    stored_file_1 = data_dir / "illustrations" / created["file_rel_path"]
    assert stored_file_1.is_file()

    # 3. 목록 / 회차별 건수 / PID 목록 / /api/books/{book}/urls 연동 확인
    list_res = client.get(f"/api/illustrations?book_name={BOOK_A}")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    ch_res = client.get(f"/api/illustrations/book/{BOOK_A}/chapters")
    assert ch_res.status_code == 200
    chapters = ch_res.json()
    assert len(chapters) == 2
    assert chapters[0]["illustration_count"] == 1
    assert chapters[1]["illustration_count"] == 0

    pids_res = client.get(f"/api/illustrations/book/{BOOK_A}/pids", params={"chapter_url": CH1_URL})
    assert pids_res.status_code == 200
    assert [p["pid"] for p in pids_res.json()] == ["L1", "L5", "L10", "L15"]

    urls_res = client.get(f"/api/books/{BOOK_A}/urls")
    assert urls_res.status_code == 200
    url_rows = {row["url"]: row for row in urls_res.json()}
    assert url_rows[CH1_URL]["illustration_count"] == 1
    assert url_rows[CH2_URL]["illustration_count"] == 0

    # 4. 이미지 스트리밍 및 캐시 헤더 확인
    img_res = client.get(f"/api/illustrations/{illu_id}/image")
    assert img_res.status_code == 200
    assert img_res.content == png_bytes
    assert "max-age=86400" in img_res.headers.get("cache-control", "")

    # 5. source_path로 이미지 교체 + TOP 위치 정규화 수정
    new_png = _make_png_bytes(64, 96, (20, 120, 210))
    local_src = tmp_path / "replacement.png"
    local_src.write_bytes(new_png)

    upd_res = client.put(
        f"/api/illustrations/{illu_id}",
        json={
            "after_pid": "top",
            "caption": "수정된 캡션",
            "source_path": str(local_src),
        },
    )
    assert upd_res.status_code == 200, upd_res.text
    updated = upd_res.json()
    assert updated["after_pid"] == "TOP"
    assert updated["caption"] == "수정된 캡션"
    assert updated["width"] == 64
    assert updated["height"] == 96
    assert not stored_file_1.exists()  # 구 파일 정리
    stored_file_2 = data_dir / "illustrations" / updated["file_rel_path"]
    assert stored_file_2.is_file()

    # 6. 삭제 시 파일 제거 및 DeletedRecord tombstone 기록
    del_res = client.delete(f"/api/illustrations/{illu_id}")
    assert del_res.status_code == 200
    assert del_res.json()["deleted_id"] == illu_id
    assert not stored_file_2.exists()
    assert client.get(f"/api/illustrations/{illu_id}/image").status_code == 404


def test_folder_rename_updates_illustrations_and_sync_endpoints(isolated_illu_env, tmp_path: Path):
    client, _ = isolated_illu_env
    local_src = tmp_path / "scene.png"
    local_src.write_bytes(_make_png_bytes(40, 60))

    create_res = client.post(
        "/api/illustrations",
        json={
            "book_name": BOOK_A,
            "chapter_url": CH1_URL,
            "after_pid": "L5",
            "source_path": str(local_src),
        },
    )
    assert create_res.status_code == 200
    illu_id = create_res.json()["id"]

    # 1. 작품(폴더)명 변경 시 삽화 book_name 연쇄 갱신 확인
    rename_res = client.put(f"/api/folders/{BOOK_A}", json={"new_name": BOOK_B})
    assert rename_res.status_code == 200, rename_res.text

    old_list = client.get(f"/api/illustrations?book_name={BOOK_A}").json()
    new_list = client.get(f"/api/illustrations?book_name={BOOK_B}").json()
    assert old_list == []
    assert len(new_list) == 1
    assert new_list[0]["id"] == illu_id

    # 2. /api/sync/pull 에 illustrations 포함 확인
    pull_res = client.get("/api/sync/pull?since=0")
    assert pull_res.status_code == 200
    pull_data = json.loads(gzip.decompress(pull_res.content).decode("utf-8"))
    matched = [row for row in pull_data.get("illustrations", []) if row["id"] == illu_id]
    assert len(matched) == 1
    assert matched[0]["book_name"] == BOOK_B
    assert matched[0]["after_pid"] == "L5"

    # 3. /api/sync/full-pack 시드 DB에 novel_illustrations 테이블/행 적재 확인
    pack_res = client.get("/api/sync/full-pack")
    assert pack_res.status_code == 200
    seed_db = tmp_path / "seed_verify.db"
    seed_db.write_bytes(gzip.decompress(pack_res.content))
    s_conn = sqlite3.connect(seed_db)
    try:
        seed_rows = s_conn.execute(
            "SELECT id, book_name, chapter_url, after_pid FROM novel_illustrations WHERE id = ?",
            (illu_id,),
        ).fetchall()
        assert seed_rows == [(illu_id, BOOK_B, CH1_URL, "L5")]
    finally:
        s_conn.close()

    # 4. 삭제 후 /api/sync/pull deletions tombstone 포함 확인
    del_res = client.delete(f"/api/illustrations/{illu_id}")
    assert del_res.status_code == 200
    pull_after_del = json.loads(gzip.decompress(client.get("/api/sync/pull?since=0").content).decode("utf-8"))
    tombstones = [
        d for d in pull_after_del.get("deletions", [])
        if d.get("entity_type") == "illustration" and d.get("entity_id") == str(illu_id)
    ]
    assert len(tombstones) == 1


def test_web_ui_templates_expose_illustration_elements(isolated_illu_env):
    client, _ = isolated_illu_env

    lib_res = client.get("/library")
    assert lib_res.status_code == 200
    assert 'data-tab="illustrations"' in lib_res.text
    assert "library.js?v=3.9" in lib_res.text

    mob_res = client.get("/m")
    assert mob_res.status_code == 200
    assert "m-illu-list" in mob_res.text
    assert "library_mobile.js?v=2.3" in mob_res.text

    view_res = client.get(f"/viewer?book={BOOK_A}")
    assert view_res.status_code == 200
    assert 'id="illustration-lightbox"' in view_res.text
    assert "viewer.js?v=3.3" in view_res.text
