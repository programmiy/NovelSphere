import time
from unittest.mock import patch

from fastapi.testclient import TestClient

from server.server import app
from server.services.task_manager import task_manager
from server.models import SystemTask
from server.database import SessionLocal

client = TestClient(app)


def test_task_manager_enqueue_and_get_status():
    """TaskManager에 작업을 등록하고 즉시 인메모리 상태를 0ms로 조회할 수 있는지 검증"""
    def dummy_task(n: int, task_id: str):
        for i in range(n):
            task_manager.report_progress(task_id, i + 1, n)
        return {"done": True}

    task_id = task_manager.enqueue(
        task_type="test_dummy",
        func=dummy_task,
        n=5,
        total_items=5,
        pass_task_id=True
    )

    status = task_manager.get_status(task_id)
    assert status["task_id"] == task_id
    assert status["state"] in ("PENDING", "PROGRESS", "SUCCESS")
    assert "meta" in status
    assert status["meta"]["total"] == 5


def test_task_manager_throttled_db_commit():
    """20건 또는 5초 쓰로틀링 커밋이 의도대로 동작하는지 검증"""
    task_id = task_manager.enqueue(
        task_type="throttling_test",
        func=lambda: None,
        total_items=50
    )

    # 5건 진행 시 (20건 미만이므로 DB 즉시 커밋되지 않음)
    task_manager.report_progress(task_id, current=5, total=50)
    in_mem = task_manager.get_status(task_id)
    assert in_mem["meta"]["current"] == 5
    assert in_mem["meta"]["percentage"] == 10

    # 25건 진행 시 (20건 도달하여 DB 커밋 트리거)
    task_manager.report_progress(task_id, current=25, total=50)
    in_mem = task_manager.get_status(task_id)
    assert in_mem["meta"]["current"] == 25
    assert in_mem["meta"]["percentage"] == 50

    db = SessionLocal()
    try:
        row = db.query(SystemTask).filter(SystemTask.id == task_id).first()
        assert row is not None
        assert row.processed_items == 25
        assert row.progress == 50
    finally:
        db.close()


def test_task_manager_cancellation():
    """작업 취소 플래그 및 CANCELLED 상태 전이 검증"""
    task_id = task_manager.enqueue(
        task_type="cancel_test",
        func=lambda: None,
        total_items=10
    )

    assert not task_manager.is_cancelled(task_id)
    cancelled = task_manager.cancel(task_id)
    assert cancelled is True
    assert task_manager.is_cancelled(task_id) is True

    status = task_manager.get_status(task_id)
    assert status["meta"]["raw_status"] == "CANCELLED"


def test_task_manager_interrupted_recovery():
    """서버 비정상 종료 시 RUNNING으로 남은 작업을 INTERRUPTED로 자동 복구하는지 검증"""
    orphan_id = f"orphan-{int(time.time())}"
    db = SessionLocal()
    try:
        orphan_task = SystemTask(
            id=orphan_id,
            task_type="crashed_task",
            status="RUNNING",
            progress=40,
            total_items=100,
            processed_items=40
        )
        db.add(orphan_task)
        db.commit()
    finally:
        db.close()

    task_manager.recover_interrupted_tasks()

    db = SessionLocal()
    try:
        updated = db.query(SystemTask).filter(SystemTask.id == orphan_id).first()
        assert updated is not None
        assert updated.status == "INTERRUPTED"
        assert "Process terminated" in updated.error_message
    finally:
        db.close()


@patch('server.routers.tasks.get_sqlite_conn')
@patch('server.routers.tasks._run_fetch_missing_titles')
def test_fetch_missing_titles_endpoint_success(mock_run, mock_get_conn):
    """POST /fetch_missing_titles가 TaskManager를 통해 정상적으로 작업을 등록하는지 검증"""
    mock_run.return_value = {"processed": 2, "total": 2, "status": "Completed"}
    mock_conn = mock_get_conn.return_value
    mock_cursor = mock_conn.cursor.return_value
    mock_cursor.execute.return_value.fetchall.return_value = [("http://example.com/1",), ("http://example.com/2",)]

    response = client.post("/fetch_missing_titles")
    assert response.status_code == 200
    data = response.json()
    assert "Started fetching titles" in data["message"]
    assert "task_id" in data

    task_id = data["task_id"]
    status_res = client.get(f"/task_status/{task_id}")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["task_id"] == task_id
    assert status_data["state"] in ("PENDING", "PROGRESS", "SUCCESS")
    assert "meta" in status_data
    assert "percentage" in status_data["meta"]


@patch('time.sleep', return_value=None)
@patch('server.routers.tasks.notify_task_event')
@patch('server.routers.tasks._fetch_and_update_title_worker')
def test_run_fetch_missing_titles_worker_logic(mock_worker, mock_notify, mock_sleep):
    """_run_fetch_missing_titles 워커 함수의 진행률 보고 및 알림 로직 검증"""
    from server.routers.tasks import _run_fetch_missing_titles
    mock_worker.return_value = True
    urls = ["http://example.com/test1", "http://example.com/test2"]
    res = _run_fetch_missing_titles(urls, task_id="mock-worker-task")
    assert res["status"] == "Completed"
    assert res["processed"] == 2
    mock_notify.assert_called_once()


@patch('server.routers.tasks.get_sqlite_conn')
def test_fetch_missing_titles_endpoint_no_missing_titles(mock_get_conn):
    """누락된 제목이 없을 때 적절한 응답을 반환하는지 검증"""
    mock_conn = mock_get_conn.return_value
    mock_cursor = mock_conn.cursor.return_value
    mock_cursor.execute.return_value.fetchall.return_value = []

    response = client.post("/fetch_missing_titles")
    assert response.status_code == 200
    assert "No missing titles to fetch." in response.json()["message"]


def test_get_task_status_compat_and_rest():
    """GET /task_status/{task_id} 및 GET /tasks/{task_id} 엔드포인트 호환성 검증"""
    task_id = task_manager.enqueue(
        task_type="status_check",
        func=lambda: None,
        total_items=10
    )

    res_compat = client.get(f"/task_status/{task_id}")
    assert res_compat.status_code == 200
    assert res_compat.json()["task_id"] == task_id

    res_rest = client.get(f"/tasks/{task_id}")
    assert res_rest.status_code == 200
    assert res_rest.json()["task_id"] == task_id


def test_cancel_task_endpoint():
    """POST /tasks/{task_id}/cancel 엔드포인트 동작 검증"""
    task_id = task_manager.enqueue(
        task_type="cancel_endpoint_test",
        func=lambda: None,
        total_items=5
    )

    res = client.post(f"/tasks/{task_id}/cancel")
    assert res.status_code == 200
    assert res.json()["task_id"] == task_id
    assert res.json()["cancelled"] is True


def test_list_tasks_endpoint():
    """GET /tasks 엔드포인트를 통한 최근 작업 목록 조회 검증"""
    res = client.get("/tasks")
    assert res.status_code == 200
    assert isinstance(res.json(), list)
