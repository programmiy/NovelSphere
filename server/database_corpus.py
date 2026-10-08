"""
Corpus AI Dedicated SQLite Database Manager.
Manages connections and schemas for server/corpus_ai.db (Pre-indexed corpus cache).
100% deterministic, WAL-mode, lightweight SQLite.
"""

import os
import sqlite3
from urllib.parse import urlparse
from contextlib import contextmanager
from typing import Optional, Dict, Any

from server.settings import settings


def get_corpus_db_path() -> str:
    """Extracts the local file path for corpus_ai.db."""
    parsed_url = urlparse(settings.corpus_db_url)
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


def get_corpus_conn(as_dict: bool = False, timeout: float = 15.0) -> sqlite3.Connection:
    """
    Creates and configures a raw SQLite connection with WAL mode,
    busy timeout, and optimized cache for corpus_ai.db.
    """
    conn = sqlite3.connect(get_corpus_db_path(), timeout=timeout)
    conn.text_factory = str

    cursor = conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA cache_size=10000")
    cursor.close()

    if as_dict:
        conn.row_factory = dict_factory

    return conn


@contextmanager
def corpus_db_connection(as_dict: bool = False, timeout: float = 15.0):
    """Context manager for corpus_ai.db connection ensuring automatic cleanup."""
    conn = get_corpus_conn(as_dict=as_dict, timeout=timeout)
    try:
        yield conn
    finally:
        conn.close()


def init_corpus_db(conn: Optional[sqlite3.Connection] = None):
    """
    Initializes the schema for corpus_ai.db.
    Creates templates, phrase alignments, tone stats, and meta tables with indexes.
    """
    should_close = False
    if conn is None:
        conn = get_corpus_conn()
        should_close = True

    try:
        cursor = conn.cursor()
        
        # 1. Corpus Sentence Templates (Tier 1 EBMT)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS corpus_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ja_clean TEXT NOT NULL,
                ko_clean TEXT NOT NULL,
                original TEXT NOT NULL,
                translated TEXT NOT NULL,
                frequency INTEGER DEFAULT 1,
                folder_name TEXT
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_templates_ja ON corpus_templates(ja_clean);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_templates_folder ON corpus_templates(folder_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_templates_len_freq ON corpus_templates(length(ja_clean), frequency DESC);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_templates_trans ON corpus_templates(translated);")

        # 2. Phrase Alignments (Tier 2 EBMT & Autocomplete)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS corpus_phrase_alignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ja_phrase TEXT NOT NULL,
                ko_phrase TEXT NOT NULL,
                co_occurrence_count INTEGER DEFAULT 1,
                probability REAL DEFAULT 1.0,
                folder_name TEXT
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_phrase_ja ON corpus_phrase_alignments(ja_phrase);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_phrase_ko ON corpus_phrase_alignments(ko_phrase);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_phrase_folder ON corpus_phrase_alignments(folder_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_phrase_ja_folder ON corpus_phrase_alignments(ja_phrase, folder_name);")

        # 3. Tone Statistics (Module 2-3 Style Consistency)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS corpus_tone_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_name TEXT NOT NULL,
                is_dialogue INTEGER DEFAULT 1,
                ja_ending TEXT NOT NULL,
                ko_ending TEXT NOT NULL,
                count INTEGER DEFAULT 1,
                probability REAL DEFAULT 1.0
            );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_tone_lookup ON corpus_tone_stats(folder_name, is_dialogue, ja_ending);")
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_tone_global ON corpus_tone_stats(is_dialogue, ja_ending);")

        # 4. Meta Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS corpus_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        """)

        conn.commit()
        cursor.close()
    finally:
        if should_close:
            conn.close()
