
import json
import requests
import re
import os
import logging
import datetime
import time
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.orm import Session # Add this import
from server.database import get_db # Add this import
from server.models import Translation, ExcludedSentence # Add these imports

from urllib.parse import urlparse
from win10toast_persist import ToastNotifier

from server.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Global State for 5 PM Stop Condition ---
process_started_before_5pm = False



# --- Pydantic Models ---
class TranslationItemInput(BaseModel):
    id: str
    text: str

class TranslateRequest(BaseModel):
    items: List[TranslationItemInput]
    url: str

class ExcludeRequest(BaseModel):
    ids: List[int]

class FindReplaceRequest(BaseModel):
    find_text: str
    replace_text: str
    condition_text: Optional[str] = None
    folder_scope: Optional[str] = None
    use_regex: Optional[bool] = False
    case_sensitive: Optional[bool] = False

class UpdateTitleRequest(BaseModel):
    url: str
    title: str

# --- Helper Functions ---
def _get_excluded_sentences_for_url(url: str, db: Session) -> set:
    """Helper function to retrieve excluded sentences for a given URL."""
    excluded_originals = {
        item.original
        for item in db.query(ExcludedSentence).filter(ExcludedSentence.url == url).all()
    }
    return excluded_originals

def call_gemini_api(api_url: str, prompt: str):
    """
    Calls the Gemini API without a retry mechanism.
    """
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ]
    }
    logger.info(f"Gemini API Payload (first 500 chars): {json.dumps(payload, ensure_ascii=False)[:500]}...")
    
    response = requests.post(api_url, json=payload, timeout=180)
    response.raise_for_status()
    return response.json()

def process_repeated_chars(text: str) -> str:
    """6번 이상 반복되는 문자를 '(반복)'으로 대체합니다."""
    if not text:
        return text
    return re.sub(r'(.)\1{5,}', '(반복)', text)

# --- API Endpoints ---
@router.post(
    "/translate",
    tags=["Translation"],
    summary="텍스트 번역",
    description="Gemini API를 호출하여 텍스트를 번역합니다. ID 기반 매칭과 재시도 로직으로 안정성을 높였습니다."
)
def translate_texts(req: TranslateRequest, db: Session = Depends(get_db)):
    global process_started_before_5pm
    now = datetime.datetime.now()

    # --- 5 PM Boundary-Crossing Logic ---
    # Reset the flag automatically on a new day (e.g., before the critical hour)
    if now.hour < 16:
        process_started_before_5pm = False

    # If a request is made before 5 PM, mark that a process is active.
    if now.hour < 17:
        process_started_before_5pm = True
    
    # THE STOP CONDITION:
    # If a process was active before 5 PM AND it's now 5 PM or later, stop it once.
    if process_started_before_5pm and now.hour >= 17:
        # Reset the flag immediately. This makes the stop "one-time" for the process,
        # allowing a new manual process to start after 5 PM.
        process_started_before_5pm = False 
        logger.critical("오후 5시가 되어, 5시 이전에 시작된 자동 번역 프로세스를 중지합니다.")
        raise HTTPException(status_code=503, detail="오후 5시가 되어 자동 번역을 중지합니다. 새로고침 후 다시 시도해주세요.")

    translatable_items = [item for item in req.items if item.id != 'tagCount']
    
    if translatable_items:
        excluded_originals = _get_excluded_sentences_for_url(req.url, db)
        items_to_translate = [item for item in translatable_items if item.text not in excluded_originals]
    else:
        items_to_translate = []

    if not items_to_translate:
        return {"translations": [
            {"id": item.id, "original": item.text, "translated": item.text} for item in req.items
        ]}

    if not settings.gemini_api_key or "YOUR_GEMINI_API_KEY_HERE" in settings.gemini_api_key:
        raise HTTPException(status_code=500, detail="Gemini API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.")

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={settings.gemini_api_key}"
    
    api_input_json = json.dumps([{"id": item.id, "text": item.text} for item in items_to_translate], ensure_ascii=False)
    logger.info(f"API Input JSON: {api_input_json}")

    prompt = f"""You are a JSON-only translation API. You will receive a JSON array of objects, each with an 'id' and a 'text' field.
Your task is to translate the 'text' from Japanese to Korean.
Your response MUST be a single, valid JSON array of objects. Each object in your response must contain the original 'id' and the translated text in a 'translated' field.
Preserve the original quotation marks (like 「...」 and 『...』) in the translated text.
Do not add any other explanations, formatting, or markdown code fences. Your entire output must be only the JSON data.
Example response format: [{{"id": "p1", "translated": "번역된 텍스트"}}]

---START OF JSON DATA---\r\n{api_input_json}\r\n---END OF JSON DATA---

"""
    logger.info(f"Gemini API URL: {api_url}")
    logger.info(f"Gemini API Prompt (first 500 chars): {prompt[:500]}...")

    # --- Manual Retry Logic ---
    data = None
    last_exception = None
    max_attempts = 5
    
    for attempt in range(max_attempts):
        try:
            data = call_gemini_api(api_url, prompt)
            break # Success, exit loop
        except requests.exceptions.HTTPError as e:
            last_exception = e
            if e.response.status_code == 503:
                logger.error("503 Overload 에러가 발생하여 재시도 없이 즉시 실패 처리합니다. (RPM 소모 방지)")
                try:
                    toaster = ToastNotifier()
                    toaster.show_toast(
                        "번역 API 과부하",
                        "API 과부하(503)로 요청이 실패했습니다. RPM 한도를 확인하거나 잠시 후 다시 시도하세요.",
                        duration=10,
                        threaded=True
                    )
                except Exception as toast_error:
                    logger.error(f"데스크톱 알림을 보내는 데 실패했습니다: {toast_error}")
                raise HTTPException(status_code=503, detail="API 과부하(503) 에러입니다. RPM 소모 방지를 위해 재시도하지 않습니다.")
            
            logger.warning(f"HTTP 오류 발생 (시도 {attempt + 1}/{max_attempts}): {e}")
            if e.response.status_code == 429:
                raise HTTPException(status_code=429, detail="API 요청 한도 초과. 잠시 후 다시 시도해주세요.")
        
        except requests.exceptions.RequestException as e:
            last_exception = e
            logger.error(f"Gemini API 연결 오류 (시도 {attempt + 1}/{max_attempts}): {e}")
            
        except Exception as e:
            last_exception = e
            logger.error(f"예상치 못한 오류 발생 (시도 {attempt + 1}/{max_attempts}): {e}")
            raise HTTPException(status_code=500, detail=f"API 호출 중 예상치 못한 오류 발생: {e}")

        # Wait before retrying for non-503 errors
        if attempt < max_attempts - 1:
            wait_time = 2 ** attempt
            logger.info(f"API 오류. {wait_time}초 후 재시도합니다...")
            time.sleep(wait_time)

    # All retries failed
    if data is None:
        if last_exception:
            raise HTTPException(status_code=500, detail=f"Gemini API 요청 최종 실패 (재시도 후): {last_exception}")
        else: # Should not be reachable
            raise HTTPException(status_code=500, detail="알 수 없는 오류로 API 호출에 실패했습니다.")

    # --- Process Response ---
    try:
        feedback = data.get('promptFeedback')
        if feedback and feedback.get('blockReason'):
            logger.warning(f"배치 번역이 차단되었습니다 ({feedback.get('blockReason')}). 120초 대기 후 2분할 번역을 시도합니다.")
            time.sleep(120)
            
            # Split items into two halves
            mid = len(items_to_translate) // 2
            halves = [items_to_translate[:mid], items_to_translate[mid:]]
            
            translated_map = {}
            fatal_failure = False
            failure_reason = ""

            for i, half in enumerate(halves):
                if not half: continue
                
                half_json = json.dumps([{"id": item.id, "text": item.text} for item in half], ensure_ascii=False)
                half_prompt = f"""You are a JSON-only translation API. You will receive a JSON array of objects, each with an 'id' and a 'text' field.
Your task is to translate the 'text' from Japanese to Korean.
Your response MUST be a single, valid JSON array of objects. Each object in your response must contain the original 'id' and the translated text in a 'translated' field.
Preserve the original quotation marks (like 「...」 and 『...』) in the translated text.
Do not add any other explanations, formatting, or markdown code fences.
Example response format: [{{"id": "p1", "translated": "번역된 텍스트"}}]

---START OF JSON DATA---\r\n{half_json}\r\n---END OF JSON DATA---
"""
                try:
                    # Using the non-retrying version for the sub-batch
                    half_data = call_gemini_api(api_url, half_prompt)
                    
                    # Check for safety filter in sub-batch
                    half_feedback = half_data.get('promptFeedback')
                    if half_feedback and half_feedback.get('blockReason'):
                        fatal_failure = True
                        failure_reason = f"분할 그룹 {i+1}에서도 검열 발생: {half_feedback.get('blockReason')}"
                        break
                    
                    # Parse sub-batch candidates
                    if not half_data.get('candidates') or not half_data['candidates']:
                        fatal_failure = True
                        failure_reason = f"분할 그룹 {i+1} 응답에 결과가 없습니다."
                        break
                        
                    candidate = half_data['candidates'][0]
                    if candidate.get('content') and candidate['content'].get('parts'):
                        raw_text = candidate['content']['parts'][0].get('text').strip()
                        if raw_text.startswith("```json"): raw_text = raw_text[7:-3].strip()
                        elif raw_text.startswith("```"): raw_text = raw_text[3:-3].strip()
                        
                        half_translated = json.loads(raw_text)
                        for t_item in half_translated:
                            translated_map[str(t_item['id'])] = t_item['translated']
                    else:
                        fatal_failure = True
                        failure_reason = f"분할 그룹 {i+1}의 내용이 비어있습니다."
                        break

                except Exception as e:
                    fatal_failure = True
                    failure_reason = f"분할 그룹 {i+1} 처리 중 오류: {str(e)}"
                    break
                
                time.sleep(2.0) # Gap between sub-batches

            if fatal_failure:
                logger.error(f"분할 번역 최종 실패: {failure_reason}. 모든 항목을 사용자 입력 대기로 전환합니다.")
                # We return a 429 to tell the extension to stop.
                # The detail will contain the "Manual Input Required" message for the user to see if possible.
                raise HTTPException(status_code=429, detail=f"번역 중단: {failure_reason}. 해당 구간은 사용자가 직접 입력해야 합니다.")

            # If all sub-batches succeeded, prepare the results
            translated_results = {}
            for item in items_to_translate:
                translated_text = translated_map.get(item.id, item.text)
                translated_text = process_repeated_chars(translated_text)
                translated_results[item.id] = {
                    "id": item.id,
                    "original": item.text,
                    "translated": translated_text
                }

            final_translations = []
            for item in req.items:
                if item.id in translated_results:
                    final_translations.append(translated_results[item.id])
                else:
                    final_translations.append({"id": item.id, "original": item.text, "translated": item.text})

            return {"translations": final_translations}

        raw_text = None
        if data.get('candidates') and isinstance(data['candidates'], list) and data['candidates']:
            candidate = data['candidates'][0]
            
            finish_reason = candidate.get('finishReason')
            if finish_reason and finish_reason != 'STOP':
                error_detail = f"API가 번역을 거부했습니다. 이유: {finish_reason}"
                raise HTTPException(status_code=500, detail=error_detail)

            if candidate.get('content') and candidate['content'].get('parts') and isinstance(candidate['content']['parts'], list) and candidate['content']['parts']:
                raw_text = candidate['content']['parts'][0].get('text')

        if raw_text is None:
            error_detail = f"API 응답에서 번역된 텍스트를 추출할 수 없습니다. 응답: {data}"
            raise HTTPException(status_code=500, detail=error_detail)
        
        clean_json_text = raw_text.strip()
        if clean_json_text.startswith("```json"):
            clean_json_text = clean_json_text[7:-3].strip()
        elif clean_json_text.startswith("```"):
            clean_json_text = clean_json_text[3:-3].strip()

        try:
            try:
                translated_data = json.loads(clean_json_text)
            except json.JSONDecodeError:
                # Try raw_decode to handle extra data at the end (e.g. "}]" artifact)
                translated_data, _ = json.JSONDecoder().raw_decode(clean_json_text)

            if not isinstance(translated_data, list):
                logger.warning(f"Expected a JSON array, but got {type(translated_data)}. Data: {clean_json_text}")
                if isinstance(translated_data, dict):
                    translated_data = [translated_data]
                else:
                    raise json.JSONDecodeError("Expected a JSON array.", clean_json_text, 0)
            
            translated_map = {
                str(item['id']): item['translated']
                for item in translated_data
                if 'id' in item and 'translated' in item
            }
        except json.JSONDecodeError as e:
            error_detail = f"API 응답의 JSON 파싱에 실패했습니다: {e}. 원본 응답: '{raw_text}'"
            logger.error(error_detail)
            raise HTTPException(status_code=500, detail=error_detail)

        translated_results = {}
        for item in items_to_translate:
            translated_text = translated_map.get(item.id)
            if translated_text is None:
                translated_text = item.text
            else:
                translated_text = process_repeated_chars(translated_text)
            translated_results[item.id] = {
                "id": item.id,
                "original": item.text,
                "translated": translated_text
            }

        final_translations = []
        for item in req.items:
            if item.id in translated_results:
                final_translations.append(translated_results[item.id])
            else:
                final_translations.append({
                    "id": item.id,
                    "original": item.text,
                    "translated": item.text
                })

        return {"translations": final_translations}
    
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        error_detail = f"API 응답 처리 오류: {e}. Original response: '{data.get('candidates', 'N/A') if 'data' in locals() else 'Response not available'}'"
        raise HTTPException(status_code=500, detail=error_detail)

@router.get(
    "/excluded_sentences",
    tags=["Translation"],
    summary="제외된 문장 조회",
    description="특정 URL에 대해 제외된 모든 원문 텍스트 목록을 반환합니다."
)
def get_excluded_sentences(url: str, db: Session = Depends(get_db)):
    excluded_originals = _get_excluded_sentences_for_url(url, db)
    return {"excluded_texts": list(excluded_originals)}

@router.post(
    "/translations/exclude",
    tags=["Translation"],
    summary="번역 기록 제외",
    description="지정된 ID의 번역 기록을 제외 목록에 추가하고 원본을 삭제합니다."
)
def exclude_translations(req: ExcludeRequest, db: Session = Depends(get_db)):
    excluded_count = 0
    for translation_id in req.ids:
        translation_to_exclude = db.query(Translation).filter(Translation.id == translation_id).first()
        if translation_to_exclude:
            # Add to excluded_sentences if not already there
            existing_excluded = db.query(ExcludedSentence).filter(
                ExcludedSentence.url == translation_to_exclude.url,
                ExcludedSentence.original == translation_to_exclude.original
            ).first()
            if not existing_excluded:
                new_excluded = ExcludedSentence(
                    url=translation_to_exclude.url,
                    original=translation_to_exclude.original
                )
                db.add(new_excluded)
            
            db.delete(translation_to_exclude)
            excluded_count += 1
    db.commit() # Commit once after the loop
    return {"message": f"{excluded_count}개의 항목이 제외 목록에 추가되었습니다."}

@router.post(
    "/translations/find_replace",
    tags=["Translation"],
    summary="찾아 바꾸기",
    description="모든 번역 기록의 번역된 텍스트에 대해 찾아 바꾸기를 수행합니다."
)
def find_replace_all(req: FindReplaceRequest, db: Session = Depends(get_db)):
    updated_count = 0

    query = db.query(Translation)

    # 1. 필터링 조건 설정
    if req.folder_scope and req.folder_scope != "__all__":
        if req.folder_scope == "폴더 추가 대기 상태":
            query = query.filter(Translation.folderName.is_(None))
        else:
            query = query.filter(Translation.folderName == req.folder_scope)
    
    # 2. 원문 조건 필터링
    if req.condition_text:
        if req.case_sensitive:
            query = query.filter(Translation.original.like(f"%{req.condition_text}%"))
        else:
            query = query.filter(Translation.original.ilike(f"%{req.condition_text}%"))

    # 3. 찾아바꿀 텍스트가 포함된 항목만 대상으로 함
    if not req.use_regex:
        if req.case_sensitive:
            query = query.filter(Translation.translated.like(f"%{req.find_text}%"))
        else:
            query = query.filter(Translation.translated.ilike(f"%{req.find_text}%"))

    records_to_update = query.all()

    for record in records_to_update:
        old_translated_text = record.translated
        new_translated_text = old_translated_text
        if old_translated_text is None:
            continue

        if req.use_regex:
            flags = re.IGNORECASE if not req.case_sensitive else 0
            try:
                new_translated_text = re.sub(req.find_text, req.replace_text, old_translated_text, flags=flags)
            except re.error as e:
                db.rollback() # Rollback in case of regex error
                raise HTTPException(status_code=400, detail=f"유효하지 않은 정규식: {e}")
        else:
            flags = re.IGNORECASE if not req.case_sensitive else 0
            new_translated_text = re.sub(re.escape(req.find_text), req.replace_text, old_translated_text, flags=flags)

        if new_translated_text != old_translated_text:
            record.translated = new_translated_text
            updated_count += 1
    
    db.commit()
    return {"message": f"{updated_count}개의 항목에서 내용을 교체했습니다."}

@router.put(
    "/translations/url_title",
    tags=["Translation"],
    summary="URL에 대한 제목 업데이트",
    description="주어진 URL을 가진 모든 항목의 제목을 업데이트합니다."
)
def update_title_for_url(req: UpdateTitleRequest, db: Session = Depends(get_db)):
    updated_count = db.query(Translation).filter(Translation.url == req.url).update(
        {Translation.title: req.title}, synchronize_session=False
    )
    db.commit()
    return {"message": f"Title updated for {updated_count} entries for URL {req.url}."}