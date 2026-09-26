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
from server.database import register_sqlite_functions
from server.models import Base

# 새로운 테스트 엔진 및 세션 생성
sdb.engine = create_engine(_test_db_url, connect_args={"check_same_thread": False})

@event.listens_for(sdb.engine, "connect")
def _test_db_connect(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
    register_sqlite_functions(dbapi_connection)

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
                tokenize='unicode61'
            );
        """)
    except Exception:
        pass

@pytest.fixture(autouse=True)
def block_external_notifications(monkeypatch, request):
    """
    테스트 스위트 실행 중 외부 ntfy 서버로 실제 HTTP 알림이 전송되는 것을 100% 차단합니다.
    test_send_ntfy_payload_and_headers와 같이 자체 mock을 검증하는 테스트는 제외합니다.
    """
    if "test_send_ntfy_payload_and_headers" in request.node.name:
        return
    from unittest.mock import MagicMock
    import server.notifications as sn
    monkeypatch.setattr(sn, "_send_ntfy_request", MagicMock(return_value=True))

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

