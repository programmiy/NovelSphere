import time
import collections
from unittest.mock import patch, MagicMock
import pytest
import requests

import server.routers.translation as trans_module
from server.routers.translation import (
    get_current_rpm,
    _record_call_timestamp,
    record_episode_translation,
    get_recent_episode_count,
    calculate_episode_adaptive_delay,
    get_rpm_status,
    recycle_gemini_session,
    proactive_rpm_rest,
    _CALL_TIMESTAMPS,
    _EPISODE_RECORDS,
    _RPM_LOCK
)
from server.notifications import update_translation_status, get_translation_status


@pytest.fixture(autouse=True)
def clean_rpm_sliding_window():
    """각 테스트 전후로 슬라이딩 윈도우 덱을 깨끗이 초기화."""
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.clear()
        _EPISODE_RECORDS.clear()
    yield
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.clear()
        _EPISODE_RECORDS.clear()


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


def test_episode_sliding_window_tracking():
    """회차 단위 슬라이딩 윈도우 기록, 만료 정리 및 30초 내 중복 방지 검증."""
    assert get_recent_episode_count(300.0) == 0

    # 서로 다른 3개 회차 기록
    record_episode_translation("https://kakuyomu.jp/works/1/episodes/101")
    record_episode_translation("https://kakuyomu.jp/works/1/episodes/102")
    record_episode_translation("https://kakuyomu.jp/works/1/episodes/103")

    assert get_recent_episode_count(300.0) == 3

    # 동일 회차 즉시 재진입 시 중복 카운트 방지
    record_episode_translation("https://kakuyomu.jp/works/1/episodes/103")
    assert get_recent_episode_count(300.0) == 3

    # 350초 전(5분 만료 초과) 기록은 자동 제거 확인
    now = time.time()
    with _RPM_LOCK:
        _EPISODE_RECORDS.appendleft((now - 350, "https://kakuyomu.jp/works/1/episodes/100"))

    assert get_recent_episode_count(300.0) == 3


def test_adaptive_delay_calculation():
    """최근 번역 회차 수에 따른 적응형 지연시간 계산 검증."""
    # 쾌속모드: 회차 수 증가에 따른 지연시간 가중 부여
    assert calculate_episode_adaptive_delay(0, is_turbo=True) == 8.0
    assert calculate_episode_adaptive_delay(2, is_turbo=True) == 8.0
    assert calculate_episode_adaptive_delay(3, is_turbo=True) == 15.0
    assert calculate_episode_adaptive_delay(4, is_turbo=True) == 22.0
    assert calculate_episode_adaptive_delay(5, is_turbo=True) == 30.0
    assert calculate_episode_adaptive_delay(6, is_turbo=True) == 40.0
    assert calculate_episode_adaptive_delay(8, is_turbo=True) == 55.0

    # 일반모드
    assert calculate_episode_adaptive_delay(3, is_turbo=False) == 60.0
    assert calculate_episode_adaptive_delay(5, is_turbo=False) == 75.0
    assert calculate_episode_adaptive_delay(8, is_turbo=False) == 90.0


def test_high_episode_velocity_triggers_yellow_zone():
    """최근 5분 번역 회차가 4화 이상일 때, 7 RPM에서도 선제적 Yellow Zone(2.5~4.5초)으로 완충 휴식하는지 검증."""
    now = time.time()
    # 4개 회차 기록
    with _RPM_LOCK:
        for i in range(4):
            _EPISODE_RECORDS.append((now - i * 10, f"https://syosetu.com/n1234/{i+1}"))
        # 7회 API 호출 (평소에는 Green Zone인 7 RPM)
        _CALL_TIMESTAMPS.extend([now - i for i in range(7)])

    assert get_recent_episode_count(300.0) == 4
    assert get_current_rpm(60.0) == 7

    with patch("time.sleep") as mock_sleep:
        proactive_rpm_rest()
        assert mock_sleep.called
        sleep_arg = mock_sleep.call_args[0][0]
        # 회차 급증 가중치로 2.5 ~ 4.5초 미세 휴식 부여
        assert 2.5 <= sleep_arg <= 4.5


def test_extreme_episode_velocity_triggers_red_zone():
    """최근 5분 번역 회차가 7화 이상일 때, 9 RPM에서도 선제적 Red Zone(8.5~16.5초)으로 진입 및 세션 재생성 검증."""
    now = time.time()
    # 7개 회차 기록
    with _RPM_LOCK:
        for i in range(7):
            _EPISODE_RECORDS.append((now - i * 10, f"https://syosetu.com/n1234/{i+1}"))
        # 9회 API 호출 (평소에는 Yellow Zone인 9 RPM)
        _CALL_TIMESTAMPS.extend([now - i for i in range(9)])

    assert get_recent_episode_count(300.0) == 7
    assert get_current_rpm(60.0) == 9

    from server.services.rpm_manager import get_gemini_session
    old_session = get_gemini_session()

    with patch("time.sleep") as mock_sleep:
        proactive_rpm_rest(novel_title="과열소설", episode_title="8화")
        assert mock_sleep.called
        sleep_arg = mock_sleep.call_args[0][0]
        assert 8.5 <= sleep_arg <= 16.5

    # 세션 소켓 재생성 확인
    new_session = get_gemini_session()
    assert new_session is not old_session


def test_rpm_status_endpoint():
    """GET /api/rpm_status 핸들러 응답 및 속성 검증."""
    now = time.time()
    with _RPM_LOCK:
        for i in range(5):
            _EPISODE_RECORDS.append((now - i * 10, f"https://novelup.plus/story/{i+1}"))
        _CALL_TIMESTAMPS.extend([now - i for i in range(8)])

    status = get_rpm_status()
    assert status["current_rpm"] == 8
    assert status["recent_episodes_5m"] == 5
    assert status["zone"] == "yellow"
    assert status["recommended_turbo_delay_seconds"] == 30.0
    assert status["recommended_normal_delay_seconds"] == 75.0
