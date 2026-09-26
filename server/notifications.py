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

    if not settings.ntfy_enabled and not topic:
        logger.debug("[ntfy] 알림이 비활성화되어 전송을 생략합니다.")
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
