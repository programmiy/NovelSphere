"""
Gemini API 일일 쿼터(RPD) 및 사용량 추적 모듈.
- 기본 번역 모델 일일 할당량(기본 500회)을 기준점으로 사용량 백분율 산출.
- 미국 태평양 자정(서머타임: 16:00 KST, 표준시: 17:00 KST)에 일일 쿼터 주기 자동 초기화.
- DB(api_call_logs)를 통해 영속적으로 API 호출 내역 보존.
"""

import time
import datetime
import logging
import threading
import zoneinfo
from typing import Optional, Dict, Any
from sqlalchemy import text
from server.database import SessionLocal, engine
from server.models import ApiCallLog, Base

logger = logging.getLogger(__name__)
_QUOTA_LOCK = threading.Lock()

try:
    _LA_TZ = zoneinfo.ZoneInfo("America/Los_Angeles")
    _KST_TZ = zoneinfo.ZoneInfo("Asia/Seoul")
except Exception:
    # tzdata 부재 환경 대비 완벽한 UTC 오프셋 fallback
    from datetime import timezone, timedelta
    _LA_TZ = timezone(timedelta(hours=-8))
    _KST_TZ = timezone(timedelta(hours=9))

__all__ = [
    "Base",
    "engine",
    "is_us_dst",
    "get_quota_reset_hour",
    "get_next_quota_reset_dt",
    "get_next_quota_reset_hour",
    "get_current_quota_window_start",
    "get_current_quota_window_start_ts",
    "get_quota_summary",
    "record_api_call",
    "DEFAULT_QUOTA_LIMIT",
]

# 쿼터 기본 할당량 (기본 모델 기준 500회)
DEFAULT_QUOTA_LIMIT = 500


def _to_kst_datetime(dt: Optional[datetime.datetime] = None) -> datetime.datetime:
    """입력 datetime을 KST 타임존(tz-aware) 객체로 표준화."""
    if dt is None:
        return datetime.datetime.now(_KST_TZ)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=_KST_TZ)
    return dt.astimezone(_KST_TZ)


def is_us_dst(dt: Optional[datetime.datetime] = None) -> bool:
    """
    미국 서머타임(Daylight Saving Time, PDT) 적용 여부 실시간 판별.
    IANA 타임존(America/Los_Angeles) 기준 실제 일광절약시간 적용 여부(dst != 0)를 판정합니다.
    """
    kst_dt = _to_kst_datetime(dt)
    la_dt = kst_dt.astimezone(_LA_TZ)
    dst = la_dt.dst()
    if dst is not None:
        return dst.total_seconds() > 0

    # Fallback (tzdata가 없는 초경량 환경): UTC 기준 정확한 서머타임 룰
    # 시작: 3월 둘째 일요일 02:00 PST (10:00 UTC)
    # 종료: 11월 첫째 일요일 02:00 PDT (09:00 UTC)
    utc_dt = kst_dt.astimezone(datetime.timezone.utc)
    year = utc_dt.year
    first_sun_mar = (6 - datetime.date(year, 3, 1).weekday()) % 7 + 1
    second_sun_mar = first_sun_mar + 7
    first_sun_nov = (6 - datetime.date(year, 11, 1).weekday()) % 7 + 1

    dst_start_utc = datetime.datetime(year, 3, second_sun_mar, 10, 0, tzinfo=datetime.timezone.utc)
    dst_end_utc = datetime.datetime(year, 11, first_sun_nov, 9, 0, tzinfo=datetime.timezone.utc)
    return dst_start_utc <= utc_dt < dst_end_utc


def get_current_quota_window_start(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """
    현재 유효한 Gemini API 일일 쿼터 주기의 시작 시각(KST, tz-naive)을 반환합니다.
    미국 태평양(America/Los_Angeles) 당일 자정(00:00:00)을 KST로 변환하여,
    서머타임 시작(3월) 및 해제(11월) 전환일에도 1초 오차 없이 정확한 시작점을 산출합니다.
    """
    kst_dt = _to_kst_datetime(now)
    la_dt = kst_dt.astimezone(_LA_TZ)
    la_midnight = la_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    return la_midnight.astimezone(_KST_TZ).replace(tzinfo=None)


def get_current_quota_window_start_ts(now: Optional[datetime.datetime] = None) -> int:
    """현재 쿼터 주기의 시작 시각을 Unix timestamp(초)로 반환합니다."""
    return int(get_current_quota_window_start(now).timestamp())


def get_next_quota_reset_dt(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """
    다음 Gemini API 일일 쿼터 리셋 예정 시각(KST, tz-naive)을 반환합니다.
    미국 태평양(America/Los_Angeles) 익일 자정(00:00:00)을 KST로 변환합니다.
    """
    kst_dt = _to_kst_datetime(now)
    la_dt = kst_dt.astimezone(_LA_TZ)
    la_today_midnight = la_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    la_tomorrow_midnight = (la_today_midnight + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return la_tomorrow_midnight.astimezone(_KST_TZ).replace(tzinfo=None)


def get_next_quota_reset_hour(now: Optional[datetime.datetime] = None) -> int:
    """다음 Gemini API 쿼터 리셋 예정 시각의 한국 시각 시간(16 또는 17)을 반환합니다."""
    return get_next_quota_reset_dt(now).hour


def get_quota_reset_hour(dt: Optional[datetime.datetime] = None) -> int:
    """
    현재 유효한 Gemini API 일일 쿼터 주기의 시작 기준 한국 시각 시간(16 또는 17) 반환:
    - 서머타임 윈도우(PDT): 한국 오후 4시 (16시)
    - 표준시 윈도우(PST): 한국 오후 5시 (17시)
    """
    return get_current_quota_window_start(dt).hour


def get_today_start(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """오늘 한국 시간(KST) 자정(00:00:00)을 반환합니다."""
    if now is None:
        now = datetime.datetime.now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def get_today_start_ts(now: Optional[datetime.datetime] = None) -> int:
    """오늘 한국 시간(KST) 자정(00:00:00)의 Unix timestamp(초)를 반환합니다."""
    return int(get_today_start(now).timestamp())


def record_api_call(model: Optional[str] = None, status_code: int = 200) -> None:
    """Gemini API 호출 내역을 DB에 기록합니다 (503 서비스 과부하는 계측에서 원천 제외)."""
    if status_code == 503:
        return
    now_ts = int(time.time())
    try:
        with SessionLocal() as db:
            log_entry = ApiCallLog(
                timestamp=now_ts,
                model=model,
                status_code=status_code
            )
            db.add(log_entry)
            db.commit()
    except Exception as e:
        logger.warning(f"[QuotaTracker] API 호출 기록 저장 실패: {e}")


def _seed_calls_from_translations_if_needed(db, window_start_ts: int) -> int:
    """
    최초 적용 시 기존 오늘자 번역 데이터(distinct timestamp)를 API 호출 건수로 동기화.
    """
    try:
        count = db.query(ApiCallLog).filter(
            ApiCallLog.timestamp >= window_start_ts,
            ApiCallLog.status_code != 503
        ).count()
        if count == 0:
            batch_times = db.execute(
                text("SELECT DISTINCT timestamp FROM translations WHERE timestamp >= :ts"),
                {"ts": window_start_ts}
            ).scalars().all()
            if batch_times:
                for ts in batch_times:
                    db.add(ApiCallLog(timestamp=ts, model="gemini-default", status_code=200))
                db.commit()
                logger.info(f"[QuotaTracker] 기존 오늘 번역 배치 {len(batch_times)}건을 API 호출 기록으로 자동 초기화했습니다.")
                return len(batch_times)
        return count
    except Exception as e:
        logger.warning(f"[QuotaTracker] API 호출 시드 실패: {e}")
        return 0


def get_today_api_call_count() -> int:
    """현재 쿼터 주기(오후 4시/5시 기준) 내의 유효 API 호출 횟수를 반환합니다 (503 과부하 제외)."""
    window_start_ts = get_current_quota_window_start_ts()
    with SessionLocal() as db:
        count = db.query(ApiCallLog).filter(
            ApiCallLog.timestamp >= window_start_ts,
            ApiCallLog.status_code != 503
        ).count()
        if count == 0:
            count = _seed_calls_from_translations_if_needed(db, window_start_ts)
        return count


def get_today_translations_count() -> int:
    """오늘(Gemini API 쿼터 초기화 16시/17시 KST 기준) 번역된 총 문단 수를 반환합니다."""
    window_ts = get_current_quota_window_start_ts()
    try:
        with SessionLocal() as db:
            count = db.execute(
                text("SELECT count(*) FROM translations WHERE timestamp >= :ts"),
                {"ts": window_ts}
            ).scalar()
            return count or 0
    except Exception as e:
        logger.warning(f"[QuotaTracker] 오늘 번역 문단 수 조회 실패: {e}")
        return 0


def get_today_episodes_count() -> int:
    """오늘(Gemini API 쿼터 초기화 16시/17시 KST 기준) 번역된 총 고유 회차(distinct URL) 수를 반환합니다."""
    window_ts = get_current_quota_window_start_ts()
    try:
        with SessionLocal() as db:
            count = db.execute(
                text("SELECT count(DISTINCT url) FROM translations WHERE timestamp >= :ts"),
                {"ts": window_ts}
            ).scalar()
            return count or 0
    except Exception as e:
        logger.warning(f"[QuotaTracker] 오늘 번역 회차 수 조회 실패: {e}")
        return 0


def get_quota_summary(quota_limit: int = DEFAULT_QUOTA_LIMIT) -> Dict[str, Any]:
    """
    현재 쿼터 주기 요약 정보를 반환합니다:
    - api_calls_today: 오늘 API 호출 횟수
    - quota_limit: 기본 모델 할당량 (기본 500)
    - percentage: 사용 백분율 (최대 100.0%)
    - raw_percentage: 초과분 포함 순수 백분율
    - quota_reset_hour: 현재 주기 시작 기준 초기화 시각 (16 또는 17)
    - next_reset_hour: 다음 쿼터 리셋 예정 시각 (16 또는 17)
    - next_reset_ts: 다음 쿼터 리셋 예정 Unix timestamp
    - window_start_ts: 현재 주기 시작 timestamp
    - today_start_ts: 현재 주기 시작 timestamp (16시/17시 기준)
    - today_translations_count: 현재 주기 내 번역된 문단 수
    - today_episodes_count: 현재 주기 내 번역된 회차(URL) 수
    - is_us_dst: 서머타임 적용 여부
    """
    calls = get_today_api_call_count()
    limit = quota_limit if quota_limit > 0 else DEFAULT_QUOTA_LIMIT
    raw_pct = round((calls / limit) * 100, 1)
    pct = min(raw_pct, 100.0)
    reset_hour = get_quota_reset_hour()
    next_reset_dt = get_next_quota_reset_dt()
    next_reset_hour = next_reset_dt.hour
    next_reset_ts = int(next_reset_dt.timestamp())
    window_start_ts = get_current_quota_window_start_ts()
    trans_count = get_today_translations_count()
    episodes_count = get_today_episodes_count()

    return {
        "api_calls_today": calls,
        "quota_limit": limit,
        "percentage": pct,
        "raw_percentage": raw_pct,
        "quota_reset_hour": reset_hour,
        "next_reset_hour": next_reset_hour,
        "next_reset_ts": next_reset_ts,
        "window_start_ts": window_start_ts,
        "today_start_ts": window_start_ts,
        "today_translations_count": trans_count,
        "today_episodes_count": episodes_count,
        "is_us_dst": is_us_dst()
    }
