import sqlite3
import json
import requests
import re
import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError

router = APIRouter()
logger = logging.getLogger(__name__)

from server.config import DATABASE_FILE
API_KEY_FILE = os.path.join(script_dir, "..", "api_key.txt")

# Pydantic Models
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

# Helper functions
def get_api_key():
    """api_key.txt 파일에서 API 키를 읽어옵니다."""
    try:
        with open(API_KEY_FILE, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"{API_KEY_FILE} 파일을 찾을 수 없습니다. API 키를 파일에 저장해주세요.")

def _get_excluded_sentences_for_url(url: str) -> set:
    """Helper function to retrieve excluded sentences for a given URL."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT original FROM excluded_sentences WHERE url = ?", (url,))
    excluded_originals = {row[0] for row in cursor.fetchall()}
    conn.close()
    return excluded_originals

@retry(
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(5),
    reraise=True
)
def call_gemini_api_with_retry(api_url: str, prompt: str):
    """
    Calls the Gemini API with a retry mechanism.
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
    try:
        response = requests.post(api_url, json=payload, timeout=180)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        logger.error(f"Gemini API HTTP error: {e.response.status_code} - {e.response.text}")
        raise
    except requests.exceptions.RequestException as e:
        logger.error(f"Gemini API request error: {e}")
        raise

def process_repeated_chars(text: str) -> str:
    """6번 이상 반복되는 문자를 '(반복)'으로 대체합니다."""
    if not text:
        return text
    return re.sub(r'(.)\1{5,}', '(반복)', text)

# API Endpoint
@router.post("/translate")
def translate_texts(req: TranslateRequest):
    """Gemini API를 호출하여 텍스트를 번역합니다. ID 기반 매칭과 재시도 로직으로 안정성을 높였습니다."""
    
    translatable_items = [item for item in req.items if item.id != 'tagCount']
    
    if translatable_items:
        excluded_originals = _get_excluded_sentences_for_url(req.url)
        items_to_translate = [item for item in translatable_items if item.text not in excluded_originals]
    else:
        items_to_translate = []

    if not items_to_translate:
        return {"translations": [
            {"id": item.id, "original": item.text, "translated": item.text} for item in req.items
        ]}

    api_key = get_api_key()
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    api_input_json = json.dumps([{"id": item.id, "text": item.text} for item in items_to_translate], ensure_ascii=False)
    logger.info(f"API Input JSON: {api_input_json}")

    prompt = f"""Translate the 'text' in the following JSON from Japanese to Korean. Your response must be a valid JSON array with the 'id' and the translated 'text' in a 'translated' field.\n\n{api_input_json}"""

    logger.info(f"Gemini API URL: {api_url}")
    logger.info(f"Gemini API Prompt (first 500 chars): {prompt[:500]}...")

    try:
        data = call_gemini_api_with_retry(api_url, prompt)

        feedback = data.get('promptFeedback')
        if feedback and feedback.get('blockReason'):
            error_detail = f"API가 콘텐츠를 차단했습니다. 이유: {feedback.get('blockReason')}"
            raise HTTPException(status_code=500, detail=error_detail)

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
        # Handle potential markdown code fences
        if clean_json_text.startswith("```json"):
            clean_json_text = clean_json_text[7:-3].strip()
        elif clean_json_text.startswith("```"):
            clean_json_text = clean_json_text[3:-3].strip()

        try:
            # The API is instructed to return a JSON array of objects
            translated_data = json.loads(clean_json_text)
            if not isinstance(translated_data, list):
                logger.warning(f"Expected a JSON array, but got {type(translated_data)}. Data: {clean_json_text}")
                # Attempt to handle if it's a single dictionary
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
    
    except RetryError as e:
        last_exception = e.last_attempt.exception()
        if isinstance(last_exception, requests.exceptions.HTTPError):
            if last_exception.response.status_code == 429:
                raise HTTPException(status_code=429, detail="API 요청 한도 초과. 잠시 후 다시 시도해주세요.")
        raise HTTPException(status_code=500, detail=f"Gemini API 요청 실패 (재시도 후): {last_exception}")

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Gemini API 연결 실패: {e}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        error_detail = f"API 응답 처리 오류: {e}. Original response: '{data.get('candidates', 'N/A') if 'data' in locals() else 'Response not available'}'"
        raise HTTPException(status_code=500, detail=error_detail)

@router.get("/excluded_sentences")
def get_excluded_sentences(url: str):
    """특정 URL에 대해 제외된 모든 원문 텍스트 목록을 반환합니다."""
    excluded_originals = _get_excluded_sentences_for_url(url)
    return {"excluded_texts": list(excluded_originals)}

@router.post("/translations/exclude")
def exclude_translations(req: ExcludeRequest):
    """지정된 ID의 번역 기록을 제외 목록에 추가하고 원본을 삭제합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    excluded_count = 0
    for translation_id in req.ids:
        cursor.execute("SELECT url, original FROM translations WHERE id = ?", (translation_id,))
        result = cursor.fetchone()
        if result:
            url, original = result
            cursor.execute("INSERT OR IGNORE INTO excluded_sentences (url, original) VALUES (?, ?)", (url, original))
            cursor.execute("DELETE FROM translations WHERE id = ?", (translation_id,))
            excluded_count += 1
    conn.commit()
    conn.close()
    return {"message": f"{excluded_count}개의 항목이 제외 목록에 추가되었습니다."}

@router.post("/translations/find_replace")
def find_replace_all(req: FindReplaceRequest):
    """모든 번역 기록의 번역된 텍스트에 대해 찾아 바꾸기를 수행합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    
    updated_count = 0

    # 1. 필터링 조건 설정
    query_conditions = []
    query_params = []

    if req.folder_scope and req.folder_scope != "__all__":
        if req.folder_scope == "폴더 추가 대기 상태":
            query_conditions.append("folderName IS NULL")
        else:
            query_conditions.append("folderName = ?")
            query_params.append(req.folder_scope)
    
    # 2. 원문 조건 필터링
    if req.condition_text:
        # 대소문자 구분 여부에 따라 쿼리 조정
        if req.case_sensitive:
            query_conditions.append("original LIKE ?")
            query_params.append(f"%{req.condition_text}%")
        else:
            query_conditions.append("lower(original) LIKE ?")
            query_params.append(f"%{req.condition_text.lower()}%")

    # 3. 찾아바꿀 텍스트가 포함된 항목만 대상으로 함
    if req.use_regex:
        # 정규식 사용 시, SQLite의 REGEXP 함수를 사용해야 하지만, 기본적으로 SQLite는 REGEXP를 지원하지 않음.
        # 따라서 모든 항목을 가져와 Python에서 처리해야 함.
        pass # 아래에서 모든 항목을 가져와 Python에서 처리할 것임
    else:
        # 정규식이 아닌 경우, SQLite의 LIKE와 REPLACE를 활용
        if req.case_sensitive:
            query_conditions.append("translated LIKE ?")
            query_params.append(f"%{req.find_text}%")
        else:
            query_conditions.append("lower(translated) LIKE ?")
            query_params.append(f"%{req.find_text.lower()}%")

    # 4. 최종 쿼리 구성
    base_query = "SELECT id, translated FROM translations"
    if query_conditions:
        base_query += " WHERE " + " AND ".join(query_conditions)
    
    cursor.execute(base_query, tuple(query_params))
    records_to_update = cursor.fetchall()

    # 5. Python에서 찾아바꾸기 로직 수행
    for record_id, old_translated_text in records_to_update:
        new_translated_text = old_translated_text
        if old_translated_text is None: # translated 필드가 NULL인 경우 처리
            continue

        if req.use_regex:
            flags = 0
            if not req.case_sensitive:
                flags |= re.IGNORECASE
            try:
                new_translated_text = re.sub(req.find_text, req.replace_text, old_translated_text, flags=flags)
            except re.error as e:
                conn.close()
                raise HTTPException(status_code=400, detail=f"유효하지 않은 정규식: {e}")
        else:
            # 대소문자 구분 여부에 따라 일반 문자열 replace
            if req.case_sensitive:
                new_translated_text = old_translated_text.replace(req.find_text, req.replace_text)
            else:
                # 대소문자 구분 없이 바꾸려면, 직접 구현해야 함 (Python의 replace는 대소문자 구분)
                # 여기서는 간단히 lower()로 비교 후, 원본에서 찾아서 바꾸는 방식으로 처리
                # 더 복잡한 로직이 필요하면 re.sub(re.escape(find_text), replace_text, text, re.IGNORECASE) 사용
                # 현재는 find_text가 translated에 포함되어 있다는 전제하에 진행
                if req.find_text.lower() in old_translated_text.lower():
                    # 이 부분은 정확한 대소문자 구분 없는 replace를 위해 re.sub를 사용하는 것이 더 안전함
                    flags = re.IGNORECASE if not req.case_sensitive else 0
                    new_translated_text = re.sub(re.escape(req.find_text), req.replace_text, old_translated_text, flags=flags)

        if new_translated_text != old_translated_text:
            cursor.execute("UPDATE translations SET translated = ? WHERE id = ?", (new_translated_text, record_id))
            updated_count += 1
    
    conn.commit()
    conn.close()
    return {"message": f"{updated_count}개의 항목에서 내용을 교체했습니다."}

@router.put("/translations/url_title")
def update_title_for_url(req: UpdateTitleRequest):
    """Updates the title for all entries with a given URL."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("UPDATE translations SET title = ? WHERE url = ?", (req.title, req.url))
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"Title updated for {updated_count} entries for URL {req.url}."}
