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

items, total = get_items(limit=500)
print(f"Total remaining items: {len(items)}")

with open(os.path.join(APP_ROOT, 'scripts', 'remaining_311_inspect.txt'), 'w', encoding='utf-8') as f:
    for idx, it in enumerate(items):
        f.write(f"[{idx+1}] ID:{it['id']} | FOLDER:{it.get('folderName', '')} | CHAPTER:{it.get('chapter', '')}\n")
        f.write(f"  ORIG: {it['original']}\n")
        f.write(f"  CURR: {it['translated']}\n\n")

print(f"Wrote to scripts/remaining_311_inspect.txt")
