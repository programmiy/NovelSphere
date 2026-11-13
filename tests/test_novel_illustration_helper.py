"""Isolated unit tests for the novel-illustration skill helper script."""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

HELPER_PATH = (
    Path(__file__).resolve().parents[1]
    / ".agents"
    / "skills"
    / "novel-illustration"
    / "scripts"
    / "novel_scene_helper.py"
)

SPEC = importlib.util.spec_from_file_location("novel_scene_helper", HELPER_PATH)
assert SPEC and SPEC.loader
helper = importlib.util.module_from_spec(SPEC)
sys.modules["novel_scene_helper"] = helper
SPEC.loader.exec_module(helper)


def _create_isolated_db(db_path: Path) -> None:
    """Create a small isolated SQLite DB matching LANOVEL translations schema."""
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE translations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL,
                pid TEXT,
                original TEXT NOT NULL,
                translated TEXT,
                timestamp INTEGER NOT NULL,
                folderName TEXT,
                title TEXT,
                toc_sort_order INTEGER
            )
            """
        )
        rows = [
            ("https://example.com/1", "L1", "orig1", "1화 첫 줄", 100, "테스트 소설", "제1화 만남", 1),
            ("https://example.com/1", "L5", "orig2", "진홍색 머리 선배 등장", 101, "테스트 소설", "제1화 만남", 1),
            ("https://example.com/1", "L10", "orig3", "레몬 캔을 건넸다", 102, "테스트 소설", "제1화 만남", 1),
            ("https://example.com/1", "L15", "orig4", "1화 끝 줄", 103, "테스트 소설", "제1화 만남", 1),
            ("https://example.com/2", "L1", "orig5", "2화 첫 줄", 200, "테스트 소설", "제2화 밤", 2),
            ("https://example.com/2", "L5", "orig6", "", 201, "테스트 소설", "제2화 밤", 2),
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


def test_readonly_books_chapters_and_scene_range(tmp_path: Path) -> None:
    """Verify read-only queries list books, chapters, and PID-bounded scene slices."""
    db_file = tmp_path / "isolated_novels.db"
    _create_isolated_db(db_file)

    conn = helper.open_readonly_db(db_file)
    try:
        books = helper.list_books(conn, search="테스트")
        assert len(books) == 1
        assert books[0]["book"] == "테스트 소설"
        assert books[0]["chapters"] == 2
        assert books[0]["sentences"] == 6

        chapters = helper.list_chapters(conn, "테스트 소설")
        assert [c["title"] for c in chapters] == ["제1화 만남", "제2화 밤"]

        scene = helper.extract_scene(
            conn,
            book="테스트 소설",
            chapter_query="1",
            pid_start="L5",
            pid_end="L10",
        )
        assert scene["title"] == "제1화 만남"
        assert scene["lines"] == [
            {"pid": "L5", "text": "진홍색 머리 선배 등장"},
            {"pid": "L10", "text": "레몬 캔을 건넸다"},
        ]

        # Empty translated text should safely fall back to original text.
        ch2 = helper.extract_scene(conn, book="테스트 소설", chapter_query="제2화")
        assert ch2["lines"][1] == {"pid": "L5", "text": "orig6"}
    finally:
        conn.close()


def test_register_illustration_builds_payload(tmp_path: Path, monkeypatch) -> None:
    """Verify register_illustration chooses source_path for loopback and base64 for remote."""
    img_path = tmp_path / "sample.png"
    img_path.write_bytes(b"fake-png-bytes")
    captured: list[dict] = []

    class _FakeResp:
        def __init__(self, body: dict):
            self._raw = json.dumps(body).encode("utf-8")

        def read(self) -> bytes:
            return self._raw

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    import json

    def _fake_urlopen(req, timeout=30.0):
        captured.append(json.loads(req.data.decode("utf-8")))
        return _FakeResp({"id": 11, "book_name": "작품A", "after_pid": "L10"})

    monkeypatch.setattr(helper.urllib.request, "urlopen", _fake_urlopen)

    res_local = helper.register_illustration(
        book="작품A",
        image_path=img_path,
        chapter_url="https://example.com/1",
        after_pid="L10",
        caption="레몬캔 장면",
        server_url="http://127.0.0.1:8001",
    )
    assert res_local["id"] == 11
    assert captured[0]["source_path"] == str(img_path.resolve())
    assert "image_base64" not in captured[0]

    helper.register_illustration(
        book="작품A",
        image_path=img_path,
        chapter_url="https://example.com/1",
        after_pid="END",
        server_url="https://lanovel.tailscale.ts.net:8001",
    )
    assert "image_base64" in captured[1]
    assert "source_path" not in captured[1]


def test_readonly_connection_blocks_writes(tmp_path: Path) -> None:
    """Ensure open_readonly_db rejects write operations at the SQLite level."""
    db_file = tmp_path / "isolated_ro.db"
    _create_isolated_db(db_file)

    conn = helper.open_readonly_db(db_file)
    try:
        try:
            conn.execute("DELETE FROM translations")
            raised = False
        except sqlite3.OperationalError:
            raised = True
        assert raised is True
    finally:
        conn.close()
