import collections
import logging
import random
import threading
import time
from typing import Optional
import requests

logger = logging.getLogger(__name__)

# --- Global State for Requests Session & RPM Sliding Window ---
_gemini_session = requests.Session()
_CALL_TIMESTAMPS = collections.deque()
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
        import sys
        if "server.routers.translation" in sys.modules:
            setattr(sys.modules["server.routers.translation"], "_gemini_session", new_session)
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


def proactive_rpm_rest(novel_title: Optional[str] = None, episode_title: Optional[str] = None):
    """
    Gemini API 호출 직전 최근 60초간의 호출 빈도(RPM)를 분석하여
    429(Rate Limit) 및 503(Overload)을 선제적으로 예방하는 적응형 휴식을 수행합니다.
    - 0~8 RPM (Green Zone): 지연 시간 0초 (최대 속도 유지)
    - 9~11 RPM (Yellow Zone): 1.5 ~ 3.5초 랜덤 미세 지연 (버스트 누적 완화)
    - 12+ RPM (Red Zone): 7.0 ~ 14.0초 랜덤 쿨링다운 + HTTP 세션 소켓 재생성(Session Rejuvenation)
    """
    current_rpm = get_current_rpm(60.0)

    if current_rpm >= 12:
        rest_time = round(random.uniform(7.0, 14.0), 2)
        logger.warning(
            f"[RPM 선제 방지] 최근 60초 RPM {current_rpm}회 감지 (과열 위험 구간). "
            f"{rest_time}초간 휴식 후 세션을 소켓 수준에서 재생성합니다."
        )
        try:
            from server.notifications import update_translation_status
            update_translation_status(
                book_title=novel_title,
                episode_title=episode_title,
                is_active=True,
                status_text=f"☕ RPM 과열 선제 방지 휴식 중... ({rest_time}초)"
            )
        except Exception:
            pass

        time.sleep(rest_time)
        recycle_gemini_session()

        try:
            from server.notifications import update_translation_status
            update_translation_status(
                book_title=novel_title,
                episode_title=episode_title,
                is_active=True,
                status_text=None
            )
        except Exception:
            pass

    elif current_rpm >= 9:
        rest_time = round(random.uniform(1.5, 3.5), 2)
        logger.info(
            f"[RPM 미세 조절] 최근 60초 RPM {current_rpm}회 감지 (주의 구간). "
            f"{rest_time}초간 미세 휴식합니다."
        )
        time.sleep(rest_time)
    else:
        # Green Zone (0 ~ 8 RPM): 0초 즉시 패스 (최대 처리량 달성)
        pass
