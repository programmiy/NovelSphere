"""
LANOVEL Translation Router
Coordinates translation requests, quota reset boundaries, and translation CRUD endpoints.
Underlying translation engine, RPM management, and recovery mechanisms are modularized in server.services.
"""

import datetime
import json
import logging
import re
import threading
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from server.database import get_db
from server.models import ExcludedSentence, Translation, TranslationTrash
from server.notifications import notify_api_error
from server.quota import (
    is_us_dst,
    get_quota_reset_hour,
    get_current_quota_window_start_ts,
)
from server.rule_classifier import (
    classify_translation,
    is_pure_punctuation_only,
    is_verbatim_copy,
    restore_brackets,
)
from server.settings import settings

# --- Modularized Services Re-exports for Backward Compatibility ---
from server.services.rpm_manager import (
    _CALL_TIMESTAMPS,  # noqa: F401
    _EPISODE_RECORDS,  # noqa: F401
    _RPM_LOCK,  # noqa: F401
    _record_call_timestamp,  # noqa: F401
    calculate_episode_adaptive_delay,
    get_current_rpm,
    get_recent_episode_count,
    proactive_rpm_rest,  # noqa: F401
    recycle_gemini_session,  # noqa: F401
    record_episode_translation,
)
from server.services.translation_engine import (
    TRANSLATION_SYSTEM_INSTRUCTION,  # noqa: F401
    TranslationItemInput,
    _build_translation_prompt,
    call_gemini_api,
    is_safety_blocked,
    parse_translation_response,
    process_repeated_chars,
)
from server.services.translation_recovery import (
    _recover_verbatim_items,
    _translate_sub_batch_with_safety_split,
    handle_verbatim_cleanup_items,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# --- Global State for Quota Reset Stop Condition ---
class _QuotaStopState:
    """
    17시 안전 중단 플래그를 스레드 안전하게 관리하는 상태 컨테이너.
    모든 읽기/쓰기는 반드시 self.lock을 획득한 상태에서 수행됩니다.
    """
    def __init__(self):
        self.lock = threading.Lock()
        self._started_before_cutoff = False

    def check_and_update(self, now: datetime.datetime, cutoff_hour: int) -> bool:
        """
        현재 시간을 기준으로 플래그를 갱신하고, 번역 중단 여부를 반환합니다.
        반환값: True이면 503을 던져야 함.
        """
        with self.lock:
            if now.hour < (cutoff_hour - 1):
                self._started_before_cutoff = False
            if now.hour < cutoff_hour:
                self._started_before_cutoff = True
            if self._started_before_cutoff and now.hour >= cutoff_hour:
                self._started_before_cutoff = False
                return True
        return False

    def reset(self):
        with self.lock:
            self._started_before_cutoff = False

_stop_state = _QuotaStopState()

# Backward compatibility aliases (외부에서 직접 참조하는 코드가 있을 경우를 위해 유지)
_stop_lock = _stop_state.lock



# --- Pydantic Request Models ---
class TranslateRequest(BaseModel):
    items: List[TranslationItemInput]
    url: str
    is_retranslation: Optional[bool] = False
    model: Optional[str] = None


class ExcludeRequest(BaseModel):
    ids: List[int]


class RestoreExcludedItem(BaseModel):
    pid: Optional[str] = None
    original: str
    translated: Optional[str] = None
    timestamp: Optional[int] = None
    folderName: Optional[str] = None
    title: Optional[str] = None
    toc_sort_order: Optional[int] = None


class RestoreExcludedRequest(BaseModel):
    url: str
    originals: Optional[List[str]] = None
    items: Optional[List[RestoreExcludedItem]] = None


class FindReplaceRequest(BaseModel):
    find_text: str
    replace_text: str
    condition_text: Optional[str] = None
    folder_scope: Optional[str] = None
    use_regex: Optional[bool] = False
    case_sensitive: Optional[bool] = False
    target_ids: Optional[List[int]] = None


class UpdateTitleRequest(BaseModel):
    url: str
    title: str


# --- Helper Functions ---
def _get_excluded_sentences_for_url(url: str, db: Session) -> set:
    """특정 URL에 대해 제외 처리된 원문 문장 세트를 반환합니다."""
    excluded_originals = {
        item.original
        for item in db.query(ExcludedSentence).filter(ExcludedSentence.url == url).all()
    }
    return excluded_originals



def _post_process_translated_text(item_text: str, raw_trans: str) -> tuple:
    """
    번역문 공통 후처리: 화살표 분리 → 반복문자 제거 → 괄호복원 → 품질분류
    반환: (processed_text: str, is_verbatim: bool, verbatim_cat: str | None)
    """
    translated_text = raw_trans
    if '->' in translated_text or '=>' in translated_text:
        parts = re.split(r'\s*[-=]>\s*', translated_text, maxsplit=1)
        if len(parts) == 2 and any(ord('가') <= ord(c) <= ord('힣') for c in parts[1]):
            translated_text = parts[1].strip()
    translated_text = process_repeated_chars(translated_text)
    translated_text = restore_brackets(item_text, translated_text)
    cls_cat = classify_translation(item_text, translated_text)
    is_verbatim = False
    verbatim_cat = None
    if is_verbatim_copy(item_text, translated_text) or cls_cat in ('verbatim_or_empty', 'paraphrased_jp', 'paraphrased_zh'):
        verbatim_cat = (
            'verbatim' if (is_verbatim_copy(item_text, translated_text) or cls_cat == 'verbatim_or_empty')
            else ('paraphrased_zh' if cls_cat == 'paraphrased_zh' else 'paraphrased_jp')
        )
        is_verbatim = True
    return translated_text, is_verbatim, verbatim_cat


# --- API Endpoints ---
@router.post(
    "/translate",
    tags=["Translation"],
    summary="텍스트 번역",
    description="Gemini API를 호출하여 텍스트를 번역합니다. ID 기반 매칭과 재시도 로직으로 안정성을 높였습니다."
)
def translate_texts(req: TranslateRequest, db: Session = Depends(get_db)):
    now = datetime.datetime.now()
    cutoff_hour = get_quota_reset_hour(now)

    # --- Quota Reset Boundary-Crossing Logic (Thread-safe via _QuotaStopState) ---
    if _stop_state.check_and_update(now, cutoff_hour):
        display_hour = cutoff_hour if cutoff_hour <= 12 else cutoff_hour - 12
        logger.critical(f"초기화 시간(오후 {display_hour}시)이 되어, 이전에 시작된 자동 번역 프로세스를 중지합니다.")
        raise HTTPException(
            status_code=503,
            detail=f"오후 {display_hour}시(쿼터 초기화 시간)가 되어 자동 번역을 중지합니다. 새로고침 후 다시 시도해주세요."
        )

    # URL에서 #lanovel_review 등 해시를 완벽히 제거하여 정규화
    clean_url = (req.url or "").split('#')[0].strip()
    req.url = clean_url

    # 최근 회차 번역 슬라이딩 윈도우에 회차 기록 (과열 방지용 속도 추적)
    if clean_url:
        record_episode_translation(clean_url)

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

    # 순수 문장부호/기호 문장(「……」 등)은 Gemini API 호출 없이 원문 그대로 즉시 반환(Fast-path)
    fast_pass_results = {}
    actual_items_to_translate = []
    for item in items_to_translate:
        if is_pure_punctuation_only(item.text):
            fast_pass_results[str(item.id)] = {
                "id": item.id,
                "original": item.text,
                "translated": item.text,
                "censored": False,
                "verbatim": False,
                "verbatim_category": None
            }
        else:
            actual_items_to_translate.append(item)

    if not actual_items_to_translate:
        return {"translations": [
            fast_pass_results.get(
                str(item.id),
                {"id": item.id, "original": item.text, "translated": item.text, "censored": False, "verbatim": False, "verbatim_category": None}
            )
            for item in req.items
        ]}

    items_to_translate = actual_items_to_translate

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
            break  # Success, exit loop
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
        else:
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
                    translated_text, is_verbatim, verbatim_cat = _post_process_translated_text(item.text, translated_text)
                    if is_verbatim:
                        logger.warning(f"[검열 분할 중 {verbatim_cat} 감지] ID: {item.id} -> 번역문을 즉시 삭제합니다.")
                        verbatim_detected_items.append({
                            "id": item.id,
                            "original": item.text,
                            "translated": translated_text,
                            "category": verbatim_cat
                        })
                        translated_text = ""

                translated_results[str(item.id)] = {
                    "id": item.id,
                    "original": item.text,
                    "translated": translated_text,
                    "censored": is_censored,
                    "verbatim": is_verbatim,
                    "verbatim_category": verbatim_cat
                }

            if verbatim_detected_items:
                verbatim_detected_items = _recover_verbatim_items(
                    verbatim_detected_items,
                    items_to_translate,
                    translated_results,
                    api_url
                )

            if verbatim_detected_items:
                handle_verbatim_cleanup_items(db, req.url, verbatim_detected_items)

            final_translations = []
            for item in req.items:
                if str(item.id) in translated_results:
                    final_translations.append(translated_results[str(item.id)])
                elif str(item.id) in fast_pass_results:
                    final_translations.append(fast_pass_results[str(item.id)])
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
                translated_text, is_verbatim, verbatim_cat = _post_process_translated_text(item.text, translated_text)
                if is_verbatim:
                    logger.warning(f"[{verbatim_cat} 감지] ID: {item.id}, 원문: '{item.text[:40]}...' -> 번역문을 즉시 삭제합니다.")
                    verbatim_detected_items.append({
                        "id": item.id,
                        "original": item.text,
                        "translated": translated_text,
                        "category": verbatim_cat
                    })
                    translated_text = ""

            translated_results[str(item.id)] = {
                "id": item.id,
                "original": item.text,
                "translated": translated_text,
                "censored": is_censored,
                "verbatim": is_verbatim,
                "verbatim_category": verbatim_cat
            }

        # 원문 복붙/변형 항목이 있는 경우 단일 재시도 및 상위 모델 자동 복구 시도
        if verbatim_detected_items:
            verbatim_detected_items = _recover_verbatim_items(
                verbatim_detected_items,
                items_to_translate,
                translated_results,
                api_url
            )

        # 복구되지 않고 남은 원문 복붙/변형 항목은 즉시 삭제 및 알림 시스템으로 이전
        if verbatim_detected_items:
            handle_verbatim_cleanup_items(db, req.url, verbatim_detected_items)

        final_translations = []
        for item in req.items:
            if str(item.id) in translated_results:
                final_translations.append(translated_results[str(item.id)])
            elif str(item.id) in fast_pass_results:
                final_translations.append(fast_pass_results[str(item.id)])
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
    description="지정된 ID의 번역 기록을 제외 목록에 추가하고 휴지통에 보관 후 삭제합니다."
)
def exclude_translations(req: ExcludeRequest, db: Session = Depends(get_db)):
    excluded_count = 0
    now = int(time.time())
    batch_id = f"exclude_{int(now * 1000)}"
    for translation_id in req.ids:
        translation_to_exclude = db.query(Translation).filter(Translation.id == translation_id).first()
        if translation_to_exclude:
            # 1. Add to excluded_sentences if not already there
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

            # 2. Archive to TranslationTrash so translation text is never lost
            trash_item = TranslationTrash(
                original_translation_id=translation_to_exclude.id,
                url=translation_to_exclude.url,
                pid=translation_to_exclude.pid,
                original=translation_to_exclude.original,
                translated=translation_to_exclude.translated,
                timestamp=translation_to_exclude.timestamp,
                folderName=translation_to_exclude.folderName,
                title=translation_to_exclude.title,
                toc_sort_order=translation_to_exclude.toc_sort_order,
                reason_category="excluded",
                deleted_at=now,
                cleanup_batch_id=batch_id
            )
            db.add(trash_item)

            # 3. Delete from active translations
            db.delete(translation_to_exclude)
            excluded_count += 1
    db.commit()
    return {"message": f"{excluded_count}개의 항목이 제외 목록 및 휴지통에 안전하게 보관되었습니다."}


@router.post(
    "/translations/restore_excluded",
    tags=["Translation"],
    summary="제외된 번역 복원 (제외 해제)",
    description="제외 목록에서 원문을 제거하고, 휴지통 또는 전달된 번역 데이터를 바탕으로 translations 테이블로 복원합니다."
)
def restore_excluded(req: RestoreExcludedRequest, db: Session = Depends(get_db)):
    # 1. 대상 original 목록 확인
    target_originals = set(req.originals) if req.originals else set()
    if not target_originals and req.items:
        target_originals = {item.original for item in req.items}

    # 대상이 없으면 해당 URL의 모든 제외 항목 대상
    if not target_originals:
        excluded_rows = db.query(ExcludedSentence).filter(ExcludedSentence.url == req.url).all()
        target_originals = {row.original for row in excluded_rows}

    if not target_originals:
        return {"success": True, "restored_count": 0, "message": "복원할 제외 항목이 없습니다.", "restored_items": []}

    # 2. ExcludedSentence 테이블에서 삭제 (제외 해제)
    db.query(ExcludedSentence).filter(
        ExcludedSentence.url == req.url,
        ExcludedSentence.original.in_(list(target_originals))
    ).delete(synchronize_session=False)

    restored_items = []
    now = int(time.time())

    # 3-A. TranslationTrash에서 백업된 항목 복원
    trash_items = db.query(TranslationTrash).filter(
        TranslationTrash.url == req.url,
        TranslationTrash.original.in_(list(target_originals))
    ).all()

    restored_from_trash_originals = set()
    for trash in trash_items:
        existing = db.query(Translation).filter(
            Translation.url == trash.url,
            Translation.pid == trash.pid,
            Translation.original == trash.original
        ).first()

        if existing:
            existing.translated = trash.translated
            existing.timestamp = trash.timestamp or now
            if trash.folderName:
                existing.folderName = trash.folderName
            if trash.title:
                existing.title = trash.title
            if trash.toc_sort_order is not None:
                existing.toc_sort_order = trash.toc_sort_order
        else:
            new_t = Translation(
                url=trash.url,
                pid=trash.pid,
                original=trash.original,
                translated=trash.translated,
                timestamp=trash.timestamp or now,
                folderName=trash.folderName,
                title=trash.title,
                toc_sort_order=trash.toc_sort_order
            )
            db.add(new_t)

        restored_items.append({
            "pid": trash.pid,
            "original": trash.original,
            "translated": trash.translated,
            "timestamp": trash.timestamp or now
        })
        restored_from_trash_originals.add(trash.original)
        db.delete(trash)

    # 3-B. 만약 클라이언트가 items를 넘겨주었고 휴지통에 없던 항목이면 직접 복원
    if req.items:
        for item in req.items:
            if item.original in restored_from_trash_originals:
                continue
            if item.original not in target_originals:
                continue

            existing = db.query(Translation).filter(
                Translation.url == req.url,
                Translation.pid == item.pid,
                Translation.original == item.original
            ).first()

            if existing:
                if item.translated:
                    existing.translated = item.translated
                existing.timestamp = item.timestamp or now
            else:
                new_t = Translation(
                    url=req.url,
                    pid=item.pid,
                    original=item.original,
                    translated=item.translated,
                    timestamp=item.timestamp or now,
                    folderName=item.folderName,
                    title=item.title,
                    toc_sort_order=item.toc_sort_order
                )
                db.add(new_t)

            restored_items.append({
                "pid": item.pid,
                "original": item.original,
                "translated": item.translated,
                "timestamp": item.timestamp or now
            })

    db.commit()
    return {
        "success": True,
        "restored_count": len(restored_items),
        "message": f"{len(restored_items)}개의 번역 항목이 정상 복원되었습니다.",
        "restored_items": restored_items
    }


@router.get(
    "/translations/excluded_details",
    tags=["Translation"],
    summary="제외된 문장 상세 정보 조회",
    description="특정 URL에 대해 제외된 문장들과 휴지통에 보관된 번역문 정보를 함께 조회합니다."
)
def get_excluded_details(url: str, db: Session = Depends(get_db)):
    excluded_rows = db.query(ExcludedSentence).filter(ExcludedSentence.url == url).all()
    if not excluded_rows:
        return {"url": url, "excluded_items": []}

    originals = [r.original for r in excluded_rows]
    trash_items = db.query(TranslationTrash).filter(
        TranslationTrash.url == url,
        TranslationTrash.original.in_(originals)
    ).all()
    trash_map = {t.original: t for t in trash_items}

    items = []
    for r in excluded_rows:
        t_match = trash_map.get(r.original)
        items.append({
            "id": r.id,
            "original": r.original,
            "pid": t_match.pid if t_match else None,
            "translated": t_match.translated if t_match else None,
            "deleted_at": t_match.deleted_at if t_match else None,
            "reason_category": t_match.reason_category if t_match else "excluded"
        })

    return {"url": url, "excluded_items": items}


@router.post(
    "/translations/find_replace",
    tags=["Translation"],
    summary="찾아 바꾸기",
    description="모든 번역 기록의 번역된 텍스트에 대해 고성능 일괄 찾아 바꾸기를 수행합니다."
)
def find_replace_all(req: FindReplaceRequest, db: Session = Depends(get_db)):
    if not req.find_text:
        raise HTTPException(status_code=400, detail="찾을 텍스트를 입력해야 합니다.")

    replace_text = req.replace_text if req.replace_text is not None else ""
    flags = re.IGNORECASE if not req.case_sensitive else 0

    has_casing = req.find_text.lower() != req.find_text.upper()
    is_plain_exact = (not req.use_regex) and (req.case_sensitive or not has_casing)

    if req.use_regex:
        try:
            re.compile(req.find_text, flags=flags)
        except re.error as e:
            raise HTTPException(status_code=400, detail=f"유효하지 않은 정규식: {e}")
        pattern = f"(?i){req.find_text}" if not req.case_sensitive else req.find_text
    else:
        pattern = f"(?i){re.escape(req.find_text)}" if not req.case_sensitive else re.escape(req.find_text)

    # 1. SQL WHERE 조건절 및 파라미터 구성
    where_clauses = ["translated IS NOT NULL"]
    params = {
        "replace_text": replace_text
    }

    # 특정 ID 목록 타겟팅 (하단 일괄 작업 선택 항목 지원)
    if req.target_ids:
        safe_ids = [int(i) for i in req.target_ids]
        if safe_ids:
            where_clauses.append(f"id IN ({','.join(str(i) for i in safe_ids)})")
        else:
            return {"message": "0개의 항목에서 내용을 교체했습니다."}

    # 폴더 범위 필터링 (인덱스를 탈 수 있도록 앞부분에 배치)
    if req.folder_scope and req.folder_scope != "__all__":
        where_clauses.append("folderName = :folder_scope")
        params["folder_scope"] = req.folder_scope

    # 원문 조건 필터링
    if req.condition_text:
        cond_has_casing = req.condition_text.lower() != req.condition_text.upper()
        if req.case_sensitive or not cond_has_casing:
            where_clauses.append("instr(original, :condition_text) > 0")
            params["condition_text"] = req.condition_text
        else:
            where_clauses.append("original REGEXP :condition_pattern")
            params["condition_pattern"] = f"(?i){re.escape(req.condition_text)}"

    # 대상 텍스트 매칭 조건 및 치환 함수 표현식
    if is_plain_exact:
        # 한글/기호/대소문자 일치 등 정규식이 불필요한 경우: C레벨 초고속 replace 및 instr
        where_clauses.append("instr(translated, :find_raw) > 0")
        params["find_raw"] = req.find_text
        replace_expr = "replace(translated, :find_raw, :replace_text)"
    elif not req.use_regex:
        # 영문 대소문자 미구분 단순 텍스트 치환: safe plain regex replace
        where_clauses.append("translated REGEXP :pattern")
        params["pattern"] = pattern
        replace_expr = "REGEXP_REPLACE_PLAIN(:pattern, :replace_text, translated)"
    else:
        # 정규식 치환
        where_clauses.append("translated REGEXP :pattern")
        params["pattern"] = pattern
        params["flags"] = int(flags)
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


@router.get(
    "/api/translation_session_count",
    tags=["Translation"],
    summary="오늘 소설 번역 회차 수 조회",
    description="오늘(00:00 KST 기준) 해당 소설에서 번역 완료된 고유 회차(distinct URL) 수 및 전체 소설 번역 회차 수를 조회합니다."
)
def get_translation_session_count(
    url: Optional[str] = None,
    work_key: Optional[str] = None,
    novel_title: Optional[str] = None,
    db: Session = Depends(get_db)
):
    window_start_ts = get_current_quota_window_start_ts()
    cutoff_hour = get_quota_reset_hour()

    count = 0
    clean_url = (url or "").split("#")[0].strip()
    
    # URL 프리픽스 결정
    prefix = None
    if clean_url:
        k_match = re.search(r'(https?://kakuyomu\.jp/works/\d+)', clean_url)
        s_match = re.search(r'(https?://[^/]+\.syosetu\.com/n\w+)', clean_url)
        nu_match = re.search(r'(https?://novelup\.plus/story/\d+)', clean_url)
        h_match = re.search(r'(https?://syosetu\.org/novel/\d+)', clean_url)
        a_match = re.search(r'(https?://[^/]+\.alphapolis\.co\.jp/novel/\d+)', clean_url)
        if k_match:
            prefix = k_match.group(1) + "%"
        elif s_match:
            prefix = s_match.group(1) + "%"
        elif nu_match:
            prefix = nu_match.group(1) + "%"
        elif h_match:
            prefix = h_match.group(1) + "%"
        elif a_match:
            prefix = a_match.group(1) + "%"

    # work_key를 통한 프리픽스 보완
    if not prefix and work_key:
        if work_key.startswith("kakuyomu_"):
            prefix = f"https://kakuyomu.jp/works/{work_key.split('_')[1]}%"
        elif work_key.startswith("syosetu_"):
            prefix = f"%syosetu.com/{work_key.split('_')[1]}%"
        elif work_key.startswith("novelup_"):
            prefix = f"https://novelup.plus/story/{work_key.split('_')[1]}%"
        elif work_key.startswith("hameln_"):
            prefix = f"https://syosetu.org/novel/{work_key.split('_')[1]}%"
        elif work_key.startswith("alphapolis_"):
            prefix = f"%alphapolis.co.jp/novel/{work_key.split('_')[1]}%"

    # folderName 조회 (clean_url 또는 prefix로 등록된 folderName 탐색)
    folder_name = None
    if clean_url:
        row = db.execute(
            text("SELECT folderName FROM translations WHERE url = :u AND folderName IS NOT NULL AND folderName != '' LIMIT 1"),
            {"u": clean_url}
        ).fetchone()
        if row and row[0]:
            folder_name = row[0]

    if not folder_name and prefix:
        row = db.execute(
            text("SELECT folderName FROM translations WHERE url LIKE :prefix AND folderName IS NOT NULL AND folderName != '' LIMIT 1"),
            {"prefix": prefix}
        ).fetchone()
        if row and row[0]:
            folder_name = row[0]
            
    if not folder_name and novel_title and novel_title != "기본 소설":
        folder_name = novel_title

    # 해당 소설의 오늘(현재 쿼터 주기, 16시/17시 초기화 기준) 번역 회차 수 조회
    conditions = []
    params = {"ts": window_start_ts}

    if prefix:
        conditions.append("url LIKE :prefix")
        params["prefix"] = prefix
    if folder_name:
        conditions.append("folderName = :folder")
        params["folder"] = folder_name
    if clean_url and not prefix:
        conditions.append("url = :u")
        params["u"] = clean_url

    if conditions:
        where_clause = " OR ".join(conditions)
        count = db.execute(
            text(f"SELECT COUNT(DISTINCT url) FROM translations WHERE timestamp >= :ts AND ({where_clause})"),
            params
        ).scalar() or 0
    else:
        count = 0

    # 소설 불문 전체 고유 URL 현재 쿼터 주기(16시/17시 기준) 번역 회차 수
    total_today_count = db.execute(
        text("SELECT COUNT(DISTINCT url) FROM translations WHERE timestamp >= :ts"),
        {"ts": window_start_ts}
    ).scalar() or 0

    return {
        "count": count,
        "novel_today_count": count,
        "total_today_count": total_today_count,
        "window_start_ts": window_start_ts,
        "today_start_ts": window_start_ts,
        "cutoff_hour": cutoff_hour,
        "is_us_dst": is_us_dst()
    }


@router.get(
    "/api/rpm_status",
    tags=["Translation"],
    summary="현재 RPM 및 최근 회차 번역 속도 상태 조회",
    description="최근 60초간의 API 호출 수(RPM)와 최근 5분간의 번역 회차 수를 조회하고 권장 지연 시간을 반환합니다."
)
def get_rpm_status():
    rpm = get_current_rpm(60.0)
    recent_episodes = get_recent_episode_count(300.0)

    turbo_delay_s = calculate_episode_adaptive_delay(recent_episodes, is_turbo=True)
    normal_delay_s = calculate_episode_adaptive_delay(recent_episodes, is_turbo=False)

    if rpm >= 12 or (recent_episodes >= 7 and rpm >= 9) or (recent_episodes >= 4 and rpm >= 11):
        zone = "red"
    elif rpm >= 9 or (recent_episodes >= 4 and rpm >= 7):
        zone = "yellow"
    else:
        zone = "green"

    return {
        "current_rpm": rpm,
        "recent_episodes_5m": recent_episodes,
        "zone": zone,
        "recommended_turbo_delay_seconds": turbo_delay_s,
        "recommended_normal_delay_seconds": normal_delay_s,
    }