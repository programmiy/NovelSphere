"""
실시간 번역 진행도/완료 알림 및 로컬 SSE 스트림을 위한 API 라우터.
"""

import asyncio
import json
import logging
import queue
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from server.settings import settings, save_runtime_settings
from server.notifications import (
    record_notification,
    notify_translation_progress,
    notify_translation_complete,
    notify_episode_progress,
    get_recent_notifications,
    clear_recent_notifications,
    add_sse_subscriber,
    remove_sse_subscriber,
    get_translation_status,
    get_api_error_stats
)

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
logger = logging.getLogger(__name__)

class NotificationConfig(BaseModel):
    notification_progress_step: int = Field(default=100, description="진행도 알림 간격 (%) - 100은 100% 완료 시에만 알림")

class NotificationConfigUpdate(BaseModel):
    notification_progress_step: Optional[int] = None

class ProgressNotificationRequest(BaseModel):
    novel_title: Optional[str] = ""
    episode_title: Optional[str] = ""
    current: Optional[int] = 0
    total: Optional[int] = 0
    percentage: Optional[int] = 0
    episode_count: Optional[int] = None
    url: Optional[str] = None

class CompleteNotificationRequest(BaseModel):
    novel_title: Optional[str] = ""
    episode_title: Optional[str] = ""
    total_count: int
    episode_count: Optional[int] = None
    url: Optional[str] = None

@router.get("/config", summary="알림 설정 조회")
def get_notification_config():
    """현재 알림 설정을 조회합니다."""
    return {
        "notification_progress_step": settings.notification_progress_step,
    }

@router.post("/config", summary="알림 설정 저장")
def update_notification_config(payload: NotificationConfigUpdate):
    """알림 설정을 업데이트하고 영속적으로 저장합니다."""
    updates = {}
    if payload.notification_progress_step is not None:
        updates["notification_progress_step"] = payload.notification_progress_step

    if updates:
        save_runtime_settings(updates)

    return {
        "message": "알림 설정이 성공적으로 저장되었습니다.",
        "config": {
            "notification_progress_step": settings.notification_progress_step,
        }
    }

@router.post("/test", summary="실시간 테스트 알림 발송")
def send_test_notification():
    """모바일 앱 및 웹 클라이언트로 실시간 테스트 알림을 브로드캐스트합니다."""
    record_notification(
        title="🔔 [LANOVEL] 테스트 알림",
        message="실시간 작업 알림 스트림이 정상 작동 중입니다!",
        event_type="test",
        priority="high",
        click_url=f"http://127.0.0.1:{settings.server_port}/"
    )
    return {
        "success": True,
        "message": "실시간 테스트 알림이 성공적으로 브로드캐스트되었습니다."
    }

@router.post("/progress", summary="번역 진행률 알림 요청")
def receive_progress_notification(req: ProgressNotificationRequest):
    """클라이언트(확장 프로그램 등)에서 번역 진행률 알림을 서버로 전달받아 발송합니다."""
    # 1. 10화 단위 등 에피소드 누적 마일스톤 알림 요청 처리
    if req.episode_count is not None and req.episode_count > 0:
        notify_episode_progress(
            novel_title=req.novel_title,
            episode_title=req.episode_title,
            episode_count=req.episode_count,
            url=req.url
        )
        return {"status": "ok", "type": "episode_milestone"}

    # 2. 단일 회차 내부 진행률 알림 필터링 (100% 완료 시에만 알림 모드일 때 스킵)
    if settings.notification_progress_step >= 100 and (req.percentage or 0) < 100:
        return {"status": "skipped", "reason": "progress_step_100_percent_only"}

    notify_translation_progress(
        novel_title=req.novel_title,
        episode_title=req.episode_title,
        current=req.current or 0,
        total=req.total or 0,
        percentage=req.percentage or 0,
        url=req.url
    )
    return {"status": "ok"}

@router.post("/complete", summary="번역 완료 알림 요청")
def receive_complete_notification(req: CompleteNotificationRequest):
    """클라이언트(확장 프로그램 등)에서 번역 완료 알림을 서버로 전달받아 발송합니다."""
    notify_translation_complete(
        novel_title=req.novel_title,
        episode_title=req.episode_title,
        total_count=req.total_count,
        url=req.url,
        episode_count=req.episode_count
    )
    return {"status": "ok"}

@router.get("/recent", summary="최근 알림 히스토리 조회 (모바일/웹 인앱용)")
def get_recent_notifications_endpoint(limit: int = 50):
    """모바일 앱 및 웹 인앱 알림 센터에서 최근 발생한 알림 목록을 조회합니다."""
    notifications = get_recent_notifications(limit=limit)
    return {
        "status": "ok",
        "notifications": notifications,
        "count": len(notifications)
    }

@router.post("/clear", summary="알림 히스토리 초기화")
def clear_notifications_endpoint():
    """인앱 알림 센터의 모든 알림 내역을 비웁니다."""
    clear_recent_notifications()
    return {"status": "ok", "message": "알림 내역이 초기화되었습니다."}

@router.get("/stream", summary="실시간 알림 SSE 스트림 (순수 로컬 / 인앱용)")
async def notifications_stream(request: Request):
    """모바일 앱 및 웹 클라이언트가 직접 실시간 알림을 수신할 수 있는 SSE 스트림."""
    q = queue.Queue(maxsize=50)
    add_sse_subscriber(q)

    async def event_generator():
        try:
            yield ": connected\n\n"
            ping_counter = 0
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = q.get_nowait()
                    data_json = json.dumps(item, ensure_ascii=False)
                    yield f"event: notification\ndata: {data_json}\n\n"
                except queue.Empty:
                    await asyncio.sleep(0.5)
                    ping_counter += 1
                    if ping_counter >= 30:  # 15초마다 keep-alive 핑
                        ping_counter = 0
                        yield ": ping\n\n"
        finally:
            remove_sse_subscriber(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )

@router.get("/summary", summary="현재 번역 작업 현황 및 검수/API 오류 종합 요약")
def get_status_summary():
    """모바일 앱 상단 대시보드 및 라이브 현황판을 위한 초경량 종합 상태 API."""
    from server.database import SessionLocal
    from server.models import CleanupNotification
    
    review_count = 0
    try:
        with SessionLocal() as db:
            review_count = db.query(CleanupNotification).filter(CleanupNotification.is_dismissed == 0).count()
    except Exception as e:
        logger.warning(f"[notifications] 검수 대기 카운트 조회 실패: {e}")

    trans_status = get_translation_status()
    api_errors = get_api_error_stats()

    return {
        "status": "ok",
        "is_active": trans_status.get("is_active", False),
        "book_title": trans_status.get("book_title"),
        "current_episode_title": trans_status.get("current_episode_title"),
        "current_sentence": trans_status.get("current_sentence", 0),
        "total_sentences": trans_status.get("total_sentences", 0),
        "percentage": trans_status.get("percentage", 0),
        "episode_count": trans_status.get("episode_count", 0),
        "status_text": trans_status.get("status_text", "대기 중"),
        "review_pending_count": review_count,
        "api_errors": api_errors,
        "api_calls_today": trans_status.get("api_calls_today", 0),
        "api_quota_limit": trans_status.get("api_quota_limit", 500),
        "quota_reset_hour": trans_status.get("quota_reset_hour", 16),
        "quota_window_start_ts": trans_status.get("quota_window_start_ts", 0),
        "today_translations_count": trans_status.get("today_translations_count", 0),
        "today_episodes_count": trans_status.get("today_episodes_count", 0),
        "today_start_ts": trans_status.get("today_start_ts", 0),
        "current_rpm": trans_status.get("current_rpm", 0),
        "updated_at": trans_status.get("updated_at", 0)
    }




