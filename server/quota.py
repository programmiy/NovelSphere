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
from typing import Optional, Dict, Any
from sqlalchemy import text
from server.database import SessionLocal, engine
from server.models import ApiCallLog, Base

logger = logging.getLogger(__name__)
_QUOTA_LOCK = threading.Lock()

# 쿼터 기본 할당량 (기본 모델 기준 500회)
DEFAULT_QUOTA_LIMIT = 500


def is_us_dst(dt: Optional[datetime.datetime] = None) -> bool:
    """
    미국 서머타임(Daylight Saving Time, PDT) 적용 여부 판별.
    시작: 3월 둘째 주 일요일 02:00
    종료: 11월 첫째 주 일요일 02:00
    """
    if dt is None:
        dt = datetime.datetime.now()
    year = dt.year
    first_sun_mar = (6 - datetime.date(year, 3, 1).weekday()) % 7 + 1
    dst_start = datetime.datetime(year, 3, first_sun_mar + 7, 2, 0)

    first_sun_nov = (6 - datetime.date(year, 11, 1).weekday()) % 7 + 1
    dst_end = datetime.datetime(year, 11, first_sun_nov, 2, 0)

    return dst_start <= dt < dst_end


def get_quota_reset_hour(dt: Optional[datetime.datetime] = None) -> int:
    """
    Gemini API 일일 쿼터 초기화 시점(미국 태평양 자정)의 한국 시간(KST) 시간(hour) 반환:
    - 서머타임(PDT, UTC-7): 한국(UTC+9) 기준 오후 4시 (16시)
    - 표준시(PST, UTC-8): 한국(UTC+9) 기준 오후 5시 (17시)
    """
    return 16 if is_us_dst(dt) else 17


def get_today_start(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """오늘 한국 시간(KST) 자정(00:00:00)을 반환합니다."""
    if now is None:
        now = datetime.datetime.now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def get_today_start_ts(now: Optional[datetime.datetime] = None) -> int:
    """오늘 한국 시간(KST) 자정(00:00:00)의 Unix timestamp(초)를 반환합니다."""
    return int(get_today_start(now).timestamp())


def get_current_quota_window_start(now: Optional[datetime.datetime] = None) -> datetime.datetime:
    """
    현재 유효한 쿼터 주기의 시작 시각(KST)을 반환합니다.
    - 현재 시각이 오늘 reset_hour(16시 또는 17시) 이상인 경우 -> 오늘 reset_hour
    - 현재 시각이 오늘 reset_hour 미만인 경우 -> 어제 reset_hour
    """
    if now is None:
        now = datetime.datetime.now()
    reset_hour = get_quota_reset_hour(now)
    today_reset = now.replace(hour=reset_hour, minute=0, second=0, microsecond=0)
    if now >= today_reset:
        return today_reset
    else:
        return today_reset - datetime.timedelta(days=1)


def get_current_quota_window_start_ts(now: Optional[datetime.datetime] = None) -> int:
    """현재 쿼터 주기의 시작 시각을 Unix timestamp(초)로 반환합니다."""
    return int(get_current_quota_window_start(now).timestamp())


def record_api_call(model: Optional[str] = None, status_code: int = 200) -> None:
    """Gemini API 호출 내역을 DB에 기록합니다."""
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
        count = db.query(ApiCallLog).filter(ApiCallLog.timestamp >= window_start_ts).count()
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
    """현재 쿼터 주기(오후 4시/5시 기준) 내의 API 호출 횟수를 반환합니다."""
    window_start_ts = get_current_quota_window_start_ts()
    with SessionLocal() as db:
        count = db.query(ApiCallLog).filter(ApiCallLog.timestamp >= window_start_ts).count()
        if count == 0:
            count = _seed_calls_from_translations_if_needed(db, window_start_ts)
        return count


def get_today_translations_count() -> int:
    """오늘(자정 00:00:00 KST 기준) 번역된 총 문단 수를 반환합니다."""
    today_ts = get_today_start_ts()
    try:
        with SessionLocal() as db:
            count = db.execute(
                text("SELECT count(*) FROM translations WHERE timestamp >= :ts"),
                {"ts": today_ts}
            ).scalar()
            return count or 0
    except Exception as e:
        logger.warning(f"[QuotaTracker] 오늘 번역 문단 수 조회 실패: {e}")
        return 0


def get_today_episodes_count() -> int:
    """오늘(자정 00:00:00 KST 기준) 번역된 총 고유 회차(distinct URL) 수를 반환합니다."""
    today_ts = get_today_start_ts()
    try:
        with SessionLocal() as db:
            count = db.execute(
                text("SELECT count(DISTINCT url) FROM translations WHERE timestamp >= :ts"),
                {"ts": today_ts}
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
    - quota_reset_hour: 초기화 시각 (16 또는 17)
    - window_start_ts: 현재 주기 시작 timestamp
    - today_start_ts: 오늘 자정 timestamp
    - today_translations_count: 오늘 번역된 문단 수 (00:00 KST 기준)
    - today_episodes_count: 오늘 번역된 회차(URL) 수 (00:00 KST 기준)
    - is_us_dst: 서머타임 적용 여부
    """
    calls = get_today_api_call_count()
    limit = quota_limit if quota_limit > 0 else DEFAULT_QUOTA_LIMIT
    raw_pct = round((calls / limit) * 100, 1)
    pct = min(raw_pct, 100.0)
    reset_hour = get_quota_reset_hour()
    window_start_ts = get_current_quota_window_start_ts()
    today_start_ts = get_today_start_ts()
    trans_count = get_today_translations_count()
    episodes_count = get_today_episodes_count()

    return {
        "api_calls_today": calls,
        "quota_limit": limit,
        "percentage": pct,
        "raw_percentage": raw_pct,
        "quota_reset_hour": reset_hour,
        "window_start_ts": window_start_ts,
        "today_start_ts": today_start_ts,
        "today_translations_count": trans_count,
        "today_episodes_count": episodes_count,
        "is_us_dst": is_us_dst()
    }
