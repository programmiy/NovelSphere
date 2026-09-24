"""
ntfy 푸시 알림 매니저 모듈.
HTTP pub-sub 서비스인 ntfy(ntfy.sh 또는 자체 호스팅)를 통해 스마트폰(Android/iOS),
웹 브라우저 및 데스크톱으로 실시간 푸시 알림을 발송합니다.
"""

import json
import logging
import threading
import requests
from typing import List, Optional, Dict, Any
from server.settings import settings

logger = logging.getLogger(__name__)

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
    send_ntfy(
        title=title,
        message=message,
        priority="default",
        tags=["broom"],
        click_url=f"http://127.0.0.1:{settings.server_port}/"
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
    send_ntfy(
        title=title,
        message=message,
        priority="default",
        tags=tags,
        click_url=click_url
    )
