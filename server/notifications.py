"""
ntfy 푸시 알림 매니저 모듈.
HTTP pub-sub 서비스인 ntfy(ntfy.sh 또는 자체 호스팅)를 통해 스마트폰(Android/iOS),
웹 브라우저 및 데스크톱으로 실시간 푸시 알림을 발송합니다.
"""

import json
import logging
import os
import threading
import time
from collections import deque
from typing import List, Optional, Dict, Any
import requests
from server.settings import settings

logger = logging.getLogger(__name__)

# 최근 알림 인메모리 링버퍼 (최근 50개 보관)
_NOTIFICATION_HISTORY = deque(maxlen=50)
_HISTORY_LOCK = threading.Lock()

# 실시간 로컬 SSE(Server-Sent Events) 구독자 큐 관리
_SSE_SUBSCRIBERS = set()
_SSE_LOCK = threading.Lock()

# Gemini API 오류 집계 통계
_API_ERROR_STATS = {
    "total": 0,
    "by_type": {}
}
_API_ERROR_LOCK = threading.Lock()

def record_api_error_stat(error_type: str):
    """Gemini API 오류 통계 기록."""
    with _API_ERROR_LOCK:
        _API_ERROR_STATS["total"] += 1
        clean_type = (error_type or "API_ERROR").strip()
        _API_ERROR_STATS["by_type"][clean_type] = _API_ERROR_STATS["by_type"].get(clean_type, 0) + 1

def get_api_error_stats() -> Dict[str, Any]:
    """Gemini API 오류 통계 요약 조회."""
    with _API_ERROR_LOCK:
        total = _API_ERROR_STATS["total"]
        by_type = dict(_API_ERROR_STATS["by_type"])
        if total == 0:
            summary_text = "오류 없음"
        else:
            items = [f"{k} {v}건" for k, v in by_type.items()]
            summary_text = f"{total}건 ({', '.join(items)})"
        return {
            "total": total,
            "by_type": by_type,
            "summary_text": summary_text
        }

def reset_api_error_stats():
    """API 오류 통계 리셋."""
    with _API_ERROR_LOCK:
        _API_ERROR_STATS["total"] = 0
        _API_ERROR_STATS["by_type"].clear()

# 현재 활성 번역 작업 상태 추적
_CURRENT_TRANSLATION_STATUS: Dict[str, Any] = {
    "is_active": False,
    "book_title": None,
    "current_episode_title": None,
    "current_sentence": 0,
    "total_sentences": 0,
    "percentage": 0,
    "episode_count": 0,
    "updated_at": 0,
    "status_text": "대기 중"
}
_STATUS_LOCK = threading.Lock()

def update_translation_status(
    book_title: Optional[str] = None,
    episode_title: Optional[str] = None,
    current_sentence: Optional[int] = None,
    total_sentences: Optional[int] = None,
    percentage: Optional[float] = None,
    episode_count: Optional[int] = None,
    is_active: bool = True,
    status_text: Optional[str] = None
):
    """현재 진행 중인 번역 상태 갱신."""
    with _STATUS_LOCK:
        now = int(time.time())
        _CURRENT_TRANSLATION_STATUS["is_active"] = is_active
        if book_title:
            _CURRENT_TRANSLATION_STATUS["book_title"] = book_title
        if episode_title:
            _CURRENT_TRANSLATION_STATUS["current_episode_title"] = episode_title
        if current_sentence is not None:
            _CURRENT_TRANSLATION_STATUS["current_sentence"] = current_sentence
        if total_sentences is not None:
            _CURRENT_TRANSLATION_STATUS["total_sentences"] = total_sentences

        api_calls = 0
        quota_limit = 500
        quota_pct = 0.0
        try:
            from server.quota import get_quota_summary
            q = get_quota_summary()
            api_calls = q["api_calls_today"]
            quota_limit = q["quota_limit"]
            quota_pct = q["percentage"]
        except Exception:
            pass

        eff_percentage = quota_pct if (percentage is None or percentage == 100) else percentage
        _CURRENT_TRANSLATION_STATUS["percentage"] = eff_percentage

        if episode_count is not None:
            _CURRENT_TRANSLATION_STATUS["episode_count"] = episode_count
        _CURRENT_TRANSLATION_STATUS["updated_at"] = now
        if status_text is not None:
            _CURRENT_TRANSLATION_STATUS["status_text"] = status_text
        elif is_active:
            ep = _CURRENT_TRANSLATION_STATUS.get("current_episode_title") or episode_title
            ep_str = f"[{ep}] " if ep else ""
            _CURRENT_TRANSLATION_STATUS["status_text"] = f"{ep_str}오늘 API {api_calls}/{quota_limit}회 ({quota_pct}%)"
        else:
            _CURRENT_TRANSLATION_STATUS["status_text"] = "번역 완료"

def get_translation_status() -> Dict[str, Any]:
    """현재 번역 상태 조회 (15분 이상 업데이트 없으면 비활성 처리, 최신 쿼터 상태 반영)."""
    with _STATUS_LOCK:
        data = dict(_CURRENT_TRANSLATION_STATUS)
        if data["is_active"] and (time.time() - data["updated_at"] > 900):
            data["is_active"] = False

        try:
            from server.quota import get_quota_summary
            q = get_quota_summary()
            data["api_calls_today"] = q["api_calls_today"]
            data["api_quota_limit"] = q["quota_limit"]
            data["quota_percentage"] = q["percentage"]
            data["quota_reset_hour"] = q["quota_reset_hour"]
            data["quota_window_start_ts"] = q["window_start_ts"]
            data["today_translations_count"] = q["today_translations_count"]

            # 4시(오후 4시/16시 또는 17시) 쿼터 초기화 시각이 지났다면 이전 회차 카운터 및 진행 상태 0으로 초기화
            if q["window_start_ts"] > _CURRENT_TRANSLATION_STATUS.get("updated_at", 0):
                _CURRENT_TRANSLATION_STATUS["episode_count"] = 0
                _CURRENT_TRANSLATION_STATUS["current_sentence"] = 0
                _CURRENT_TRANSLATION_STATUS["total_sentences"] = 0
                _CURRENT_TRANSLATION_STATUS["is_active"] = False
                data["episode_count"] = 0
                data["current_sentence"] = 0
                data["total_sentences"] = 0
                data["is_active"] = False
            elif not data.get("is_active"):
                # 유휴(대기 중) 상태에서는 이전 누적 표시 클리어 및 쿼터 사용률 표시
                data["episode_count"] = 0
                if q["percentage"] > 0 or data.get("percentage") in (0, 100, None):
                    data["percentage"] = q["percentage"]

            # 사용자 정의 status_text(휴식 중, 에러 등)가 설정된 경우 덮어쓰지 않고 보존
            curr_st = data.get("status_text")
            ep_str = f"[{data.get('current_episode_title')}] " if data.get('current_episode_title') else ""
            if not curr_st or curr_st in ("대기 중", "번역 완료") or "오늘 API" in curr_st:
                if data["is_active"]:
                    data["status_text"] = f"{ep_str}오늘 API {q['api_calls_today']}/{q['quota_limit']}회 ({q['percentage']}%)"
                else:
                    data["status_text"] = f"대기 중 (오늘 API {q['api_calls_today']}/{q['quota_limit']}회, {q['percentage']}%)"

        except Exception as e:
            logger.warning(f"[notifications] 쿼터 상태 반영 실패: {e}")

        try:
            from server.routers.translation import get_current_rpm
            data["current_rpm"] = get_current_rpm()
        except Exception:
            data["current_rpm"] = 0

        return data


def add_sse_subscriber(subscriber_queue):
    """실시간 로컬 알림 스트림 구독자 큐 등록."""
    with _SSE_LOCK:
        _SSE_SUBSCRIBERS.add(subscriber_queue)

def remove_sse_subscriber(subscriber_queue):
    """실시간 로컬 알림 스트림 구독자 큐 해제."""
    with _SSE_LOCK:
        _SSE_SUBSCRIBERS.discard(subscriber_queue)

def broadcast_notification(item: Dict[str, Any]):
    """연결된 모든 로컬 SSE 클라이언트로 알림 브로드캐스트."""
    with _SSE_LOCK:
        for q in list(_SSE_SUBSCRIBERS):
            try:
                q.put_nowait(item)
            except Exception:
                pass

def record_notification(
    title: str,
    message: str,
    event_type: str = "general",
    book_title: Optional[str] = None,
    chapter_title: Optional[str] = None,
    click_url: Optional[str] = None,
    priority: str = "default"
):
    """모바일 앱 및 웹 인앱 알림 센터 조회를 위한 알림 기록 함수."""
    with _HISTORY_LOCK:
        notif_id = f"notif_{int(time.time() * 1000)}_{len(_NOTIFICATION_HISTORY)}"
        item = {
            "id": notif_id,
            "title": title,
            "message": message,
            "type": event_type,
            "book_title": book_title,
            "chapter_title": chapter_title,
            "click_url": click_url,
            "priority": priority,
            "timestamp": int(time.time())
        }
        _NOTIFICATION_HISTORY.appendleft(item)
    broadcast_notification(item)

def get_recent_notifications(limit: int = 50) -> List[Dict[str, Any]]:
    """최근 알림 목록 조회."""
    with _HISTORY_LOCK:
        return list(_NOTIFICATION_HISTORY)[:limit]

def clear_recent_notifications():
    """알림 히스토리 초기화."""
    with _HISTORY_LOCK:
        _NOTIFICATION_HISTORY.clear()

PRIORITY_MAP = {
    "min": 1,
    "low": 2,
    "default": 3,
    "high": 4,
    "urgent": 5,
    "max": 5
}

def _send_ntfy_request(payload: Dict[str, Any], server_url: str, timeout: int = 5) -> bool:
    """ntfy 서버로 실제 HTTP POST 요청을 전송하는 내부 함수."""
    # [안전 가드] pytest 환경에서 mock되지 않은 실제 HTTP 외부 요청 원천 차단
    if os.environ.get("PYTEST_CURRENT_TEST") or os.environ.get("LANOVEL_TESTING"):
        from unittest.mock import Mock
        if not isinstance(requests.post, Mock):
            logger.debug(f"[ntfy] 테스트 환경 감지: 외부 HTTP 요청 차단 (title='{payload.get('title')}')")
            return True

    try:
        url = server_url.rstrip("/")
        resp = requests.post(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=timeout
        )
        if resp.status_code == 200:
            logger.info(f"[ntfy] 알림 전송 성공: topic='{payload.get('topic')}', title='{payload.get('title')}'")
            return True
        else:
            logger.warning(f"[ntfy] 알림 전송 응답 코드 {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        logger.warning(f"[ntfy] 알림 전송 실패: {e}")
        return False

def send_ntfy(
    title: str,
    message: str,
    priority: str = "default",
    tags: Optional[List[str]] = None,
    click_url: Optional[str] = None,
    actions: Optional[List[Dict[str, Any]]] = None,
    topic: Optional[str] = None,
    server: Optional[str] = None,
    synchronous: bool = False
) -> bool:
    """
    ntfy 푸시 알림을 발송합니다.
    기본적으로 논블로킹(데몬 스레드)으로 동작하여 메인 스레드나 번역 작업 흐름을 차단하지 않습니다.
    """
    active_topic = (topic or settings.ntfy_topic or "").strip()
    active_server = (server or settings.ntfy_server or "https://ntfy.sh").strip()

    # ntfy 외부 서비스 완전 분리: 설정이 비활성화되어 있으면 외부 HTTP 요청 원천 차단 (단, 명시적 topic 테스트는 허용)
    if not settings.ntfy_enabled and not topic:
        return False

    if not active_topic:
        logger.debug("[ntfy] 토픽명이 설정되지 않아 전송을 생략합니다.")
        return False

    num_priority = PRIORITY_MAP.get(str(priority).lower(), 3)
    if isinstance(priority, int):
        num_priority = priority

    payload: Dict[str, Any] = {
        "topic": active_topic,
        "title": title,
        "message": message,
        "priority": num_priority,
    }

    if tags:
        payload["tags"] = tags
    if click_url:
        payload["click"] = click_url
    if actions:
        payload["actions"] = actions

    if synchronous:
        return _send_ntfy_request(payload, active_server)
    else:
        thread = threading.Thread(
            target=_send_ntfy_request,
            args=(payload, active_server),
            daemon=True
        )
        thread.start()
        return True

def notify_translation_progress(
    novel_title: str,
    episode_title: str,
    current: int,
    total: int,
    percentage: int,
    url: Optional[str] = None
):
    """번역 진행도 마일스톤 알림 (25%, 50%, 75% 등)"""
    title = f"⏳ [번역 진행 {percentage}%] {novel_title or '소설'}"
    ep_info = f"[{episode_title}] " if episode_title else ""
    message = f"{ep_info}진행률: {percentage}% ({current}/{total} 문장)"
    click = url if url else None

    update_translation_status(
        book_title=novel_title,
        episode_title=episode_title,
        current_sentence=current,
        total_sentences=total,
        percentage=percentage,
        is_active=True
    )

    record_notification(
        title=title,
        message=message,
        event_type="progress",
        book_title=novel_title,
        chapter_title=episode_title,
        click_url=click,
        priority="default"
    )

    send_ntfy(
        title=title,
        message=message,
        priority="default",
        tags=["hourglass_flowing_sand"],
        click_url=click
    )

def notify_translation_complete(
    novel_title: str,
    episode_title: str,
    total_count: int,
    url: Optional[str] = None,
    episode_count: Optional[int] = None
):
    """소설 챕터 번역 완료 알림 (알림 탭 시 뷰어로 바로 이동)"""
    ep_prefix = f"[총 {episode_count}개 화 번역 완료] " if episode_count and episode_count > 1 else ""
    title = f"🎉 {ep_prefix}{novel_title or '소설'}" if ep_prefix else f"🎉 [번역 완료] {novel_title or '소설'}"
    ep_info = f"[{episode_title}]\n" if episode_title else ""
    detail = f"(총 {episode_count}개 화) " if episode_count and episode_count > 1 else ""
    message = f"{ep_info}{detail}총 {total_count}개 문장 번역이 완료되었습니다!"
    
    # 뷰어 직접 이동 링크 구성
    click_url = None
    if url:
        click_url = f"http://127.0.0.1:{settings.server_port}/viewer?url={url}"

    update_translation_status(
        book_title=novel_title,
        episode_title=episode_title,
        percentage=100,
        episode_count=episode_count,
        is_active=False,
        status_text="번역 완료"
    )

    record_notification(
        title=title,
        message=message,
        event_type="complete",
        book_title=novel_title,
        chapter_title=episode_title,
        click_url=click_url,
        priority="high"
    )

    send_ntfy(
        title=title,
        message=message,
        priority="high",
        tags=["tada", "books"],
        click_url=click_url
    )

def notify_episode_progress(
    novel_title: str,
    episode_title: str,
    episode_count: int,
    url: Optional[str] = None
):
    """10화 단위 번역 진행 마일스톤 알림 (10화, 20화, 30화 등 100% 완료 시)"""
    title = f"⏳ [번역 진행 {episode_count}화 완료] {novel_title or '소설'}"
    ep_info = f"[{episode_title}]\n" if episode_title else ""
    message = f"{ep_info}총 {episode_count}개 화 100% 번역 완료! 다음 화 번역을 계속 진행합니다."
    
    click_url = None
    if url:
        click_url = f"http://127.0.0.1:{settings.server_port}/viewer?url={url}"

    update_translation_status(
        book_title=novel_title,
        episode_title=episode_title,
        episode_count=episode_count,
        percentage=100,
        is_active=True
    )

    record_notification(
        title=title,
        message=message,
        event_type="episode_milestone",
        book_title=novel_title,
        chapter_title=episode_title,
        click_url=click_url,
        priority="default"
    )

    send_ntfy(
        title=title,
        message=message,
        priority="default",
        tags=["hourglass_flowing_sand", "books"],
        click_url=click_url
    )


def notify_api_error(
    error_title: str,
    message: str,
    error_type: str = "API ERROR",
    url: Optional[str] = None
):
    """API 과부하(503), 할당량 초과(429) 등 중요 오류 알림"""
    title = f"🚨 [{error_type}] {error_title}"
    body = message
    if url:
        body += f"\n대상 URL: {url}"

    record_api_error_stat(error_type)

    record_notification(
        title=title,
        message=body,
        event_type="error",
        click_url=url,
        priority="urgent"
    )

    send_ntfy(
        title=title,
        message=body,
        priority="urgent",
        tags=["warning", "rotating_light"],
        click_url=url
    )

def notify_verbatim_cleanup(
    novel_title: str,
    episode_title: str,
    count: int,
    url: Optional[str] = None,
    batch_id: Optional[str] = None
):
    """미번역 원문 복제 단락 자동 정리 감지 알림"""
    title = f"🧹 [원문 복붙 자동 정리] {novel_title or '소설'}"
    ep_info = f"[{episode_title}] " if episode_title else ""
    message = f"{ep_info}미번역 원문 복사 {count}개 단락이 감지되어 휴지통 및 알림 센터(배치: {batch_id or 'auto'})로 안전하게 격리되었습니다."
    
    click_url = f"http://127.0.0.1:{settings.server_port}/"
    record_notification(
        title=title,
        message=message,
        event_type="cleanup",
        book_title=novel_title,
        chapter_title=episode_title,
        click_url=click_url,
        priority="default"
    )

    send_ntfy(
        title=title,
        message=message,
        priority="default",
        tags=["broom"],
        click_url=click_url
    )

def notify_task_event(
    task_name: str,
    message: str,
    status: str = "SUCCESS",
    click_url: Optional[str] = None
):
    """Celery / 백그라운드 태스크 완료 알림"""
    is_success = status.upper() == "SUCCESS"
    title = f"✅ [{task_name}] 완료" if is_success else f"⚠️ [{task_name}] 실패"
    tags = ["white_check_mark"] if is_success else ["x"]
    
    record_notification(
        title=title,
        message=message,
        event_type="task",
        click_url=click_url,
        priority="default" if is_success else "high"
    )

    send_ntfy(
        title=title,
        message=message,
        priority="default",
        tags=tags,
        click_url=click_url
    )
