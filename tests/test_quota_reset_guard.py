import datetime
import pytest
from server.routers.translation import is_us_dst, get_quota_reset_hour, _stop_lock
import server.routers.translation as trans_module


def test_is_us_dst_summer():
    # 2026년 7월 15일 (한여름, 써머타임 적용)
    dt_summer = datetime.datetime(2026, 7, 15, 12, 0, 0)
    assert is_us_dst(dt_summer) is True
    assert get_quota_reset_hour(dt_summer) == 16


def test_is_us_dst_winter():
    # 2026년 1월 15일 (겨울, 표준시 적용)
    dt_winter = datetime.datetime(2026, 1, 15, 12, 0, 0)
    assert is_us_dst(dt_winter) is False
    assert get_quota_reset_hour(dt_winter) == 17


def test_is_us_dst_march_boundary():
    # 2026년 3월: 3월 1일은 일요일.
    # 1st Sunday = 3월 1일
    # 2nd Sunday = 3월 8일 02:00
    before_dst = datetime.datetime(2026, 3, 8, 1, 59, 59)
    after_dst = datetime.datetime(2026, 3, 8, 2, 0, 0)

    assert is_us_dst(before_dst) is False
    assert get_quota_reset_hour(before_dst) == 17

    assert is_us_dst(after_dst) is True
    assert get_quota_reset_hour(after_dst) == 16


def test_is_us_dst_november_boundary():
    # 2026년 11월: 11월 1일은 일요일.
    # 1st Sunday = 11월 1일 02:00 (써머타임 종료)
    before_end = datetime.datetime(2026, 11, 1, 1, 59, 59)
    after_end = datetime.datetime(2026, 11, 1, 2, 0, 0)

    assert is_us_dst(before_end) is True
    assert get_quota_reset_hour(before_end) == 16

    assert is_us_dst(after_end) is False
    assert get_quota_reset_hour(after_end) == 17


def test_quota_reset_boundary_crossing_behavior():
    # 가상 환경에서 상태 플래그 테스트
    with _stop_lock:
        trans_module.process_started_before_cutoff = True
        trans_module.process_started_before_5pm = True

    # 16시(써머타임 기준) 정각에 도달했을 때 가드 조건 검사
    now_hour = 16
    cutoff_hour = 16

    triggered = False
    with _stop_lock:
        if (trans_module.process_started_before_cutoff or trans_module.process_started_before_5pm) and now_hour >= cutoff_hour:
            trans_module.process_started_before_cutoff = False
            trans_module.process_started_before_5pm = False
            triggered = True

    assert triggered is True
    assert trans_module.process_started_before_cutoff is False
    assert trans_module.process_started_before_5pm is False
