import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.models import Base
from server.novel_queue import QueueRunner
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
    # 테스트 환경의 .env 값에 영향받지 않도록 자격증명을 고정
    monkeypatch.setattr(settings, "lanovel_auth_hash", "")
    monkeypatch.setattr(settings, "lanovel_auth_token", "")
    monkeypatch.setattr(settings, "remote_token", "secret-token")
    fresh = RemoteHub()
    monkeypatch.setattr(remote_router, "hub", fresh)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    fresh.update_status({"phase": "idle"})
    queue_runner = QueueRunner(
        fresh, session_factory=sessionmaker(bind=engine, autoflush=False),
        fetch_episodes=lambda url: [{"title": "1", "url": "https://x/1"}, {"title": "2", "url": "https://x/2"}],
        translated_keys=lambda urls: set(), notify=lambda *a: None,
    )
    fresh.site_queue = queue_runner
    monkeypatch.setattr(remote_router, "runner", queue_runner)
    app = FastAPI()
    app.include_router(remote_router.router)
    return TestClient(app), fresh   # TestClient 의 client host 는 'testclient' → 외부 기기 취급


H = {"X-Remote-Token": "secret-token"}
H_APP = {"X-Lanovel-Key": "secret-token"}   # 모바일 앱이 이미 쓰는 헤더


def test_api_rejects_missing_or_wrong_token(client):
    c, _ = client
    assert c.get("/api/remote/status").status_code == 401
    assert c.get("/api/remote/status", headers={"X-Remote-Token": "nope"}).status_code == 401


def test_api_accepts_app_header_and_hashed_credential(client, monkeypatch):
    from server.security import hash_token
    c, _ = client
    assert c.get("/api/remote/status", headers=H_APP).status_code == 200
    monkeypatch.setattr(settings, "remote_token", "")
    monkeypatch.setattr(settings, "lanovel_auth_hash", hash_token("phone-key", iterations=1000))
    assert c.get("/api/remote/status", headers={"X-Lanovel-Key": "phone-key"}).status_code == 200
    assert c.get("/api/remote/status", headers={"X-Lanovel-Key": "wrong"}).status_code == 401


def test_api_disabled_for_external_when_no_credential_configured(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(settings, "remote_token", "")
    assert c.get("/api/remote/status", headers=H).status_code == 503


def test_loopback_needs_no_token(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(remote_router, "LOOPBACK_HOSTS", ("testclient",))
    assert c.get("/api/remote/status").status_code == 200
    assert c.get("/api/remote/poll").status_code == 200


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


def test_websocket_delivers_command_and_status(client, monkeypatch):
    c, hub = client
    monkeypatch.setattr(remote_router, "LOOPBACK_HOSTS", ("testclient",))
    with c.websocket_connect("/api/remote/ws") as ws:
        first = ws.receive_json()
        assert first["type"] == "config" and first["config"]["cinderella"] is False
        ws.send_json({"type": "status", "data": {"phase": "translating", "percentage": 5, "url": "https://x"}})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
        r = c.post("/api/remote/command", json={"type": "next"})
        assert r.json()["delivered_via_ws"] is True
        msg = ws.receive_json()
        assert msg["type"] == "commands" and msg["commands"][0]["type"] == "next"
    assert hub.status.percentage == 5


def test_websocket_rejected_from_external_host(client):
    c, _ = client   # 'testclient' 는 루프백이 아님
    with pytest.raises(Exception):
        with c.websocket_connect("/api/remote/ws"):
            pass


def test_websocket_rejects_web_page_origin(client, monkeypatch):
    c, _ = client
    monkeypatch.setattr(remote_router, "LOOPBACK_HOSTS", ("testclient",))
    with pytest.raises(Exception):
        with c.websocket_connect("/api/remote/ws", headers={"origin": "https://evil.example"}):
            pass


# ---------- 목록 API ----------
NOVEL_A = "https://kakuyomu.jp/works/111"
NOVEL_B = "https://ncode.syosetu.com/n2222bb"


def test_queue_add_list_and_reject(client):
    c, _ = client
    r = c.post("/api/remote/queue", json={"urls": [f"{NOVEL_A}\n{NOVEL_B}", "https://bad.example/x"]}, headers=H_APP)
    assert r.status_code == 200
    body = r.json()
    assert [i["url"] for i in body["added"]] == [NOVEL_A, NOVEL_B]
    assert body["rejected"][0]["url"] == "https://bad.example/x"
    overview = c.get("/api/remote/queue", headers=H_APP).json()
    assert [i["url"] for i in overview["items"]] == [NOVEL_A, NOVEL_B]
    assert overview["running"] is False and overview["cinderella"] is False


def test_queue_requires_auth(client):
    c, _ = client
    assert c.get("/api/remote/queue").status_code == 401
    assert c.post("/api/remote/queue", json={"urls": [NOVEL_A]}).status_code == 401
    assert c.put("/api/remote/queue/config", json={"cinderella": True}).status_code == 401


def test_queue_empty_add_is_400(client):
    c, _ = client
    assert c.post("/api/remote/queue", json={"urls": ["  "]}, headers=H_APP).status_code == 400


def test_queue_config_starts_first_novel_and_sends_goto(client):
    c, hub = client
    c.post("/api/remote/queue", json={"urls": [NOVEL_A, NOVEL_B]}, headers=H_APP)
    cfg = c.put("/api/remote/queue/config", json={"running": True, "cinderella": True}, headers=H_APP).json()
    assert cfg == {"running": True, "cinderella": True}
    gotos = [x for x in hub.commands.values() if x.type == "goto"]
    assert len(gotos) == 1 and gotos[0].params["queue_session"] is True
    status = c.get("/api/remote/status", headers=H_APP).json()
    assert status["queue"]["current"]["url"] == NOVEL_A and status["queue"]["pending_count"] == 1
    assert status["queue"]["recent_events"][0]["kind"] == "novel_start"


def test_queue_event_moves_to_next_and_polls_config(client):
    c, hub = client
    ids = [i["id"] for i in c.post("/api/remote/queue", json={"urls": [NOVEL_A, NOVEL_B]}, headers=H_APP).json()["added"]]
    c.put("/api/remote/queue/config", json={"running": True}, headers=H_APP)
    assert c.post("/api/remote/queue/event", json={"kind": "novel_finished", "queue_item_id": ids[0]}, headers=H_APP).status_code == 200
    assert len([x for x in hub.commands.values() if x.type == "goto"]) == 2
    polled = c.get("/api/remote/poll", headers=H_APP).json()
    assert polled["config"]["running"] is True
    assert c.get("/api/remote/site_queue", headers=H_APP).json()["supported"] is True


def test_queue_remove_reorder_retry_and_manual_next(client):
    c, hub = client
    ids = [i["id"] for i in c.post("/api/remote/queue", json={"urls": [NOVEL_A, NOVEL_B]}, headers=H_APP).json()["added"]]
    assert c.post("/api/remote/queue/reorder", json={"ids": [ids[1], ids[0]]}, headers=H_APP).status_code == 200
    items = c.get("/api/remote/queue", headers=H_APP).json()["items"]
    assert [i["id"] for i in items] == [ids[1], ids[0]]
    assert c.delete(f"/api/remote/queue/{ids[0]}", headers=H_APP).status_code == 200
    assert c.delete("/api/remote/queue/9999", headers=H_APP).status_code == 404
    assert c.post(f"/api/remote/queue/{ids[1]}/retry", headers=H_APP).status_code == 400   # 대기 중이라 재시도 대상 아님
    # 수동 '다음 소설로' — 목록에 남은 소설이 있으면 시작
    r = c.post("/api/remote/command", json={"type": "go_next_site"}, headers=H_APP)
    assert r.status_code == 200
    assert [x.params["url"] for x in hub.commands.values() if x.type == "goto"] == ["https://x/1"]
    # 더 이상 남은 소설이 없으면 400
    assert c.post("/api/remote/command", json={"type": "go_next_site"}, headers=H_APP).status_code == 400


def test_websocket_queue_event_updates_runner(client, monkeypatch):
    c, hub = client
    monkeypatch.setattr(remote_router, "LOOPBACK_HOSTS", ("testclient",))
    ids = [i["id"] for i in c.post("/api/remote/queue", json={"urls": [NOVEL_A]}, headers=H_APP).json()["added"]]
    c.put("/api/remote/queue/config", json={"running": True}, headers=H_APP)
    with c.websocket_connect("/api/remote/ws") as ws:
        assert ws.receive_json()["type"] == "config"
        backlog = ws.receive_json()          # 접속 전에 쌓여 있던 goto 명령
        assert backlog["type"] == "commands" and backlog["commands"][0]["params"]["queue_item_id"] == ids[0]
        ws.send_json({"type": "queue_event", "data": {"kind": "novel_finished", "queue_item_id": ids[0]}})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
    final = c.get("/api/remote/queue", headers=H_APP).json()
    assert final["items"][0]["status"] == "done" and final["running"] is False


def test_config_change_pushes_to_extension_ws(client, monkeypatch):
    c, hub = client
    monkeypatch.setattr(remote_router, "LOOPBACK_HOSTS", ("testclient",))
    with c.websocket_connect("/api/remote/ws") as ws:
        assert ws.receive_json()["config"]["cinderella"] is False
        c.put("/api/remote/queue/config", json={"cinderella": True}, headers=H_APP)
        msg = ws.receive_json()
        assert msg["type"] == "config" and msg["config"]["cinderella"] is True
