import os
import re
import sqlite3
from urllib.parse import urlparse
from contextlib import contextmanager
from sqlalchemy import create_engine, event
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

def get_sqlite_conn(as_dict: bool = False, timeout: float = 15.0) -> sqlite3.Connection:
    """
    Creates and configures a raw SQLite connection with WAL mode, foreign keys,
    busy timeout, and custom regex function registered.
    """
    conn = sqlite3.connect(get_db_path(), timeout=timeout)
    conn.text_factory = str

    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

    def regexp(expr, item):
        if item is None:
            return False
        reg = re.compile(expr)
        return reg.search(item) is not None

    conn.create_function("REGEXP", 2, regexp)

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
    settings.database_url, connect_args={"check_same_thread": False}
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

    def regexp(expr, item):
        if item is None:
            return False
        reg = re.compile(expr)
        return reg.search(item) is not None

    dbapi_connection.create_function("REGEXP", 2, regexp)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
