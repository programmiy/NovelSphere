import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from server.server import app
from server.settings import settings
from server.notifications import (
    notify_translation_progress,
    notify_translation_complete,
    notify_episode_progress,
    notify_api_error,
    notify_verbatim_cleanup,
    notify_task_event,
    get_recent_notifications,
    clear_recent_notifications
)

client = TestClient(app)

def test_notify_translation_complete_includes_viewer_link():
    """번역 완료 알림 시 뷰어 바로가기 URL이 포함되어 인메모리 히스토리에 적재되는지 검증"""
    clear_recent_notifications()
    notify_translation_complete(
        novel_title="이세계 라노벨",
        episode_title="제1화 시작",
        total_count=120,
        url="https://kakuyomu.jp/works/123/episodes/456"
    )

    notifs = get_recent_notifications(limit=5)
    assert len(notifs) >= 1
    item = notifs[0]
    assert "이세계 라노벨" in item["title"]
    assert "120개 문장" in item["message"]
    assert item["priority"] == "high"
    assert item["type"] == "complete"
    assert item["click_url"] == f"http://127.0.0.1:{settings.server_port}/viewer?url=https://kakuyomu.jp/works/123/episodes/456"

def test_notify_api_error_sets_urgent_priority():
    """API 오류 알림 시 긴급(urgent) 우선순위로 기록되는지 검증"""
    clear_recent_notifications()
    notify_api_error(
        error_title="과부하 발생",
        message="503 Overloaded",
        error_type="503 OVERLOAD",
        url="https://kakuyomu.jp/works/123"
    )

    notifs = get_recent_notifications(limit=5)
    assert len(notifs) >= 1
    item = notifs[0]
    assert item["priority"] == "urgent"
    assert item["type"] == "error"
    assert "503 OVERLOAD" in item["title"]

def test_api_get_and_update_notifications_config():
    """GET /api/notifications/config 및 POST /api/notifications/config 엔드포인트 동작 검증"""
    # 1. 조회
    res = client.get("/api/notifications/config")
    assert res.status_code == 200
    data = res.json()
    assert "notification_progress_step" in data

    # 2. 업데이트
    update_res = client.post("/api/notifications/config", json={
        "notification_progress_step": 50
    })
    assert update_res.status_code == 200
    up_data = update_res.json()
    assert up_data["config"]["notification_progress_step"] == 50

    # 원복
    client.post("/api/notifications/config", json={
        "notification_progress_step": 100
    })

def test_api_test_notification_endpoint():
    """POST /api/notifications/test 엔드포인트 검증 (실시간 알림 브로드캐스트)"""
    clear_recent_notifications()
    res = client.post("/api/notifications/test")
    assert res.status_code == 200
    assert res.json()["success"] is True

    notifs = get_recent_notifications(limit=5)
    assert len(notifs) >= 1
    assert "테스트 알림" in notifs[0]["title"]
    assert notifs[0]["type"] == "test"

def test_notify_episode_progress():
    """10화 단위 에피소드 진행 마일스톤 알림 검증"""
    clear_recent_notifications()
    notify_episode_progress(
        novel_title="전생 슬라임",
        episode_title="제 10화 결전의 날",
        episode_count=10,
        url="https://novel18.syosetu.com/n1234/10/"
    )

    notifs = get_recent_notifications(limit=5)
    assert len(notifs) >= 1
    item = notifs[0]
    assert "[번역 진행 10화 완료]" in item["title"]
    assert "총 10개 화 100% 번역 완료!" in item["message"]
    assert item["type"] == "episode_milestone"
    assert "viewer?url=" in item["click_url"]

def test_api_progress_and_complete_endpoints():
    """POST /api/notifications/progress 및 complete 엔드포인트 검증 (10화 단위 및 100% 모드 필터링)"""
    with patch("server.routers.notifications.notify_translation_progress") as mock_prog, \
         patch("server.routers.notifications.notify_episode_progress") as mock_ep_prog, \
         patch("server.routers.notifications.notify_translation_complete") as mock_comp:

        # 1. 10화 단위 에피소드 마일스톤 알림 요청 (episode_count=10)
        ep_res = client.post("/api/notifications/progress", json={
            "novel_title": "테스트 소설",
            "episode_title": "10화",
            "episode_count": 10,
            "url": "https://example.com/10"
        })
        assert ep_res.status_code == 200
        assert ep_res.json()["status"] == "ok"
        assert ep_res.json()["type"] == "episode_milestone"
        mock_ep_prog.assert_called_once_with(
            novel_title="테스트 소설",
            episode_title="10화",
            episode_count=10,
            url="https://example.com/10"
        )

        # 2. notification_progress_step >= 100 일 때 단일 회차 도중 진행률(25%) 요청 -> 스킵 확인
        settings.notification_progress_step = 100
        skipped_res = client.post("/api/notifications/progress", json={
            "novel_title": "테스트 소설",
            "episode_title": "1화",
            "current": 25,
            "total": 100,
            "percentage": 25,
            "url": "https://example.com/1"
        })
        assert skipped_res.status_code == 200
        assert skipped_res.json()["status"] == "skipped"
        mock_prog.assert_not_called()

        # 3. notification_progress_step = 25 로 변경 시 단일 회차 도중 진행률(25%) 허용 확인
        settings.notification_progress_step = 25
        allowed_res = client.post("/api/notifications/progress", json={
            "novel_title": "테스트 소설",
            "episode_title": "1화",
            "current": 25,
            "total": 100,
            "percentage": 25,
            "url": "https://example.com/1"
        })
        assert allowed_res.status_code == 200
        assert allowed_res.json()["status"] == "ok"
        mock_prog.assert_called_once_with(
            novel_title="테스트 소설",
            episode_title="1화",
            current=25,
            total=100,
            percentage=25,
            url="https://example.com/1"
        )

        # 4. complete 엔드포인트 검증 (episode_count 지원)
        comp_res = client.post("/api/notifications/complete", json={
            "novel_title": "테스트 소설",
            "episode_title": "1화",
            "total_count": 100,
            "episode_count": 10,
            "url": "https://example.com/1"
        })
        assert comp_res.status_code == 200
        mock_comp.assert_called_once_with(
            novel_title="테스트 소설",
            episode_title="1화",
            total_count=100,
            url="https://example.com/1",
            episode_count=10
        )

def test_recent_and_clear_notifications_endpoints():
    """GET /api/notifications/recent 및 POST /api/notifications/clear 동작 검증"""
    from server.notifications import record_notification, clear_recent_notifications
    clear_recent_notifications()

    # 1. 알림 기록 적재
    record_notification(
        title="🎉 [번역 완료] 테스트 책",
        message="총 50개 문장 번역 완료",
        event_type="complete",
        book_title="테스트 책",
        chapter_title="1화",
        click_url="http://127.0.0.1:8001/viewer?url=test"
    )

    # 2. 조회 엔드포인트 호출
    res = client.get("/api/notifications/recent?limit=10")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["count"] >= 1
    first = data["notifications"][0]
    assert first["title"] == "🎉 [번역 완료] 테스트 책"
    assert first["type"] == "complete"
    assert first["book_title"] == "테스트 책"

    # 3. 비우기 엔드포인트 호출
    clear_res = client.post("/api/notifications/clear")
    assert clear_res.status_code == 200
    assert clear_res.json()["status"] == "ok"

    res_after = client.get("/api/notifications/recent")
    assert res_after.json()["count"] == 0

def test_notifications_stream_broadcasting():
    """GET /api/notifications/stream 및 record_notification 로컬 SSE 브로드캐스팅 검증"""
    import queue
    from server.notifications import add_sse_subscriber, remove_sse_subscriber, record_notification

    test_q = queue.Queue()
    add_sse_subscriber(test_q)
    try:
        record_notification(
            title="실시간 SSE 테스트",
            message="스트리밍 확인",
            event_type="test_event",
            book_title="스트림 책"
        )
        assert not test_q.empty()
        item = test_q.get_nowait()
        assert item["title"] == "실시간 SSE 테스트"
        assert item["book_title"] == "스트림 책"
    finally:
        remove_sse_subscriber(test_q)

def test_status_summary_endpoint():
    """GET /api/status/summary 및 /api/notifications/summary 종합 현황 API 검증"""
    from server.notifications import (
        update_translation_status,
        notify_api_error,
        reset_api_error_stats
    )
    reset_api_error_stats()

    # 1. 초기 상태 확인
    res = client.get("/api/status/summary")
    assert res.status_code == 200
    data = res.json()
    assert "api_errors" in data
    assert data["api_errors"]["total"] == 0
    assert data["api_errors"]["summary_text"] == "오류 없음"

    # 2. 번역 진행도 및 API 오류 기록
    update_translation_status(
        book_title="테스트 대시보드 소설",
        episode_title="제5화",
        current_sentence=50,
        total_sentences=100,
        percentage=50,
        is_active=True
    )
    notify_api_error(
        error_title="모델 과부하",
        message="503 Overloaded",
        error_type="503 OVERLOAD"
    )
    notify_api_error(
        error_title="쿼터 소진",
        message="429 Quota Exceeded",
        error_type="429 QUOTA"
    )

    # 3. 갱신된 현황 조회 확인
    res2 = client.get("/api/notifications/summary")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["is_active"] is True
    assert data2["book_title"] == "테스트 대시보드 소설"
    assert data2["percentage"] == 50
    assert data2["api_errors"]["total"] == 2
    assert "503 OVERLOAD" in data2["api_errors"]["by_type"]
    assert "429 QUOTA" in data2["api_errors"]["by_type"]
    assert "2건" in data2["api_errors"]["summary_text"]
    assert "today_episodes_count" in data2
    assert "today_translations_count" in data2
    assert isinstance(data2["today_episodes_count"], int)
    assert isinstance(data2["today_translations_count"], int)


def test_unclassified_episodes_included_in_today_count():
    """미분류(folderName IS NULL 또는 빈 문자열) 보관함의 오늘 번역 회차가 today_episodes_count에 반영되는지 검증"""
    import time
    from server.database import SessionLocal
    from server.models import Translation

    now_ts = int(time.time())
    with SessionLocal() as db:
        # 미분류 에피소드 1 (folderName = None)
        t1 = Translation(
            url="https://kakuyomu.jp/works/test_unclassified_999/episodes/1",
            pid="p1",
            original="テスト本文1",
            translated="테스트 본문 1",
            timestamp=now_ts,
            folderName=None,
            title="미분류 1화"
        )
        # 미분류 에피소드 2 (folderName = "")
        t2 = Translation(
            url="https://kakuyomu.jp/works/test_unclassified_999/episodes/2",
            pid="p2",
            original="テスト本文2",
            translated="테스트 본문 2",
            timestamp=now_ts,
            folderName="",
            title="미분류 2화"
        )
        db.add_all([t1, t2])
        db.commit()

        try:
            res = client.get("/api/notifications/summary")
            assert res.status_code == 200
            data = res.json()
            # 오늘 번역 회차 수에 미분류 회차가 최소 2개 이상 잡혀야 함
            assert data["today_episodes_count"] >= 2
            assert data["today_translations_count"] >= 2
        finally:
            db.delete(t1)
            db.delete(t2)
            db.commit()



