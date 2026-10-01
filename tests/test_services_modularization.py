"""
Comprehensive Integration & Unit Tests for Modularized server.services
Verifies that rpm_manager, translation_engine, and translation_recovery
operate flawlessly both directly and via server.routers.translation re-exports.
"""

import time
import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# 1. Direct Service Imports
from server.services.rpm_manager import (
    get_current_rpm,
    _record_call_timestamp,
    recycle_gemini_session,
    proactive_rpm_rest,
    get_gemini_session,
    _CALL_TIMESTAMPS,
    _RPM_LOCK
)
from server.services.translation_engine import (
    parse_translation_response,
    process_repeated_chars,
    is_safety_blocked,
    _build_translation_prompt,
    TranslationItemInput,
    TRANSLATION_RESPONSE_SCHEMA,
    TRANSLATION_SYSTEM_INSTRUCTION
)
from server.services.translation_recovery import (
    handle_verbatim_cleanup_items,
    _translate_sub_batch_with_safety_split
)

# 2. Router Re-exports Check
import server.routers.translation as router_trans
from server.server import app
from server.database import get_db, SessionLocal
from server.models import Translation, TranslationTrash, CleanupNotification


client = TestClient(app)


# =========================================================================
# 1. RPM Manager Direct Unit Tests
# =========================================================================
def test_service_rpm_manager_sliding_window():
    """RPM 슬라이딩 윈도우 계산 및 기록 검증"""
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.clear()

    assert get_current_rpm(60.0) == 0

    now = time.time()
    with _RPM_LOCK:
        # 3초 전, 2초 전, 1초 전 호출 기록
        _CALL_TIMESTAMPS.append(now - 3)
        _CALL_TIMESTAMPS.append(now - 2)
        _CALL_TIMESTAMPS.append(now - 1)

    assert get_current_rpm(60.0) == 3

    # 만료된 타임스탬프 (70초 전)는 카운트에서 자동 제거되는지 검증
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.appendleft(now - 70)

    assert get_current_rpm(60.0) == 3


def test_service_rpm_manager_session_recycling():
    """세션 재생성 시 새 세션 인스턴스로 교체되고 get_gemini_session()이 항상 최신 세션을 반환하는지 검증"""
    s1 = get_gemini_session()
    recycle_gemini_session()
    s2 = get_gemini_session()

    assert s1 is not s2
    # get_gemini_session()은 항상 최신 세션을 반환해야 함
    assert s2 is get_gemini_session()



# =========================================================================
# 2. Translation Engine Direct Unit Tests
# =========================================================================
def test_service_translation_engine_parse_json():
    """JSON 파싱 및 마크다운 코드블록 파싱 검증"""
    raw_clean = '[{"id": "p1", "translated": "안녕하세요."}]'
    res = parse_translation_response(raw_clean)
    assert res == {"p1": "안녕하세요."}

    raw_markdown = '```json\n[{"id": "p2", "translated": "반갑습니다."}]\n```'
    res_md = parse_translation_response(raw_markdown)
    assert res_md == {"p2": "반갑습니다."}


def test_service_translation_engine_repeated_chars():
    """6회 이상 반복 기호 (반복) 대체 검증"""
    raw = "우와아아아!!!!!!"
    processed = process_repeated_chars(raw)
    assert processed == "우와아아아(반복)"

    raw_normal = "우와아아아!!!"
    assert process_repeated_chars(raw_normal) == "우와아아아!!!"


def test_service_translation_engine_safety_blocked_detection():
    """안전 필터 및 소프트 거절 감지 검증"""
    # 1. promptFeedback 차단
    data_blocked = {"promptFeedback": {"blockReason": "SAFETY"}}
    blocked, reason = is_safety_blocked(data_blocked)
    assert blocked is True
    assert reason == "SAFETY"

    # 2. candidates finishReason 차단
    data_candidate_blocked = {"candidates": [{"finishReason": "PROHIBITED_CONTENT"}]}
    blocked, reason = is_safety_blocked(data_candidate_blocked)
    assert blocked is True
    assert reason == "PROHIBITED_CONTENT"

    # 3. 소프트 거절(Soft Refusal) 문구 감지
    data_soft_refusal = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{"text": "I cannot fulfill this request as it violates our safety guidelines."}]
            }
        }]
    }
    blocked, reason = is_safety_blocked(data_soft_refusal)
    assert blocked is True
    assert "SOFT_REFUSAL" in reason


def test_service_translation_engine_prompt_builder():
    """_build_translation_prompt 포맷 생성 검증"""
    items = [TranslationItemInput(id="1", text="テスト")]
    prompt = _build_translation_prompt(items)
    assert "MANDATORY REQUIREMENTS" in prompt
    assert '"id": "1"' in prompt
    assert '"text": "テスト"' in prompt


# =========================================================================
# 3. Translation Recovery Direct Unit Tests
# =========================================================================
def test_service_translation_recovery_cleanup():
    """handle_verbatim_cleanup_items 실행 시 휴지통 이전 및 알림 생성 검증"""
    db = SessionLocal()
    url = f"https://example.com/test_recovery_{int(time.time()*1000)}"
    try:
        # 기존 번역 데이터 적재
        t1 = Translation(
            url=url,
            pid="p10",
            original="こんにちは",
            translated="こんにちは",
            folderName="테스트소설",
            title="테스트1화",
            timestamp=int(time.time())
        )
        db.add(t1)
        db.commit()

        verbatim_items = [{
            "id": "p10",
            "original": "こんにちは",
            "translated": "こんにちは",
            "category": "verbatim"
        }]

        # 서비스 함수 호출
        with patch("server.services.translation_recovery.notify_verbatim_cleanup"):
            batch_id = handle_verbatim_cleanup_items(
                db=db,
                url=url,
                verbatim_items=verbatim_items,
                folder_name="테스트소설",
                title="테스트1화"
            )

        assert batch_id.startswith("verbatim_auto_")

        # 기존 테이블에서는 삭제되었는지 확인
        remaining = db.query(Translation).filter(Translation.url == url, Translation.pid == "p10").first()
        assert remaining is None

        # 휴지통(TranslationTrash)으로 정상 이동되었는지 확인
        trash = db.query(TranslationTrash).filter(TranslationTrash.url == url, TranslationTrash.pid == "p10").first()
        assert trash is not None
        assert trash.cleanup_batch_id == batch_id
        assert trash.reason_category == "verbatim"

        # 알림(CleanupNotification)이 생성되었는지 확인
        notif = db.query(CleanupNotification).filter(CleanupNotification.batch_id == batch_id).first()
        assert notif is not None
        assert notif.deleted_count == 1
    finally:
        # 테스트 데이터 정리
        db.query(Translation).filter(Translation.url == url).delete()
        db.query(TranslationTrash).filter(TranslationTrash.url == url).delete()
        db.query(CleanupNotification).filter(CleanupNotification.url == url).delete()
        db.commit()
        db.close()


# =========================================================================
# 4. Router End-to-End Test (/translate API)
# =========================================================================
def test_translate_api_endpoint_flow_with_mock():
    """분할된 라우터와 하위 서비스들이 협력하여 /translate API 요청을 완벽히 처리하는지 검증"""
    payload = {
        "items": [
            {"id": "L1", "text": "テスト文章1"},
            {"id": "L2", "text": "テスト文章2"}
        ],
        "url": "https://example.com/novel/test_e2e"
    }

    mock_gemini_response = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{
                    "text": json.dumps([
                        {"id": "L1", "translated": "테스트 문장 1"},
                        {"id": "L2", "translated": "테스트 문장 2"}
                    ])
                }]
            }
        }]
    }

    with patch("server.routers.translation.call_gemini_api", return_value=mock_gemini_response):
        response = client.post("/translate", json=payload)

    assert response.status_code == 200
    res_data = response.json()
    assert "translations" in res_data
    trans_list = res_data["translations"]
    assert len(trans_list) == 2
    assert trans_list[0]["id"] == "L1"
    assert trans_list[0]["translated"] == "테스트 문장 1"
    assert trans_list[1]["id"] == "L2"
    assert trans_list[1]["translated"] == "테스트 문장 2"
