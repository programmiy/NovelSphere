import time
import collections
from unittest.mock import patch, MagicMock
import pytest
import requests

import server.routers.translation as trans_module
from server.routers.translation import (
    get_current_rpm,
    _record_call_timestamp,
    recycle_gemini_session,
    proactive_rpm_rest,
    _CALL_TIMESTAMPS,
    _RPM_LOCK
)
from server.notifications import update_translation_status, get_translation_status


@pytest.fixture(autouse=True)
def clean_rpm_sliding_window():
    """각 테스트 전후로 슬라이딩 윈도우 덱을 깨끗이 초기화."""
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.clear()
    yield
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.clear()


def test_rpm_sliding_window_tracking():
    """슬라이딩 윈도우 호출 기록 및 60초 만료 정리 검증."""
    assert get_current_rpm(60.0) == 0

    now = time.time()
    # 5개의 최근 호출 기록 (0초 전, 10초 전, 20초 전, 30초 전, 50초 전)
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.extend([now - 50, now - 30, now - 20, now - 10, now])

    assert get_current_rpm(60.0) == 5

    # 65초 전 기록 추가 (60초 초과이므로 자동 제거되어야 함)
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.appendleft(now - 65)

    assert get_current_rpm(60.0) == 5


def test_green_zone_zero_delay():
    """Green Zone (0~8 RPM): 지연 시간 없이(0초) 즉시 통과하여 최대 처리량 유지."""
    now = time.time()
    with _RPM_LOCK:
        # 5회 호출 기록 (Green Zone)
        _CALL_TIMESTAMPS.extend([now - i for i in range(5)])

    with patch("time.sleep") as mock_sleep:
        proactive_rpm_rest()
        mock_sleep.assert_not_called()


def test_yellow_zone_jitter_sleep():
    """Yellow Zone (9~11 RPM): 1.5 ~ 3.5초 사이의 랜덤 미세 휴식 검증."""
    now = time.time()
    with _RPM_LOCK:
        # 10회 호출 기록 (Yellow Zone)
        _CALL_TIMESTAMPS.extend([now - i for i in range(10)])

    assert get_current_rpm(60.0) == 10

    with patch("time.sleep") as mock_sleep:
        proactive_rpm_rest()
        assert mock_sleep.called
        sleep_arg = mock_sleep.call_args[0][0]
        assert 1.5 <= sleep_arg <= 3.5


def test_red_zone_rest_and_session_rejuvenation():
    """Red Zone (12+ RPM): 7.0 ~ 14.0초 랜덤 쿨링다운 + HTTP 세션 소켓 재생성 + 상태 알림 검증."""
    now = time.time()
    with _RPM_LOCK:
        # 13회 호출 기록 (Red Zone)
        _CALL_TIMESTAMPS.extend([now - i for i in range(13)])

    assert get_current_rpm(60.0) == 13

    from server.services.rpm_manager import get_gemini_session
    old_session = get_gemini_session()

    with patch("time.sleep") as mock_sleep:
        proactive_rpm_rest(novel_title="테스트소설", episode_title="1화")
        assert mock_sleep.called
        sleep_arg = mock_sleep.call_args[0][0]
        assert 7.0 <= sleep_arg <= 14.0

    # 세션 소켓이 새로 재생성되었는지 확인
    new_session = get_gemini_session()
    assert new_session is not old_session
    assert isinstance(new_session, requests.Session)


def test_session_recycling():
    """recycle_gemini_session이 기존 세션을 닫고 새 인스턴스로 교체하는지 검증."""
    from server.services.rpm_manager import get_gemini_session
    original_session = get_gemini_session()
    recycle_gemini_session()
    recycled_session = get_gemini_session()

    assert original_session is not recycled_session
    assert isinstance(recycled_session, requests.Session)



def test_status_preservation_and_current_rpm():
    """휴식 중 설정된 status_text가 get_translation_status에서 덮어씌워지지 않고 유지되며 current_rpm이 노출되는지 검증."""
    now = time.time()
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.extend([now - 1, now - 2, now - 3])

    update_translation_status(
        book_title="테스트북",
        episode_title="10화",
        is_active=True,
        status_text="☕ RPM 과열 선제 방지 휴식 중... (8.4초)"
    )

    status = get_translation_status()
    assert status["status_text"] == "☕ RPM 과열 선제 방지 휴식 중... (8.4초)"
    assert status["current_rpm"] == 3
    assert status["book_title"] == "테스트북"
    assert status["current_episode_title"] == "10화"
