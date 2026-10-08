import collections
import logging
import random
import threading
import time
from typing import Optional
import requests

logger = logging.getLogger(__name__)

try:
    from server.notifications import update_translation_status as _update_status
except ImportError:
    _update_status = None

# --- Global State for Requests Session & RPM Sliding Window ---
_gemini_session = requests.Session()
_CALL_TIMESTAMPS = collections.deque()
_EPISODE_RECORDS = collections.deque()  # tuple: (timestamp, url)
_RPM_LOCK = threading.Lock()


def get_gemini_session() -> requests.Session:
    """현재 활성화된 requests.Session 인스턴스를 반환합니다."""
    return _gemini_session


def recycle_gemini_session():
    """
    Gemini API 요청용 세션을 소켓 레벨에서 안전하게 재생성하여
    특정 엣지 노드에 고착된 TCP/TLS 연결 및 잠재적 과부하 상태를 해소합니다.
    """
    global _gemini_session
    old_session = _gemini_session
    try:
        new_session = requests.Session()
        _gemini_session = new_session
        old_session.close()
        logger.info("[Session Rejuvenation] Gemini requests.Session이 성공적으로 재생성되었습니다.")
    except Exception as e:
        logger.warning(f"[Session Rejuvenation] 세션 재생성 중 예외 발생: {e}")


def get_current_rpm(window_seconds: float = 60.0) -> int:
    """최근 window_seconds(기본 60초) 동안의 실제 API 호출 횟수(RPM)를 반환합니다."""
    now = time.time()
    cutoff = now - window_seconds
    with _RPM_LOCK:
        while _CALL_TIMESTAMPS and _CALL_TIMESTAMPS[0] < cutoff:
            _CALL_TIMESTAMPS.popleft()
        return len(_CALL_TIMESTAMPS)


def _record_call_timestamp():
    """API 호출 발생 시 타임스탬프를 슬라이딩 윈도우에 기록합니다."""
    with _RPM_LOCK:
        _CALL_TIMESTAMPS.append(time.time())


def record_episode_translation(url: str, novel_title: Optional[str] = None):
    """
    회차(URL) 단위 번역 시작 또는 완료 시 슬라이딩 윈도우에 기록합니다.
    동일 URL이 30초 내에 중복 진입할 경우(한 회차 내 여러 청크 호출) 중복 누적을 방지합니다.
    """
    clean_url = (url or "").split("#")[0].strip()
    if not clean_url:
        return
    now = time.time()
    with _RPM_LOCK:
        # 최근 30초 이내에 이미 기록된 동일 회차 URL이면 타임스탬프만 최신화
        for i in range(len(_EPISODE_RECORDS) - 1, -1, -1):
            ts, ep_url = _EPISODE_RECORDS[i]
            if ep_url == clean_url:
                if (now - ts) < 30.0:
                    _EPISODE_RECORDS[i] = (now, ep_url)
                    return
                break
        _EPISODE_RECORDS.append((now, clean_url))


def get_recent_episode_count(window_seconds: float = 300.0) -> int:
    """최근 window_seconds(기본 300초 = 5분) 동안 번역된 고유 회차(에피소드) 수를 반환합니다."""
    now = time.time()
    cutoff = now - window_seconds
    with _RPM_LOCK:
        while _EPISODE_RECORDS and _EPISODE_RECORDS[0][0] < cutoff:
            _EPISODE_RECORDS.popleft()
        distinct_urls = {ep_url for _, ep_url in _EPISODE_RECORDS}
        return len(distinct_urls)


def calculate_episode_adaptive_delay(recent_episodes: int, is_turbo: bool = True) -> float:
    """
    최근 번역된 회차 수에 따른 권장 대기 시간(초)을 산출합니다.
    최근 번역한 회차가 많을수록(짧은 소설 연속 번역 등) 분당 호출 폭증을 막기 위해 지연시간을 많이 부여합니다.
    """
    if is_turbo:
        if recent_episodes <= 2:
            return 8.0
        elif recent_episodes == 3:
            return 15.0
        elif recent_episodes == 4:
            return 22.0
        elif recent_episodes == 5:
            return 30.0
        elif recent_episodes == 6:
            return 40.0
        else:
            return 55.0
    else:
        if recent_episodes <= 4:
            return 60.0
        elif recent_episodes <= 6:
            return 75.0
        else:
            return 90.0


def proactive_rpm_rest(novel_title: Optional[str] = None, episode_title: Optional[str] = None, url: Optional[str] = None):
    """
    Gemini API 호출 직전 최근 60초간의 호출 빈도(RPM) 및 최근 5분간의 회차 번역 빈도를 종합 분석하여
    429(Rate Limit) 및 503(Overload)을 선제적으로 예방하는 적응형 휴식을 수행합니다.

    - 기본 구간:
      * 0~8 RPM: 0초 (최대 속도 유지)
      * 9~11 RPM: 1.5 ~ 3.5초 랜덤 미세 휴식
      * 12+ RPM: 7.0 ~ 14.0초 랜덤 쿨링다운 + HTTP 세션 재생성
    - 최근 번역 회차 가중치(Episode Throttling Weight):
      * 최근 5분간 4화 이상 번역 완료 시: RPM 7부터 Yellow Zone 진입, 11부터 Red Zone 진입
      * 최근 5분간 7화 이상 번역 완료 시: RPM 9부터 Red Zone(8.0~16.0초 쿨링다운) 진입
    """
    current_rpm = get_current_rpm(60.0)
    recent_episodes = get_recent_episode_count(300.0)

    is_high_velocity = (recent_episodes >= 4)
    is_extreme_velocity = (recent_episodes >= 7)

    # Red Zone 판단
    is_red = (
        current_rpm >= 12 or
        (is_extreme_velocity and current_rpm >= 9) or
        (is_high_velocity and current_rpm >= 11)
    )

    # Yellow Zone 판단
    is_yellow = not is_red and (
        current_rpm >= 9 or
        (is_high_velocity and current_rpm >= 7)
    )

    if is_red:
        min_rest = 7.0 if not is_extreme_velocity else 8.5
        max_rest = 14.0 if not is_extreme_velocity else 16.5
        rest_time = round(random.uniform(min_rest, max_rest), 2)

        reason = f"RPM {current_rpm}회"
        if recent_episodes >= 4:
            reason += f" (최근 5분 번역: {recent_episodes}화 급증)"

        logger.warning(
            f"[RPM 선제 방지] {reason} 감지 (과열 위험 구간). "
            f"{rest_time}초간 휴식 후 세션을 소켓 수준에서 재생성합니다."
        )
        if _update_status:
            try:
                status_msg = f"☕ RPM 과열 선제 방지 휴식 중... ({rest_time}초"
                if recent_episodes >= 4:
                    status_msg += f", 최근 {recent_episodes}화 급증 방어"
                status_msg += ")"
                _update_status(
                    book_title=novel_title,
                    episode_title=episode_title,
                    is_active=True,
                    status_text=status_msg
                )
            except Exception:
                pass

        time.sleep(rest_time)
        recycle_gemini_session()

        if _update_status:
            try:
                _update_status(
                    book_title=novel_title,
                    episode_title=episode_title,
                    is_active=True,
                    status_text=None
                )
            except Exception:
                pass

    elif is_yellow:
        min_rest = 1.5 if not is_high_velocity else 2.5
        max_rest = 3.5 if not is_high_velocity else 4.5
        rest_time = round(random.uniform(min_rest, max_rest), 2)

        reason = f"RPM {current_rpm}회"
        if recent_episodes >= 4:
            reason += f" (최근 5분 번역: {recent_episodes}화)"

        logger.info(
            f"[RPM 미세 조절] {reason} 감지 (주의 구간). "
            f"{rest_time}초간 미세 휴식합니다."
        )
        time.sleep(rest_time)
    else:
        # Green Zone: 지연 시간 0초 (최대 처리량 유지)
        pass
