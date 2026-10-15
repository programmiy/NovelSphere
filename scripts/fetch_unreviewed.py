import sys
import os

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from server.database import SessionLocal
from server.models import AiReviewQueue
from server.services.abnormal_service import get_abnormal_translations_data

def get_items(limit=20, folder=None):
    db = SessionLocal()
    try:
        data = get_abnormal_translations_data(None, db)
        queued_ids = {row[0] for row in db.query(AiReviewQueue.translation_id).all()}
        
        items = []
        for f_name, groups in data.items():
            if f_name.startswith('_'):
                continue
            if folder and f_name != folder:
                continue
            for g in groups:
                for it in g.get('items', []):
                    if it['id'] not in queued_ids:
                        items.append(it)
        return items[:limit], len(items)
    finally:
        db.close()

if __name__ == '__main__':
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    folder = sys.argv[2] if len(sys.argv) > 2 else None
    items, total = get_items(limit, folder)
    print(f"TOTAL_REMAINING: {total}")
    for idx, it in enumerate(items):
        print(f"=== ITEM {idx+1} | ID: {it['id']} | FOLDER: {it['folderName']} ===")
        print(f"ORIGINAL: {it['original']}")
        print(f"TRANSLATED: {it['translated']}")
