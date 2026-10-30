import sys
import os
import re
import time

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from scripts.fetch_unreviewed import get_items
from scripts.test_auto_cleaner import clean_text_advanced
from server.database import SessionLocal
from server.models import AiReviewQueue, Translation
from server.routers.ai_review import clean_ai_translation

def run_auto_clean_batch():
    items, total = get_items(limit=3000)
    print(f"Total unreviewed fetched: {len(items)} (Total in DB: {total})")
    
    cjk_pattern = re.compile(r'[\u3040-\u309f\u30a0-\u30fa\u4e00-\u9faf]')
    
    to_insert = []
    skipped = []
    
    for it in items:
        curr = it.get('translated', '')
        cleaned = clean_text_advanced(curr)
        cleaned = clean_ai_translation(cleaned)
        
        # CJK가 전혀 없고 비어있지 않은 경우
        if cleaned and cleaned.strip() and not cjk_pattern.search(cleaned):
            to_insert.append({
                "id": it['id'],
                "reviewed_translation": cleaned
            })
        else:
            skipped.append(it)
            
    print(f"Eligible for auto-insert: {len(to_insert)} items")
    print(f"Remaining for manual review: {len(skipped)} items")
    
    if not to_insert:
        print("No items to insert.")
        return
        
    from scripts.insert_reviewed_items import insert_reviewed
    inserted_count = insert_reviewed(to_insert, model_name="Antigravity-RuleEngine")
    print(f"SUCCESS: Inserted {inserted_count} items into ai_review_queue!")

if __name__ == '__main__':
    run_auto_clean_batch()
