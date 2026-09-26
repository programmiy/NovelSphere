import datetime
import pytest
from server.database import engine, SessionLocal
from sqlalchemy import text
from server.models import Base

def is_us_dst(dt=None):
    if dt is None:
        dt = datetime.datetime.now()
    year = dt.year
    first_sun_mar = (6 - datetime.date(year, 3, 1).weekday()) % 7 + 1
    dst_start = datetime.datetime(year, 3, first_sun_mar + 7, 2, 0)
    first_sun_nov = (6 - datetime.date(year, 11, 1).weekday()) % 7 + 1
    dst_end = datetime.datetime(year, 11, first_sun_nov, 2, 0)
    return dst_start <= dt < dst_end

def get_quota_reset_hour(dt=None):
    return 16 if is_us_dst(dt) else 17

def get_current_quota_window_start(now=None):
    if now is None:
        now = datetime.datetime.now()
    reset_hour = get_quota_reset_hour(now)
    today_reset = now.replace(hour=reset_hour, minute=0, second=0, microsecond=0)
    if now >= today_reset:
        return today_reset
    else:
        return today_reset - datetime.timedelta(days=1)

def test_quota_window_calculation():
    # Summer time test (July): reset hour should be 16
    summer_dt_afternoon = datetime.datetime(2026, 7, 15, 18, 30)
    assert get_quota_reset_hour(summer_dt_afternoon) == 16
    start = get_current_quota_window_start(summer_dt_afternoon)
    assert start == datetime.datetime(2026, 7, 15, 16, 0)

    # Summer time morning (before 16:00): window start should be previous day 16:00
    summer_dt_morning = datetime.datetime(2026, 7, 15, 10, 0)
    start_morning = get_current_quota_window_start(summer_dt_morning)
    assert start_morning == datetime.datetime(2026, 7, 14, 16, 0)

    # Winter time test (December): reset hour should be 17
    winter_dt_afternoon = datetime.datetime(2026, 12, 15, 18, 30)
    assert get_quota_reset_hour(winter_dt_afternoon) == 17
    start_winter = get_current_quota_window_start(winter_dt_afternoon)
    assert start_winter == datetime.datetime(2026, 12, 15, 17, 0)

    # Winter time morning (before 17:00): window start should be previous day 17:00
    winter_dt_morning = datetime.datetime(2026, 12, 15, 12, 0)
    start_winter_m = get_current_quota_window_start(winter_dt_morning)
    assert start_winter_m == datetime.datetime(2026, 12, 14, 17, 0)

def test_server_quota_module():
    from server.quota import (
        is_us_dst as m_is_us_dst,
        get_quota_reset_hour as m_get_quota_reset_hour,
        get_current_quota_window_start as m_get_current_quota_window_start,
        get_quota_summary,
        record_api_call,
        Base,
        engine
    )
    # Ensure tables exist
    Base.metadata.create_all(bind=engine)
    
    # Record a test API call
    record_api_call(model="test-gemini", status_code=200)
    
    summary = get_quota_summary(quota_limit=500)
    assert "api_calls_today" in summary
    assert summary["api_calls_today"] >= 1
    assert summary["quota_limit"] == 500
    assert 0.0 <= summary["percentage"] <= 100.0
    assert summary["quota_reset_hour"] in (16, 17)
    assert "window_start_ts" in summary

