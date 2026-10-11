import pytest
from fastapi.testclient import TestClient
import sqlite3
import os
import time

@pytest.fixture(scope="module", autouse=True)
def override_settings(tmp_path_factory):
    test_db_path = tmp_path_factory.mktemp("data") / "test_exclude_restore.db"
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
        CREATE TABLE IF NOT EXISTS excluded_sentences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            original TEXT NOT NULL,
            UNIQUE(url, original)
        );
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS translation_trash (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_translation_id INTEGER,
            url TEXT NOT NULL,
            pid TEXT,
            original TEXT NOT NULL,
            translated TEXT,
            timestamp INTEGER NOT NULL,
            folderName TEXT,
            title TEXT,
            toc_sort_order INTEGER,
            reason_category TEXT NOT NULL,
            deleted_at INTEGER NOT NULL,
            cleanup_batch_id TEXT
        );
    """)
    conn.commit()
    conn.close()

    yield
    
    del os.environ["DATABASE_URL"]
    settings.database_url = orig_database_url
    sdb.engine.dispose()
    sdb.engine = orig_engine
    sdb.SessionLocal = orig_session_local


def test_exclude_and_restore_cycle():
    from server.server import app
    from server.models import Translation, ExcludedSentence, TranslationTrash
    import server.database as sdb

    client = TestClient(app)
    db = sdb.SessionLocal()

    # 1. Insert initial translation
    t = Translation(
        url="https://test.com/novel/1",
        pid="p40",
        original="◇シアナside◇",
        translated="◇ 시아나 시점 ◇",
        timestamp=123456789,
        title="1화"
    )
    db.add(t)
    db.commit()
    t_id = t.id
    db.close()

    # 2. Call exclude
    res = client.post("/translations/exclude", json={"ids": [t_id]})
    assert res.status_code == 200

    # Verify: Translation deleted, ExcludedSentence created, TranslationTrash archived
    db = sdb.SessionLocal()
    assert db.query(Translation).filter(Translation.id == t_id).first() is None
    excluded = db.query(ExcludedSentence).filter(ExcludedSentence.url == "https://test.com/novel/1").first()
    assert excluded is not None
    assert excluded.original == "◇シアナside◇"

    trash = db.query(TranslationTrash).filter(TranslationTrash.url == "https://test.com/novel/1").first()
    assert trash is not None
    assert trash.translated == "◇ 시아나 시점 ◇"
    assert trash.reason_category == "excluded"
    db.close()

    # 3. Check excluded_details endpoint
    res_details = client.get("/translations/excluded_details?url=https://test.com/novel/1")
    assert res_details.status_code == 200
    details_data = res_details.json()
    assert len(details_data["excluded_items"]) == 1
    assert details_data["excluded_items"][0]["original"] == "◇シアナside◇"
    assert details_data["excluded_items"][0]["translated"] == "◇ 시아나 시점 ◇"

    # 4. Call restore_excluded
    res_restore = client.post("/translations/restore_excluded", json={
        "url": "https://test.com/novel/1",
        "originals": ["◇シアナside◇"]
    })
    assert res_restore.status_code == 200
    restore_data = res_restore.json()
    assert restore_data["success"] is True
    assert restore_data["restored_count"] == 1
    assert restore_data["restored_items"][0]["pid"] == "p40"
    assert restore_data["restored_items"][0]["translated"] == "◇ 시아나 시점 ◇"

    # 5. Verify DB state after restore
    db = sdb.SessionLocal()
    # ExcludedSentence removed
    assert db.query(ExcludedSentence).filter(ExcludedSentence.url == "https://test.com/novel/1").count() == 0
    # Translation restored
    restored_t = db.query(Translation).filter(Translation.url == "https://test.com/novel/1", Translation.pid == "p40").first()
    assert restored_t is not None
    assert restored_t.translated == "◇ 시아나 시점 ◇"
    # Trash cleaned
    assert db.query(TranslationTrash).filter(TranslationTrash.url == "https://test.com/novel/1").count() == 0
    db.close()
