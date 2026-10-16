import time
from unittest.mock import patch
from fastapi.testclient import TestClient

from server.server import app
from server.services.task_manager import task_manager
from server.models import Translation, AiReviewQueue
from server.database import SessionLocal

client = TestClient(app)


def test_ai_review_trigger_initial_no_items():
    """이상 번역이 없을 때 적절한 메시지를 반환하는지 검증"""
    res = client.post("/api/ai_review/trigger_initial")
    assert res.status_code == 200
    assert "발견된 이상번역이 없습니다." in res.json()["message"]


@patch("server.routers.ai_review.process_initial_translation_bg")
def test_ai_review_trigger_initial_with_items(mock_worker):
    """이상 번역 항목이 있을 때 TaskManager에 정상적으로 작업이 등록되는지 검증"""
    mock_worker.return_value = None

    db = SessionLocal()
    try:
        db.query(Translation).filter(Translation.url == "http://example.com/abnormal1").delete()
        trans = Translation(
            url="http://example.com/abnormal1",
            pid="p1",
            original="こんにちは世界",
            translated="こんにちは世界",
            timestamp=int(time.time()),
            folderName="TestBook",
            title="Ch1"
        )
        db.add(trans)
        db.commit()
    finally:
        db.close()

    res = client.post("/api/ai_review/trigger_initial")
    assert res.status_code == 200
    data = res.json()
    if "task_id" in data:
        task_id = data["task_id"]
        status = task_manager.get_status(task_id)
        assert status["state"] in ("PENDING", "PROGRESS", "SUCCESS")
        task_manager.cancel(task_id)

    db = SessionLocal()
    try:
        db.query(Translation).filter(Translation.url == "http://example.com/abnormal1").delete()
        db.commit()
    finally:
        db.close()


@patch("server.routers.ai_review.process_batch_reretranslation_bg")
def test_ai_review_trigger_reretranslate_empty_and_populated(mock_worker):
    """재재번역 트리거 시 TaskManager 작업 등록 검증"""
    mock_worker.return_value = None

    db = SessionLocal()
    try:
        db.query(AiReviewQueue).filter(AiReviewQueue.original_text == "テスト").delete()
        db.commit()
    finally:
        db.close()

    # pending_reretranslate 항목 추가
    db = SessionLocal()
    try:
        now = int(time.time())
        trans = Translation(
            url="http://example.com/rere1",
            pid="p1",
            original="テスト",
            translated="테스트",
            timestamp=now,
            folderName="BookA"
        )
        db.add(trans)
        db.commit()
        db.refresh(trans)

        q_item = AiReviewQueue(
            translation_id=trans.id,
            original_text="テスト",
            old_translated_text="테스트",
            ai_translated_text="테스트 봇",
            status="pending_reretranslate",
            created_at=now,
            updated_at=now
        )
        db.add(q_item)
        db.commit()
    finally:
        db.close()

    res_pop = client.post("/api/ai_review/trigger_reretranslate")
    assert res_pop.status_code == 200
    data = res_pop.json()
    assert "task_id" in data
    task_id = data["task_id"]
    status = task_manager.get_status(task_id)
    assert status["task_id"] == task_id
    task_manager.cancel(task_id)

    db = SessionLocal()
    try:
        db.query(AiReviewQueue).filter(AiReviewQueue.original_text == "テスト").delete()
        db.query(Translation).filter(Translation.url == "http://example.com/rere1").delete()
        db.commit()
    finally:
        db.close()


@patch("server.routers.ai_review.process_specific_reretranslation_bg")
def test_ai_review_reretranslate_specific(mock_worker):
    """특정 항목 재재번역 실행 시 TaskManager 등록 검증"""
    mock_worker.return_value = None

    db = SessionLocal()
    try:
        now = int(time.time())
        trans = Translation(
            url="http://example.com/spec1",
            pid="p2",
            original="特定のテスト",
            translated="특정 테스트",
            timestamp=now,
            folderName="BookB"
        )
        db.add(trans)
        db.commit()
        db.refresh(trans)

        q_item = AiReviewQueue(
            translation_id=trans.id,
            original_text="特定のテスト",
            old_translated_text="특정 테스트",
            ai_translated_text="특정 테스트 AI",
            status="pending_review",
            created_at=now,
            updated_at=now
        )
        db.add(q_item)
        db.commit()
        db.refresh(q_item)
        queue_id = q_item.id
    finally:
        db.close()

    res = client.post(
        "/api/ai_review/reretranslate/run",
        json={"queue_ids": [queue_id], "model": "gemini-3.8-flash"}
    )
    assert res.status_code == 200
    data = res.json()
    assert "task_id" in data
    status = task_manager.get_status(data["task_id"])
    assert status["task_id"] == data["task_id"]
    task_manager.cancel(data["task_id"])

    db = SessionLocal()
    try:
        db.query(AiReviewQueue).filter(AiReviewQueue.id == queue_id).delete()
        db.query(Translation).filter(Translation.url == "http://example.com/spec1").delete()
        db.commit()
    finally:
        db.close()


def test_get_review_queue_and_context():
    """GET /api/ai_review/queue가 비동기 스레드 및 메모이제이션 기반으로 전후 문맥을 올바르게 반환하는지 검증"""
    db = SessionLocal()
    url = "http://example.com/queue_ctx_test"
    folder = "QueueContextTestBook"
    try:
        db.query(Translation).filter(Translation.url == url).delete()
        t1 = Translation(url=url, pid="p1", original="1번 문장", translated="1번 번역", timestamp=1000, folderName=folder, title="1화", toc_sort_order=1)
        t2 = Translation(url=url, pid="p2", original="2번 문장(이상)", translated="2번 번역", timestamp=1000, folderName=folder, title="1화", toc_sort_order=2)
        t3 = Translation(url=url, pid="p3", original="3번 문장", translated="3번 번역", timestamp=1000, folderName=folder, title="1화", toc_sort_order=3)
        db.add_all([t1, t2, t3])
        db.commit()
        db.refresh(t2)

        q_item = AiReviewQueue(
            translation_id=t2.id,
            original_text=t2.original,
            old_translated_text=t2.translated,
            ai_translated_text="2번 AI 재번역",
            model_used="gemini-3.8-flash",
            status="pending_review",
            created_at=int(time.time()),
            updated_at=int(time.time())
        )
        db.add(q_item)
        db.commit()

        res = client.get(f"/api/ai_review/queue?folderName={folder}")
        assert res.status_code == 200
        items = res.json()["items"]
        assert len(items) == 1
        item = items[0]
        assert item["translation_id"] == t2.id
        assert len(item["context_before"]) == 1
        assert item["context_before"][0]["original"] == "1번 문장"
        assert len(item["context_after"]) == 1
        assert item["context_after"][0]["original"] == "3번 문장"
    finally:
        db.query(AiReviewQueue).filter(AiReviewQueue.original_text == "2번 문장(이상)").delete()
        db.query(Translation).filter(Translation.url == url).delete()
        db.commit()
        db.close()

