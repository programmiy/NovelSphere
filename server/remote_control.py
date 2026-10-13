"""
모바일 앱 → PC 서버 → 크롬 확장 원격 제어 허브.

- 명령 큐: 앱이 보낸 명령을 보관하고, 확장에 WebSocket(메인) 또는 폴링(대체)으로 전달.
- 상태: 확장이 보고한 상태를 보관하고, 앱에 보여줄 한 줄 상태 글을 판정.
- 멈춤 감지: 진행 없음 / 확장 연결 끊김을 감지해 알림 발송.
- 사이트 목록 연동 틀: 나중에 '다음에 번역할 사이트 목록' 기능이 붙을 자리(SiteQueueProvider).
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

logger = logging.getLogger(__name__)

# --- 상수 ---
EXTENSION_TIMEOUT_SEC = 30        # 이 시간 동안 확장 신호가 없으면 '연결 끊김'
STALL_TIMEOUT_SEC = 5 * 60        # 진행률이 이 시간 동안 그대로면 '진행 없음'
COMMAND_TTL_SEC = 10 * 60         # 전달되지 못한 명령 보관 시간
MAX_COMMAND_HISTORY = 50

# 지원 명령. 앱에서 보내는 type 값.
COMMAND_TYPES = {
    "reload",          # 번역 탭 새로고침
    "next",            # 현재 화 번역 끝나면 다음화로 이동(예약)
    "cancel_next",     # 다음화 예약 취소
    "prev",            # 이전화로 즉시 이동
    "goto",            # params.url 로 즉시 이동
    "pause",           # 자동 번역/자동 다음화 일시정지
    "resume",          # 재개
    "turbo_on",
    "turbo_off",
    "retranslate",     # 현재 화 재번역
    "go_next_site",    # [예약] 사이트 목록의 다음 항목으로 이동 (SiteQueueProvider 필요)
}

# 확장이 보고하는 phase 값
PHASES = {
    "translating",     # 정상 번역 중
    "censor_split",    # 검열로 문단 분할 재시도 중
    "delay_wait",      # 요청 간격/API 제한 대기
    "paused",          # 사용자 일시정지
    "turbo_wait",      # 터보 모드 대기
    "idle",            # 할 일 없음 / 마지막 화 완료
}


# ---------------------------------------------------------------------------
# 사이트 목록 연동 틀 (아직 구현 안 함)
# ---------------------------------------------------------------------------
class SiteQueueProvider(Protocol):
    """'다음에 번역할 사이트 목록' 기능이 구현해야 하는 인터페이스."""

    def list_items(self) -> List[Dict[str, Any]]:
        """앱에 보여줄 목록. 각 항목 예: {"title": str, "url": str}"""
        ...

    def pop_next_url(self) -> Optional[str]:
        """다음에 이동할 URL을 꺼낸다. 없으면 None."""
        ...


class NullSiteQueueProvider:
    """기본값: 목록 기능이 없을 때. 항상 빈 목록."""

    supported = False

    def list_items(self) -> List[Dict[str, Any]]:
        return []

    def pop_next_url(self) -> Optional[str]:
        return None


# ---------------------------------------------------------------------------
# 데이터 구조
# ---------------------------------------------------------------------------
@dataclass
class RemoteCommand:
    id: str
    type: str
    params: Dict[str, Any]
    created_at: float
    status: str = "pending"   # pending → sent → done / failed / expired
    sent_at: Optional[float] = None
    result_message: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "params": self.params,
            "status": self.status,
            "created_at": self.created_at,
            "result_message": self.result_message,
        }


@dataclass
class ExtensionStatus:
    phase: str = "idle"
    raw_text: str = ""                  # 확장이 보낸 원문 상태 텍스트
    url: str = ""
    book_title: str = ""
    chapter_title: str = ""
    percentage: int = 0
    delay_remaining_sec: int = 0
    next_scheduled: bool = False
    turbo: bool = False
    tab_id: Optional[int] = None
    last_seen: float = 0.0              # 마지막 신호(상태 보고/WS ping/폴링)
    last_progress_at: float = 0.0       # 진행률이 마지막으로 변한 시각
    channel: str = "none"               # ws / poll / none


class RemoteHub:
    def __init__(self) -> None:
        self.commands: Dict[str, RemoteCommand] = {}
        self.status = ExtensionStatus()
        self.ws_clients: set = set()     # 연결된 확장 WebSocket
        self.site_queue: SiteQueueProvider = NullSiteQueueProvider()
        self._stall_alerted = False
        self._offline_alerted = False

    # --- 명령 ---
    def enqueue(self, cmd_type: str, params: Optional[Dict[str, Any]] = None) -> RemoteCommand:
        if cmd_type not in COMMAND_TYPES:
            raise ValueError(f"지원하지 않는 명령: {cmd_type}")
        params = dict(params or {})

        if cmd_type == "goto" and not str(params.get("url", "")).startswith(("http://", "https://")):
            raise ValueError("goto 명령에는 http(s) URL이 필요합니다.")

        if cmd_type == "go_next_site":
            url = self.site_queue.pop_next_url()
            if not url:
                raise ValueError("다음에 번역할 사이트 목록이 비어 있거나 아직 지원되지 않습니다.")
            cmd_type, params = "goto", {"url": url, "from_site_queue": True}

        self._purge_old()
        cmd = RemoteCommand(id=uuid.uuid4().hex[:12], type=cmd_type, params=params, created_at=time.time())
        self.commands[cmd.id] = cmd
        return cmd

    def take_pending(self) -> List[RemoteCommand]:
        """아직 전달 안 된 명령을 꺼내며 sent 로 표시(폴링/WS 공용)."""
        self._purge_old()
        out = []
        now = time.time()
        for cmd in sorted(self.commands.values(), key=lambda c: c.created_at):
            if cmd.status == "pending":
                cmd.status = "sent"
                cmd.sent_at = now
                out.append(cmd)
        return out

    def ack(self, cmd_id: str, ok: bool, message: str = "") -> bool:
        cmd = self.commands.get(cmd_id)
        if not cmd:
            return False
        cmd.status = "done" if ok else "failed"
        cmd.result_message = message
        return True

    def _purge_old(self) -> None:
        now = time.time()
        for cmd in self.commands.values():
            if cmd.status == "pending" and now - cmd.created_at > COMMAND_TTL_SEC:
                cmd.status = "expired"
        if len(self.commands) > MAX_COMMAND_HISTORY:
            keep = sorted(self.commands.values(), key=lambda c: c.created_at)[-MAX_COMMAND_HISTORY:]
            self.commands = {c.id: c for c in keep}

    def recent_commands(self, limit: int = 10) -> List[Dict[str, Any]]:
        items = sorted(self.commands.values(), key=lambda c: c.created_at, reverse=True)[:limit]
        return [c.to_dict() for c in items]

    # --- 상태 ---
    def touch(self, channel: str) -> None:
        self.status.last_seen = time.time()
        self.status.channel = channel

    def update_status(self, data: Dict[str, Any], channel: str = "ws") -> None:
        s = self.status
        now = time.time()
        phase = str(data.get("phase", s.phase))
        s.phase = phase if phase in PHASES else "idle"
        s.raw_text = str(data.get("text", ""))[:200]
        s.book_title = str(data.get("book_title", s.book_title))[:200]
        s.chapter_title = str(data.get("chapter_title", s.chapter_title))[:200]
        s.delay_remaining_sec = max(0, int(data.get("delay_remaining_sec", 0) or 0))
        s.next_scheduled = bool(data.get("next_scheduled", False))
        s.turbo = bool(data.get("turbo", False))
        s.tab_id = data.get("tab_id", s.tab_id)

        new_url = str(data.get("url", s.url))[:1000]
        pct = max(0, min(100, int(data.get("percentage", s.percentage) or 0)))
        if pct != s.percentage or s.last_progress_at == 0.0 or new_url != s.url:
            s.last_progress_at = now
        s.url = new_url
        s.percentage = pct
        self.touch(channel)

    def is_extension_online(self, now: Optional[float] = None) -> bool:
        now = now or time.time()
        return self.status.last_seen > 0 and (now - self.status.last_seen) <= EXTENSION_TIMEOUT_SEC

    def is_stalled(self, now: Optional[float] = None) -> bool:
        now = now or time.time()
        s = self.status
        return (
            self.is_extension_online(now)
            and s.phase == "translating"
            and s.last_progress_at > 0
            and (now - s.last_progress_at) >= STALL_TIMEOUT_SEC
        )

    def resolve_label(self, now: Optional[float] = None) -> Dict[str, str]:
        """앱 상태 카드에 표시할 한 줄 상태. (서버 오프라인은 앱이 직접 판단)"""
        now = now or time.time()
        s = self.status
        if not self.is_extension_online(now):
            return {"code": "extension_offline", "label": "🔌 확장 연결 끊김"}
        if s.phase == "censor_split":
            return {"code": "censor_split", "label": "🛑 검열로 인한 분할 중"}
        if s.phase == "paused":
            return {"code": "paused", "label": "⏸ 일시정지 (사용자)"}
        if s.phase == "delay_wait":
            sec = s.delay_remaining_sec
            return {"code": "delay_wait", "label": f"⏳ 딜레이로 임시 정지 ({sec}초 후 재개)" if sec else "⏳ 딜레이로 임시 정지"}
        if s.phase == "turbo_wait":
            return {"code": "turbo_wait", "label": "🌙 터보 대기"}
        if self.is_stalled(now):
            return {"code": "stalled", "label": "⚠️ 5분간 진행 없음"}
        if s.next_scheduled:
            return {"code": "next_scheduled", "label": "➡️ 다음화 이동 예약됨"}
        if s.phase == "translating":
            if s.turbo:
                return {"code": "turbo", "label": "⚡ 터보 진행 중"}
            return {"code": "running", "label": "🟢 정상 진행 중"}
        if s.phase == "idle":
            return {"code": "idle", "label": "✅ 대기 중"}
        return {"code": "other", "label": f"❓ {s.raw_text or '알 수 없는 상태'}"}

    def snapshot(self) -> Dict[str, Any]:
        now = time.time()
        s = self.status
        label = self.resolve_label(now)
        return {
            "state": label["code"],
            "label": label["label"],
            "extension_online": self.is_extension_online(now),
            "channel": s.channel if self.is_extension_online(now) else "none",
            "phase": s.phase,
            "url": s.url,
            "book_title": s.book_title,
            "chapter_title": s.chapter_title,
            "percentage": s.percentage,
            "delay_remaining_sec": s.delay_remaining_sec,
            "next_scheduled": s.next_scheduled,
            "turbo": s.turbo,
            "last_seen_ago_sec": int(now - s.last_seen) if s.last_seen else None,
            "last_progress_ago_sec": int(now - s.last_progress_at) if s.last_progress_at else None,
            "site_queue_supported": bool(getattr(self.site_queue, "supported", True)),
            "recent_commands": self.recent_commands(5),
        }

    # --- 멈춤 감지 ---
    def check_alerts(self, now: Optional[float] = None) -> Optional[Dict[str, str]]:
        """알림을 보내야 하면 {'title','message','event'} 반환(같은 상황에선 1회만)."""
        now = now or time.time()
        s = self.status

        if s.last_seen > 0 and not self.is_extension_online(now):
            if not self._offline_alerted:
                self._offline_alerted = True
                return {"title": "번역 확장 연결 끊김",
                        "message": f"{EXTENSION_TIMEOUT_SEC}초 넘게 번역 탭 신호가 없습니다. 탭이 닫혔거나 PC가 잠들었을 수 있어요.",
                        "event": "remote_offline"}
        else:
            self._offline_alerted = False

        if self.is_stalled(now):
            if not self._stall_alerted:
                self._stall_alerted = True
                return {"title": "번역이 멈춘 것 같아요",
                        "message": f"{s.chapter_title or s.book_title or '번역 탭'} 진행률 {s.percentage}%에서 5분간 변화가 없습니다.",
                        "event": "remote_stalled"}
        else:
            self._stall_alerted = False
        return None


hub = RemoteHub()


async def alert_monitor_loop(interval_seconds: int = 15) -> None:
    """lifespan 에서 asyncio.create_task 로 실행. 멈춤/끊김 시 알림 발송."""
    from server.notifications import record_notification, send_ntfy

    while True:
        try:
            alert = hub.check_alerts()
            if alert:
                record_notification(
                    title=alert["title"], message=alert["message"],
                    event_type=alert["event"], priority="high",
                )
                send_ntfy(title=alert["title"], message=alert["message"], priority="high", tags=["warning"])
                logger.warning(f"[remote] {alert['title']}: {alert['message']}")
        except Exception as e:
            logger.error(f"[remote] 알림 모니터 오류: {e}")
        await asyncio.sleep(interval_seconds)
