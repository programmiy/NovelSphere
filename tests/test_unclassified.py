import pytest
from fastapi.testclient import TestClient
import sqlite3
import os
import time

@pytest.fixture(scope="module", autouse=True)
def override_settings(tmp_path_factory):
    test_db_path = tmp_path_factory.mktemp("unclass_data") / "test_unclassified.db"
    test_db_url = f"sqlite:///{test_db_path}"
    os.environ["DATABASE_URL"] = test_db_url

    from server.settings import settings
    orig_database_url = settings.database_url
    settings.database_url = test_db_url

    import server.database as sdb
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    orig_engine = sdb.engine
    orig_session_local = sdb.SessionLocal

    sdb.engine = create_engine(test_db_url, connect_args={"check_same_thread": False})
    sdb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sdb.engine)

    conn = sqlite3.connect(test_db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            pid TEXT,
            original TEXT NOT NULL,
            translated TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            folderName TEXT,
            title TEXT,
            toc_sort_order INTEGER,
            UNIQUE(url, pid)
        );
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS novel_works (
            work_id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            novel_title TEXT NOT NULL,
            work_url TEXT,
            matched_folder TEXT,
            created_at INTEGER,
            updated_at INTEGER
        );
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS book_activity (
            folderName TEXT PRIMARY KEY,
            last_read_timestamp INTEGER NOT NULL,
            is_visible INTEGER DEFAULT 1
        );
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS applied_urls (
            url TEXT PRIMARY KEY,
            applied_at INTEGER
        );
    """)
    conn.commit()
    conn.close()

    yield test_db_path
    
    del os.environ["DATABASE_URL"]
    settings.database_url = orig_database_url
    sdb.engine.dispose()
    sdb.engine = orig_engine
    sdb.SessionLocal = orig_session_local

def test_unclassified_sorting_and_assignment(override_settings):
    from server.server import app
    client = TestClient(app)
    db_path = override_settings

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    # Clean up
    cursor.execute("DELETE FROM translations")
    cursor.execute("DELETE FROM novel_works")
    cursor.execute("DELETE FROM book_activity")

    # Insert episodes for a Kakuyomu work with scrambled URL numbers vs reading order
    work_id = "16817139555497698213"
    work_url = f"https://kakuyomu.jp/works/{work_id}"
    
    # Pre-cache title to avoid web scraping during test
    cursor.execute("""
        INSERT INTO novel_works (work_id, platform, novel_title, work_url, created_at, updated_at)
        VALUES (?, 'Kakuyomu', '테스트 소설 제목', ?, 100, 100)
    """, (f"kakuyomu:{work_id}", work_url))

    episodes = [
        ("https://kakuyomu.jp/works/16817139555497698213/episodes/99999999999999999999", "1화 프롤로그"),
        ("https://kakuyomu.jp/works/16817139555497698213/episodes/11111111111111111111", "2화 본편"),
        ("https://kakuyomu.jp/works/16817139555497698213/episodes/55555555555555555555", "3화 결말"),
    ]

    # Insert chronologically (min(id) 1, 2, 3)
    for idx, (ep_url, ep_title) in enumerate(episodes):
        cursor.execute("""
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title, toc_sort_order)
            VALUES (?, 'p1', '원문', '번역', ?, NULL, ?, NULL)
        """, (ep_url, 1000 + idx, ep_title))
    conn.commit()
    conn.close()

    # 1. Test GET /api/unclassified_novels
    res = client.get("/api/unclassified_novels")
    assert res.status_code == 200
    data = res.json()
    assert data["total_unclassified_novels"] == 1
    novel = data["novels"][0]
    assert novel["novel_title"] == "테스트 소설 제목"
    assert len(novel["episodes"]) == 3
    # Check that episodes are sorted strictly by min_id (1화, 2화, 3화), NOT URL
    assert novel["episodes"][0]["title"] == "1화 프롤로그"
    assert novel["episodes"][1]["title"] == "2화 본편"
    assert novel["episodes"][2]["title"] == "3화 결말"

    # 2. Test POST /api/unclassified_novels/assign_folder
    assign_res = client.post("/api/unclassified_novels/assign_folder", json={
        "work_id": f"kakuyomu:{work_id}",
        "target_folder": "새로운소설폴더",
        "work_url": work_url
    })
    assert assign_res.status_code == 200
    assert assign_res.json()["success"] is True

    # 3. Check SQLite that toc_sort_order was automatically sequentially populated (0, 1, 2)
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT url, title, toc_sort_order, folderName
        FROM translations
        WHERE folderName = '새로운소설폴더'
        ORDER BY toc_sort_order ASC
    """)
    rows = cursor.fetchall()
    conn.close()

    assert len(rows) == 3
    assert rows[0][1] == "1화 프롤로그"
    assert rows[0][2] == 0
    assert rows[1][1] == "2화 본편"
    assert rows[1][2] == 1
    assert rows[2][1] == "3화 결말"
    assert rows[2][2] == 2
