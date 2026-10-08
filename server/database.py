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

def get_sqlite_conn(as_dict: bool = False, timeout: float = 15.0) -> sqlite3.Connection:
    """
    Creates and configures a raw SQLite connection with WAL mode, foreign keys,
    busy timeout, and custom regex functions registered.
    """
    conn = sqlite3.connect(get_db_path(), timeout=timeout)
    conn.text_factory = str

    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

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

@event.listens_for(engine, "connect")
def _db_connect(dbapi_connection, _connection_record):
    """
    Registers custom functions and optimizes SQLite performance.
    """
    # SQLite optimization pragmas
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=10000")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

    register_sqlite_functions(dbapi_connection)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

