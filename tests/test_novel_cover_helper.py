"""Isolated unit tests for the novel-cover skill helper script."""

from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path

COVER_HELPER_PATH = (
    Path(__file__).resolve().parents[1]
    / ".agents"
    / "skills"
    / "novel-cover"
    / "scripts"
    / "novel_cover_helper.py"
)

SPEC = importlib.util.spec_from_file_location("novel_cover_helper", COVER_HELPER_PATH)
assert SPEC and SPEC.loader
cover_helper = importlib.util.module_from_spec(SPEC)
sys.modules["novel_cover_helper"] = cover_helper
SPEC.loader.exec_module(cover_helper)


def test_cover_brief_with_summary_tags_and_chapters(tmp_path: Path) -> None:
    """Verify get_cover_brief aggregates summary, notes, tags, and opening lines read-only."""
    db_file = tmp_path / "cover_full.db"
    conn = sqlite3.connect(db_file)
    try:
        conn.executescript(
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
            );
            CREATE TABLE book_activity (
                folderName TEXT PRIMARY KEY,
                notes TEXT,
                summary TEXT,
                summary_source_url TEXT
            );
            CREATE TABLE tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            );
            CREATE TABLE book_tags (
                book_folderName TEXT,
                tag_id INTEGER
            );
            """
        )
        conn.executemany(
            "INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title, toc_sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("https://example.com/1", "L1", "orig1", "진홍색 머리의 선배가 나타났다.", 100, "표지테스트", "제1화 만남", 1),
                ("https://example.com/1", "L2", "orig2", "가을 바람이 불었다.", 101, "표지테스트", "제1화 만남", 1),
                ("https://example.com/2", "L1", "orig3", "두 번째 화의 시작.", 200, "표지테스트", "제2화 동거", 2),
            ],
        )
        conn.execute(
            "INSERT INTO book_activity (folderName, notes, summary, summary_source_url) VALUES (?, ?, ?, ?)",
            ("표지테스트", "러브코미디 메모", "스무 살 주인공과 선배의 달달한 동거 이야기.", "https://example.com"),
        )
        conn.execute("INSERT INTO tags (id, name) VALUES (1, '러브코미디'), (2, '동거')")
        conn.execute("INSERT INTO book_tags (book_folderName, tag_id) VALUES ('표지테스트', 1), ('표지테스트', 2)")
        conn.commit()
    finally:
        conn.close()

    ro_conn = cover_helper.open_readonly_db(db_file)
    try:
        brief = cover_helper.get_cover_brief(ro_conn, book="표지테스트", sample_chapters=2, lines_per_chapter=1)
        assert brief["total_chapters"] == 2
        assert brief["tags"] == ["동거", "러브코미디"]
        assert brief["summary"] == "스무 살 주인공과 선배의 달달한 동거 이야기."
        assert brief["notes"] == "러브코미디 메모"
        assert len(brief["opening_excerpts"]) == 2
        assert brief["opening_excerpts"][0]["lines"] == [{"pid": "L1", "text": "진홍색 머리의 선배가 나타났다."}]
    finally:
        ro_conn.close()


def test_cover_brief_minimal_schema_fallback(tmp_path: Path) -> None:
    """Ensure get_cover_brief works even if book_activity or tag tables do not exist."""
    db_file = tmp_path / "cover_minimal.db"
    conn = sqlite3.connect(db_file)
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
        conn.execute(
            "INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title, toc_sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("https://example.com/1", "p1", "o1", "최소 스키마 테스트 문장", 100, "미니멀소설", "1화", 1),
        )
        conn.commit()
    finally:
        conn.close()

    ro_conn = cover_helper.open_readonly_db(db_file)
    try:
        brief = cover_helper.get_cover_brief(ro_conn, book="미니멀소설")
        assert brief["tags"] == []
        assert brief["summary"] == ""
        assert brief["total_chapters"] == 1
        assert brief["opening_excerpts"][0]["lines"][0]["text"] == "최소 스키마 테스트 문장"
    finally:
        ro_conn.close()
