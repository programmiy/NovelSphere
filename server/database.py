import os
import re
import sqlite3
from urllib.parse import urlparse
from contextlib import contextmanager
from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool
from sqlalchemy.orm import sessionmaker
from server.settings import settings

def get_db_path() -> str:
    """Extracts the local file path from the configured SQLite database URL."""
    parsed_url = urlparse(settings.database_url)
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

def dict_factory(cursor, row):
    """Converts SQLite cursor rows to a dictionary."""
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

import functools

@functools.lru_cache(maxsize=256)
def _get_compiled_regex(expr: str, flags: int = 0):
    return re.compile(expr, flags=flags)

def _sqlite_regexp(expr, item, flags=0):
    if item is None or expr is None:
        return False
    try:
        return _get_compiled_regex(expr, flags=flags).search(item) is not None
    except Exception:
        return False

def _sqlite_regexp_replace(pattern, repl, text, flags=0):
    if text is None:
        return None
    if pattern is None or repl is None:
        return text
    try:
        return _get_compiled_regex(pattern, flags=flags).sub(repl, text)
    except Exception:
        try:
            return _get_compiled_regex(pattern, flags=flags).sub(lambda m: repl, text)
        except Exception:
            return text

def _sqlite_regexp_replace_plain(pattern, repl, text):
    if text is None:
        return None
    if pattern is None or repl is None:
        return text
    try:
        return _get_compiled_regex(pattern).sub(lambda m: repl, text)
    except Exception:
        return text

import zoneinfo
import datetime

_LA_TZ = zoneinfo.ZoneInfo("America/Los_Angeles")

def _sqlite_to_quota_date(ts):
    """Unix timestamp(초)를 미국 태평양(America/Los_Angeles, Gemini API 리셋 기준) 날짜 문자열(YYYY-MM-DD)로 변환."""
    if ts is None:
        return None
    try:
        dt = datetime.datetime.fromtimestamp(int(ts), tz=_LA_TZ)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None

def _sqlite_to_quota_hour(ts):
    """Unix timestamp(초)를 미국 태평양 기준 0~23 시(Hour)로 변환."""
    if ts is None:
        return 0
    try:
        dt = datetime.datetime.fromtimestamp(int(ts), tz=_LA_TZ)
        return dt.hour
    except Exception:
        return 0

def _sqlite_to_quota_dow(ts):
    """Unix timestamp(초)를 미국 태평양 기준 요일(0:일, 1:월, ..., 6:토)로 변환."""
    if ts is None:
        return 0
    try:
        dt = datetime.datetime.fromtimestamp(int(ts), tz=_LA_TZ)
        return int(dt.strftime("%w"))
    except Exception:
        return 0

def register_sqlite_functions(conn):
    conn.create_function("REGEXP", 2, _sqlite_regexp)
    conn.create_function("REGEXP", 3, _sqlite_regexp)
    conn.create_function("REGEXP_REPLACE", 3, lambda p, r, t: _sqlite_regexp_replace(p, r, t, 0))
    conn.create_function("REGEXP_REPLACE", 4, _sqlite_regexp_replace)
    conn.create_function("REGEXP_REPLACE_PLAIN", 3, _sqlite_regexp_replace_plain)
    conn.create_function("TO_QUOTA_DATE", 1, _sqlite_to_quota_date)
    conn.create_function("TO_QUOTA_HOUR", 1, _sqlite_to_quota_hour)
    conn.create_function("TO_QUOTA_DOW", 1, _sqlite_to_quota_dow)

import sys
import logging

logger = logging.getLogger(__name__)

# 영구 보호 대상 핵심 테이블 목록 (DROP TABLE 원천 차단)
PROTECTED_TABLES = {
    "translations",
    "applied_urls",
    "glossary",
    "trash_translations",
    "novel_separator_settings",
    "pinned_books",
    "book_tags",
    "cleanup_rules",
    "replace_rules"
}

def is_prod_db_write_allowed() -> bool:
    """
    운영 DB(translations.db)에 대한 쓰기 권한 허용 여부를 엄격하게 판별합니다.
    - 환경 변수 ALLOW_PROD_DB_WRITE=1 (서버 구동 시 자동 설정)
    - pytest 테스트 러너 실행 중 (tests/conftest.py에서 격리 DB 사용)
    - 대상 DB 파일이 translations.db 가 아닌 임시/테스트 DB일 때
    - 메인 프로세스가 uvicorn / server.server / main.py 등 서버 프로세스일 때
    그 외의 임의 파이썬 스크립트(테스트 스크립트 등)는 자동으로 쓰기가 차단(query_only=ON)됩니다.
    """
    if os.environ.get("ALLOW_PROD_DB_WRITE", "").lower() in ("1", "true", "yes"):
        return True
    if "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ:
        return True

    # 대상 DB가 translations.db 가 아닌 경우(테스트/임시 DB 등)는 자유롭게 허용
    try:
        db_basename = os.path.basename(get_db_path()).lower()
        if db_basename not in ("translations.db",):
            return True
    except Exception:
        pass

    # 메인 프로세스 검사
    main_mod = sys.modules.get("__main__")
    main_file = (getattr(main_mod, "__file__", "") or "").replace("\\", "/").lower()
    argv0 = (sys.argv[0] if sys.argv else "").replace("\\", "/").lower()

    if any(sig in argv0 or sig in main_file for sig in ("uvicorn", "server/server.py", "server\\server.py", "main.py", "run_server.py")):
        return True

    return False

def _sqlite_authorizer(action_code, arg1, arg2, db_name, trigger_name):
    """
    SQLite C-API 레벨의 엔진 보안 통제 함수.
    1. 핵심 테이블 DROP TABLE 시도 시 즉시 SQLITE_DENY 거부.
    2. 비승인 스크립트가 PRAGMA query_only=OFF 로 보호 해제 시도 시 즉시 SQLITE_DENY 거부.
    """
    # 1. DROP TABLE 차단
    if action_code == sqlite3.SQLITE_DROP_TABLE:
        table_name = (arg1 or "").strip().lower()
        if table_name in PROTECTED_TABLES:
            logger.critical(f"[DB SECURITY ALERT] DROP TABLE '{arg1}' 차단됨! (SQLite Authorizer)")
            return sqlite3.SQLITE_DENY

    # 2. PRAGMA query_only 우회 시도 차단
    elif action_code == sqlite3.SQLITE_PRAGMA:
        pragma_name = (arg1 or "").strip().lower()
        if pragma_name == "query_only":
            val = (arg2 or "").strip().lower()
            if val in ("off", "0", "no", "false"):
                if not is_prod_db_write_allowed():
                    logger.critical("[DB SECURITY ALERT] PRAGMA query_only 해제 시도 차단됨!")
                    return sqlite3.SQLITE_DENY

    return sqlite3.SQLITE_OK

def get_sqlite_conn(as_dict: bool = False, timeout: float = 15.0) -> sqlite3.Connection:
    """
    Creates and configures a raw SQLite connection with WAL mode, foreign keys,
    busy timeout, authorizer, and custom regex functions registered.
    """
    conn = sqlite3.connect(get_db_path(), timeout=timeout)
    conn.text_factory = str

    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA mmap_size=268435456")  # 256MB OS memory map
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")

    if not is_prod_db_write_allowed():
        cursor.execute("PRAGMA query_only = ON")

    cursor.close()

    conn.set_authorizer(_sqlite_authorizer)
    register_sqlite_functions(conn)

    if as_dict:
        conn.row_factory = dict_factory

    return conn

@contextmanager
def db_connection(as_dict: bool = False, timeout: float = 15.0):
    """Context manager for SQLite connections that ensures automatic cleanup."""
    conn = get_sqlite_conn(as_dict=as_dict, timeout=timeout)
    try:
        yield conn
    finally:
        conn.close()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    poolclass=NullPool
)

def attach_engine_safety_guards(target_engine):
    """
    지정된 SQLAlchemy Engine에 엔진 레벨 보안 가드(Authorizer, WAL/최적화 Pragma, DELETE 안전 검사기)를 등록합니다.
    """
    @event.listens_for(target_engine, "connect")
    def _db_connect_listener(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA mmap_size=268435456")  # 256MB OS memory map
        cursor.execute("PRAGMA cache_size=10000")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")

        if not is_prod_db_write_allowed():
            cursor.execute("PRAGMA query_only = ON")

        cursor.close()

        dbapi_connection.set_authorizer(_sqlite_authorizer)
        register_sqlite_functions(dbapi_connection)

    @event.listens_for(target_engine, "before_cursor_execute")
    def _check_safe_sql_listener(conn, cursor, statement, parameters, context, executemany):
        stmt = " ".join(statement.strip().split()).upper()
        if re.search(r'\bDELETE\s+FROM\s+["`\[]?TRANSLATIONS["`\]]?', stmt):
            if "WHERE" not in stmt:
                raise PermissionError(
                    f"CRITICAL DB SAFETY: Whole-table DELETE on translations without WHERE is strictly forbidden! [SQL: {statement[:80]}]"
                )
            where_part = stmt.split("WHERE", 1)[1].strip().rstrip(";").strip()
            if where_part in ("1=1", "1 = 1", "TRUE", "1", "1==1"):
                raise PermissionError(
                    f"CRITICAL DB SAFETY: Trivial WHERE condition in DELETE on translations is strictly forbidden! [SQL: {statement[:80]}]"
                )

attach_engine_safety_guards(engine)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


