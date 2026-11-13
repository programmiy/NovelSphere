"""
LANOVEL Translation Recovery and Cleanup Service
Handles verbatim repetition cleanup, fallback recoveries, and recursive safety splitting.
"""

import json
import logging
import re
import time
from typing import List, Optional, Set, Tuple, Dict
import requests
from fastapi import HTTPException
from sqlalchemy.orm import Session

from server.models import Translation, TranslationTrash, CleanupNotification
from server.quota import record_api_call
from server.notifications import notify_verbatim_cleanup
from server.settings import settings
from server.services.rpm_manager import (
    recycle_gemini_session,
    _record_call_timestamp,
    proactive_rpm_rest,
    get_gemini_session,
)
from server.services.translation_engine import (
    call_gemini_api,
    parse_translation_response,
    post_process_translated_text,
    _build_translation_prompt,
    is_safety_blocked,
    TranslationItemInput,
)
from server.services.hdtrans_service import is_hdtrans_available, translate_paragraphs

logger = logging.getLogger(__name__)


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

    # 소설명 및 회차명 탐색 (동일 URL 우선, 미발견 시 동일 작품 prefix 역조회로 미분류 방지)
    sample_meta = db.query(Translation.folderName, Translation.title).filter(
        (Translation.url == clean_url) | (Translation.url == url),
        Translation.folderName.isnot(None),
        Translation.folderName != "",
        Translation.folderName != "미분류",
        Translation.folderName != "Unknown"
    ).first()

    if not sample_meta and not folder_name:
        novel_base_match = re.search(r'(https?://[^/]+/(?:works/\d+|n[a-z0-9]+|novels/\d+|novel/\d+))', clean_url)
        if novel_base_match:
            novel_base = novel_base_match.group(1)
            sample_meta = db.query(Translation.folderName, Translation.title).filter(
                Translation.url.startswith(novel_base),
                Translation.folderName.isnot(None),
                Translation.folderName != "",
                Translation.folderName != "미분류",
                Translation.folderName != "Unknown"
            ).first()

    if not sample_meta:
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

        matched_item = next(
            (x for x in verbatim_items if str(x.get("id")) == str(t.pid) or x.get("original") == t.original),
            None
        )
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

    # 해당 회차(동일 URL)에 보관된 전체 휴지통 건수 계산 (SSOT)
    trash_count = db.query(TranslationTrash).filter(
        (TranslationTrash.url == clean_url) | (TranslationTrash.url.startswith(clean_url + "#"))
    ).count()
    if trash_count == 0:
        trash_count = len(verbatim_items)

    # 동일 회차의 기존 활성 알림 조회 (중복 생성 방지 및 기존 알림 UPSERT)
    existing_notif = db.query(CleanupNotification).filter(
        CleanupNotification.is_dismissed == 0,
        (CleanupNotification.url == clean_url) | (CleanupNotification.url.startswith(clean_url + "#"))
    ).order_by(CleanupNotification.created_at.desc()).first()

    if existing_notif:
        existing_notif.batch_id = batch_id
        if novel_title and novel_title not in ("미분류", "Unknown"):
            existing_notif.novel_title = novel_title
        if episode_title and episode_title != clean_url:
            existing_notif.episode_title = episode_title
        existing_notif.deleted_count = trash_count
        existing_notif.created_at = now_ms
        notif = existing_notif

        # 동일 회차에 남아있던 과거 중복 활성 알림들은 대표 1건을 제외하고 모두 자동 정리
        other_active_notifs = db.query(CleanupNotification).filter(
            CleanupNotification.is_dismissed == 0,
            CleanupNotification.id != existing_notif.id,
            (CleanupNotification.url == clean_url) | (CleanupNotification.url.startswith(clean_url + "#"))
        ).all()
        for o_notif in other_active_notifs:
            o_notif.is_dismissed = 1
            o_notif.dismissed_at = now_ms // 1000

        # 해당 회차의 기존 TranslationTrash 항목들의 cleanup_batch_id도 이번 batch_id로 동기화
        db.query(TranslationTrash).filter(
            (TranslationTrash.url == clean_url) | (TranslationTrash.url.startswith(clean_url + "#"))
        ).update({TranslationTrash.cleanup_batch_id: batch_id}, synchronize_session=False)
    else:
        # 알림 시스템(CleanupNotification)에 신규 등록
        notif = CleanupNotification(
            batch_id=batch_id,
            novel_title=novel_title,
            episode_title=episode_title,
            url=clean_url,
            deleted_count=trash_count,
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

    # 실시간 알림 전송
    notify_verbatim_cleanup(
        novel_title=novel_title,
        episode_title=episode_title,
        count=len(verbatim_items),
        url=url,
        batch_id=batch_id
    )

    return batch_id


def _recover_verbatim_items(
    verbatim_detected_items: List[dict],
    items_to_translate: List[TranslationItemInput],
    translated_results: dict,
    api_url: str
) -> List[dict]:
    """
    배치 번역 중 기본 모델(Gemini Flash-Lite 등)의 JSON 스키마 제약으로 인해
    원문 에코잉(verbatim)이 발생한 항목들을 동일한 기본 모델로 재시도하여 정상 복구합니다.
    (대체 모델 사용 없이 오직 현재 요청된 기본 모델로만 복구를 수행합니다.)
    """
    if not verbatim_detected_items:
        return verbatim_detected_items

    recovered_ids = set()

    # 복구 대상 원문 항목 매핑
    target_orig_items = []
    for v_item in verbatim_detected_items:
        orig = next((it for it in items_to_translate if str(it.id) == str(v_item["id"])), None)
        if orig:
            target_orig_items.append(orig)

    if not target_orig_items:
        return verbatim_detected_items

    def _accept_if_valid(orig_item: TranslationItemInput, raw_trans: str, log_prefix: str) -> bool:
        if not raw_trans:
            return False
        processed, is_bad, _ = post_process_translated_text(orig_item.text, raw_trans)
        if is_bad:
            return False
        item_id_str = str(orig_item.id)
        logger.info(f"[{log_prefix}] ID: {orig_item.id} -> '{processed[:30]}...'")
        translated_results[item_id_str] = {
            "id": orig_item.id,
            "original": orig_item.text,
            "translated": processed,
            "censored": False,
            "verbatim": False,
            "verbatim_category": None,
        }
        recovered_ids.add(item_id_str)
        return True

    # -------------------------------------------------------------
    # [Step 1: 스마트 미니배치 복구 (대량 불량 건: 4개 이상)]
    # 언어 이탈(중국어 환각 등)이나 배치 에코잉으로 수십 개가 동시 불량인 경우,
    # 낱개로 수십 번 쪼개지 않고 15개 단위 미니배치로 재호출하여 
    # API 쿼터(RPD) 낭비와 RPM 급등을 95% 이상 방지합니다.
    # -------------------------------------------------------------
    if len(target_orig_items) >= 4:
        logger.info(
            f"[스마트 배치 복구] 총 {len(target_orig_items)}개 대량 불량/변형 문장 감지. "
            f"개별 분할 대신 미니배치 재번역을 우선 수행합니다."
        )
        batch_size = 15
        for i in range(0, len(target_orig_items), batch_size):
            chunk = target_orig_items[i:i + batch_size]
            try:
                api_input_json = json.dumps([
                    {"id": str(it.id), "text": str(it.text)}
                    for it in chunk
                ], ensure_ascii=False)

                mini_prompt = (
                    "Translate the following JSON array from Japanese to natural Korean.\n"
                    "CRITICAL REQUIREMENTS:\n"
                    "1. You MUST translate into natural, fluent KOREAN (한국어). Do NOT output Chinese (中文/汉字) or Japanese (日本語).\n"
                    "2. Translate each item independently and uniquely based only on its own text.\n"
                    "3. Do NOT repeat or carry over translations from other items.\n"
                    "4. Output plain Korean text ONLY without any HTML/XML tags (e.g., <span>, <s>, <b>, <p>) or strikethrough drafts.\n"
                    "5. Return ONLY a valid JSON array of objects with 'id' and 'translated':\n\n"
                    f"{api_input_json}"
                )

                retry_res = call_gemini_api(api_url, mini_prompt)
                cand = retry_res.get('candidates', [{}])[0]
                cand_text = cand.get('content', {}).get('parts', [{}])[0].get('text', '')
                if cand_text:
                    parsed_map = parse_translation_response(cand_text)
                    for item in chunk:
                        new_trans = parsed_map.get(str(item.id))
                        if new_trans:
                            _accept_if_valid(item, new_trans, "스마트 미니배치 복구 성공")
            except Exception as e:
                logger.warning(f"[스마트 미니배치 복구 중 예외 발생] chunk {i}~{i+len(chunk)}: {e}")

    # -------------------------------------------------------------
    # [Step 2: 잔여 개별 문장 정밀 복구 (1~3개 소량 잔여 문장)]
    # 미니배치 복구 후에도 여전히 복구되지 않은 문장이거나, 애초에 1~3개 소량이었던 경우만
    # 낱개 단일 문장 재시도를 진행합니다.
    # -------------------------------------------------------------
    remaining_items = [it for it in target_orig_items if str(it.id) not in recovered_ids]
    for orig_item in remaining_items:

        # 1차 시도: 동일 기본 모델로 단일 항목 JSON 요청
        try:
            single_payload = json.dumps([{"id": orig_item.id, "text": orig_item.text}], ensure_ascii=False)
            single_prompt = (
                "Translate this Japanese text into natural, fluent Korean.\n"
                "Do NOT include any HTML/XML tags (e.g., <span>, <s>, <b>) or strikethrough markup.\n"
                "Return ONLY a valid JSON array with 'id' and 'translated':\n"
                + single_payload
            )
            retry_res = call_gemini_api(api_url, single_prompt)
            cand = retry_res.get('candidates', [{}])[0]
            cand_text = cand.get('content', {}).get('parts', [{}])[0].get('text', '')
            parsed_map = parse_translation_response(cand_text)
            new_trans = parsed_map.get(str(orig_item.id), "")
            if _accept_if_valid(orig_item, new_trans, "기본모델 verbatim 복구 성공(단일 JSON)"):
                continue
        except Exception as e:
            logger.debug(f"[verbatim 단일 JSON 복구 시도 중 오류] ID: {orig_item.id}: {e}")

        # 2차 시도: 동일 기본 모델로 JSON 스키마 제약을 해제한 단일 일반 텍스트 번역 요청 (스키마 간섭 배제)
        try:
            headers = {"Content-Type": "application/json"}
            key = getattr(settings, "gemini_api_key", None)
            if key and "key=" not in api_url:
                headers["x-goog-api-key"] = key

            plain_payload = {
                "contents": [{
                    "parts": [{
                        "text": (
                            "Translate the following Japanese text into natural Korean. "
                            "Output ONLY plain translated Korean text without any HTML/XML tags (e.g., <span>, <s>, <b>), "
                            "strikethrough drafts, or explanations:\n"
                            f"{orig_item.text}"
                        )
                    }]
                }],
                "generationConfig": {
                    "temperature": 0.3
                }
            }
            proactive_rpm_rest()
            _record_call_timestamp()
            res = get_gemini_session().post(api_url, json=plain_payload, headers=headers, timeout=60)
            model_name = api_url.split('/models/')[1].split(':')[0] if '/models/' in api_url else 'gemini'
            record_api_call(model=model_name, status_code=res.status_code)
            if res.status_code in (429, 503):
                recycle_gemini_session()
            if res.ok:
                c_json = res.json()
                cand = c_json.get('candidates', [{}])[0]
                cand_text = cand.get('content', {}).get('parts', [{}])[0].get('text', '').strip()
                if _accept_if_valid(orig_item, cand_text, "기본모델 verbatim 복구 성공(단일 일반)"):
                    continue
        except Exception as e:
            logger.debug(f"[verbatim 단일 일반 복구 시도 중 오류] ID: {orig_item.id}: {e}")

    return [v for v in verbatim_detected_items if str(v["id"]) not in recovered_ids]


def _fallback_hdtrans_or_split(
    items: List[TranslationItemInput],
    reason: str,
    depth: int,
    api_url: str,
    wait_time_on_block: int
) -> Tuple[Dict[str, str], Set[str]]:
    """
    검열 발생 시 hdTrans(오프라인 번역 엔진)를 우선 사용하여 대체 번역을 수행하고,
    사용 불가능할 경우 기존 재귀 2분할 또는 Fast-Fail 로직으로 폴백합니다.
    """
    if is_hdtrans_available():
        logger.warning(
            f"[검열 대체 번역 - hdTrans] 분할 {depth}단계에서 검열 감지 ({reason}). "
            f"{len(items)}개 문장을 hdTrans 오프라인 엔진으로 즉시 번역합니다."
        )
        try:
            texts = [it.text for it in items]
            hd_results = translate_paragraphs(texts)
            translated_map = {str(it.id): trans for it, trans in zip(items, hd_results, strict=False)}
            return translated_map, set()
        except Exception as e:
            logger.error(f"[hdTrans 대체 번역 실패] {e}. 기존 분할/폴백 로직으로 진행합니다.")

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


def _translate_sub_batch_with_safety_split(
    items: List[TranslationItemInput],
    api_url: str,
    wait_time_on_block: int = 5,
    depth: int = 1
) -> Tuple[Dict[str, str], Set[str]]:
    """
    검열 발생 또는 파싱 실패 시 재귀적 2분할 번역을 수행합니다.
    - len(items) > 1: 분할하여 안전한 문장들 번역 계속 진행 (검열 감지 시 hdTrans 우선 대체 번역)
    - len(items) == 1: Fast-Fail 적용 (hdTrans 우선 대체 번역, 실패 시 '[검열로 인해 번역 생략]' 처리 후 다음으로 진행)
    반환값: (translated_map: dict, censored_ids: set)
    """
    if not items:
        return {}, set()

    sub_prompt = _build_translation_prompt(items)
    try:
        sub_data = call_gemini_api(api_url, sub_prompt)
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            recycle_gemini_session()
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
        return _fallback_hdtrans_or_split(items, reason, depth, api_url, wait_time_on_block)

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
            return _fallback_hdtrans_or_split(items, finish_reason, depth, api_url, wait_time_on_block)
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
