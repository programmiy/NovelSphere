import sqlite3
import json
import requests
import re
import os
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError

router = APIRouter()
logger = logging.getLogger(__name__)

# Constants - It's better to move these to a central config file later
script_dir = os.path.dirname(os.path.abspath(__file__))
DATABASE_FILE = os.path.join(script_dir, "..", "translations.db")
API_KEY_FILE = os.path.join(script_dir, "..", "api_key.txt")

# Pydantic Models
class TranslationItemInput(BaseModel):
    id: str
    text: str

class TranslateRequest(BaseModel):
    items: List[TranslationItemInput]
    url: str

# Helper functions
def get_api_key():
    """api_key.txt 파일에서 API 키를 읽어옵니다."""
    try:
        with open(API_KEY_FILE, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"{API_KEY_FILE} 파일을 찾을 수 없습니다. API 키를 파일에 저장해주세요.")

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
        conn = sqlite3.connect(DATABASE_FILE, timeout=15)
        cursor = conn.cursor()

        cursor.execute("SELECT original FROM excluded_sentences WHERE url = ?", (req.url,))
        excluded_originals = {row[0] for row in cursor.fetchall()}
        conn.close()

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
        
        start_index = raw_text.find('[')
        end_index = raw_text.rfind(']')
        
        if start_index != -1 and end_index != -1 and end_index > start_index:
            clean_json_text = raw_text[start_index:end_index+1]
        else:
            json_match = re.search(r'```(json)?(.*)```', raw_text, re.DOTALL)
            if json_match:
                clean_json_text = json_match.group(2).strip()
            else:
                clean_json_text = raw_text.strip()

        translated_map = {}
        object_strings = re.findall(r'\{[^\{\}]*\}', clean_json_text)

        for obj_str in object_strings:
            try:
                id_match = re.search(r'"id"\s*:\s*"(.*?)"', obj_str)
                if not id_match:
                    continue
                obj_id = id_match.group(1)

                trans_key_match = re.search(r'"translated"\s*:\s*"', obj_str)
                if not trans_key_match:
                    continue
                
                content_start_index = trans_key_match.end()
                content_end_index = obj_str.rfind('"', content_start_index)
                
                if content_end_index == -1:
                    continue

                translated_text = obj_str[content_start_index:content_end_index]
                translated_text = translated_text.replace('\\"', '"')

                translated_map[obj_id] = translated_text
            except Exception:
                continue

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