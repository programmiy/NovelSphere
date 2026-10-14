"""
원격 제어 API 라우터. (모바일 앱 → 서버 → 크롬 확장)

앱용:   POST /api/remote/command, GET /api/remote/status, GET /api/remote/site_queue
확장용: WS /api/remote/ws, GET /api/remote/poll, POST /api/remote/report, POST /api/remote/ack
모든 엔드포인트는 REMOTE_TOKEN 검사 (헤더 X-Remote-Token 또는 쿼리 token).
"""

import asyncio
import hmac
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from server.remote_control import hub
from server.settings import settings

router = APIRouter(prefix="/api/remote", tags=["Remote"])
logger = logging.getLogger(__name__)


LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")


def _stored_credentials() -> list:
    """서버 미들웨어와 같은 자격증명 후보(해시/평문). 비어 있으면 인증 수단 없음."""
    creds = [settings.lanovel_auth_hash, settings.lanovel_auth_token, settings.remote_token]
    return [c.strip() for c in creds if c and c.strip()]


def _credential_ok(provided: Optional[str]) -> bool:
    from server.security import verify_token
    return any(verify_token(provided, stored) for stored in _stored_credentials())


def _extract_credential(request_headers, query_params) -> Optional[str]:
    return (
        request_headers.get("x-lanovel-key")
        or request_headers.get("x-remote-token")
        or query_params.get("key")
        or query_params.get("token")
    )


def require_token(request: Request):
    host = request.client.host if request.client else ""
    if host in LOOPBACK_HOSTS:
        return  # PC 본인(확장 포함): 서버 전체 정책과 동일하게 프리패스 (Origin은 상위 미들웨어가 검사)
    if not _stored_credentials():
        raise HTTPException(status_code=503, detail="서버에 인증 토큰이 설정되지 않아 외부 원격 제어가 비활성화되어 있습니다. .env의 LANOVEL_AUTH_HASH(또는 REMOTE_TOKEN)를 설정하세요.")
    if not _credential_ok(_extract_credential(request.headers, request.query_params)):
        raise HTTPException(status_code=401, detail="리모컨 인증 토큰이 올바르지 않습니다.")


class CommandRequest(BaseModel):
    type: str = Field(..., description="reload/next/cancel_next/prev/goto/pause/resume/turbo_on/turbo_off/retranslate/go_next_site")
    params: Dict[str, Any] = Field(default_factory=dict)


class ReportRequest(BaseModel):
    phase: str = "idle"
    text: str = ""
    url: str = ""
    book_title: str = ""
    chapter_title: str = ""
    percentage: int = 0
    delay_remaining_sec: int = 0
    next_scheduled: bool = False
    turbo: bool = False
    tab_id: Optional[int] = None


class AckRequest(BaseModel):
    id: str
    ok: bool = True
    message: str = ""


# ----------------------------- 앱용 -----------------------------
@router.post("/command")
async def send_command(req: CommandRequest, _: None = Depends(require_token)):
    try:
        cmd = hub.enqueue(req.type, req.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    delivered_ws = await _push_pending_to_ws()
    return {"ok": True, "command": cmd.to_dict(), "delivered_via_ws": delivered_ws,
            "extension_online": hub.is_extension_online()}


@router.get("/status")
async def get_status(_: None = Depends(require_token)):
    return hub.snapshot()


@router.get("/site_queue")
async def get_site_queue(_: None = Depends(require_token)):
    """[예약] 다음에 번역할 사이트 목록. 아직은 빈 목록."""
    return {"supported": bool(getattr(hub.site_queue, "supported", True)), "items": hub.site_queue.list_items()}


# ----------------------------- 확장용 -----------------------------
@router.get("/poll")
async def poll_commands(_: None = Depends(require_token)):
    """WebSocket이 끊겼을 때 확장이 주기적으로 호출. 호출 자체가 생존 신호."""
    hub.touch("poll")
    return {"commands": [c.to_dict() for c in hub.take_pending()]}


@router.post("/report")
async def report_status(req: ReportRequest, _: None = Depends(require_token)):
    hub.update_status(req.model_dump(), channel="poll")
    return {"ok": True}


@router.post("/ack")
async def ack_command(req: AckRequest, _: None = Depends(require_token)):
    if not hub.ack(req.id, req.ok, req.message):
        raise HTTPException(status_code=404, detail="알 수 없는 명령 id")
    return {"ok": True}


async def _push_pending_to_ws() -> bool:
    """연결된 확장 WebSocket으로 대기 중인 명령 전송. 하나라도 보내면 True."""
    if not hub.ws_clients:
        return False
    sent_any = False
    for ws in list(hub.ws_clients):
        pending = hub.take_pending()
        if not pending:
            break
        try:
            await ws.send_json({"type": "commands", "commands": [c.to_dict() for c in pending]})
            sent_any = True
        except Exception:
            hub.ws_clients.discard(ws)
            # 전송 실패 → 다시 폴링으로 가져갈 수 있게 되돌림
            for c in pending:
                c.status = "pending"
    return sent_any


@router.websocket("/ws")
async def extension_ws(ws: WebSocket):
    host = ws.client.host if ws.client else ""
    origin = ws.headers.get("origin", "")
    # 확장은 항상 PC 안에서만 접속한다. 외부 기기는 /command·/status 만 사용.
    if host not in LOOPBACK_HOSTS or not (not origin or origin.startswith("chrome-extension://")):
        await ws.close(code=4403)
        return
    await ws.accept()
    hub.ws_clients.add(ws)
    hub.touch("ws")
    logger.info("[remote] 확장 WebSocket 연결됨")
    try:
        await _push_pending_to_ws()   # 접속 직후 밀린 명령 전달
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            hub.touch("ws")
            if kind == "status":
                hub.update_status(msg.get("data") or {}, channel="ws")
            elif kind == "ack":
                hub.ack(str(msg.get("id", "")), bool(msg.get("ok", True)), str(msg.get("message", "")))
            elif kind == "ping":
                await ws.send_json({"type": "pong"})
            await _push_pending_to_ws()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"[remote] WebSocket 오류: {e}")
    finally:
        hub.ws_clients.discard(ws)
        logger.info("[remote] 확장 WebSocket 종료")
