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

def test_mobile_library_detection_and_pc_preservation():
    # 1. Desktop User-Agent -> Serves 100% untouched PC library.html
    desktop_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    pc_res = client.get("/", headers={"User-Agent": desktop_ua})
    assert pc_res.status_code == 200
    assert "library.css" in pc_res.text
    assert "library.js" in pc_res.text
    assert "hero-continue-reading" in pc_res.text
    assert "m-bottom-nav" not in pc_res.text

    # 2. Mobile User-Agent (iPhone / Android) -> Serves library_mobile.html
    mobile_ua_iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    mobile_res = client.get("/", headers={"User-Agent": mobile_ua_iphone})
    assert mobile_res.status_code == 200
    assert "library_mobile.css" in mobile_res.text
    assert "library_mobile.js" in mobile_res.text
    assert "m-bottom-nav" in mobile_res.text
    assert "mBookShelf" in mobile_res.text
    assert "offline-banner" in mobile_res.text

    # 3. Direct /m route -> Always serves mobile template
    m_direct_res = client.get("/m")
    assert m_direct_res.status_code == 200
    assert "library_mobile.css" in m_direct_res.text
    assert "m-bottom-nav" in m_direct_res.text

    # 4. Desktop with ?view=mobile query param -> Serves mobile template and sets cookie
    forced_mobile_res = client.get("/?view=mobile", headers={"User-Agent": desktop_ua})
    assert forced_mobile_res.status_code == 200
    assert "library_mobile.css" in forced_mobile_res.text
    assert "lanovel_view_mode=mobile" in forced_mobile_res.headers.get("set-cookie", "")

    # 5. Mobile with ?view=pc query param -> Serves PC template and sets cookie
    forced_pc_res = client.get("/?view=pc", headers={"User-Agent": mobile_ua_iphone})
    assert forced_pc_res.status_code == 200
    assert "library.css" in forced_pc_res.text
    assert "hero-continue-reading" in forced_pc_res.text
    assert "lanovel_view_mode=pc" in forced_pc_res.headers.get("set-cookie", "")

    # 6. Mobile device with lanovel_view_mode=pc cookie -> Serves PC template
    cookie_pc_res = client.get("/", headers={"User-Agent": mobile_ua_iphone}, cookies={"lanovel_view_mode": "pc"})
    assert cookie_pc_res.status_code == 200
    assert "library.css" in cookie_pc_res.text
    assert "m-bottom-nav" not in cookie_pc_res.text

