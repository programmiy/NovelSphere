import os
import shutil
import tempfile
import sqlite3
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

# 1. 모듈 수집/import 전에 전역 테스트 임시 DB 생성 및 격리
_temp_dir = tempfile.mkdtemp(prefix="lanovel_test_")
_test_db_path = os.path.join(_temp_dir, "test_isolated.db")
_test_db_url = f"sqlite:///{_test_db_path}"

from server.settings import settings
settings.database_url = _test_db_url

import server.database as sdb
from server.database import register_sqlite_functions, attach_engine_safety_guards
from server.models import Base

# 새로운 테스트 엔진 및 세션 생성
sdb.engine = create_engine(_test_db_url, connect_args={"check_same_thread": False})
attach_engine_safety_guards(sdb.engine)

sdb.SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sdb.engine)

# 스키마 및 FTS5 생성
Base.metadata.create_all(bind=sdb.engine)
with sdb.engine.begin() as conn:
    try:
        conn.exec_driver_sql("""
            CREATE VIRTUAL TABLE IF NOT EXISTS translations_fts USING fts5(
                original,
                translated,
                content='translations',
                content_rowid='id',
                tokenize='trigram'
            );
        """)
        conn.exec_driver_sql("""
            CREATE TRIGGER IF NOT EXISTS translations_ai AFTER INSERT ON translations BEGIN
                INSERT INTO translations_fts(rowid, original, translated) VALUES (new.id, new.original, new.translated);
            END;
        """)
        conn.exec_driver_sql("""
            CREATE TRIGGER IF NOT EXISTS translations_ad AFTER DELETE ON translations BEGIN
                INSERT INTO translations_fts(translations_fts, rowid, original, translated) VALUES('delete', old.id, old.original, old.translated);
            END;
        """)
        conn.exec_driver_sql("""
            CREATE TRIGGER IF NOT EXISTS translations_au AFTER UPDATE ON translations BEGIN
                INSERT INTO translations_fts(translations_fts, rowid, original, translated) VALUES('delete', old.id, old.original, old.translated);
                INSERT INTO translations_fts(rowid, original, translated) VALUES (new.id, new.original, new.translated);
            END;
        """)
    except Exception:
        pass

def pytest_sessionfinish(session, exitstatus):
    """테스트 세션 종료 시 임시 DB 디렉토리 정리"""
    try:
        sdb.engine.dispose()
    except Exception:
        pass
    try:
        shutil.rmtree(_temp_dir, ignore_errors=True)
    except Exception:
        pass

