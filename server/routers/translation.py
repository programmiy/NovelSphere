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
from urllib.parse import urlparse

from server.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Helper to get DB path from URL ---
def get_db_path():
    # sqlite:///C:\path\to\db.db -> C:\path\to\db.db
    # Assumes the path is absolute after the third slash
    parsed_url = urlparse(settings.database_url)
    # On Windows, urlparse might add an extra leading slash if the path starts with a drive letter.
    # e.g., sqlite:///C:/... becomes /C:/...
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

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
def _get_excluded_sentences_for_url(url: str) -> set:
    """Helper function to retrieve excluded sentences for a given URL."""
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT original FROM excluded_sentences WHERE url = ?", (url,))
    excluded_originals = {row[0] for row in cursor.fetchall()}
    conn.close()
    return excluded_originals

@retry(
    wait=wait_exponential(multiplier=1, min=80, max=420),
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

# --- API Endpoints ---
@router.post(
    "/translate",
    tags=["Translation"],
    summary="텍스트 번역",
    description="Gemini API를 호출하여 텍스트를 번역합니다. ID 기반 매칭과 재시도 로직으로 안정성을 높였습니다."
)
def translate_texts(req: TranslateRequest):
    
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

    if not settings.gemini_api_key or "YOUR_GEMINI_API_KEY_HERE" in settings.gemini_api_key:
        raise HTTPException(status_code=500, detail="Gemini API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.")

    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.gemini_api_key}"
    
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

    try:
        data = call_gemini_api_with_retry(api_url, prompt)

        feedback = data.get('promptFeedback')
        if feedback and feedback.get('blockReason'):
            logger.warning(f"배치 번역이 차단되었습니다 ({feedback.get('blockReason')}). 개별 항목 번역으로 전환합니다.")
            
            translated_map = {}
            for item in items_to_translate:
                try:
                    single_item_json = json.dumps([{"id": item.id, "text": item.text}], ensure_ascii=False)
                    individual_prompt = f"""You are a JSON-only translation API. You will receive a JSON array of objects, each with an 'id' and a 'text' field.
Your task is to translate the 'text' from Japanese to Korean.
Your response MUST be a single, valid JSON array of objects. Each object in your response must contain the original 'id' and the translated text in a 'translated' field.
Preserve the original quotation marks (like 「...」 and 『...』) in the translated text.
Do not add any other explanations, formatting, or markdown code fences.
Example response format: [{{"id": "p1", "translated": "번역된 텍스트"}}]

---START OF JSON DATA---\r\n{single_item_json}\r\n---END OF JSON DATA---

"""
                    individual_data = call_gemini_api_with_retry(api_url, individual_prompt)

                    individual_feedback = individual_data.get('promptFeedback')
                    if individual_feedback and individual_feedback.get('blockReason'):
                        reason = individual_feedback.get('blockReason')
                        logger.error(f"개별 항목 {item.id}이 차단되었습니다: {reason}")
                        translated_map[item.id] = f"번역 실패: {reason}"
                        continue

                    raw_text = None
                    if individual_data.get('candidates') and isinstance(individual_data['candidates'], list) and individual_data['candidates']:
                        candidate = individual_data['candidates'][0]
                        if candidate.get('content') and candidate['content'].get('parts') and isinstance(candidate['content']['parts'], list) and candidate['content']['parts']:
                            raw_text = candidate['content']['parts'][0].get('text')
                    
                    if not raw_text:
                        translated_map[item.id] = item.text
                        continue

                    clean_json_text = raw_text.strip()
                    if clean_json_text.startswith("```json"):
                        clean_json_text = clean_json_text[7:-3].strip()
                    elif clean_json_text.startswith("```"):
                        clean_json_text = clean_json_text[3:-3].strip()
                    
                    translated_data = json.loads(clean_json_text)
                    if translated_data and isinstance(translated_data, list) and 'translated' in translated_data[0]:
                        translated_map[item.id] = translated_data[0]['translated']
                    else:
                        translated_map[item.id] = item.text

                except Exception as e:
                    logger.error(f"개별 항목 {item.id} 번역 중 오류 발생: {e}")
                    translated_map[item.id] = f"번역 실패: {e}"

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
                    final_translations.append({
                        "id": item.id,
                        "original": item.text,
                        "translated": item.text
                    })

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
            translated_data = json.loads(clean_json_text)
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

@router.get(
    "/excluded_sentences",
    tags=["Translation"],
    summary="제외된 문장 조회",
    description="특정 URL에 대해 제외된 모든 원문 텍스트 목록을 반환합니다."
)
def get_excluded_sentences(url: str):
    excluded_originals = _get_excluded_sentences_for_url(url)
    return {"excluded_texts": list(excluded_originals)}

@router.post(
    "/translations/exclude",
    tags=["Translation"],
    summary="번역 기록 제외",
    description="지정된 ID의 번역 기록을 제외 목록에 추가하고 원본을 삭제합니다."
)
def exclude_translations(req: ExcludeRequest):
    conn = sqlite3.connect(get_db_path(), timeout=15)
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

@router.post(
    "/translations/find_replace",
    tags=["Translation"],
    summary="찾아 바꾸기",
    description="모든 번역 기록의 번역된 텍스트에 대해 찾아 바꾸기를 수행합니다."
)
def find_replace_all(req: FindReplaceRequest):
    conn = sqlite3.connect(get_db_path(), timeout=15)
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
        if req.case_sensitive:
            query_conditions.append("original LIKE ?")
            query_params.append(f"%{req.condition_text}%")
        else:
            query_conditions.append("lower(original) LIKE ?")
            query_params.append(f"%{req.condition_text.lower()}%")

    # 3. 찾아바꿀 텍스트가 포함된 항목만 대상으로 함
    if not req.use_regex:
        if req.case_sensitive:
            query_conditions.append("translated LIKE ?")
            query_params.append(f"%{req.find_text}%")
        else:
            query_conditions.append("lower(translated) LIKE ?")
            query_params.append(f"%{req.find_text.lower()}%")

    base_query = "SELECT id, translated FROM translations"
    if query_conditions:
        base_query += " WHERE " + " AND ".join(query_conditions)
    
    cursor.execute(base_query, tuple(query_params))
    records_to_update = cursor.fetchall()

    for record_id, old_translated_text in records_to_update:
        new_translated_text = old_translated_text
        if old_translated_text is None:
            continue

        if req.use_regex:
            flags = re.IGNORECASE if not req.case_sensitive else 0
            try:
                new_translated_text = re.sub(req.find_text, req.replace_text, old_translated_text, flags=flags)
            except re.error as e:
                conn.close()
                raise HTTPException(status_code=400, detail=f"유효하지 않은 정규식: {e}")
        else:
            flags = re.IGNORECASE if not req.case_sensitive else 0
            new_translated_text = re.sub(re.escape(req.find_text), req.replace_text, old_translated_text, flags=flags)

        if new_translated_text != old_translated_text:
            cursor.execute("UPDATE translations SET translated = ? WHERE id = ?", (new_translated_text, record_id))
            updated_count += 1
    
    conn.commit()
    conn.close()
    return {"message": f"{updated_count}개의 항목에서 내용을 교체했습니다."}

@router.put(
    "/translations/url_title",
    tags=["Translation"],
    summary="URL에 대한 제목 업데이트",
    description="주어진 URL을 가진 모든 항목의 제목을 업데이트합니다."
)
def update_title_for_url(req: UpdateTitleRequest):
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    cursor.execute("UPDATE translations SET title = ? WHERE url = ?", (req.title, req.url))
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"Title updated for {updated_count} entries for URL {req.url}."}