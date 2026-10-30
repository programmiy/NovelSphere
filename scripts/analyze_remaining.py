import sys
import os
import re

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from scripts.fetch_unreviewed import get_items

items, total = get_items(limit=3000)
print(f"Total unreviewed fetched: {len(items)} (Overall total: {total})")

patterns = {
    "only_small_tsu": 0,
    "has_japanese_words": 0,
    "has_english_only": 0,
    "has_cjk_kanji": 0,
    "has_ai_memo": 0
}

cjk_kanji = re.compile(r'[\u4e00-\u9faf]')
kana = re.compile(r'[\u3040-\u309f\u30a0-\u30fa]')

for it in items:
    curr = it.get('translated', '')
    has_kanji = bool(cjk_kanji.search(curr))
    has_kana = bool(kana.search(curr))
    
    if "그どころか" in curr or "そろそろ" in curr or "確かに" in curr or "いわゆる" in curr:
        patterns["has_japanese_words"] += 1
    elif re.search(r'[っッー]', curr):
        patterns["only_small_tsu"] += 1
    elif has_kanji:
        patterns["has_cjk_kanji"] += 1
    else:
        patterns["has_english_only"] += 1

print("Pattern statistics:")
for k, v in patterns.items():
    print(f"  {k}: {v}")
