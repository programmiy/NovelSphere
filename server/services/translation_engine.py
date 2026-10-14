import json
import logging
import re
from typing import Optional, List, Any
import requests
from pydantic import BaseModel

from server.settings import settings

from server.quota import record_api_call
from server.services.rpm_manager import (
    proactive_rpm_rest,
    _record_call_timestamp,
    recycle_gemini_session,
    get_gemini_session,
)

logger = logging.getLogger(__name__)

TRANSLATION_SYSTEM_INSTRUCTION = {
    "parts": [{
        "text": (
            "You are a professional Japanese-to-Korean light novel translation engine.\n\n"
            "CRITICAL RULES & NEGATIVE CONSTRAINTS:\n"
            "1. STRICT TRANSLATION ONLY (NO ECHOING / DO NOT RETURN ORIGINAL):\n"
            "   - Under NO circumstances should you output or echo the original Japanese text into the 'translated' field.\n"
            "   - Every Japanese sentence MUST be completely and naturally translated into fluent Korean.\n"
            "2. STRICT ITEM INDEPENDENCE (NO CROSS-CONTAMINATION & NO REPETITION LOOP):\n"
            "   - Each 'translated' field MUST correspond strictly and uniquely to its own 'text' field by 'id'.\n"
            "   - NEVER copy, carry over, or duplicate text/translations from preceding items or other items.\n"
            "   - If different items have different Japanese text, their Korean translations MUST also be distinct.\n"
            "3. ZERO KANA LEAKAGE (NO RESIDUAL KANA):\n"
            "   - Ensure NO Japanese Hiragana or Katakana remains untranslated in the Korean text.\n"
            "   - Common colloquial expressions must be translated into natural Korean:\n"
            "     * というか -> '그보다', '아니', '라기보다는'\n"
            "     * こんどこそ / 今度こそ -> '이번에야말로', '이번만큼은'\n"
            "     * やっぱり / やはり -> '역시', '아무래도'\n"
            "     * さすがに -> '아무리 그래도', '역시나'\n"
            "     * まぁ / まあ -> '뭐', '글쎄'\n"
            "     * ……っ -> '……!', '……읏', '……'\n"
            "4. STYLE & PUNCTUATION:\n"
            "   - Preserve original quotation marks (「...」, 『...』) and punctuation marks (……, 〜, !?).\n"
            "   - Maintain light novel storytelling tone (natural Korean web novel dialogue and narration).\n"
            "5. OUTPUT FORMAT:\n"
            "   - Return ONLY a valid JSON array matching the schema, with each item containing 'id' and 'translated'.\n"
            "   - Do not add explanations, notes, or markdown formatting."
        )
    }]
}

TRANSLATION_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "id": {"type": "STRING"},
            "translated": {"type": "STRING"}
        },
        "required": ["id", "translated"]
    }
}


class TranslationItemInput(BaseModel):
    id: str
    text: str


def call_gemini_api(api_url: str, prompt: str, api_key: Optional[str] = None, system_instruction: Optional[dict] = None, timeout: int = 180):
    """
    Calls the Gemini API using requests.Session with header authentication,
    low temperature (0.3), systemInstruction separation, and response_schema.
    Ensures fresh session state by clearing cookies before request.
    Applies adaptive proactive RPM breathing and session rejuvenation before execution.
    """
    session = get_gemini_session()

    # 선제적 적응형 RPM 휴식 및 세션 소켓 재생성
    proactive_rpm_rest()

    # 매 요청마다 세션 쿠키/상태를 리셋하여 이전 요청의 컨텍스트 간섭 방지
    try:
        session.cookies.clear()
    except Exception:
        pass

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": system_instruction or TRANSLATION_SYSTEM_INSTRUCTION,
        "generationConfig": {
            "temperature": 0.3,
            "response_mime_type": "application/json",
            "response_schema": TRANSLATION_RESPONSE_SCHEMA,
        },
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ]
    }
    logger.debug(f"Gemini API Payload (first 500 chars): {json.dumps(payload, ensure_ascii=False)[:500]}...")

    headers = {"Content-Type": "application/json"}
    key = api_key or getattr(settings, "gemini_api_key", None)
    if key and "key=" not in api_url:
        headers["x-goog-api-key"] = key

    model_name = "gemini"
    if "/models/" in api_url:
        try:
            model_name = api_url.split("/models/")[1].split(":")[0]
        except Exception:
            pass

    # 실제 요청 발송 직전 슬라이딩 윈도우에 타임스탬프 기록
    _record_call_timestamp()

    try:
        response = session.post(api_url, json=payload, headers=headers, timeout=timeout)
        record_api_call(model=model_name, status_code=response.status_code)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        status_code = getattr(getattr(e, 'response', None), 'status_code', 500)
        record_api_call(model=model_name, status_code=status_code)
        if status_code in (429, 503):
            recycle_gemini_session()
        raise


def process_repeated_chars(text: str) -> str:
    """6번 이상 반복되는 문자를 '(반복)'으로 대체합니다."""
    if not text:
        return text
    return re.sub(r'(.)\1{5,}', '(반복)', text)


def parse_translation_response(raw_text: str) -> dict:
    """
    Gemini API 등 LLM 응답에서 번역된 JSON 데이터를 안전하게 파싱하여 {id: translated_text} 딕셔너리로 반환합니다.
    - 제어 문자(줄바꿈 \n, 탭 \t 등) 허용 (strict=False)
    - 마크다운 코드 블록 (```json ... ```) 제거
    - 텍스트 앞뒤 찌꺼기 및 추가 문자열(raw_decode 및 대괄호/중괄호 슬라이싱) 처리
    - 후행 쉼표(trailing comma), 잘못된 이스케이프(\ ) 등 문법 오류 복구
    - 잘린 JSON에 대한 정규식 기반 폴백 복구
    """
    if not raw_text or not raw_text.strip():
        raise ValueError("번역 응답 내용이 비어있습니다.")

    def _extract_map(data) -> dict:
        if isinstance(data, list):
            res = {}
            for item in data:
                if isinstance(item, dict):
                    item_id = item.get('id')
                    if item_id is None:
                        continue
                    item_id = str(item_id)

                    trans = None
                    for candidate_key in ('translated', 'translation', 'text', 'translated_text', 'korean', 'ko', 'result', 'output', 'content'):
                        if candidate_key in item and item[candidate_key] is not None:
                            trans = str(item[candidate_key])
                            break
                    if trans is None:
                        other_keys = [k for k in item.keys() if k != 'id']
                        if len(other_keys) == 1 and item[other_keys[0]] is not None:
                            trans = str(item[other_keys[0]])

                    if trans is not None:
                        res[item_id] = trans
            if res:
                return res
        elif isinstance(data, dict):
            for key in ("translations", "items", "data", "results", "sentences", "response"):
                if key in data and isinstance(data[key], (list, dict)):
                    res = _extract_map(data[key])
                    if res:
                        return res
            if 'id' in data:
                item_id = str(data['id'])
                trans = None
                for candidate_key in ('translated', 'translation', 'text', 'translated_text', 'korean', 'ko', 'result'):
                    if candidate_key in data and data[candidate_key] is not None:
                        trans = str(data[candidate_key])
                        break
                if trans is None:
                    other_keys = [k for k in data.keys() if k != 'id']
                    if len(other_keys) == 1 and data[other_keys[0]] is not None:
                        trans = str(data[other_keys[0]])
                if trans is not None:
                    return {item_id: trans}
            if data and all(isinstance(k, str) for k in data.keys()):
                return {str(k): str(v) for k, v in data.items() if v is not None}
        return {}

    text = raw_text.strip()

    # 1. 마크다운 코드 블록 제거
    if "```" in text:
        fence_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text, flags=re.IGNORECASE)
        if fence_match:
            text = fence_match.group(1).strip()
        else:
            text = re.sub(r'^\s*```(?:json)?\s*', '', text, flags=re.IGNORECASE)
            text = re.sub(r'\s*```\s*$', '', text).strip()

    # 2. 1차 시도: json.loads (strict=False로 줄바꿈/제어 문자 허용)
    try:
        data = json.loads(text, strict=False)
        m = _extract_map(data)
        if m:
            return m
    except Exception:
        pass

    # 3. 2차 시도: raw_decode (strict=False로 뒤쪽 찌꺼기 e.g. "}]" 허용)
    try:
        decoder = json.JSONDecoder(strict=False)
        data, _ = decoder.raw_decode(text)
        m = _extract_map(data)
        if m:
            return m
    except Exception:
        pass

    # 4. 3차 시도: 텍스트 내에서 JSON 배열[...] 또는 객체{...} 영역만 추출 후 파싱
    s_arr = text.find('[')
    if s_arr != -1:
        e_arr = text.rfind(']')
        if e_arr != -1 and s_arr < e_arr:
            sub = text[s_arr:e_arr + 1]
            try:
                data = json.loads(sub, strict=False)
                m = _extract_map(data)
                if m:
                    return m
            except Exception:
                pass
            try:
                decoder = json.JSONDecoder(strict=False)
                data, _ = decoder.raw_decode(sub)
                m = _extract_map(data)
                if m:
                    return m
            except Exception:
                pass
        else:
            # 잘린 배열 복구: 마지막 '}'를 찾아 뒤에 ']' 닫기
            last_brace = text.rfind('}')
            if last_brace != -1 and s_arr < last_brace:
                sub = text[s_arr:last_brace + 1] + ']'
                try:
                    data = json.loads(sub, strict=False)
                    m = _extract_map(data)
                    if m:
                        return m
                except Exception:
                    pass
                try:
                    decoder = json.JSONDecoder(strict=False)
                    data, _ = decoder.raw_decode(sub)
                    m = _extract_map(data)
                    if m:
                        return m
                except Exception:
                    pass

    # 객체인 경우 (배열이 아니거나 객체가 먼저 나오는 경우)
    s_obj = text.find('{')
    e_obj = text.rfind('}')
    if s_obj != -1 and e_obj != -1 and s_obj < e_obj:
        if s_arr == -1 or s_obj < s_arr:
            sub = text[s_obj:e_obj + 1]
            try:
                data = json.loads(sub, strict=False)
                m = _extract_map(data)
                if m:
                    return m
            except Exception:
                pass
            try:
                decoder = json.JSONDecoder(strict=False)
                data, _ = decoder.raw_decode(sub)
                m = _extract_map(data)
                if m:
                    return m
            except Exception:
                pass

    # 5. 4차 시도: 흔한 JSON 문법 에러 복구 (Trailing commas, 유효하지 않은 이스케이프)
    repaired = text
    # 후행 쉼표 제거 (e.g. [1, 2, ] -> [1, 2])
    repaired = re.sub(r',\s*([\]}])', r'\1', repaired)
    # 유효하지 않은 백슬래시 이스케이프 복구 (JSON 표준: ", \, /, b, f, n, r, t, uXXXX 외는 \\로 치환)
    repaired = re.sub(r'\\(?![/u"\\bfnrt]|u[0-9a-fA-F]{4})', r'\\\\', repaired)

    try:
        data = json.loads(repaired, strict=False)
        m = _extract_map(data)
        if m:
            return m
    except Exception:
        pass

    try:
        decoder = json.JSONDecoder(strict=False)
        data, _ = decoder.raw_decode(repaired)
        m = _extract_map(data)
        if m:
            return m
    except Exception:
        pass

    # 6. 5차 시도: 정규식 기반 개별 객체 폴백 추출 (잘린 JSON이나 부분 손상된 응답 복구)
    fallback_map = {}
    item_pattern = re.compile(
        r'\{\s*"id"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|([0-9a-zA-Z_\-]+))\s*,\s*"(?:translated|translation|text|translated_text|korean|result)"\s*:\s*"((?:[^"\\]|\\.)*)"',
        re.DOTALL | re.IGNORECASE
    )
    for match in item_pattern.finditer(text):
        item_id = match.group(1) if match.group(1) is not None else match.group(2)
        trans_raw = match.group(3)
        try:
            trans_val = json.loads(f'"{trans_raw}"', strict=False)
        except Exception:
            trans_val = trans_raw.replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n')
        if item_id:
            fallback_map[str(item_id)] = trans_val

    item_pattern_rev = re.compile(
        r'\{\s*"(?:translated|translation|text|translated_text|korean|result)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"id"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|([0-9a-zA-Z_\-]+))',
        re.DOTALL | re.IGNORECASE
    )
    for match in item_pattern_rev.finditer(text):
        trans_raw = match.group(1)
        item_id = match.group(2) if match.group(2) is not None else match.group(3)
        try:
            trans_val = json.loads(f'"{trans_raw}"', strict=False)
        except Exception:
            trans_val = trans_raw.replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n')
        if item_id and str(item_id) not in fallback_map:
            fallback_map[str(item_id)] = trans_val

    # 6-2. 텍스트 라인 형태: "p1": "번역문" 또는 p1: 번역문 폴백
    if not fallback_map:
        line_pattern = re.compile(
            r'(?:^|\n)\s*["\']?([0-9a-zA-Z_\-]+)["\']?\s*:\s*["\']?(.*?)["\']?(?=\n\s*["\']?[0-9a-zA-Z_\-]+["\']?\s*:|\s*$)',
            re.DOTALL
        )
        for match in line_pattern.finditer(text):
            item_id = match.group(1)
            trans_raw = match.group(2).strip().strip('"').strip("'")
            if item_id and trans_raw and item_id.lower() not in ("id", "translation", "translated", "text"):
                fallback_map[str(item_id)] = trans_raw

    if fallback_map:
        logger.warning(f"정규식 폴백으로 {len(fallback_map)}개의 번역 항목을 복구했습니다.")
        return fallback_map

    raise json.JSONDecodeError("JSON 파싱 및 복구에 모두 실패했습니다.", text, 0)


def _build_translation_prompt(items: List[Any]) -> str:
    """번역 대상 JSON 데이터를 생성합니다. 프롬프트 내 명시적 지침 및 이전 컨텍스트 격리를 지시합니다."""
    api_input_json = json.dumps([{"id": getattr(item, 'id', item.get('id') if isinstance(item, dict) else str(item)), "text": getattr(item, 'text', item.get('text') if isinstance(item, dict) else '')} for item in items], ensure_ascii=False)
    return (
        "Translate the following JSON array from Japanese to Korean.\n"
        "MANDATORY REQUIREMENTS:\n"
        "1. Translate each item independently and uniquely based only on its own text.\n"
        "2. Do NOT echo or copy the original Japanese text into 'translated'.\n"
        "3. Do NOT repeat or carry over translations or text from preceding items.\n"
        "4. Return ONLY a valid JSON array of objects with 'id' and 'translated':\n\n"
        f"{api_input_json}"
    )


def is_safety_blocked(data: dict) -> (bool, str):
    """Gemini API 응답에서 안전 필터/검열 차단 여부를 감지합니다 (소프트 거절 텍스트 포함)."""
    if not data:
        return False, ""
    feedback = data.get('promptFeedback')
    if feedback and feedback.get('blockReason'):
        return True, str(feedback.get('blockReason'))

    if data.get('candidates') and isinstance(data['candidates'], list) and data['candidates']:
        candidate = data['candidates'][0]
        finish_reason = candidate.get('finishReason')
        if finish_reason in ('SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'):
            return True, str(finish_reason)

        # 소프트 거절(Soft Refusal) 감지: finishReason은 STOP이지만 본문에 거절 문구가 담긴 경우
        if candidate.get('content') and candidate['content'].get('parts'):
            parts = candidate['content']['parts']
            if isinstance(parts, list) and parts:
                text = parts[0].get('text', '')
                lower_text = text.lower()
                refusal_keywords = [
                    "cannot fulfill this request",
                    "unable to fulfill",
                    "unable to translate",
                    "cannot translate this",
                    "against safety guidelines",
                    "against our safety",
                    "safety policies",
                    "violates our",
                    "sexually explicit",
                    "nsfw",
                    "申し訳ありません",
                    "お受けできません",
                    "翻訳はお受け",
                    "성인 콘텐츠",
                    "번역할 수 없습니다"
                ]
                for kw in refusal_keywords:
                    if kw in lower_text:
                        clean_check = text.strip()
                        if not (clean_check.startswith('[') or clean_check.startswith('{')):
                            return True, f"SOFT_REFUSAL ({kw})"
    return False, ""
