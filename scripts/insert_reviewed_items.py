import sys
import os
import json
import time
import glob

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from server.database import SessionLocal
from server.models import AiReviewQueue, Translation
from server.routers.ai_review import clean_ai_translation

def insert_reviewed(batch_data, model_name="Antigravity-AI"):
    db = SessionLocal()
    inserted = 0
    try:
        now = int(time.time())
        for item in batch_data:
            t_id = item['id']
            ai_text = clean_ai_translation(
                item.get('translated') or 
                item.get('translated_text') or 
                item.get('cleaned_text') or 
                item.get('reviewed_translation') or ''
            )
            if not ai_text or not ai_text.strip():
                raise ValueError(f"Empty translation for ID {t_id}! Item keys: {list(item.keys())}")
            
            # Base translation 조회
            trans = db.query(Translation).filter(Translation.id == t_id).first()
            if not trans:
                continue
                
            existing = db.query(AiReviewQueue).filter(AiReviewQueue.translation_id == t_id).first()
            if existing:
                existing.ai_translated_text = ai_text
                existing.model_used = model_name
                existing.status = 'pending_review'
                existing.updated_at = now
            else:
                new_q = AiReviewQueue(
                    translation_id=t_id,
                    original_text=trans.original,
                    old_translated_text=clean_ai_translation(trans.translated),
                    ai_translated_text=ai_text,
                    status='pending_review',
                    model_used=model_name,
                    created_at=now,
                    updated_at=now
                )
                db.add(new_q)
            inserted += 1
        db.commit()
        return inserted
    finally:
        db.close()

if __name__ == '__main__':
    if len(sys.argv) > 1:
        file_paths = []
        for arg in sys.argv[1:]:
            matched = glob.glob(arg)
            if matched:
                file_paths.extend(matched)
            elif os.path.exists(arg):
                file_paths.append(arg)
        
        file_paths = sorted(list(dict.fromkeys(file_paths)))
        print(f"Processing {len(file_paths)} file(s)...")
        total_inserted = 0
        for fp in file_paths:
            with open(fp, 'r', encoding='utf-8') as f:
                data = json.load(f)
            cnt = insert_reviewed(data)
            total_inserted += cnt
            print(f"[{os.path.basename(fp)}] INSERTED: {cnt}")
        print(f"TOTAL_INSERTED_COUNT: {total_inserted}")
