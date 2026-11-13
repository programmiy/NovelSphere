import datetime
from server.routers.translation import is_us_dst, get_quota_reset_hour, _stop_state
from server.quota import get_next_quota_reset_dt, get_next_quota_reset_hour


def test_is_us_dst_summer():
    # 2026년 7월 15일 (한여름, 써머타임 적용)
    dt_summer = datetime.datetime(2026, 7, 15, 12, 0, 0)
    assert is_us_dst(dt_summer) is True
    assert get_quota_reset_hour(dt_summer) == 16
    assert get_next_quota_reset_hour(dt_summer) == 16


def test_is_us_dst_winter():
    # 2026년 1월 15일 (겨울, 표준시 적용)
    dt_winter = datetime.datetime(2026, 1, 15, 12, 0, 0)
    assert is_us_dst(dt_winter) is False
    assert get_quota_reset_hour(dt_winter) == 17
    assert get_next_quota_reset_hour(dt_winter) == 17


def test_is_us_dst_march_boundary():
    # 2026년 3월: 3월 1일은 일요일.
    # 2nd Sunday = 3월 8일 02:00 PST (미국 현지 새벽 2시)
    # 한국(KST, UTC+9)은 PST(UTC-8)보다 17시간 빠르므로 한국 시간으로는 3월 8일 19:00:00 (오후 7시)에 전환됨.
    before_dst = datetime.datetime(2026, 3, 8, 18, 59, 59)
    after_dst = datetime.datetime(2026, 3, 8, 19, 0, 0)

    # 18:59:59 KST: 아직 서머타임 전(PST)
    assert is_us_dst(before_dst) is False
    assert get_quota_reset_hour(before_dst) == 17
    assert get_next_quota_reset_hour(before_dst) == 16  # 익일 자정(3/9)은 16시 리셋

    # 19:00:00 KST: 공식 서머타임 개시(PDT)
    assert is_us_dst(after_dst) is True
    # 당일 자정(3/8 00:00 LA)은 서머타임 전이었으므로 현재 윈도우 시작은 17시
    assert get_quota_reset_hour(after_dst) == 17
    # 다음 리셋(3/9 00:00 LA)은 서머타임 적용으로 16시
    assert get_next_quota_reset_hour(after_dst) == 16


def test_is_us_dst_november_boundary():
    # 2026년 11월: 11월 1일은 일요일.
    # 1st Sunday = 11월 1일 02:00 PDT (미국 현지 새벽 2시, 써머타임 공식 종료)
    # 한국(KST, UTC+9)은 PDT(UTC-7)보다 16시간 빠르므로 한국 시간으로는 11월 1일 18:00:00 (오후 6시)에 종료됨.
    before_end = datetime.datetime(2026, 11, 1, 17, 59, 59)
    after_end = datetime.datetime(2026, 11, 1, 18, 0, 0)

    # 17:59:59 KST: 아직 서머타임(PDT)
    assert is_us_dst(before_end) is True
    assert get_quota_reset_hour(before_end) == 16
    assert get_next_quota_reset_hour(before_end) == 17  # 다음 리셋(11/2)은 표준시 적용으로 17시

    # 18:00:00 KST: 공식 서머타임 종료(PST)
    assert is_us_dst(after_end) is False
    # 당일 자정(11/1 00:00 LA)은 서머타임 중이었으므로 현재 윈도우 시작은 16시
    assert get_quota_reset_hour(after_end) == 16
    # 다음 리셋(11/2 00:00 LA)은 표준시 적용으로 17시
    assert get_next_quota_reset_hour(after_end) == 17


def test_quota_stop_state_boundary_crossing():
    _stop_state.reset()
    target_dt = datetime.datetime(2026, 11, 1, 16, 0, 0)

    # 1. 1시간 전(15:30)에 번역 중 -> 무장됨, 503 안 뜸
    assert _stop_state.check_and_update(datetime.datetime(2026, 11, 1, 15, 30), target_dt) is False
    assert _stop_state._armed is True

    # 2. 정각(16:00)에 도달 -> 즉시 503 중단(True) 발생!
    assert _stop_state.check_and_update(datetime.datetime(2026, 11, 1, 16, 0, 0), target_dt) is True
    assert _stop_state._armed is False

    # 3. 16:01 재시작 (다음 타깃은 11월 2일 17:00) -> 오작동 없음
    target_next = datetime.datetime(2026, 11, 2, 17, 0, 0)
    assert _stop_state.check_and_update(datetime.datetime(2026, 11, 1, 16, 1, 0), target_next) is False


def test_quota_stop_state_dynamic_next_reset_dt():
    """
    실제 translate_texts() 라우터와 동일하게 매 시점 get_next_quota_reset_dt(now)를 동적으로 전달할 때,
    정각(17:00:00) 돌파 순간 next_reset_dt가 익일 17:00로 바뀌더라도 자가 무장 해제되지 않고
    정확히 최초 1회 중단(True)을 반환하는지 검증합니다.
    """
    _stop_state.reset()

    # 1. 16:59:48 KST (정각 12초 전) -> 오늘 17:00 타깃으로 무장됨, 중단 안 함
    t_before = datetime.datetime(2026, 11, 13, 16, 59, 48)
    assert _stop_state.check_and_update(t_before, get_next_quota_reset_dt(t_before)) is False
    assert _stop_state._armed is True

    # 2. 17:00:01 KST (정각 1초 후) -> get_next_quota_reset_dt는 내일(11/14 17:00)을 반환하지만,
    #    방금 통과한 오늘 17:00 타깃에 대해 정확히 1회 중단(True) 발동 후 무장 해제!
    t_cross = datetime.datetime(2026, 11, 13, 17, 0, 1)
    assert _stop_state.check_and_update(t_cross, get_next_quota_reset_dt(t_cross)) is True
    assert _stop_state._armed is False

    # 3. 17:00:06 KST (5초 뒤 재시작 또는 신데렐라 복구 요청) -> 추가 차단 없이 정상 통과(False)
    t_after = datetime.datetime(2026, 11, 13, 17, 0, 6)
    assert _stop_state.check_and_update(t_after, get_next_quota_reset_dt(t_after)) is False
    assert _stop_state._armed is False

