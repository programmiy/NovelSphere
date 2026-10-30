import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.models import Base
from server.novel_queue import (
    MAX_ATTEMPTS,
    RETRY_INTERVAL_SEC,
    QueueRunner,
    QueueUrlError,
    choose_start,
    normalize_overview_url,
)
from server.remote_control import RemoteHub


# ---------- URL 정규화 ----------
@pytest.mark.parametrize("raw,expected,site", [
    ("https://kakuyomu.jp/works/1177354054880238351", "https://kakuyomu.jp/works/1177354054880238351", "kakuyomu"),
    ("https://kakuyomu.jp/works/1177354054880238351/episodes/99?x=1#a", "https://kakuyomu.jp/works/1177354054880238351", "kakuyomu"),
    ("https://ncode.syosetu.com/N1234AB/", "https://ncode.syosetu.com/n1234ab", "ncode"),
    ("ncode.syosetu.com/n1234ab/12/", "https://ncode.syosetu.com/n1234ab", "ncode"),
    ("https://noc.syosetu.com/n9999zz/", "https://noc.syosetu.com/n9999zz", "nocturne"),
    ("https://novelup.plus/story/123456789", "https://novelup.plus/story/123456789", "novelup"),
    ("novelup.plus/story/987654321/12345", "https://novelup.plus/story/987654321", "novelup"),
])
def test_normalize_ok(raw, expected, site):
    assert normalize_overview_url(raw) == (expected, site)


@pytest.mark.parametrize("raw", ["", "https://example.com/n1234ab", "https://kakuyomu.jp/", "https://ncode.syosetu.com/"])
def test_normalize_rejects(raw):
    with pytest.raises(QueueUrlError):
        normalize_overview_url(raw)


# ---------- 시작 회차 선택 ----------
def _eps(n):
    return [{"title": f"{i}화", "url": f"https://x/{i}"} for i in range(1, n + 1)]


def test_choose_start_from_first_when_few_translated():
    # 20화 중 1화 번역(5%) → 1화부터 (번역된 회차는 확장이 건너뜀)
    start, why = choose_start(_eps(20), {"https://x/1"})
    assert why == "first" and start["url"] == "https://x/1"


def test_choose_start_jumps_when_ten_percent_or_more():
    # 20화 중 2화 번역(10%) → 가장 앞 미번역(3화)
    start, why = choose_start(_eps(20), {"https://x/1", "https://x/2"})
    assert why == "first_untrans" and start["url"] == "https://x/3"


def test_choose_start_first_untranslated_with_gap():
    # 앞에 빈 곳이 있으면 그곳부터
    start, why = choose_start(_eps(10), {"https://x/2", "https://x/3"})
    assert start["url"] == "https://x/1"


def test_choose_start_all_translated_and_empty():
    assert choose_start(_eps(3), {f"https://x/{i}" for i in range(1, 4)}) == (None, "all_translated")
    assert choose_start([], set()) == (None, "empty")


def test_choose_start_ignores_trailing_slash_and_fragment():
    eps = [{"title": "1", "url": "https://x/1/"}, {"title": "2", "url": "https://x/2"}]
    start, _ = choose_start(eps, {"https://x/1"})
    assert start["url"] == "https://x/2"


# ---------- 진행기 ----------
class Clock:
    def __init__(self):
        self.t = 1_000_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)
    hub = RemoteHub()
    hub.update_status({"phase": "idle", "percentage": 0})     # 확장 온라인
    clock = Clock()
    notified = []
    state = {"episodes": {}, "translated": set(), "fail": set()}

    def fetch(url):
        if url in state["fail"]:
            raise RuntimeError("연결 실패")
        return state["episodes"].get(url, _eps(5))

    runner = QueueRunner(
        hub, session_factory=Session, fetch_episodes=fetch,
        translated_keys=lambda urls: {u for u in urls if u in state["translated"]},
        notify=lambda t, m, e: notified.append((e, m)), now=clock,
    )
    return runner, hub, clock, notified, state


A = "https://kakuyomu.jp/works/111"
B = "https://ncode.syosetu.com/n2222bb"
C = "https://noc.syosetu.com/n3333cc"


def _gotos(hub):
    return [c for c in hub.commands.values() if c.type == "goto"]


def test_add_dedupe_and_reject(env):
    runner, *_ = env
    r = runner.add_urls([A, B, A, "https://bad.example/x", ""])
    assert [i["url"] for i in r["added"]] == [A, B]
    assert r["rejected"][0]["url"] == "https://bad.example/x"
    again = runner.add_urls([A])
    assert again["rejected"][0]["reason"] == "이미 목록에 있습니다."


def test_nothing_starts_until_running(env):
    runner, hub, *_ = env
    runner.add_urls([A])
    assert runner.tick() is False and not _gotos(hub)
    runner.set_config(running=True)
    assert runner.tick() is True
    cmd = _gotos(hub)[0]
    assert cmd.params["queue_session"] is True and cmd.params["skip_translated"] is True
    assert cmd.params["url"] == "https://x/1" and "queue_item_id" in cmd.params


def test_start_goes_to_computed_url_and_waits_for_finish(env):
    runner, hub, _, _, state = env
    state["episodes"][A] = _eps(10)
    state["translated"] = {"https://x/1", "https://x/2"}   # 20% → 3화부터
    runner.add_urls([A, B])
    runner.set_config(running=True)
    assert runner.tick() is True
    g = _gotos(hub)
    assert len(g) == 1 and g[0].params["url"] == "https://x/3"
    assert runner.tick() is False        # 진행 중에는 다음 소설을 시작하지 않음
    assert len(_gotos(hub)) == 1


def test_finish_moves_to_next_novel_and_list_done_notifies(env):
    runner, hub, _, notified, _ = env
    items = runner.add_urls([A, B])["added"]
    runner.set_config(running=True)
    runner.tick()
    assert runner.handle_extension_event({"kind": "novel_finished", "queue_item_id": items[0]["id"]}) is True
    assert len(_gotos(hub)) == 2
    assert runner.handle_extension_event({"kind": "novel_finished", "queue_item_id": items[1]["id"]}) is False
    assert runner.get_config()["running"] is False
    kinds = [e for e, _ in notified]
    assert kinds == ["queue_list_done"]            # 소설 완료/시작은 알림 없음
    assert [e["kind"] for e in runner.recent_events(10)][:1] == ["list_done"]


def test_unknown_or_stale_finish_event_ignored(env):
    runner, *_ = env
    runner.add_urls([A])
    assert runner.handle_extension_event({"kind": "novel_finished", "queue_item_id": 999}) is False
    assert runner.handle_extension_event({"kind": "novel_finished"}) is False


def test_retry_three_times_every_three_minutes_then_skip_with_cinderella(env):
    runner, hub, clock, notified, state = env
    runner.add_urls([A, B])
    runner.set_config(running=True, cinderella=True)
    state["fail"].add(A)

    assert runner.tick() is False                      # 1회 실패
    assert runner.tick() is False                      # 3분 전: 대기 (B로 새치기 안 함)
    clock.t += RETRY_INTERVAL_SEC
    assert runner.tick() is False                      # 2회 실패
    clock.t += RETRY_INTERVAL_SEC
    assert runner.tick() is True                       # 3회 실패 → A 건너뛰고 B 시작
    assert _gotos(hub)[0].params["url"] == "https://x/1"
    items = {i["url"]: i for i in runner.list_items()}
    assert items[A]["status"] == "failed" and items[B]["status"] == "running"
    assert [e for e, _ in notified] == ["queue_skipped"]


def test_without_cinderella_halts_after_three_failures(env):
    runner, hub, clock, notified, state = env
    runner.add_urls([A, B])
    runner.set_config(running=True, cinderella=False)
    state["fail"].add(A)
    for _ in range(MAX_ATTEMPTS):
        runner.tick()
        clock.t += RETRY_INTERVAL_SEC
    assert runner.get_config()["running"] is False
    assert runner.tick() is False and not _gotos(hub)       # B로 넘어가지 않음
    assert [e for e, _ in notified] == ["queue_halted"]


def test_cinderella_last_item_failure_alarms_list_done(env):
    runner, hub, clock, notified, state = env
    runner.add_urls([A])
    runner.set_config(running=True, cinderella=True)
    state["fail"].add(A)
    for _ in range(MAX_ATTEMPTS):
        runner.tick()
        clock.t += RETRY_INTERVAL_SEC
    kinds = [e for e, _ in notified]
    assert kinds == ["queue_skipped", "queue_list_done"]
    assert runner.get_config()["running"] is False


def test_all_translated_novel_is_skipped_to_next(env):
    runner, hub, _, notified, state = env
    state["episodes"][A] = _eps(3)
    state["translated"] = {"https://x/1", "https://x/2", "https://x/3"}
    state["episodes"][B] = [{"title": "a", "url": "https://y/1"}]
    runner.add_urls([A, B])
    runner.set_config(running=True)
    assert runner.tick() is True
    assert [g.params["url"] for g in _gotos(hub)] == ["https://y/1"]
    assert notified == []


def test_waits_while_extension_offline(env):
    runner, hub, clock, *_ = env
    runner.add_urls([A])
    runner.set_config(running=True)
    hub.status.last_seen = clock.t - 10_000          # 오래전 → 오프라인
    import server.remote_control as rc
    hub.is_extension_online = lambda now=None: False
    assert runner.tick() is False and not _gotos(hub)


def test_retry_remove_reorder_and_summary(env):
    runner, hub, clock, _, state = env
    ids = [i["id"] for i in runner.add_urls([A, B, C])["added"]]
    runner.reorder([ids[2], ids[0], ids[1]])
    assert [i["id"] for i in runner.list_items()] == [ids[2], ids[0], ids[1]]
    assert runner.remove(ids[1]) is True and runner.remove(12345) is False
    runner.set_config(running=True)
    runner.tick()
    s = runner.summary()
    assert s["running"] and s["current"]["id"] == ids[2] and s["pending_count"] == 1
    hub.status.book_title = "소설 제목"
    assert runner.summary()["current"]["title"] == "소설 제목"
    runner.handle_extension_event({"kind": "novel_finished", "queue_item_id": ids[2]})
    assert runner.retry(ids[2]) is True and runner.retry(999) is False


def test_recent_events_limit_three(env):
    runner, *_ = env
    items = runner.add_urls([A, B, C])["added"]
    runner.set_config(running=True)
    runner.tick()
    for it in items:
        runner.handle_extension_event({"kind": "novel_finished", "queue_item_id": it["id"]})
    assert len(runner.recent_events()) == 3


# ---------- 확장이 보고하는 '페이지 문제' ----------
def _problem(item_id):
    return {"kind": "page_problem", "queue_item_id": item_id, "reason": "연령 확인 화면"}


def test_page_problem_retries_three_times_then_skips_with_cinderella(env):
    runner, hub, clock, notified, _ = env
    items = runner.add_urls([A, B])["added"]
    runner.set_config(running=True, cinderella=True)
    assert runner.tick() is True                                    # A 시작
    assert runner.handle_extension_event(_problem(items[0]["id"])) is False   # 1회 → 3분 뒤 재시도
    assert runner.tick() is False                                   # 3분 전에는 대기 (B로 새치기 안 함)
    clock.t += RETRY_INTERVAL_SEC
    assert runner.tick() is True                                    # A 다시 시작
    assert runner.handle_extension_event(_problem(items[0]["id"])) is False   # 2회
    clock.t += RETRY_INTERVAL_SEC
    assert runner.tick() is True                                    # A 세 번째 시작
    assert runner.handle_extension_event(_problem(items[0]["id"])) is True    # 3회 → 건너뛰고 B 시작
    by_url = {i["url"]: i for i in runner.list_items()}
    assert by_url[A]["status"] == "failed" and by_url[B]["status"] == "running"
    assert [e for e, _ in notified] == ["queue_skipped"]
    assert len([c for c in hub.commands.values() if c.type == "goto"]) == 4


def test_page_problem_without_cinderella_halts_after_three(env):
    runner, hub, clock, notified, _ = env
    items = runner.add_urls([A, B])["added"]
    runner.set_config(running=True, cinderella=False)
    assert runner.tick() is True
    for attempt in range(3):
        runner.handle_extension_event(_problem(items[0]["id"]))
        clock.t += RETRY_INTERVAL_SEC
        if attempt < 2:
            assert runner.tick() is True
    by_url = {i["url"]: i for i in runner.list_items()}
    assert by_url[A]["status"] == "failed" and by_url[B]["status"] == "pending"
    assert runner.get_config()["running"] is False
    assert [e for e, _ in notified] == ["queue_halted"]


def test_page_problem_for_unknown_or_idle_item_is_ignored(env):
    runner, *_ = env
    runner.add_urls([A])
    assert runner.handle_extension_event(_problem(999)) is False
    assert runner.handle_extension_event({"kind": "page_problem"}) is False
