import pytest
from fastapi.testclient import TestClient
from server.server import app

client = TestClient(app)

def test_book_activity_and_library_enrichment():
    test_folder = "테스트_소설_UIUX_검증용"

    # 1. Update book activity with last_read_chapter_title and is_completed = True
    payload = {
        "last_read_chapter_title": "제1화 새로운 시작",
        "last_read_pid": "p_001",
        "is_completed": True,
        "is_bookmarked": True,
        "notes": "완결까지 흥미진진한 소설",
        "summary": "주인공의 모험기"
    }
    update_res = client.put(f"/api/books/{test_folder}/activity", json=payload)
    assert update_res.status_code == 200
    assert "updated" in update_res.json().get("message", "").lower()

    # 2. Fetch book activity directly
    get_act_res = client.get(f"/api/books/{test_folder}/activity")
    assert get_act_res.status_code == 200
    activity = get_act_res.json()
    assert activity["folderName"] == test_folder
    assert activity["last_read_chapter_title"] == "제1화 새로운 시작"
    assert activity["last_read_pid"] == "p_001"
    assert activity["is_completed"] == 1
    assert activity["is_bookmarked"] == 1
    assert activity["summary"] == "주인공의 모험기"

    # 3. Check /api/books (or /folders) endpoint returns enriched data with chapter_count
    books_res = client.get("/api/books")
    assert books_res.status_code == 200
    books = books_res.json()
    target_book = next((b for b in books if b["name"] == test_folder), None)
    assert target_book is not None
    assert "chapter_count" in target_book
    assert target_book["activity"]["is_completed"] == 1
    assert target_book["activity"]["last_read_chapter_title"] == "제1화 새로운 시작"

def test_viewer_ui_html_response():
    response = client.get("/viewer?book=테스트_소설")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "reading-progress-bar" in response.text
    assert "reader-settings-panel" in response.text

def test_single_save_completion_toggle_and_cache_headers():
    test_folder = "단일저장_완결_검증용_소설"

    # 1. First save: Mark as completed = True
    payload = {"is_completed": True}
    res = client.put(f"/api/books/{test_folder}/activity", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "activity" in data
    assert data["activity"]["is_completed"] == 1

    # 2. Immediate single GET /api/books must reflect is_completed == 1 without 2nd save
    books_res = client.get("/api/books")
    assert books_res.status_code == 200
    assert "no-cache" in books_res.headers.get("cache-control", "").lower()
    books = books_res.json()
    target_book = next((b for b in books if b["name"] == test_folder), None)
    assert target_book is not None
    assert target_book["activity"]["is_completed"] == 1

    # 3. Toggle back to is_completed = False on single save
    payload_untoggle = {"is_completed": False}
    res_untoggle = client.put(f"/api/books/{test_folder}/activity", json=payload_untoggle)
    assert res_untoggle.status_code == 200
    assert res_untoggle.json()["activity"]["is_completed"] == 0

    # 4. Immediate single GET /api/books must reflect is_completed == 0
    books_res2 = client.get("/api/books")
    books2 = books_res2.json()
    target_book2 = next((b for b in books2 if b["name"] == test_folder), None)
    assert target_book2 is not None
    assert target_book2["activity"]["is_completed"] == 0

def test_library_ui_elements():
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "hero-continue-reading" in response.text
    assert "viewModeToggle" in response.text
    assert "btnViewGrid" in response.text
    assert "btnViewList" in response.text
    assert "statUnreadBooks" in response.text
    assert "countUnread" in response.text
