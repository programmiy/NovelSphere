import sys
import os
import json

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from scripts.fetch_unreviewed import get_items

def prepare_batches(start_batch_num, num_batches=3, batch_size=50):
    total_needed = num_batches * batch_size
    items, remaining_total = get_items(limit=total_needed)
    print(f"Total remaining before preparation: {remaining_total}")
    print(f"Fetched {len(items)} items for {num_batches} batches (Batch {start_batch_num} to {start_batch_num + num_batches - 1})")
    
    for b_idx in range(num_batches):
        b_num = start_batch_num + b_idx
        b_items = items[b_idx * batch_size : (b_idx + 1) * batch_size]
        if not b_items:
            break
        
        raw_path = os.path.join(APP_ROOT, 'scripts', f'batch{b_num}_raw.json')
        inspect_path = os.path.join(APP_ROOT, 'scripts', f'batch{b_num}_inspect.txt')
        
        with open(raw_path, 'w', encoding='utf-8') as f:
            json.dump(b_items, f, ensure_ascii=False, indent=2)
            
        with open(inspect_path, 'w', encoding='utf-8') as f:
            for idx, item in enumerate(b_items):
                f.write(f"[{idx+1}] ID:{item['id']} | {item.get('chapter', '')}\n")
                f.write(f"ORIG: {item['original']}\n")
                f.write(f"CURR: {item['translated']}\n\n")
                
        print(f"Prepared Batch {b_num}: {len(b_items)} items -> {raw_path}, {inspect_path}")

if __name__ == '__main__':
    start_batch = int(sys.argv[1]) if len(sys.argv) > 1 else 101
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    prepare_batches(start_batch, count, 50)
