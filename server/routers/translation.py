
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
from sqlalchemy import text
from sqlalchemy.orm import Session
from server.database import get_db
from server.models import Translation, ExcludedSentence, TranslationTrash, CleanupNotification
from server.rule_classifier import classify_translation, is_verbatim_copy, normalize_text, restore_brackets

from urllib.parse import urlparse
from server.notifications import notify_verbatim_cleanup, notify_api_error
import threading
from server.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Global State for 5 PM Stop Condition ---
process_started_before_5pm = False
_stop_lock = threading.Lock()
_gemini_session = requests.Session()



# --- Pydantic Models ---
class TranslationItemInput(BaseModel):
    id: str
    text: str

class TranslateRequest(BaseModel):
    items: List[TranslationItemInput]
    url: str
    is_retranslation: Optional[bool] = False
    model: Optional[str] = None

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

def call_gemini_api(api_url: str, prompt: str, api_key: Optional[str] = None, system_instruction: Optional[dict] = None):
    """
    Calls the Gemini API using requests.Session with header authentication,
    low temperature (0.3), systemInstruction separation, and response_schema.
    Ensures fresh session state by clearing cookies before request.
    """
    # 매 요청마다 세션 쿠키/상태를 리셋하여 이전 요청의 컨텍스트 간섭 방지
    try:
        _gemini_session.cookies.clear()
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

    response = _gemini_session.post(api_url, json=payload, headers=headers, timeout=180)
    response.raise_for_status()
    return response.json()

def process_repeated_chars(text: str) -> str:
    """6번 이상 반복되는 문자를 '(반복)'으로 대체합니다."""
    if not text:
        return text
    return re.sub(r'(.)\1{5,}', '(반복)', text)

def parse_translation_response(raw_text: str) -> dict:
    """
    Gemini API 등 LLM 응답에서 번역된 JSON 데이터를 안전하게 파싱하여 {id: translated_text} 딕셔너리로 반환합니다.
    - 제어 문자(줄바꿈 \\n, 탭 \\t 등) 허용 (strict=False)
    - 마크다운 코드 블록 (```json ... ```) 제거
    - 텍스트 앞뒤 찌꺼기 및 추가 문자열(raw_decode 및 대괄호/중괄호 슬라이싱) 처리
    - 후행 쉼표(trailing comma), 잘못된 이스케이프(\\\\ ) 등 문법 오류 복구
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

def _build_translation_prompt(items: List[TranslationItemInput]) -> str:
    """번역 대상 JSON 데이터를 생성합니다. 프롬프트 내 명시적 지침 및 이전 컨텍스트 격리를 지시합니다."""
    api_input_json = json.dumps([{"id": item.id, "text": item.text} for item in items], ensure_ascii=False)
    return (
        "Translate the following JSON array from Japanese to Korean.\n"
        "MANDATORY REQUIREMENTS:\n"
        "1. Translate each item independently and uniquely based only on its own text.\n"
        "2. Do NOT echo or copy the original Japanese text into 'translated'.\n"
        "3. Do NOT repeat or carry over translations or text from preceding items.\n"
        "4. Return ONLY a valid JSON array of objects with 'id' and 'translated':\n\n"
        f"{api_input_json}"
    )

def handle_verbatim_cleanup_items(
    db: Session,
    url: str,
    verbatim_items: List[dict],
    folder_name: Optional[str] = None,
    title: Optional[str] = None
) -> str:
    """
    원문 복붙(글자만 일치)으로 감지된 번역 항목들을 즉시 삭제하고,
    TranslationTrash(휴지통)로 이전하며 CleanupNotification 알림을 등록합니다.
    """
    if not verbatim_items:
        return ""

    clean_url = (url or "").split('#')[0].strip()

    sample_meta = db.query(Translation.folderName, Translation.title).filter(
        (Translation.url == clean_url) | (Translation.url == url)
    ).first()
    novel_title = folder_name or (sample_meta[0] if sample_meta else None) or "미분류"
    episode_title = title or (sample_meta[1] if sample_meta else None) or clean_url

    target_pids = {str(item.get("id")) for item in verbatim_items if item.get("id")}
    target_origs = {item.get("original") for item in verbatim_items if item.get("original")}

    now_ms = int(time.time() * 1000)
    batch_id = f"verbatim_auto_{now_ms}"

    # 기존 DB에 해당 원문 또는 pid가 이미 적재되어 있는 경우 휴지통으로 이동 후 삭제
    existing_targets = db.query(Translation).filter(
        (Translation.url == clean_url) | (Translation.url == url),
        (Translation.pid.in_(target_pids) | Translation.original.in_(target_origs))
    ).all()

    existing_pid_set = set()
    existing_orig_set = set()

    for t in existing_targets:
        if t.pid:
            existing_pid_set.add(str(t.pid))
        if t.original:
            existing_orig_set.add(t.original)

        matched_item = next((x for x in verbatim_items if str(x.get("id")) == str(t.pid) or x.get("original") == t.original), None)
        item_cat = (matched_item.get("category") if matched_item else None) or 'verbatim'

        trash_item = TranslationTrash(
            original_translation_id=t.id,
            url=clean_url,
            pid=t.pid,
            original=t.original,
            translated=t.translated,
            timestamp=t.timestamp,
            folderName=t.folderName,
            title=t.title,
            toc_sort_order=t.toc_sort_order,
            reason_category=item_cat,
            deleted_at=now_ms,
            cleanup_batch_id=batch_id
        )
        db.add(trash_item)
        db.delete(t)

    # 기존 DB에 없던 신규 번역 항목들도 TranslationTrash에 등록하여 재검수 대상으로 보존
    for item in verbatim_items:
        pid = str(item.get("id") or "")
        orig = item.get("original") or ""
        if (pid and pid in existing_pid_set) or (orig and orig in existing_orig_set):
            continue

        item_cat = item.get("category") or 'verbatim'
        trash_item = TranslationTrash(
            original_translation_id=None,
            url=clean_url,
            pid=pid,
            original=orig,
            translated=item.get("translated") or "",
            timestamp=now_ms // 1000,
            folderName=novel_title,
            title=episode_title,
            toc_sort_order=None,
            reason_category=item_cat,
            deleted_at=now_ms,
            cleanup_batch_id=batch_id
        )
        db.add(trash_item)

    # 알림 시스템(CleanupNotification)에 등록
    notif = CleanupNotification(
        batch_id=batch_id,
        novel_title=novel_title,
        episode_title=episode_title,
        url=clean_url,
        deleted_count=len(verbatim_items),
        is_dismissed=0,
        created_at=now_ms,
        dismissed_at=None
    )
    db.add(notif)
    db.commit()

    logger.warning(
        f"[원문 복사 즉시 삭제] URL: '{clean_url}'에서 {len(verbatim_items)}개 원문 복붙 문장을 "
        f"즉시 삭제하고 알림 시스템(배치 ID: {batch_id})으로 이전했습니다."
    )

    # ntfy 푸시 알림 전송
    notify_verbatim_cleanup(
        novel_title=novel_title,
        episode_title=episode_title,
        count=len(verbatim_items),
        url=url,
        batch_id=batch_id
    )

    return batch_id

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

def _translate_sub_batch_with_safety_split(
    items: List[TranslationItemInput],
    api_url: str,
    wait_time_on_block: int = 5,
    depth: int = 1
) -> (dict, set):
    """
    검열 발생 또는 파싱 실패 시 재귀적 2분할 번역을 수행합니다.
    - len(items) > 1: 분할하여 안전한 문장들 번역 계속 진행
    - len(items) == 1: Fast-Fail 적용 (해당 문장 '[검열로 인해 번역 생략]' 처리 후 다음으로 진행)
    반환값: (translated_map: dict, censored_ids: set)
    """
    if not items:
        return {}, set()

    sub_prompt = _build_translation_prompt(items)
    try:
        sub_data = call_gemini_api(api_url, sub_prompt)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            raise HTTPException(status_code=429, detail="API 요청 한도 초과. 잠시 후 다시 시도해주세요.")
        logger.warning(f"분할 번역 중 HTTP 오류 ({e}). 하위 분할을 시도합니다.")
        sub_data = None
    except Exception as e:
        logger.warning(f"분할 번역 중 오류 ({e}). 하위 분할을 시도합니다.")
        sub_data = None

    if sub_data is None:
        if len(items) > 1:
            mid = len(items) // 2
            res1, cens1 = _translate_sub_batch_with_safety_split(items[:mid], api_url, wait_time_on_block, depth + 1)
            time.sleep(1.0)
            res2, cens2 = _translate_sub_batch_with_safety_split(items[mid:], api_url, wait_time_on_block, depth + 1)
            return {**res1, **res2}, cens1.union(cens2)
        else:
            single_item = items[0]
            return {str(single_item.id): single_item.text}, set()

    blocked, reason = is_safety_blocked(sub_data)
    if blocked:
        if len(items) > 1:
            logger.warning(
                f"[검열 분할 {depth}단계] {len(items)}개 문장 그룹에서 검열 발생 ({reason}). "
                f"{wait_time_on_block}초 대기 후 추가 2분할을 시도합니다."
            )
            time.sleep(wait_time_on_block)
            mid = len(items) // 2
            first_half = items[:mid]
            second_half = items[mid:]

            res1, cens1 = _translate_sub_batch_with_safety_split(first_half, api_url, wait_time_on_block, depth + 1)
            time.sleep(1.0)
            res2, cens2 = _translate_sub_batch_with_safety_split(second_half, api_url, wait_time_on_block, depth + 1)

            combined_map = {**res1, **res2}
            combined_cens = cens1.union(cens2)
            return combined_map, combined_cens
        else:
            # Single item blocked -> Fast-Fail
            single_item = items[0]
            logger.warning(
                f"[검열 Fast-Fail] 단일 문장(ID: {single_item.id})에서 검열 발생 ({reason}). "
                f"해당 문장을 '[검열로 인해 번역 생략]' 처리하고 다음 문장으로 진행합니다."
            )
            return {str(single_item.id): "[검열로 인해 번역 생략]"}, {str(single_item.id)}

    # Parse response
    if not sub_data.get('candidates') or not sub_data['candidates']:
        if len(items) > 1:
            mid = len(items) // 2
            res1, cens1 = _translate_sub_batch_with_safety_split(items[:mid], api_url, wait_time_on_block, depth + 1)
            time.sleep(1.0)
            res2, cens2 = _translate_sub_batch_with_safety_split(items[mid:], api_url, wait_time_on_block, depth + 1)
            return {**res1, **res2}, cens1.union(cens2)
        else:
            logger.warning(f"[단일 문장 번역 실패] ID: {items[0].id}. 원문 오염을 방지하기 위해 빈 번역문으로 처리합니다.")
            return {str(items[0].id): ""}, set()

    candidate = sub_data['candidates'][0]
    finish_reason = candidate.get('finishReason')
    if finish_reason and finish_reason != 'STOP':
        if finish_reason in ('SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT'):
            if len(items) > 1:
                logger.warning(
                    f"[검열 분할 {depth}단계] 응답 후보에서 검열 발생 ({finish_reason}). "
                    f"{wait_time_on_block}초 대기 후 추가 2분할을 시도합니다."
                )
                time.sleep(wait_time_on_block)
                mid = len(items) // 2
                res1, cens1 = _translate_sub_batch_with_safety_split(items[:mid], api_url, wait_time_on_block, depth + 1)
                time.sleep(1.0)
                res2, cens2 = _translate_sub_batch_with_safety_split(items[mid:], api_url, wait_time_on_block, depth + 1)
                return {**res1, **res2}, cens1.union(cens2)
            else:
                single_item = items[0]
                logger.warning(
                    f"[검열 Fast-Fail] 단일 문장(ID: {single_item.id})에서 응답 검열 발생 ({finish_reason}). "
                    f"해당 문장을 '[검열로 인해 번역 생략]' 처리합니다."
                )
                return {str(single_item.id): "[검열로 인해 번역 생략]"}, {str(single_item.id)}
        if len(items) > 1:
            mid = len(items) // 2
            res1, cens1 = _translate_sub_batch_with_safety_split(items[:mid], api_url, wait_time_on_block, depth + 1)
            time.sleep(1.0)
            res2, cens2 = _translate_sub_batch_with_safety_split(items[mid:], api_url, wait_time_on_block, depth + 1)
            return {**res1, **res2}, cens1.union(cens2)
        else:
            return {str(items[0].id): ""}, set()

    if candidate.get('content') and candidate['content'].get('parts') and isinstance(candidate['content']['parts'], list) and candidate['content']['parts']:
        raw_text = candidate['content']['parts'][0].get('text', '')
        try:
            sub_map = parse_translation_response(raw_text)
            return sub_map, set()
        except Exception as e:
            logger.warning(f"분할 번역 JSON 파싱 실패 ({e}), 원본: '{raw_text[:100]}...'. 추가 분할을 시도합니다.")
            if len(items) > 1:
                mid = len(items) // 2
                res1, cens1 = _translate_sub_batch_with_safety_split(items[:mid], api_url, wait_time_on_block, depth + 1)
                time.sleep(1.0)
                res2, cens2 = _translate_sub_batch_with_safety_split(items[mid:], api_url, wait_time_on_block, depth + 1)
                return {**res1, **res2}, cens1.union(cens2)
            else:
                single_item = items[0]
                logger.warning(f"[Fast-Fail] 단일 문장(ID: {single_item.id}) 파싱 실패로 빈 번역문으로 처리합니다.")
                return {str(single_item.id): ""}, set()
    else:
        if len(items) > 1:
            mid = len(items) // 2
            res1, cens1 = _translate_sub_batch_with_safety_split(items[:mid], api_url, wait_time_on_block, depth + 1)
            time.sleep(1.0)
            res2, cens2 = _translate_sub_batch_with_safety_split(items[mid:], api_url, wait_time_on_block, depth + 1)
            return {**res1, **res2}, cens1.union(cens2)
        else:
            return {str(items[0].id): ""}, set()

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

    # --- 5 PM Boundary-Crossing Logic (Thread-safe) ---
    with _stop_lock:
        if now.hour < 16:
            process_started_before_5pm = False

        if now.hour < 17:
            process_started_before_5pm = True

        if process_started_before_5pm and now.hour >= 17:
            process_started_before_5pm = False
            logger.critical("오후 5시가 되어, 5시 이전에 시작된 자동 번역 프로세스를 중지합니다.")
            raise HTTPException(status_code=503, detail="오후 5시가 되어 자동 번역을 중지합니다. 새로고침 후 다시 시도해주세요.")

    # URL에서 #lanovel_review 등 해시를 완벽히 제거하여 정규화
    clean_url = (req.url or "").split('#')[0].strip()
    req.url = clean_url

    translatable_items = [item for item in req.items if item.id != 'tagCount']
    
    if translatable_items:
        excluded_originals = _get_excluded_sentences_for_url(clean_url, db)
        items_to_translate = [item for item in translatable_items if item.text not in excluded_originals]
    else:
        items_to_translate = []

    if not items_to_translate:
        return {"translations": [
            {"id": item.id, "original": item.text, "translated": item.text} for item in req.items
        ]}

    if not settings.gemini_api_key or "YOUR_GEMINI_API_KEY_HERE" in settings.gemini_api_key:
        raise HTTPException(status_code=500, detail="Gemini API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.")

    selected_model = req.model or (settings.gemini_retranslation_model if req.is_retranslation else settings.gemini_default_model)
    logger.debug(f"Using Gemini Model: {selected_model} (is_retranslation={req.is_retranslation})")
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{selected_model}:generateContent"
    
    prompt = _build_translation_prompt(items_to_translate)
    logger.debug(f"Gemini API URL: {api_url}")
    logger.debug(f"Gemini API Prompt (first 500 chars): {prompt[:500]}...")

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
                notify_api_error(
                    error_title="번역 API 과부하 (503)",
                    message="API 과부하(503)로 요청이 실패했습니다. RPM 한도를 확인하거나 잠시 후 다시 시도하세요.",
                    error_type="503 OVERLOAD",
                    url=req.url
                )
                raise HTTPException(status_code=503, detail="API 과부하(503) 에러입니다. RPM 소모 방지를 위해 재시도하지 않습니다.")
            
            logger.warning(f"HTTP 오류 발생 (시도 {attempt + 1}/{max_attempts}): {e}")
            if e.response.status_code == 429:
                notify_api_error(
                    error_title="번역 API 요청 한도 초과 (429)",
                    message="Gemini API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.",
                    error_type="429 RATE LIMIT",
                    url=req.url
                )
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
        blocked, block_reason = is_safety_blocked(data)
        if blocked:
            logger.warning(f"배치 번역이 차단되었습니다 ({block_reason}). 40초 대기 후 분할 번역을 시도합니다.")
            time.sleep(40)

            if len(items_to_translate) > 1:
                mid = len(items_to_translate) // 2
                first_half = items_to_translate[:mid]
                second_half = items_to_translate[mid:]

                res1, cens1 = _translate_sub_batch_with_safety_split(first_half, api_url, wait_time_on_block=40, depth=1)
                time.sleep(2.0)
                res2, cens2 = _translate_sub_batch_with_safety_split(second_half, api_url, wait_time_on_block=40, depth=1)

                translated_map = {**res1, **res2}
                censored_ids = cens1.union(cens2)
            else:
                # Fast-Fail on single item
                single_item = items_to_translate[0]
                logger.warning(
                    f"[검열 Fast-Fail] 단일 문장(ID: {single_item.id})에서 검열 발생 ({block_reason}). "
                    f"해당 문장을 '[검열로 인해 번역 생략]' 처리합니다."
                )
                translated_map = {str(single_item.id): "[검열로 인해 번역 생략]"}
                censored_ids = {str(single_item.id)}

            # Prepare the results
            translated_results = {}
            verbatim_detected_items = []

            for item in items_to_translate:
                is_censored = str(item.id) in censored_ids or translated_map.get(str(item.id)) == "[검열로 인해 번역 생략]"
                raw_trans = translated_map.get(str(item.id))
                
                if raw_trans is None:
                    translated_text = ""
                else:
                    translated_text = raw_trans

                is_verbatim = False
                verbatim_cat = None
                if not is_censored and translated_text:
                    translated_text = process_repeated_chars(translated_text)
                    translated_text = restore_brackets(item.text, translated_text)
                    cls_cat = classify_translation(item.text, translated_text)
                    if is_verbatim_copy(item.text, translated_text) or cls_cat in ('verbatim_or_empty', 'paraphrased_jp'):
                        verbatim_cat = 'verbatim' if (is_verbatim_copy(item.text, translated_text) or cls_cat == 'verbatim_or_empty') else 'paraphrased_jp'
                        logger.warning(f"[검열 분할 중 {verbatim_cat} 감지] ID: {item.id} -> 번역문을 즉시 삭제합니다.")
                        verbatim_detected_items.append({
                            "id": item.id,
                            "original": item.text,
                            "translated": translated_text,
                            "category": verbatim_cat
                        })
                        translated_text = ""
                        is_verbatim = True

                translated_results[str(item.id)] = {
                    "id": item.id,
                    "original": item.text,
                    "translated": translated_text,
                    "censored": is_censored,
                    "verbatim": is_verbatim,
                    "verbatim_category": verbatim_cat
                }

            if verbatim_detected_items:
                handle_verbatim_cleanup_items(db, req.url, verbatim_detected_items)

            final_translations = []
            for item in req.items:
                if str(item.id) in translated_results:
                    final_translations.append(translated_results[str(item.id)])
                else:
                    final_translations.append({
                        "id": item.id,
                        "original": item.text,
                        "translated": "",
                        "censored": False,
                        "verbatim": False,
                        "verbatim_category": None
                    })

            return {"translations": final_translations}

        raw_text = None
        if data.get('candidates') and isinstance(data['candidates'], list) and data['candidates']:
            candidate = data['candidates'][0]
            
            finish_reason = candidate.get('finishReason')
            if finish_reason and finish_reason != 'STOP':
                logger.warning(f"API finishReason이 '{finish_reason}'입니다. 분할 번역으로 복구를 시도합니다.")

            if candidate.get('content') and candidate['content'].get('parts') and isinstance(candidate['content']['parts'], list) and candidate['content']['parts']:
                raw_text = candidate['content']['parts'][0].get('text')

        if raw_text is None:
            logger.warning("API 응답에서 번역 텍스트를 추출할 수 없습니다. 분할 번역으로 자동 복구합니다.")
            if len(items_to_translate) > 1:
                mid = len(items_to_translate) // 2
                res1, cens1 = _translate_sub_batch_with_safety_split(items_to_translate[:mid], api_url, wait_time_on_block=2, depth=1)
                time.sleep(1.0)
                res2, cens2 = _translate_sub_batch_with_safety_split(items_to_translate[mid:], api_url, wait_time_on_block=2, depth=1)
                translated_map = {**res1, **res2}
            else:
                single_item = items_to_translate[0]
                translated_map = {str(single_item.id): ""}
        else:
            try:
                translated_map = parse_translation_response(raw_text)
            except Exception as parse_err:
                logger.warning(
                    f"배치 번역 파싱 실패 ({parse_err}). 원본: '{raw_text[:200]}...'. "
                    f"분할 번역(Safety/Resilience Split)으로 자동 복구합니다."
                )
                if len(items_to_translate) > 1:
                    mid = len(items_to_translate) // 2
                    res1, cens1 = _translate_sub_batch_with_safety_split(items_to_translate[:mid], api_url, wait_time_on_block=2, depth=1)
                    time.sleep(1.0)
                    res2, cens2 = _translate_sub_batch_with_safety_split(items_to_translate[mid:], api_url, wait_time_on_block=2, depth=1)
                    translated_map = {**res1, **res2}
                else:
                    single_item = items_to_translate[0]
                    logger.warning(f"[Fast-Fail] 단일 문장(ID: {single_item.id}) 파싱 실패로 빈 번역문으로 처리합니다.")
                    translated_map = {str(single_item.id): ""}

        translated_results = {}
        verbatim_detected_items = []

        for item in items_to_translate:
            raw_trans = translated_map.get(str(item.id))
            if raw_trans is None:
                translated_text = ""
            else:
                translated_text = raw_trans

            is_censored = False
            is_verbatim = False
            verbatim_cat = None
            if translated_text:
                translated_text = process_repeated_chars(translated_text)
                translated_text = restore_brackets(item.text, translated_text)
                cls_cat = classify_translation(item.text, translated_text)
                if is_verbatim_copy(item.text, translated_text) or cls_cat in ('verbatim_or_empty', 'paraphrased_jp'):
                    verbatim_cat = 'verbatim' if (is_verbatim_copy(item.text, translated_text) or cls_cat == 'verbatim_or_empty') else 'paraphrased_jp'
                    logger.warning(f"[{verbatim_cat} 감지] ID: {item.id}, 원문: '{item.text[:40]}...' -> 번역문을 즉시 삭제합니다.")
                    verbatim_detected_items.append({
                        "id": item.id,
                        "original": item.text,
                        "translated": translated_text,
                        "category": verbatim_cat
                    })
                    translated_text = ""
                    is_verbatim = True

            translated_results[str(item.id)] = {
                "id": item.id,
                "original": item.text,
                "translated": translated_text,
                "censored": is_censored,
                "verbatim": is_verbatim,
                "verbatim_category": verbatim_cat
            }

        # 원문 복붙/변형 항목이 있는 경우 즉시 삭제 및 알림 시스템으로 이전
        if verbatim_detected_items:
            handle_verbatim_cleanup_items(db, req.url, verbatim_detected_items)

        final_translations = []
        for item in req.items:
            if str(item.id) in translated_results:
                final_translations.append(translated_results[str(item.id)])
            else:
                final_translations.append({
                    "id": item.id,
                    "original": item.text,
                    "translated": "",
                    "censored": False,
                    "verbatim": False,
                    "verbatim_category": None
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
    description="모든 번역 기록의 번역된 텍스트에 대해 고성능 일괄 찾아 바꾸기를 수행합니다."
)
def find_replace_all(req: FindReplaceRequest, db: Session = Depends(get_db)):
    if not req.find_text:
        raise HTTPException(status_code=400, detail="찾을 텍스트를 입력해야 합니다.")

    flags = re.IGNORECASE if not req.case_sensitive else 0
    if req.use_regex:
        try:
            re.compile(req.find_text, flags=flags)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"유효하지 않은 정규식: {e}")
        pattern = req.find_text
    else:
        pattern = re.escape(req.find_text)

    # 1. SQL WHERE 조건절 및 파라미터 구성
    where_clauses = ["translated IS NOT NULL"]
    params = {
        "pattern": pattern,
        "replace_text": req.replace_text or "",
        "flags": int(flags)
    }

    # 대상 텍스트 매칭 조건
    if not req.use_regex and req.case_sensitive:
        where_clauses.append("instr(translated, :find_raw) > 0")
        params["find_raw"] = req.find_text
    else:
        where_clauses.append("translated REGEXP :pattern")

    # 폴더 범위 필터링
    if req.folder_scope and req.folder_scope != "__all__":
        if req.folder_scope == "폴더 추가 대기 상태":
            where_clauses.append("folderName IS NULL")
        else:
            where_clauses.append("folderName = :folder_scope")
            params["folder_scope"] = req.folder_scope

    # 원문 조건 필터링
    if req.condition_text:
        if req.case_sensitive:
            where_clauses.append("instr(original, :condition_text) > 0")
        else:
            where_clauses.append("original REGEXP :condition_pattern")
            params["condition_pattern"] = re.escape(req.condition_text)
        params["condition_text"] = req.condition_text

    # 치환 함수 표현식
    if not req.use_regex and req.case_sensitive:
        replace_expr = "replace(translated, :find_raw, :replace_text)"
    else:
        replace_expr = "REGEXP_REPLACE(:pattern, :replace_text, translated, :flags)"

    # 실제 내용이 변경되는 항목만 치환하고 카운트하도록 필터링
    where_clauses.append(f"translated != {replace_expr}")

    where_sql = " AND ".join(where_clauses)
    update_sql = f"""
        UPDATE translations
        SET translated = {replace_expr}
        WHERE {where_sql}
    """

    try:
        result = db.execute(text(update_sql), params)
        db.commit()
        updated_count = result.rowcount if result.rowcount is not None and result.rowcount >= 0 else 0
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"치환 처리 중 오류 발생: {e}")

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