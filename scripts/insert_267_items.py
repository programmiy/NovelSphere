import sys
import os
import re

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from scripts.fetch_unreviewed import get_items
from scripts.test_final_cleaner import clean_final_311
from scripts.insert_reviewed_items import insert_reviewed

def run_insert_267():
    items, total = get_items(limit=500)
    print(f"Total unreviewed fetched: {len(items)}")
    
    cjk_pattern = re.compile(r'[\u3040-\u309f\u30a0-\u30fa\u4e00-\u9faf]')
    
    to_insert = []
    
    for it in items:
        curr = it.get('translated', '')
        cl = clean_final_311(curr)
        if cl and not cjk_pattern.search(cl):
            to_insert.append({
                "id": it['id'],
                "reviewed_translation": cl
            })
            
    print(f"Inserting {len(to_insert)} items...")
    cnt = insert_reviewed(to_insert, model_name="Antigravity-RuleEngine")
    print(f"SUCCESS: Inserted {cnt} items!")

if __name__ == '__main__':
    run_insert_267()
