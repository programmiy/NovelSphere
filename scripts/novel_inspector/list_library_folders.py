"""
Library Folder Inspector - 서재 등록 폴더명 목록 및 최근 소설 매핑 확인 도구

[사용법]
.\\venv\\Scripts\\python.exe scripts\\novel_inspector\\list_library_folders.py
"""

import sys
import sqlite3
from pathlib import Path

if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = Path(r"C:\LANOVEL\server\translations.db")

def get_folders():
    if not DB_PATH.exists():
        print(f"[!] DB 파일이 없습니다: {DB_PATH}")
        return []

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    folders = set()
    for table in ['book_activity', 'translations', 'novel_works', 'pinned_books', 'book_tags']:
        try:
            col = 'book_folderName' if table == 'book_tags' else 'folderName'
            cur.execute(f"SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL")
            for r in cur.fetchall():
                if r[0] and str(r[0]).strip():
                    folders.add(str(r[0]).strip())
        except Exception:
            pass

    return sorted(list(folders))

def get_recent_works():
    if not DB_PATH.exists():
        return []
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    try:
        cur.execute("SELECT id, site, title, url, folderName FROM novel_works ORDER BY updated_at DESC LIMIT 15")
        return cur.fetchall()
    except Exception:
        return []

def main():
    folders = get_folders()
    print("=" * 60)
    print(f"📚 [서재 등록 폴더명 목록] (총 {len(folders)}개)")
    print("=" * 60)
    for i, f in enumerate(folders, 1):
        print(f" {i:2d}. {f}")
    print("=" * 60)

    recent = get_recent_works()
    if recent:
        print("\n🔄 [최근 등록/번역 소설 매핑]")
        print("=" * 60)
        for r in recent:
            print(f" - [{r[4] or '폴더미지정'}] {r[2]}")
            print(f"   URL: {r[3]}")
        print("=" * 60)

if __name__ == "__main__":
    main()
