"""
ntfy 알림 설정 관리 및 진행도/완료/테스트 알림을 위한 API 라우터.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from server.settings import settings, save_runtime_settings
from server.notifications import (
    send_ntfy,
    notify_translation_progress,
    notify_translation_complete,
    notify_episode_progress
)

router = APIRouter(prefix="/api/notifications", tags=["Notifications"])
logger = logging.getLogger(__name__)

class NtfyConfig(BaseModel):
    ntfy_enabled: bool = Field(default=True, description="ntfy 활성화 여부")
    ntfy_server: str = Field(default="https://ntfy.sh", description="ntfy 서버 URL")
    ntfy_topic: str = Field(default="NovelSphere", description="ntfy 구독 토픽명")
    ntfy_progress_step: int = Field(default=100, description="진행도 알림 간격 (%) - 100은 100% 완료 시에만 알림")

class NtfyConfigUpdate(BaseModel):
    ntfy_enabled: Optional[bool] = None
    ntfy_server: Optional[str] = None
    ntfy_topic: Optional[str] = None
    ntfy_progress_step: Optional[int] = None

class TestNotificationRequest(BaseModel):
    topic: Optional[str] = None
    server: Optional[str] = None

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

@router.get("/config", summary="ntfy 알림 설정 조회")
def get_ntfy_config():
    """현재 ntfy 알림 설정을 조회합니다."""
    return {
        "ntfy_enabled": settings.ntfy_enabled,
        "ntfy_server": settings.ntfy_server,
        "ntfy_topic": settings.ntfy_topic,
        "ntfy_progress_step": settings.ntfy_progress_step,
    }

@router.post("/config", summary="ntfy 알림 설정 저장")
def update_ntfy_config(payload: NtfyConfigUpdate):
    """ntfy 알림 설정을 업데이트하고 영속적으로 저장합니다."""
    updates = {}
    if payload.ntfy_enabled is not None:
        updates["ntfy_enabled"] = payload.ntfy_enabled
    if payload.ntfy_server is not None:
        updates["ntfy_server"] = payload.ntfy_server.strip()
    if payload.ntfy_topic is not None:
        updates["ntfy_topic"] = payload.ntfy_topic.strip()
    if payload.ntfy_progress_step is not None:
        updates["ntfy_progress_step"] = payload.ntfy_progress_step

    if updates:
        save_runtime_settings(updates)

    return {
        "message": "ntfy 설정이 성공적으로 저장되었습니다.",
        "config": {
            "ntfy_enabled": settings.ntfy_enabled,
            "ntfy_server": settings.ntfy_server,
            "ntfy_topic": settings.ntfy_topic,
            "ntfy_progress_step": settings.ntfy_progress_step,
        }
    }

@router.post("/test", summary="ntfy 테스트 알림 발송")
def send_test_notification(req: TestNotificationRequest = None):
    """지정된 토픽 또는 기본 설정 토픽으로 테스트 푸시 알림을 즉시 발송합니다."""
    topic = (req.topic if req and req.topic else settings.ntfy_topic or "NovelSphere").strip()
    server = (req.server if req and req.server else settings.ntfy_server or "https://ntfy.sh").strip()

    success = send_ntfy(
        title="🔔 [LANOVEL] 테스트 알림",
        message=f"ntfy 푸시 알림이 정상적으로 연동되었습니다!\n토픽: {topic}\n서버: {server}",
        priority="high",
        tags=["bell", "tada"],
        topic=topic,
        server=server,
        click_url=f"http://127.0.0.1:{settings.server_port}/",
        synchronous=True
    )

    if not success:
        raise HTTPException(
            status_code=502,
            detail=f"ntfy 서버({server})로의 테스트 알림 전송에 실패했습니다. 서버 URL 및 네트워크 연결을 확인하세요."
        )

    return {
        "success": True,
        "message": f"'{topic}' 토픽으로 테스트 알림이 성공적으로 발송되었습니다."
    }

@router.post("/progress", summary="번역 진행률 알림 요청")
def receive_progress_notification(req: ProgressNotificationRequest):
    """클라이언트(확장 프로그램 등)에서 번역 진행률 알림을 서버로 전달받아 발송합니다."""
    if not settings.ntfy_enabled:
        return {"status": "skipped", "reason": "disabled"}

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
    if settings.ntfy_progress_step >= 100 and (req.percentage or 0) < 100:
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
    if not settings.ntfy_enabled:
        return {"status": "skipped", "reason": "disabled"}

    notify_translation_complete(
        novel_title=req.novel_title,
        episode_title=req.episode_title,
        total_count=req.total_count,
        url=req.url,
        episode_count=req.episode_count
    )
    return {"status": "ok"}

