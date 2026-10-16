from typing import List, Dict, Any
from collections import defaultdict
from server.database import get_sqlite_conn

def get_all_folders(include_hidden: bool = False) -> List[Dict[str, Any]]:
    """모든 폴더(책) 목록과 활동 정보를 데이터베이스에서 조회합니다."""
    conn = get_sqlite_conn(as_dict=True)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM book_activity")
        activity_map = {row['folderName']: row for row in cursor.fetchall()}
        
        cursor.execute("SELECT bt.book_folderName, t.id, t.name FROM book_tags bt JOIN tags t ON bt.tag_id = t.id")
        book_tags_map = defaultdict(list)
        for row in cursor.fetchall():
            book_tags_map[row['book_folderName']].append({'id': row['id'], 'name': row['name']})
            
        cursor.execute("SELECT folderName FROM pinned_books")
        pinned_set = {row['folderName'] for row in cursor.fetchall()}
        
        cursor.execute("SELECT DISTINCT folderName FROM translations WHERE folderName IS NOT NULL")
        translation_folders = {row['folderName'] for row in cursor.fetchall()}

        cursor.execute("SELECT DISTINCT folderName FROM book_activity WHERE folderName IS NOT NULL")
        activity_folders = {row['folderName'] for row in cursor.fetchall()}

        all_folders_set = translation_folders.union(activity_folders)

        # 숨김 처리된 폴더 (is_visible == 0) 필터링
        hidden_folders = {
            row['folderName']
            for row in activity_map.values()
            if row.get('is_visible') == 0
        }
        if not include_hidden:
            all_folders_set = {f for f in all_folders_set if f not in hidden_folders}

        cursor.execute("SELECT folderName, COUNT(DISTINCT title) as chapter_count FROM translations WHERE folderName IS NOT NULL AND title IS NOT NULL GROUP BY folderName")
        chapter_counts = {row['folderName']: row['chapter_count'] for row in cursor.fetchall()}

        from server.services.reviewed_service import reviewed_service

        folder_objects = [
            {
                'name': f,
                'pinned': f in pinned_set,
                'tags': book_tags_map.get(f, []),
                'activity': activity_map.get(f),
                'chapter_count': chapter_counts.get(f, 0),
                'is_visible': 0 if f in hidden_folders else 1,
                'is_reviewed': reviewed_service.is_book_reviewed(f)
            } for f in all_folders_set
        ]
        return sorted(folder_objects, key=lambda x: (not x['pinned'], x['name']))
    finally:
        conn.close()

def update_book_toc_order(folder_name: str, urls: List[Dict[str, str]]) -> int:
    """지정된 폴더(책) 내 URL들의 순서를 업데이트합니다."""
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    updated_count = 0

    try:
        if folder_name == "미분류":
            cursor.execute("UPDATE translations SET toc_sort_order = NULL WHERE folderName IS NULL")
        else:
            cursor.execute("UPDATE translations SET toc_sort_order = NULL WHERE folderName = ?", (folder_name,))

        for i, item in enumerate(urls):
            normalized_url = item["url"].rstrip('/')
            
            if folder_name == "미분류":
                cursor.execute(
                    "UPDATE translations SET toc_sort_order = ?, title = ? WHERE folderName IS NULL AND (RTRIM(url, '/') = ? OR url = ?)",
                    (i, item["title"], normalized_url, item["url"])
                )
            else:
                cursor.execute(
                    "UPDATE translations SET toc_sort_order = ?, title = ? WHERE folderName = ? AND (RTRIM(url, '/') = ? OR url = ?)",
                    (i, item["title"], folder_name, normalized_url, item["url"])
                )
            if cursor.rowcount > 0:
                updated_count += 1

            try:
                cursor.execute(
                    "UPDATE url_metadata SET sort_order = ?, title = ? WHERE RTRIM(url, '/') = ? OR url = ?",
                    (i, item["title"], normalized_url, item["url"])
                )
            except Exception:
                pass

        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()
        
    return updated_count
