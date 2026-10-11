import time
import math
import asyncio
import json
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from server.database import get_db, get_sqlite_conn, SessionLocal
from server.models import Translation, AiReviewQueue
from server.settings import settings
from server.services.abnormal_service import get_abnormal_translations_data
from server.routers.translation import call_gemini_api
import re

router = APIRouter()

class ApproveRejectReq(BaseModel):
    queue_id: int
    feedback: Optional[str] = None
    translated_text: Optional[str] = None

class UndoReq(BaseModel):
    queue_id: int

def clean_ai_translation(text: Optional[str]) -> str:
    if not text:
        return ""
    cleaned = text.strip()
    
    # 0. 마크다운 코드블록 내부에 들어있는 경우 추출
    codeblock_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned, re.IGNORECASE)
    if codeblock_match:
        cleaned = codeblock_match.group(1).strip()
    else:
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:].strip()
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:].strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()
        
    # 1. Regex search for "translated", "translation", "text" key in JSON / dict format
    match = re.search(r"""(?:"|')(?:translated|translation|text)(?:"|')\s*:\s*(?:"|')((?:\\.|[^"'\\])*)(?:"|')""", cleaned, re.IGNORECASE)
    if match and match.group(1):
        raw_val = match.group(1)
        try:
            return json.loads(f'"{raw_val}"').strip()
        except Exception:
            return raw_val.replace(r'\n', '\n').replace(r'\"', '"').replace(r"\'", "'").replace(r'\\', '\\').strip()
            
    # 2. Try JSON parsing
    if (cleaned.startswith("[") and cleaned.endswith("]")) or (cleaned.startswith("{") and cleaned.endswith("}")):
        try:
            parsed = json.loads(cleaned)
            if isinstance(parsed, list) and len(parsed) > 0:
                first = parsed[0]
                if isinstance(first, str):
                    return first.strip()
                if isinstance(first, dict):
                    val = first.get("translated") or first.get("translation") or first.get("text")
                    if isinstance(val, str):
                        return val.strip()
            elif isinstance(parsed, dict):
                val = parsed.get("translated") or parsed.get("translation") or parsed.get("text")
                if isinstance(val, str):
                    return val.strip()
        except Exception:
            pass
            
    # 3. Fallback markdown strip
    if cleaned.startswith("```json"): cleaned = cleaned[7:].strip()
    elif cleaned.startswith("```"): cleaned = cleaned[3:].strip()
    if cleaned.endswith("```"): cleaned = cleaned[:-3].strip()
    
    return cleaned

def get_percentiles(lengths: List[int], percentiles: List[int]) -> Dict[str, int]:
    if not lengths:
        return {f"p{p}": 0 for p in percentiles}
    lengths.sort()
    n = len(lengths)
    res = {}
    for p in percentiles:
        idx = int(n * p / 100)
        res[f"p{p}"] = lengths[min(idx, n-1)]
    return res

@router.get("/ai_review", response_class=HTMLResponse)
async def ai_review_page(request: Request):
    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory=settings.templates_dir)
    return templates.TemplateResponse("ai_review.html", {"request": request})

@router.get("/ai_reretranslate", response_class=HTMLResponse)
async def ai_reretranslate_page(request: Request):
    from fastapi.templating import Jinja2Templates
    templates = Jinja2Templates(directory=settings.templates_dir)
    return templates.TemplateResponse("ai_reretranslate.html", {"request": request})

@router.get("/api/ai_review/stats")
async def get_ai_review_stats(folderName: Optional[str] = None, db: Session = Depends(get_db)):
    data = get_abnormal_translations_data(None, db)
    lengths = []
    
    for folder_name, groups in data.items():
        if folder_name.startswith('_'):
            continue
        if folderName and folder_name != folderName:
            continue
        for group in groups:
            for item in group.get('items', []):
                original = item.get('original', '')
                if original:
                    lengths.append(len(original))
                    
    total = len(lengths)
    if total == 0:
        return {"total": 0, "avg": 0, "min": 0, "max": 0, "percentiles": {}}
        
    query = db.query(AiReviewQueue)
    if folderName:
        query = query.join(Translation, AiReviewQueue.translation_id == Translation.id).filter(Translation.folderName == folderName)
        
    rejected_count = query.filter(AiReviewQueue.status == 'pending_reretranslate').count()
    
    avg = sum(lengths) / total
    return {
        "total": total,
        "avg": round(avg, 1),
        "min": min(lengths),
        "max": max(lengths),
        "percentiles": get_percentiles(lengths, [25, 50, 75]),
        "rejected_count": rejected_count
    }

async def process_initial_translation_bg(items_to_translate: list):
    db = SessionLocal()
    try:
        model = "gemini-3.1-flash-lite"
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.gemini_api_key}"
        
        # We will batch 20 items per API call to reduce RPM
        batch_size = 20
        
        # Filter items that are not already in queue
        valid_items = []
        for item in items_to_translate:
            exists = db.query(AiReviewQueue).filter(AiReviewQueue.translation_id == item['id']).first()
            if not exists:
                valid_items.append(item)
                
        for i in range(0, len(valid_items), batch_size):
            batch = valid_items[i:i+batch_size]
            
            originals = [item['original'] for item in batch]
            originals_json = json.dumps(originals, ensure_ascii=False)
            
            prompt = f"""다음 일본어 소설 문장들을 한국어로 번역해줘. 의역을 최소화하고 원문의 형태, 문체, 어조(뉘앙스)를 최대한 원형 그대로 살려서(직역에 가깝게) 번역해줘. 고유명사도 원문의 발음을 최대한 유지해야 해.
특히 원문에 작은 히라가나(ぁ, ぃ, ぅ, ぇ, ぉ, っ 등)가 쓰여 발음을 길게 늘이거나 강조하는 뉘앙스가 있다면, 한국어 번역에서도 모음을 연장해서(예: '말이야' -> '말이야아') 그 느낌을 정확히 반영해줘.
결과는 반드시 입력된 원문 배열과 동일한 길이의 JSON 배열(Array of strings) 형식으로만 출력해줘. 백틱이나 마크다운 없이 순수 JSON 배열만 출력해.

원문 목록:
{originals_json}
"""
            try:
                res = await asyncio.to_thread(call_gemini_api, api_url, prompt)
                new_texts = []
                
                if res and "candidates" in res and res["candidates"]:
                    parts = res["candidates"][0].get("content", {}).get("parts", [])
                    if parts:
                        raw_text = parts[0].get("text", "").strip()
                        if raw_text.startswith("```json"): raw_text = raw_text[7:]
                        elif raw_text.startswith("```"): raw_text = raw_text[3:]
                        if raw_text.endswith("```"): raw_text = raw_text[:-3]
                        
                        try:
                            new_texts = json.loads(raw_text.strip())
                        except json.JSONDecodeError:
                            print("Failed to parse JSON array from model output")
                            
                for idx, item in enumerate(batch):
                    trans_text = ""
                    if isinstance(new_texts, list) and idx < len(new_texts):
                        trans_text = new_texts[idx]
                        
                    if not trans_text:
                        trans_text = item['translated'] + " [AI 재번역 파싱 실패]"
                    else:
                        trans_text = clean_ai_translation(trans_text)
                        
                    now = int(time.time())
                    new_queue = AiReviewQueue(
                        translation_id=item['id'],
                        original_text=item['original'],
                        old_translated_text=clean_ai_translation(item['translated']),
                        ai_translated_text=trans_text.strip(),
                        status='pending_review',
                        model_used=model,
                        created_at=now,
                        updated_at=now
                    )
                    db.add(new_queue)
                    
                db.commit()
                await asyncio.sleep(2) # Delay between batches
            except Exception as e:
                print(f"Error in initial bg translation batch: {e}")
                
    finally:
        db.close()

@router.post("/api/ai_review/trigger_initial")
async def trigger_initial_retranslate(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    data = get_abnormal_translations_data(None, db)
    items_to_translate = []
    
    for folder_name, groups in data.items():
        if folder_name.startswith('_'): continue
        for group in groups:
            for item in group.get('items', []):
                items_to_translate.append(item)
                
    if not items_to_translate:
        return {"message": "발견된 이상번역이 없습니다."}
        
    background_tasks.add_task(process_initial_translation_bg, items_to_translate)
    return {"message": f"총 {len(items_to_translate)}건의 1차 일괄 번역이 묶음(배치) 단위로 시작되었습니다."}

@router.post("/api/ai_review/trigger_reretranslate")
async def trigger_manual_reretranslate(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    count = db.query(AiReviewQueue).filter(AiReviewQueue.status == 'pending_reretranslate').count()
    if count == 0:
        return {"message": "거절(재재번역 대기)된 항목이 없습니다."}
    
    background_tasks.add_task(process_batch_reretranslation_bg)
    return {"message": f"총 {count}건의 문장에 대해 통계 기반 다중 모델(3.0~3.8) 재재번역 작업이 백그라운드에서 시작되었습니다."}

@router.get("/api/ai_review/reretranslate/queue")
async def get_reretranslate_queue(folderName: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(AiReviewQueue, Translation).join(Translation, AiReviewQueue.translation_id == Translation.id).filter(AiReviewQueue.status == 'pending_reretranslate')
    if folderName:
        query = query.filter(Translation.folderName == folderName)
        
    results = query.all()
    
    # Collect all available folders
    all_pending = db.query(Translation.folderName).join(AiReviewQueue, Translation.id == AiReviewQueue.translation_id).filter(AiReviewQueue.status == 'pending_reretranslate').distinct().all()
    folders = [f[0] for f in all_pending if f[0]]

    if not results:
        return {"models": {}, "total": 0, "percentiles": {}, "folders": folders}
        
    lengths = [len(item.original_text) for item, _ in results if item.original_text]
    p = get_percentiles(lengths, [25, 50, 75])
    
    model_batches = {
        'gemini-3.0-flash': [],
        'gemini-3.6-flash': [],
        'gemini-3.7-flash': [],
        'gemini-3.8-flash': []
    }
    
    for item, base_trans in results:
        length = len(item.original_text) if item.original_text else 0
        if length <= p['p25']: model = 'gemini-3.0-flash'
        elif length <= p['p50']: model = 'gemini-3.6-flash'
        elif length <= p['p75']: model = 'gemini-3.7-flash'
        else: model = 'gemini-3.8-flash'
        
        folder = base_trans.folderName if base_trans else ""
        
        model_batches[model].append({
            "queue_id": item.id,
            "original_text": item.original_text,
            "old_translated_text": clean_ai_translation(item.old_translated_text) if item.old_translated_text else None,
            "ai_translated_text": clean_ai_translation(item.ai_translated_text) if item.ai_translated_text else None,
            "length": length,
            "folderName": folder
        })
        
    return {
        "models": model_batches,
        "total": len(results),
        "percentiles": p,
        "folders": folders,
        "avg_length": round(sum(lengths)/len(lengths), 1) if lengths else 0
    }

@router.delete("/api/ai_review/reretranslate/item/{queue_id}")
async def delete_reretranslate_item(queue_id: int, db: Session = Depends(get_db)):
    item = db.query(AiReviewQueue).filter(AiReviewQueue.id == queue_id).first()
    if not item:
        raise HTTPException(404, "항목을 찾을 수 없습니다.")
    db.delete(item)
    db.commit()
    return {"status": "success", "message": "재재번역 큐에서 항목이 제거되었습니다."}

class RunReretranslateReq(BaseModel):
    queue_ids: List[int]
    model: str

@router.post("/api/ai_review/reretranslate/run")
async def run_reretranslate_specific(req: RunReretranslateReq, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_specific_reretranslation_bg, req.queue_ids, req.model)
    return {"message": f"선택한 {len(req.queue_ids)}개 문장을 {req.model} 모델로 재재번역합니다."}

async def process_specific_reretranslation_bg(queue_ids: List[int], model: str):
    db = SessionLocal()
    try:
        items = db.query(AiReviewQueue).filter(AiReviewQueue.id.in_(queue_ids)).all()
        if not items: return
        
        batch_size = 20
        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.gemini_api_key}"
        
        for i in range(0, len(items), batch_size):
            batch = items[i:i+batch_size]
            originals = [item.original_text for item in batch]
            originals_json = json.dumps(originals, ensure_ascii=False)
            
            prompt = f"""다음 일본어 소설 문장들을 번역해줘. 이전 번역이 의역이 심하거나 원문의 맛을 살리지 못해 거절된 상태야. 원문의 구조, 어조, 세세한 뉘앙스 하나까지 훼손하지 말고 원문을 최대한 100% 살려서 정밀하고 충실하게 번역해야 해.
특히 작은 히라가나(ぁ, ぃ, ぅ, ぇ, ぉ, っ 등)로 발음을 늘이거나 억양을 강조한 표현이 있다면, 한국어 번역에서도 반드시 모음을 연장하여(예: '그렇구나' -> '그렇구나아') 원문 특유의 감각을 살려줘.
결과는 반드시 입력된 원문 배열과 동일한 길이의 JSON 배열(Array of strings) 형식으로만 출력해줘. 백틱이나 마크다운 없이 순수 JSON 배열만 출력해.

원문 목록:
{originals_json}
"""
            try:
                res = await asyncio.to_thread(call_gemini_api, api_url, prompt)
                new_texts = []
                if res and "candidates" in res and res["candidates"]:
                    parts = res["candidates"][0].get("content", {}).get("parts", [])
                    if parts:
                        raw_text = parts[0].get("text", "").strip()
                        if raw_text.startswith("```json"): raw_text = raw_text[7:]
                        elif raw_text.startswith("```"): raw_text = raw_text[3:]
                        if raw_text.endswith("```"): raw_text = raw_text[:-3]
                        try:
                            new_texts = json.loads(raw_text.strip())
                        except json.JSONDecodeError:
                            pass
                            
                for idx, item in enumerate(batch):
                    trans_text = ""
                    if isinstance(new_texts, list) and idx < len(new_texts):
                        trans_text = new_texts[idx]
                        
                    if trans_text:
                        item.ai_translated_text = clean_ai_translation(trans_text)
                        item.status = 'pending_review'
                        item.model_used = model
                        item.updated_at = int(time.time())
                        
                db.commit()
                await asyncio.sleep(2)
            except Exception as e:
                print(f"Error re-retranslating specific batch with {model}: {e}")
                
    finally:
        db.close()

async def process_batch_reretranslation_bg():
    db = SessionLocal()
    try:
        items = db.query(AiReviewQueue).filter(AiReviewQueue.status == 'pending_reretranslate').all()
        if not items:
            return
            
        # Group items by length category to send them to specific models in batches
        lengths = [len(item.original_text) for item in items if item.original_text]
        if not lengths: return
        p = get_percentiles(lengths, [25, 50, 75])
        
        # Group by model
        model_batches = {
            'gemini-3.0-flash': [],
            'gemini-3.6-flash': [],
            'gemini-3.7-flash': [],
            'gemini-3.8-flash': []
        }
        
        for item in items:
            length = len(item.original_text)
            if length <= p['p25']: model = 'gemini-3.0-flash'
            elif length <= p['p50']: model = 'gemini-3.6-flash'
            elif length <= p['p75']: model = 'gemini-3.7-flash'
            else: model = 'gemini-3.8-flash'
            model_batches[model].append(item)
            
        for model, batch_items in model_batches.items():
            if not batch_items: continue
            
            # Batch size for re-retranslation
            batch_size = 20
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.gemini_api_key}"
            
            for i in range(0, len(batch_items), batch_size):
                batch = batch_items[i:i+batch_size]
                originals = [item.original_text for item in batch]
                originals_json = json.dumps(originals, ensure_ascii=False)
                
                prompt = f"""다음 일본어 문장들을 번역해줘. 이전 번역이 의역이 심하거나 원문의 맛을 살리지 못해 거절된 상태야. 원문의 구조, 어조, 세세한 뉘앙스 하나까지 훼손하지 말고 원문을 최대한 100% 살려서 정밀하고 충실하게 번역해야 해.
특히 작은 히라가나(ぁ, ぃ, ぅ, ぇ, ぉ, っ 등)로 발음을 늘이거나 억양을 강조한 표현이 있다면, 한국어 번역에서도 반드시 모음을 연장하여(예: '그렇구나' -> '그렇구나아') 원문 특유의 감각을 살려줘.
결과는 반드시 입력된 원문 배열과 동일한 길이의 JSON 배열(Array of strings) 형식으로만 출력해줘. 백틱이나 마크다운 없이 순수 JSON 배열만 출력해.

원문 목록:
{originals_json}
"""
                try:
                    res = await asyncio.to_thread(call_gemini_api, api_url, prompt)
                    new_texts = []
                    
                    if res and "candidates" in res and res["candidates"]:
                        parts = res["candidates"][0].get("content", {}).get("parts", [])
                        if parts:
                            raw_text = parts[0].get("text", "").strip()
                            if raw_text.startswith("```json"): raw_text = raw_text[7:]
                            elif raw_text.startswith("```"): raw_text = raw_text[3:]
                            if raw_text.endswith("```"): raw_text = raw_text[:-3]
                            try:
                                new_texts = json.loads(raw_text.strip())
                            except json.JSONDecodeError:
                                print("Failed to parse JSON array in re-retranslation")
                                
                    for idx, item in enumerate(batch):
                        trans_text = ""
                        if isinstance(new_texts, list) and idx < len(new_texts):
                            trans_text = new_texts[idx]
                            
                        if trans_text:
                            item.ai_translated_text = clean_ai_translation(trans_text)
                            item.status = 'pending_review'
                            item.model_used = model
                            item.updated_at = int(time.time())
                            
                    db.commit()
                    await asyncio.sleep(2)
                except Exception as e:
                    print(f"Error re-retranslating batch with {model}: {e}")
                    
    finally:
        db.close()

@router.get("/api/ai_review/folders")
async def get_review_folders(db: Session = Depends(get_db)):
    folders = db.query(Translation.folderName).join(AiReviewQueue, Translation.id == AiReviewQueue.translation_id).filter(AiReviewQueue.status == 'pending_review').distinct().all()
    return {"folders": [f[0] for f in folders if f[0]]}

@router.get("/api/ai_review/queue")
async def get_review_queue(folderName: Optional[str] = None, db: Session = Depends(get_db)):
    from sqlalchemy import case
    query = db.query(AiReviewQueue, Translation).join(Translation, AiReviewQueue.translation_id == Translation.id).filter(AiReviewQueue.status == 'pending_review')
    if folderName:
        query = query.filter(Translation.folderName == folderName)
        
    # Prioritize re-retranslated items (not 3.1-flash-lite) by updated_at descending
    priority = case((AiReviewQueue.model_used != 'gemini-3.1-flash-lite', 0), else_=1)
    query = query.order_by(priority, AiReviewQueue.updated_at.desc(), AiReviewQueue.id.asc())
        
    items = query.all()
    res = []
    for queue_item, base_trans in items:
        context_before = []
        context_after = []
        folder = ""
        url = ""
        if base_trans:
            folder = base_trans.folderName
            url = base_trans.url
            def format_ctx(c):
                return {
                    "id": c.id,
                    "original": c.original,
                    "translated": c.translated,
                    "url": c.url,
                    "pid": c.pid,
                    "folderName": c.folderName,
                    "title": c.title
                }

            # Fetch context (before/after) with intelligent fallback
            # 1. Primary: Same URL (episode-level context)
            if url:
                if base_trans.toc_sort_order is not None:
                    ctx_b = db.query(Translation).filter(Translation.url == url, Translation.toc_sort_order < base_trans.toc_sort_order).order_by(Translation.toc_sort_order.desc()).limit(3).all()
                    context_before = [format_ctx(c) for c in reversed(ctx_b)]
                    
                    ctx_a = db.query(Translation).filter(Translation.url == url, Translation.toc_sort_order > base_trans.toc_sort_order).order_by(Translation.toc_sort_order.asc()).limit(3).all()
                    context_after = [format_ctx(c) for c in ctx_a]
                else:
                    ctx_b = db.query(Translation).filter(Translation.url == url, Translation.id < base_trans.id).order_by(Translation.id.desc()).limit(3).all()
                    context_before = [format_ctx(c) for c in reversed(ctx_b)]
                    
                    ctx_a = db.query(Translation).filter(Translation.url == url, Translation.id > base_trans.id).order_by(Translation.id.asc()).limit(3).all()
                    context_after = [format_ctx(c) for c in ctx_a]

            # 2. Secondary fallback: Same Folder if URL returned no context
            if not context_before and not context_after and folder:
                ctx_b = db.query(Translation).filter(Translation.folderName == folder, Translation.id < base_trans.id).order_by(Translation.id.desc()).limit(3).all()
                context_before = [format_ctx(c) for c in reversed(ctx_b)]
                
                ctx_a = db.query(Translation).filter(Translation.folderName == folder, Translation.id > base_trans.id).order_by(Translation.id.asc()).limit(3).all()
                context_after = [format_ctx(c) for c in ctx_a]
                
        res.append({
            "queue_id": queue_item.id,
            "translation_id": queue_item.translation_id,
            "original_text": queue_item.original_text,
            "old_translated_text": clean_ai_translation(queue_item.old_translated_text) if queue_item.old_translated_text else None,
            "ai_translated_text": clean_ai_translation(queue_item.ai_translated_text),
            "model_used": queue_item.model_used,
            "is_reretranslated": queue_item.model_used != "gemini-3.1-flash-lite",
            "folderName": folder,
            "url": url,
            "context_before": context_before,
            "context_after": context_after
        })
    return {"items": res}

@router.get("/api/ai_review/reroll")
async def reroll_translation(queue_id: int, db: Session = Depends(get_db)):
    item = db.query(AiReviewQueue).filter(AiReviewQueue.id == queue_id).first()
    if not item:
        return {"message": "항목을 찾을 수 없습니다."}
        
    model = "gemini-3.8-flash"
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={settings.gemini_api_key}"
    
    prompt = f"""다음 일본어 원문을 한국어로 번역해줘. 이전 번역들이 전부 마음에 들지 않아 거절된 상태야.
의역을 배제하고 원문의 구조, 어조, 뉘앙스를 최대한 100% 직역에 가깝게 살려서 정밀하게 번역해야 해.
특히 작은 히라가나(ぁ, ぃ, ぅ, ぇ, ぉ, っ 등)로 발음을 늘이거나 억양을 강조한 표현이 있다면, 한국어 번역에서도 반드시 모음을 연장하여(예: '말이야아') 그 느낌을 200% 살려줘.

원문:
{item.original_text}

결과는 다른 설명이나 마크다운 없이 순수하게 번역된 한국어 문자열 한 줄만 출력해."""
    
    try:
        res = await asyncio.to_thread(call_gemini_api, api_url, prompt)
        if res and "candidates" in res and res["candidates"]:
            parts = res["candidates"][0].get("content", {}).get("parts", [])
            if parts:
                raw_text = parts[0].get("text", "").strip()
                cleaned_text = clean_ai_translation(raw_text)
                item.ai_translated_text = cleaned_text
                item.model_used = model
                db.commit()
                return {"translated_text": cleaned_text}
                
        return {"message": "Gemini API 응답 파싱 실패"}
    except Exception as e:
        return {"message": f"재번역 실패: {str(e)}"}

@router.post("/api/ai_review/approve")
async def approve_review(req: ApproveRejectReq, db: Session = Depends(get_db)):
    item = db.query(AiReviewQueue).filter(AiReviewQueue.id == req.queue_id).first()
    if not item: raise HTTPException(404)
    
    trans = db.query(Translation).filter(Translation.id == item.translation_id).first()
    if trans:
        item.old_translated_text = trans.translated
        final_text = req.translated_text if req.translated_text else item.ai_translated_text
        trans.translated = final_text
        trans.timestamp = int(time.time())
        item.status = 'approved'
        item.updated_at = int(time.time())
        db.commit()
    return {"status": "success"}

@router.post("/api/ai_review/reject")
async def reject_review(req: ApproveRejectReq, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    item = db.query(AiReviewQueue).filter(AiReviewQueue.id == req.queue_id).first()
    if not item: raise HTTPException(404)
    
    item.status = 'pending_reretranslate'
    item.updated_at = int(time.time())
    db.commit()
    
    count = db.query(AiReviewQueue).filter(AiReviewQueue.status == 'pending_reretranslate').count()
    if count >= 10: 
        background_tasks.add_task(process_batch_reretranslation_bg)
        
    return {"status": "success", "queued_for_reretranslate": count}

@router.post("/api/ai_review/undo")
async def undo_review(req: UndoReq, db: Session = Depends(get_db)):
    item = db.query(AiReviewQueue).filter(AiReviewQueue.id == req.queue_id).first()
    if not item: raise HTTPException(404)
    
    if item.status == 'approved':
        trans = db.query(Translation).filter(Translation.id == item.translation_id).first()
        if trans and item.old_translated_text is not None:
            trans.translated = item.old_translated_text
            db.commit()
            
    item.status = 'pending_review'
    item.updated_at = int(time.time())
    db.commit()
    return {"status": "success"}


class ContextQuickEditReq(BaseModel):
    translation_id: int
    translated_text: str

@router.post("/api/ai_review/context/quick_edit")
async def quick_edit_context(req: ContextQuickEditReq, db: Session = Depends(get_db)):
    trans = db.query(Translation).filter(Translation.id == req.translation_id).first()
    if not trans:
        raise HTTPException(404, "문장을 찾을 수 없습니다.")
    trans.translated = req.translated_text
    trans.timestamp = int(time.time())
    db.commit()
    return {"status": "success", "message": "문맥 번역이 성공적으로 수정되었습니다."}
