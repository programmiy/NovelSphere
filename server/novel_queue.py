"""
'다음에 번역할 소설' 목록.

- 소설 개요 페이지 URL(카쿠요무 / ncode / 녹턴)을 DB에 보관한다.
- 서버가 개요 페이지에서 시작 회차를 계산한다.
    · 기본은 1화부터
    · 번역된 회차가 전체의 10% 이상이면 가장 앞의 미번역 회차부터
- 확장에 'goto' 명령(큐 세션 표시 포함)을 보내고, 소설이 끝났다는 보고를 받으면 다음 소설로 넘어간다.
- 시작 회차 계산이 실패하면 3분 간격으로 3회 재시도한다.
    · 신데렐라 ON : 계속 실패하면 해당 소설을 실패 처리하고 다음 소설로
    · 신데렐라 OFF: 실패 처리 후 목록 진행을 멈춘다
- 알림은 실패/건너뜀/멈춤, 목록 종료만 앱으로 보낸다. 나머지는 '최근 이슈'에만 남긴다.

'신데렐라'는 하루 한 번 있는 초기화 시간(16/17시) 의무 정지를 새로고침으로 넘기는 스위치다.
(실제 새로고침은 확장이 수행하고, 서버는 설정값 보관과 이력 기록만 담당한다.)
"""

import logging
import re
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_INTERVAL_SEC = 180
SKIP_JUMP_RATIO = 0.10          # 번역된 회차가 전체의 이 비율 이상이면 미번역 첫 회차로 점프
MAX_EVENTS_KEPT = 100
RECENT_EVENTS_SHOWN = 3

NOTIFY_KINDS = {"failed", "skipped", "halted", "list_done"}   # 앱 알림을 보내는 이벤트


# ---------------------------------------------------------------------------
# URL 판별 / 정규화
# ---------------------------------------------------------------------------
class QueueUrlError(ValueError):
    pass


def normalize_overview_url(raw: str) -> Tuple[str, str]:
    """입력 URL을 (정규화된 개요 URL, 사이트 코드)로 바꾼다. 회차 URL을 넣어도 개요 URL로 되돌린다."""
    url = (raw or "").strip()
    if not url:
        raise QueueUrlError("빈 주소입니다.")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    segments = [s for s in parsed.path.split("/") if s]

    if host in ("kakuyomu.jp", "www.kakuyomu.jp"):
        if len(segments) >= 2 and segments[0] == "works" and segments[1].isdigit():
            return f"https://kakuyomu.jp/works/{segments[1]}", "kakuyomu"
        raise QueueUrlError("카쿠요무 소설 주소(https://kakuyomu.jp/works/숫자)가 아닙니다.")

    if host == "ncode.syosetu.com":
        if segments and re.fullmatch(r"n\w+", segments[0], re.I):
            return f"https://ncode.syosetu.com/{segments[0].lower()}", "ncode"
        raise QueueUrlError("ncode 소설 주소(https://ncode.syosetu.com/n1234ab)가 아닙니다.")

    if host in ("noc.syosetu.com", "novel18.syosetu.com"):
        if segments and re.fullmatch(r"n\w+", segments[0], re.I):
            return f"https://{host}/{segments[0].lower()}", "nocturne"
        raise QueueUrlError("녹턴노벨즈 소설 주소(https://noc.syosetu.com/n1234ab)가 아닙니다.")

    if host in ("novelup.plus", "www.novelup.plus"):
        if len(segments) >= 2 and segments[0] == "story" and segments[1].isdigit():
            return f"https://novelup.plus/story/{segments[1]}", "novelup"
        raise QueueUrlError("노벨업 소설 주소(https://novelup.plus/story/숫자)가 아닙니다.")

    raise QueueUrlError("지원하지 않는 사이트입니다. (카쿠요무, ncode, 녹턴노벨즈, 노벨업플러스만 가능)")


def _ep_key(url: str) -> str:
    return (url or "").split("#")[0].rstrip("/")


# ---------------------------------------------------------------------------
# 시작 회차 계산 (순수 함수)
# ---------------------------------------------------------------------------
def choose_start(episodes: List[Dict[str, str]], translated_keys: Set[str]) -> Tuple[Optional[Dict[str, str]], str]:
    """
    반환: (시작 회차 또는 None, 사유 코드)
      'first'          : 번역 이력이 10% 미만 → 1화부터 (번역된 회차는 확장이 건너뜀)
      'first_untrans'  : 10% 이상 번역됨 → 가장 앞의 미번역 회차부터
      'all_translated' : 모든 회차가 이미 번역됨 → 시작할 곳 없음
      'empty'          : 회차 목록이 비어 있음
    """
    if not episodes:
        return None, "empty"
    done = sum(1 for e in episodes if _ep_key(e["url"]) in translated_keys)
    if done == len(episodes):
        return None, "all_translated"
    if done / len(episodes) >= SKIP_JUMP_RATIO:
        for e in episodes:
            if _ep_key(e["url"]) not in translated_keys:
                return e, "first_untrans"
    return episodes[0], "first"


# ---------------------------------------------------------------------------
# 외부 의존(네트워크/DB) 기본 구현 — 테스트에서는 주입으로 대체
# ---------------------------------------------------------------------------
def default_fetch_episodes(overview_url: str) -> List[Dict[str, str]]:
    """기존 목차 파서(/api/import-toc)를 재사용. 목차가 없는 단편은 개요 페이지 자체를 1화로 본다."""
    from fastapi import HTTPException
    from server.routers.toc_importer import TocUrl, import_toc

    try:
        episodes = import_toc(TocUrl(toc_url=overview_url))
    except HTTPException as e:
        if e.status_code == 404:          # 목차 구조 없음 → 단편
            return [{"title": "", "url": overview_url}]
        raise RuntimeError(str(e.detail))
    return list(episodes or [])


def default_translated_keys(urls: List[str]) -> Set[str]:
    """DB에 번역문이 하나라도 저장된 회차 URL 집합(정규화된 키)."""
    import server.database as sdb
    from server.models import Translation

    candidates: List[str] = []
    for u in urls:
        base = _ep_key(u)
        candidates.extend([u, base, base + "/"])
    candidates = list(dict.fromkeys(candidates))

    found: Set[str] = set()
    db = sdb.SessionLocal()
    try:
        for i in range(0, len(candidates), 500):
            chunk = candidates[i:i + 500]
            rows = (
                db.query(Translation.url)
                .filter(Translation.url.in_(chunk))
                .filter(Translation.translated.isnot(None), Translation.translated != "")
                .distinct()
                .all()
            )
            found.update(_ep_key(r[0]) for r in rows)
    finally:
        db.close()
    return found


def default_notify(title: str, message: str, event_type: str) -> None:
    from server.notifications import record_notification, send_ntfy
    record_notification(title=title, message=message, event_type=event_type, priority="high")
    send_ntfy(title=title, message=message, priority="high", tags=["books"])


# ---------------------------------------------------------------------------
# 진행기
# ---------------------------------------------------------------------------
class QueueRunner:
    def __init__(
        self,
        hub,
        session_factory: Optional[Callable[[], Any]] = None,
        fetch_episodes: Callable[[str], List[Dict[str, str]]] = default_fetch_episodes,
        translated_keys: Callable[[List[str]], Set[str]] = default_translated_keys,
        notify: Callable[[str, str, str], None] = default_notify,
        now: Callable[[], float] = time.time,
    ):
        self.hub = hub
        self._session_factory = session_factory
        self._fetch_episodes = fetch_episodes
        self._translated_keys = translated_keys
        self._notify = notify
        self._now = now

    # --- DB 접근 ---
    def _db(self):
        if self._session_factory:
            return self._session_factory()
        import server.database as sdb
        return sdb.SessionLocal()

    @property
    def supported(self) -> bool:   # SiteQueueProvider 호환
        return True

    # --- 설정 ---
    def _get_setting(self, db, key: str, default: str = "") -> str:
        from server.models import RemoteSetting
        row = db.get(RemoteSetting, key)
        return row.value if row else default

    def _set_setting(self, db, key: str, value: str) -> None:
        from server.models import RemoteSetting
        row = db.get(RemoteSetting, key)
        if row:
            row.value = value
        else:
            db.add(RemoteSetting(key=key, value=value))

    def get_config(self) -> Dict[str, bool]:
        db = self._db()
        try:
            return {
                "running": self._get_setting(db, "queue_running", "0") == "1",
                "cinderella": self._get_setting(db, "cinderella", "0") == "1",
            }
        finally:
            db.close()

    def set_config(self, running: Optional[bool] = None, cinderella: Optional[bool] = None) -> Dict[str, bool]:
        db = self._db()
        try:
            if running is not None:
                self._set_setting(db, "queue_running", "1" if running else "0")
            if cinderella is not None:
                self._set_setting(db, "cinderella", "1" if cinderella else "0")
            db.commit()
        finally:
            db.close()
        return self.get_config()

    # --- 이력 ---
    def _event(self, db, kind: str, message: str, item_id: Optional[int] = None) -> None:
        from server.models import NovelQueueEvent
        db.add(NovelQueueEvent(ts=int(self._now()), kind=kind, message=message[:300], item_id=item_id))
        db.flush()
        old = db.query(NovelQueueEvent.id).order_by(NovelQueueEvent.id.desc()).offset(MAX_EVENTS_KEPT).all()
        if old:
            db.query(NovelQueueEvent).filter(NovelQueueEvent.id.in_([o[0] for o in old])).delete(synchronize_session=False)
        if kind in NOTIFY_KINDS:
            try:
                self._notify("📚 번역 목록", message, f"queue_{kind}")
            except Exception as e:
                logger.warning(f"[queue] 알림 전송 실패: {e}")

    def recent_events(self, limit: int = RECENT_EVENTS_SHOWN) -> List[Dict[str, Any]]:
        from server.models import NovelQueueEvent
        db = self._db()
        try:
            rows = db.query(NovelQueueEvent).order_by(NovelQueueEvent.id.desc()).limit(limit).all()
            return [{"ts": r.ts, "kind": r.kind, "message": r.message} for r in rows]
        finally:
            db.close()

    # --- 목록 관리 ---
    @staticmethod
    def _item_dict(it) -> Dict[str, Any]:
        return {
            "id": it.id, "url": it.url, "site": it.site, "title": it.title or "",
            "status": it.status, "fail_reason": it.fail_reason or "", "attempts": it.attempts or 0,
            "position": it.position, "start_url": it.start_url or "",
        }

    def list_items(self) -> List[Dict[str, Any]]:
        from server.models import NovelQueueItem
        db = self._db()
        try:
            rows = db.query(NovelQueueItem).order_by(NovelQueueItem.position, NovelQueueItem.id).all()
            return [self._item_dict(r) for r in rows]
        finally:
            db.close()

    def add_urls(self, urls: List[str]) -> Dict[str, List[Any]]:
        from server.models import NovelQueueItem
        added, requeued, rejected = [], [], []
        db = self._db()
        try:
            max_pos = db.query(NovelQueueItem.position).order_by(NovelQueueItem.position.desc()).limit(1).scalar()
            pos = (max_pos if max_pos is not None else -1) + 1
            seen = set()
            for raw in urls:
                if not (raw or "").strip():
                    continue
                try:
                    url, site = normalize_overview_url(raw)
                except QueueUrlError as e:
                    rejected.append({"url": raw.strip(), "reason": str(e)})
                    continue
                if url in seen:
                    continue
                seen.add(url)
                existing = db.query(NovelQueueItem).filter(NovelQueueItem.url == url).first()
                if existing:
                    if existing.status in ("done", "failed"):
                        existing.status, existing.attempts, existing.fail_reason = "pending", 0, ""
                        existing.next_attempt_at, existing.position = None, pos
                        pos += 1
                        requeued.append(self._item_dict(existing))
                    else:
                        rejected.append({"url": url, "reason": "이미 목록에 있습니다."})
                    continue
                item = NovelQueueItem(url=url, site=site, position=pos, status="pending", created_at=int(self._now()))
                db.add(item)
                db.flush()
                pos += 1
                added.append(self._item_dict(item))
            db.commit()
        finally:
            db.close()
        return {"added": added, "requeued": requeued, "rejected": rejected}

    def remove(self, item_id: int) -> bool:
        from server.models import NovelQueueItem
        db = self._db()
        try:
            n = db.query(NovelQueueItem).filter(NovelQueueItem.id == item_id).delete()
            db.commit()
            return n > 0
        finally:
            db.close()

    def reorder(self, ids: List[int]) -> None:
        from server.models import NovelQueueItem
        db = self._db()
        try:
            for index, item_id in enumerate(ids):
                db.query(NovelQueueItem).filter(NovelQueueItem.id == item_id).update({"position": index})
            db.commit()
        finally:
            db.close()

    def retry(self, item_id: int) -> bool:
        from server.models import NovelQueueItem
        db = self._db()
        try:
            it = db.get(NovelQueueItem, item_id)
            if not it or it.status not in ("failed", "done"):
                return False
            it.status, it.attempts, it.fail_reason, it.next_attempt_at = "pending", 0, "", None
            db.commit()
            return True
        finally:
            db.close()

    # --- 진행 ---
    def tick(self) -> bool:
        """주기적으로 호출. 다음 소설을 시작시켰으면 True (호출 측이 확장으로 명령을 밀어준다)."""
        from server.models import NovelQueueItem
        db = self._db()
        try:
            if self._get_setting(db, "queue_running", "0") != "1":
                return False
            if db.query(NovelQueueItem).filter(NovelQueueItem.status == "running").first():
                return False   # 소설 하나 진행 중 → 끝났다는 보고를 기다린다
            nxt = (
                db.query(NovelQueueItem).filter(NovelQueueItem.status == "pending")
                .order_by(NovelQueueItem.position, NovelQueueItem.id).first()
            )
            if not nxt:
                return False
            if nxt.next_attempt_at and nxt.next_attempt_at > self._now():
                return False   # 재시도 대기 중 (앞 순서를 건너뛰지 않는다)
            if not self.hub.is_extension_online():
                return False   # 확장이 없으면 명령을 보낼 수 없다 (확장 끊김 알림은 별도로 나감)
            return self._start_item(db, nxt)
        finally:
            db.close()

    def _start_item(self, db, it) -> bool:
        label = it.title or it.url
        try:
            episodes = self._fetch_episodes(it.url)
            start, reason = choose_start(episodes, self._translated_keys([e["url"] for e in episodes]) if episodes else set())
        except Exception as e:
            return self._on_start_failure(db, it, str(e))

        if start is None:
            if reason == "all_translated":
                it.status, it.finished_at = "done", int(self._now())
                self._event(db, "novel_done", f"{label}: 이미 모두 번역되어 있어 건너뜁니다.", it.id)
                db.commit()
                self._finish_if_empty(db)
                db.commit()
                return self.tick()    # 바로 다음 소설로
            return self._on_start_failure(db, it, "회차 목록을 찾지 못했습니다.")

        it.status, it.started_at, it.start_url, it.next_attempt_at = "running", int(self._now()), start["url"], None
        # attempts 는 소설이 끝날 때 초기화한다 (페이지 문제가 반복되면 누적되어 건너뜀/멈춤을 판단)
        where = "미번역 첫 회차부터" if reason == "first_untrans" else "1화부터"
        self._event(db, "novel_start", f"▶ {label} 시작 ({where}, 총 {len(episodes)}화)", it.id)
        self.hub.enqueue("goto", {
            "url": start["url"], "queue_item_id": it.id, "queue_session": True, "skip_translated": True,
        })
        db.commit()
        return True

    def _on_start_failure(self, db, it, reason: str) -> bool:
        label = it.title or it.url
        it.attempts = (it.attempts or 0) + 1
        if it.attempts < MAX_ATTEMPTS:
            it.next_attempt_at = int(self._now()) + RETRY_INTERVAL_SEC
            self._event(db, "retry", f"{label}: 접속 실패({it.attempts}/{MAX_ATTEMPTS}) — 3분 뒤 다시 시도합니다. ({reason})", it.id)
            db.commit()
            return False

        it.status, it.fail_reason, it.next_attempt_at, it.finished_at = "failed", reason[:300], None, int(self._now())
        cinderella = self._get_setting(db, "cinderella", "0") == "1"
        if cinderella:
            self._event(db, "skipped", f"{label}: {MAX_ATTEMPTS}번 접속에 실패해 건너뜁니다. ({reason})", it.id)
            db.commit()
            self._finish_if_empty(db)
            db.commit()
            return self.tick()
        self._set_setting(db, "queue_running", "0")
        self._event(db, "halted", f"{label}: {MAX_ATTEMPTS}번 접속에 실패해 목록 진행을 멈췄어요. ({reason})", it.id)
        db.commit()
        return False

    def _finish_if_empty(self, db) -> bool:
        from server.models import NovelQueueItem
        remaining = db.query(NovelQueueItem).filter(NovelQueueItem.status.in_(["pending", "running"])).count()
        if remaining:
            return False
        if self._get_setting(db, "queue_running", "0") != "1":
            return False
        failed = db.query(NovelQueueItem).filter(NovelQueueItem.status == "failed").count()
        self._set_setting(db, "queue_running", "0")
        tail = f" (실패 {failed}건)" if failed else ""
        self._event(db, "list_done", f"목록의 모든 소설 처리가 끝났어요.{tail}")
        return True

    def advance_manual(self) -> bool:
        """리모컨 '다음 소설로' 버튼: 진행 중인 소설을 마무리 처리하고 다음 소설을 바로 시작한다."""
        from server.models import NovelQueueItem
        db = self._db()
        try:
            cur = db.query(NovelQueueItem).filter(NovelQueueItem.status == "running").first()
            if cur:
                cur.status, cur.finished_at = "done", int(self._now())
                self._event(db, "novel_done", f"⏭ {cur.title or cur.url}: 수동으로 다음 소설로 이동", cur.id)
            self._set_setting(db, "queue_running", "1")
            db.commit()
        finally:
            db.close()
        return self.tick()

    # --- 확장 → 서버 보고 ---
    def handle_extension_event(self, ev: Dict[str, Any]) -> bool:
        """확장이 보낸 큐 이벤트 처리. 다음 소설을 시작시켰으면 True."""
        from server.models import NovelQueueItem
        kind = str(ev.get("kind", ""))
        db = self._db()
        try:
            if kind == "novel_finished":
                item_id = ev.get("queue_item_id")
                it = db.get(NovelQueueItem, int(item_id)) if item_id is not None else None
                if not it or it.status != "running":
                    return False
                it.status, it.finished_at = "done", int(self._now())
                it.attempts = 0
                self._event(db, "novel_done", f"✔ {it.title or it.url} 번역 완료", it.id)
                db.commit()
                self._finish_if_empty(db)
                db.commit()
                return self.tick()
            if kind == "page_problem":
                item_id = ev.get("queue_item_id")
                it = db.get(NovelQueueItem, int(item_id)) if item_id is not None else None
                if not it or it.status != "running":
                    return False
                # 시작 실패와 같은 규칙: 3분 간격 3회 재시도 → 신데렐라 ON이면 건너뜀, OFF면 멈춤
                it.status = "pending"
                return self._on_start_failure(db, it, str(ev.get("reason") or "페이지를 열 수 없습니다."))
            if kind == "cinderella":
                self._event(db, "cinderella", "🌙 초기화 시간을 넘겨 번역을 이어갔어요.", ev.get("queue_item_id"))
                db.commit()
            return False
        finally:
            db.close()

    # --- 상태 요약 (리모컨 상태에 포함) ---
    def summary(self) -> Dict[str, Any]:
        from server.models import NovelQueueItem
        cfg = self.get_config()
        db = self._db()
        try:
            cur = db.query(NovelQueueItem).filter(NovelQueueItem.status == "running").first()
            if cur and not cur.title:
                bt = (self.hub.status.book_title or "").strip()
                if bt:
                    cur.title = bt[:200]
                    db.commit()
            return {
                **cfg,
                "current": ({"id": cur.id, "title": cur.title or "", "url": cur.url} if cur else None),
                "pending_count": db.query(NovelQueueItem).filter(NovelQueueItem.status == "pending").count(),
                "failed_count": db.query(NovelQueueItem).filter(NovelQueueItem.status == "failed").count(),
            }
        finally:
            db.close()
