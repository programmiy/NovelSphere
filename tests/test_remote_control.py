import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server.remote_control import (
    EXTENSION_TIMEOUT_SEC,
    STALL_TIMEOUT_SEC,
    RemoteHub,
)
from server.routers import remote as remote_router
from server.settings import settings


# ---------- 허브 단위 테스트 ----------
def _online_hub(**status):
    h = RemoteHub()
    h.update_status({"phase": "translating", "percentage": 10, "url": "https://x/1", **status})
    return h


def test_label_extension_offline_when_never_seen():
    assert RemoteHub().resolve_label()["code"] == "extension_offline"


def test_label_priority_and_phases():
    assert _online_hub().resolve_label()["code"] == "running"
    assert _online_hub(turbo=True).resolve_label()["code"] == "turbo"
    assert _online_hub(phase="censor_split").resolve_label()["code"] == "censor_split"
    assert _online_hub(phase="paused").resolve_label()["code"] == "paused"
    d = _online_hub(phase="delay_wait", delay_remaining_sec=47).resolve_label()
    assert d["code"] == "delay_wait" and "47" in d["label"]
    assert _online_hub(phase="turbo_wait").resolve_label()["code"] == "turbo_wait"
    assert _online_hub(next_scheduled=True).resolve_label()["code"] == "next_scheduled"
    assert _online_hub(phase="idle").resolve_label()["code"] == "idle"


def test_extension_goes_offline_after_timeout():
    h = _online_hub()
    later = time.time() + EXTENSION_TIMEOUT_SEC + 1
    assert h.resolve_label(later)["code"] == "extension_offline"


def test_stall_detected_only_without_progress():
    h = _online_hub()
    later = time.time() + STALL_TIMEOUT_SEC + 1
    h.status.last_seen = later          # 확장은 살아 있지만 진행률이 그대로
    assert h.resolve_label(later)["code"] == "stalled"
    h.update_status({"phase": "translating", "percentage": 11, "url": "https://x/1"})
    assert h.resolve_label()["code"] == "running"


def test_alerts_fire_once():
    h = _online_hub()
    later = time.time() + STALL_TIMEOUT_SEC + 1
    h.status.last_seen = later
    first = h.check_alerts(later)
    assert first and first["event"] == "remote_stalled"
    assert h.check_alerts(later) is None

    gone = later + EXTENSION_TIMEOUT_SEC + 1
    off = h.check_alerts(gone)
    assert off and off["event"] == "remote_offline"
    assert h.check_alerts(gone) is None


def test_command_validation_and_delivery():
    h = RemoteHub()
    with pytest.raises(ValueError):
        h.enqueue("rm_rf")
    with pytest.raises(ValueError):
        h.enqueue("goto", {"url": "javascript:alert(1)"})
    c = h.enqueue("reload")
    assert [x.id for x in h.take_pending()] == [c.id]
    assert h.take_pending() == []        # 두 번 전달되지 않음
    assert h.ack(c.id, True, "ok") and h.commands[c.id].status == "done"


def test_go_next_site_without_provider_is_rejected_then_works_with_provider():
    h = RemoteHub()
    with pytest.raises(ValueError):
        h.enqueue("go_next_site")

    class Fake:
        supported = True
        def list_items(self): return [{"title": "t", "url": "https://n/1"}]
        def pop_next_url(self): return "https://n/1"

    h.site_queue = Fake()
    cmd = h.enqueue("go_next_site")
    assert cmd.type == "goto" and cmd.params["url"] == "https://n/1"


# ---------- API 테스트 ----------
@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "remote_token", "secret-token")
    fresh = RemoteHub()
    monkeypatch.setattr(remote_router, "hub", fresh)
    app = FastAPI()
    app.include_router(remote_router.router)
    return TestClient(app), fresh


H = {"X-Remote-Token": "secret-token"}


def test_api_rejects_missing_or_wrong_token(client):
    c, _ = client
    assert c.get("/api/remote/status").status_code == 401
    assert c.get("/api/remote/status", headers={"X-Remote-Token": "nope"}).status_code == 401


def test_api_disabled_when_token_unset(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(settings, "remote_token", "")
    assert c.get("/api/remote/status", headers=H).status_code == 503


def test_api_command_poll_ack_flow(client):
    c, hub = client
    r = c.post("/api/remote/command", json={"type": "reload"}, headers=H)
    assert r.status_code == 200
    cid = r.json()["command"]["id"]
    polled = c.get("/api/remote/poll", headers=H).json()["commands"]
    assert [x["id"] for x in polled] == [cid]
    assert c.post("/api/remote/ack", json={"id": cid, "ok": True}, headers=H).status_code == 200
    assert c.get("/api/remote/status", headers=H).json()["recent_commands"][0]["status"] == "done"


def test_api_bad_command_400(client):
    c, _ = client
    assert c.post("/api/remote/command", json={"type": "nope"}, headers=H).status_code == 400


def test_websocket_delivers_command_and_status(client):
    c, hub = client
    with c.websocket_connect("/api/remote/ws?token=secret-token") as ws:
        ws.send_json({"type": "status", "data": {"phase": "translating", "percentage": 5, "url": "https://x"}})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        r = c.post("/api/remote/command", json={"type": "next"}, headers=H)
        assert r.json()["delivered_via_ws"] is True
        msg = ws.receive_json()
        assert msg["type"] == "commands" and msg["commands"][0]["type"] == "next"
    assert hub.status.percentage == 5


def test_websocket_rejects_bad_token(client):
    c, _ = client
    with pytest.raises(Exception):
        with c.websocket_connect("/api/remote/ws?token=bad"):
            pass
