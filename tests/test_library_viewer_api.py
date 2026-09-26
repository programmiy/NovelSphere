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

    # 7. Desktop device with leftover mobile cookie -> Automatically corrected to PC template!
    leftover_desktop_res = client.get("/", headers={"User-Agent": desktop_ua}, cookies={"lanovel_view_mode": "mobile"})
    assert leftover_desktop_res.status_code == 200
    assert "library.css" in leftover_desktop_res.text
    assert "m-bottom-nav" not in leftover_desktop_res.text

def test_toc_import_elements_presence_in_pc_and_mobile():
    """PC 및 모바일 서재 뷰에서 TOC(목차) 임포트 및 동기화 버튼들이 완벽하게 존재하는지 검증"""
    # 1. PC Library HTML
    pc_res = client.get("/?view=pc")
    assert pc_res.status_code == 200
    assert "import-toc-btn" in pc_res.text
    assert "sync-toc-editor-btn" in pc_res.text
    assert "book-toc-source-url" in pc_res.text
    assert "crawl-summary-btn" in pc_res.text

    # 2. Mobile Library HTML
    mobile_res = client.get("/m")
    assert mobile_res.status_code == 200
    assert "m-import-toc-btn" in mobile_res.text
    assert "m-sync-toc-btn" in mobile_res.text
    assert "m-book-toc-source-url" in mobile_res.text
    assert "m-crawl-summary-btn" in mobile_res.text



def test_book_visibility_toggle_and_hidden_filtering():
    """책 숨김 토글(is_visible) 및 /api/books 필터링 동작 검증"""
    test_folder = "숨김_테스트_전용_소설"

    # 1. 초기 등록
    act_res = client.put(f"/api/books/{test_folder}/activity", json={"notes": "숨김 검증용"})
    assert act_res.status_code == 200

    # 기본 노출 확인
    books_res = client.get("/api/books")
    assert books_res.status_code == 200
    book_names = [b["name"] for b in books_res.json()]
    assert test_folder in book_names

    # 2. 서재에서 숨기기 (is_visible = False)
    vis_res = client.put(f"/api/books/{test_folder}/visibility", json={"is_visible": False})
    assert vis_res.status_code == 200
    assert vis_res.json()["is_visible"] is False

    # 3. 기본 /api/books 및 /folders 조회 시 목록에서 완전히 제외되어야 함
    books_hidden_res = client.get("/api/books")
    assert books_hidden_res.status_code == 200
    hidden_names = [b["name"] for b in books_hidden_res.json()]
    assert test_folder not in hidden_names

    folders_hidden_res = client.get("/folders")
    assert folders_hidden_res.status_code == 200
    folder_names = [f["name"] for f in folders_hidden_res.json()]
    assert test_folder not in folder_names

    # 4. include_hidden=True 조회 시에는 포함되어야 함
    all_books_res = client.get("/api/books?include_hidden=true")
    assert all_books_res.status_code == 200
    all_books = all_books_res.json()
    target_book = next((b for b in all_books if b["name"] == test_folder), None)
    assert target_book is not None
    assert target_book.get("is_visible") == 0

    # 5. 다시 보이기 (is_visible = True)
    restore_res = client.put(f"/api/books/{test_folder}/visibility", json={"is_visible": True})
    assert restore_res.status_code == 200
    assert restore_res.json()["is_visible"] is True

    # 6. 기본 목록에 정상 복구 확인
    restored_books_res = client.get("/api/books")
    restored_names = [b["name"] for b in restored_books_res.json()]
    assert test_folder in restored_names

def test_viewer_chapter_content_and_url_title_unification():
    folder = "회차_통합_테스트_소설"
    url = "https://kakuyomu.jp/works/12345/episodes/99999"
    
    # 1. 2개의 단락을 서로 다른 제목으로 upsert (하나는 클린 제목, 하나는 사이트 접미사 포함)
    items = [
        {
            "url": url,
            "pid": "p1",
            "original": "段落１の本文です。",
            "translated": "단락 1의 본문입니다.",
            "timestamp": 1000,
            "folderName": folder,
            "title": "제1화 시작"
        },
        {
            "url": url,
            "pid": "p2",
            "original": "段落２の本文です。",
            "translated": "단락 2의 본문입니다.",
            "timestamp": 1001,
            "folderName": folder,
            "title": "제1화 시작 - 소설제목 - カクヨム"
        }
    ]
    upsert_res = client.post("/translations/upsert", json=items)
    assert upsert_res.status_code == 200

    # 2. 챕터 목록(/chapters) 조회 시 회차가 분리되지 않고 정확히 1개만 조회되어야 함
    chapters_res = client.get(f"/api/books/{folder}/chapters")
    assert chapters_res.status_code == 200
    assert "no-cache" in chapters_res.headers.get("cache-control", "").lower()
    chapters = chapters_res.json()
    assert len(chapters) == 1
    assert chapters[0] == "제1화 시작"

    # 3. 챕터 내용(/chapter) 조회 시 p1, p2 두 단락이 누락 없이 모두 반환되어야 함
    content_res = client.get(f"/api/books/{folder}/chapter?title={chapters[0]}")
    assert content_res.status_code == 200
    assert "no-cache" in content_res.headers.get("cache-control", "").lower()
    content = content_res.json()
    assert len(content) == 2
    pids = [row["pid"] for row in content]
    assert "p1" in pids
    assert "p2" in pids
    # 두 단락의 제목이 모두 클린 제목으로 동기화되어 있어야 함
    assert all(row["title"] == "제1화 시작" for row in content)

    # 4. URL 목록(/urls)에서도 해당 URL이 1개로 그룹화되고 단락 수가 2개여야 함
    urls_res = client.get(f"/api/books/{folder}/urls")
    assert urls_res.status_code == 200
    urls_data = urls_res.json()
    assert len(urls_data) == 1
    assert urls_data[0]["count"] == 2
    assert urls_data[0]["title"] == "제1화 시작"



