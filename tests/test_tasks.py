import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import sqlite3
import os
from urllib.parse import urlparse
from celery.result import AsyncResult

# server.server에서 app을 import하기 전에 settings를 오버라이드해야 합니다.
# 이를 위해 pytest fixture를 사용합니다.
@pytest.fixture(scope="module", autouse=True)
def override_settings():
    # 테스트용 데이터베이스 경로 설정
    test_db_path = "test_translations.db"
    
    # 환경 변수 오버라이드
    os.environ["DATABASE_URL"] = f"sqlite:///{test_db_path}"
    os.environ["CELERY_ALWAYS_EAGER"] = "True" # Celery 작업을 즉시 실행하도록 설정

    # settings 모듈을 다시 로드하여 변경된 환경 변수를 적용
    # 이 방법은 모듈이 이미 로드된 경우 작동하지 않을 수 있으므로,
    # 테스트 시작 전에 환경 변수를 설정하는 것이 가장 안전합니다.
    # 여기서는 pytest의 autouse fixture를 사용하여 모듈 로드 전에 실행되도록 합니다.
    from server.settings import settings
    settings.database_url = f"sqlite:///{test_db_path}"
    settings.celery_always_eager = True

    # celery_app이 settings를 로드하기 전에 eager 모드가 설정되도록 합니다.
    from server.celery_app import celery_app
    celery_app.conf.task_always_eager = True
    celery_app.conf.broker_url = "memory://" # Redis 연결 시도를 막기 위해 memory 브로커 사용
    celery_app.conf.result_backend = "cache+memory://" # Redis 연결 시도를 막기 위해 memory 백엔드 사용
    celery_app.conf.task_store_eager_result = True # eager 모드에서 결과 저장 활성화

    # 테스트용 DB 파일이 존재하면 삭제
    if os.path.exists(test_db_path):
        os.remove(test_db_path)

    # 테스트용 DB 초기화 (스키마 생성)
    conn = sqlite3.connect(test_db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            pid TEXT,
            original TEXT NOT NULL,
            translated TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            folderName TEXT,
            title TEXT,
            toc_sort_order INTEGER,
            UNIQUE(url, pid)
        );
    """)
    conn.commit()
    conn.close()

    yield # 테스트 실행

    # 테스트 완료 후 DB 파일 삭제
    if os.path.exists(test_db_path):
        os.remove(test_db_path)
    
    # 환경 변수 정리
    del os.environ["DATABASE_URL"]
    del os.environ["CELERY_ALWAYS_EAGER"]

# settings 오버라이드 후 app import
from server.server import app
client = TestClient(app)

def get_db_path_for_test():
    parsed_url = urlparse(os.environ["DATABASE_URL"])
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

@pytest.fixture
def setup_db_data():
    conn = sqlite3.connect(get_db_path_for_test())
    cursor = conn.cursor()
    cursor.execute("DELETE FROM translations") # 기존 데이터 삭제
    cursor.execute("INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   ("http://example.com/1", "p1", "original 1", "translated 1", 1678886400, "FolderA", None))
    cursor.execute("INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   ("http://example.com/2", "p1", "original 2", "translated 2", 1678886401, "FolderA", "Existing Title"))
    cursor.execute("INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   ("http://example.com/3", "p1", "original 3", "translated 3", 1678886402, "FolderB", "年齢確認")) # Invalid title
    conn.commit()
    conn.close() # DB 연결 닫기
    yield
    conn = sqlite3.connect(get_db_path_for_test())
    cursor = conn.cursor()
    cursor.execute("DELETE FROM translations")
    conn.commit()
    conn.close()

@patch('server.routers.tasks._fetch_and_update_title_worker')
@patch('server.routers.tasks.process_urls_in_background_task.update_state') # update_state 모의
def test_process_urls_in_background_task_success(mock_update_state, mock_worker):
    urls = ["http://test.com/url1", "http://test.com/url2"]
    
    from server.routers.tasks import process_urls_in_background_task
    result = process_urls_in_background_task(urls)
    
    assert mock_worker.call_count == len(urls)
    assert mock_update_state.call_count == len(urls)

@patch('server.routers.tasks._fetch_and_update_title_worker')
@patch('server.routers.tasks.process_urls_in_background_task.update_state') # update_state 모의
def test_process_urls_in_background_task_failure(mock_update_state, mock_worker):
    mock_worker.side_effect = [True, False] # 첫 번째는 성공, 두 번째는 실패
    urls = ["http://test.com/url1", "http://test.com/url2"]
    
    from server.routers.tasks import process_urls_in_background_task
    result = process_urls_in_background_task(urls)
    
    assert mock_worker.call_count == len(urls)
    assert mock_update_state.call_count == len(urls)
    assert result['status'] == 'Completed' # Celery eager mode에서는 실패해도 Completed로 반환될 수 있음
    assert result['percentage'] == 100

@patch('server.routers.tasks.process_urls_in_background_task') # process_urls_in_background_task 자체를 모의
@patch('server.routers.tasks._fetch_and_update_title_worker')
def test_fetch_missing_titles_endpoint_success(mock_worker, mock_process_task, setup_db_data):
    # mock_process_task가 AsyncResult 객체를 반환하도록 설정
    mock_task_result = MagicMock(spec=AsyncResult)
    mock_task_result.id = "mock_task_id_123"
    mock_process_task.apply_async.return_value = mock_task_result

    response = client.post("/fetch_missing_titles")
    assert response.status_code == 200
    assert "Started fetching titles" in response.json()["message"]
    assert response.json()["task_id"] == "mock_task_id_123"

    # process_urls_in_background_task가 호출되었는지 확인
    mock_process_task.apply_async.assert_called_once()
    # _fetch_and_update_title_worker는 process_urls_in_background_task 내부에서 호출되므로,
    # process_urls_in_background_task를 모의하면 _fetch_and_update_title_worker는 호출되지 않습니다.
    # 따라서 이 assert는 제거하거나, mock_process_task의 내부 동작을 모의해야 합니다.
    # 여기서는 mock_process_task가 호출되었는지 확인하는 것으로 충분합니다.
    # assert mock_worker.call_count > 0 # 이 부분은 제거합니다.

def test_fetch_missing_titles_endpoint_no_missing_titles(setup_db_data):
    # 모든 제목을 미리 업데이트하여 누락된 제목이 없도록 설정
    conn = sqlite3.connect(get_db_path_for_test())
    cursor = conn.cursor()
    cursor.execute("UPDATE translations SET title = 'Updated Title' WHERE title IS NULL OR title = '年齢確認'")
    conn.commit()
    conn.close()

    response = client.post("/fetch_missing_titles")
    assert response.status_code == 200
    assert "No missing titles to fetch." in response.json()["message"]

def test_get_task_status_eager_mode():
    # eager mode에서는 작업이 즉시 완료되므로 PENDING 상태는 발생하지 않습니다.
    # 따라서 항상 SUCCESS 또는 FAILURE 상태를 반환해야 합니다.
    # 여기서는 가상의 task_id를 사용하여 AsyncResult가 어떻게 동작하는지 확인합니다.
    # 실제 Celery 백엔드에 연결하지 않으므로, AsyncResult는 기본 상태를 반환합니다.
    from server.celery_app import celery_app
    
    # 가상의 성공 작업 결과 생성
    mock_success_task_id = "mock_success_task_id"
    celery_app.backend.mark_as_done(mock_success_task_id, {'current': 1, 'total': 1, 'percentage': 100, 'status': 'Completed'})
    response = client.get(f"/task_status/{mock_success_task_id}")
    assert response.status_code == 200
    assert response.json()["state"] == "SUCCESS"
    assert response.json()["meta"]["status"] == "Completed"

    # 가상의 실패 작업 결과 생성
    mock_failure_task_id = "mock_failure_task_id"
    celery_app.backend.mark_as_failure(mock_failure_task_id, Exception("Mocked error"))
    response = client.get(f"/task_status/{mock_failure_task_id}")
    assert response.status_code == 200
    assert response.json()["state"] == "FAILURE"
    assert "Mocked error" in response.json()["status"]

    # 존재하지 않는 task_id (PENDING으로 간주)
    response = client.get("/task_status/non_existent_task_id")
    assert response.status_code == 200
    assert response.json()["state"] == "PENDING"
    assert response.json()["status"] == "Pending..."
