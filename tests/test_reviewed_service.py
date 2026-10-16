import pytest
import time
from fastapi.testclient import TestClient
from server.server import app
from server.services.reviewed_service import ReviewedRegistryService
from server.database import get_sqlite_conn

client = TestClient(app)

def test_reviewed_service_core_logic(tmp_path):
    registry_file = str(tmp_path / "test_reviewed_registry.json")
    service = ReviewedRegistryService(file_path=registry_file)

    book = "마법사의 밤"
    url1 = "https://kakuyomu.jp/works/123/episodes/1"
    url2 = "https://kakuyomu.jp/works/123/episodes/2"
    all_urls = [url1, url2]

    # Initial state
    assert not service.is_book_reviewed(book)
    assert not service.is_chapter_reviewed(url1, book)

    # 1. Chapter 1 review
    res1 = service.set_chapter_reviewed(url1, True, folder_name=book, all_book_urls=all_urls)
    assert res1["success"] is True
    assert service.is_chapter_reviewed(url1, book)
    assert not service.is_chapter_reviewed(url2, book)
    assert not service.is_book_reviewed(book)

    # 2. Chapter 2 review -> Auto-promotion to book review!
    res2 = service.set_chapter_reviewed(url2, True, folder_name=book, all_book_urls=all_urls)
    assert res2["book_promoted"] is True
    assert service.is_book_reviewed(book)
    assert service.is_chapter_reviewed(url1, book)
    assert service.is_chapter_reviewed(url2, book)

    # 3. Unlock Chapter 1 -> Demotes book review
    res3 = service.set_chapter_reviewed(url1, False, folder_name=book, all_book_urls=all_urls)
    assert not service.is_book_reviewed(book)
    assert not service.is_chapter_reviewed(url1, book)
    assert service.is_chapter_reviewed(url2, book)

    # 4. Set book reviewed ON -> locks all chapters
    service.set_book_reviewed(book, True, chapter_urls=all_urls)
    assert service.is_book_reviewed(book)
    assert service.is_chapter_reviewed(url1, book)
    assert service.is_chapter_reviewed(url2, book)

    # 5. Set book reviewed OFF -> unlocks all chapters
    service.set_book_reviewed(book, False, chapter_urls=all_urls)
    assert not service.is_book_reviewed(book)
    assert not service.is_chapter_reviewed(url1, book)
    assert not service.is_chapter_reviewed(url2, book)


def test_reviewed_api_endpoints_and_lock_guards():
    from server.services.reviewed_service import reviewed_service
    test_folder = "검수완료_통합테스트_소설"
    test_url = "https://test.novels.com/chap/100"
    test_pid = "p_review_test_1"

    # Insert test sentence directly into DB for test
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM translations WHERE url = ?", (test_url,))
    cursor.execute(
        "INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (test_url, test_pid, "日本語のテスト原文です。", "일본어 테스트 번역문입니다.", int(time.time()), test_folder, "100화 테스트")
    )
    conn.commit()
    test_id = cursor.lastrowid
    conn.close()

    try:
        # Ensure initial state is unlocked
        reviewed_service.set_chapter_reviewed(test_url, False, folder_name=test_folder)
        reviewed_service.set_book_reviewed(test_folder, False)

        # 1. API: Mark chapter as reviewed
        res = client.put("/api/chapters/review", json={
            "url": test_url,
            "is_reviewed": True,
            "folder_name": test_folder
        })
        assert res.status_code == 200
        assert res.json()["is_chapter_reviewed"] is True
        assert reviewed_service.is_chapter_reviewed(test_url, test_folder)

        # 2. Check /api/books returns is_reviewed flag
        books_res = client.get("/api/books")
        assert books_res.status_code == 200
        book_obj = next((b for b in books_res.json() if b["name"] == test_folder), None)
        assert book_obj is not None
        assert "is_reviewed" in book_obj

        # 3. Check /api/books/{folder}/urls returns is_reviewed = True for this URL
        urls_res = client.get(f"/api/books/{test_folder}/urls")
        assert urls_res.status_code == 200
        found_url = next((u for u in urls_res.json() if u["url"] == test_url), None)
        assert found_url is not None
        assert found_url["is_reviewed"] is True

        # 4. Check /api/books/{folder}/chapter returns items with is_reviewed = True
        chap_res = client.get(f"/api/books/{test_folder}/chapter?title=100화 테스트")
        assert chap_res.status_code == 200
        chap_items = chap_res.json()
        assert len(chap_items) > 0
        assert chap_items[0]["is_reviewed"] is True

        # 5. Security Guard: Upsert must be BLOCKED with HTTP 403 Forbidden!
        upsert_payload = [{
            "url": test_url,
            "pid": test_pid,
            "original": "日本語のテスト原文です。",
            "translated": "수정을 시도하는 번역문",
            "timestamp": int(time.time()),
            "folderName": test_folder,
            "title": "100화 테스트"
        }]
        upsert_res = client.post("/translations/upsert", json=upsert_payload)
        assert upsert_res.status_code == 403
        assert "검수 완료" in upsert_res.json()["detail"]

        # 6. Security Guard: Delete must be BLOCKED with HTTP 403 Forbidden!
        del_res = client.post("/translations/delete", json={"ids": [test_id]})
        assert del_res.status_code == 403
        assert "검수 완료" in del_res.json()["detail"]

        # 7. Security Guard: Replace all in folder must be BLOCKED with HTTP 403 Forbidden!
        # First test with book review
        client.put(f"/api/books/{test_folder}/review", json={"is_reviewed": True})
        replace_res = client.post("/translations/find_replace", json={
            "find_text": "일본어",
            "replace_text": "한국어",
            "folder_scope": test_folder
        })
        assert replace_res.status_code == 403
        assert "검수 완료" in replace_res.json()["detail"]

        # 8. Security Guard: DB Editor approve_single must be BLOCKED with HTTP 403!
        approve_res = client.post("/api/db_editor/approve_single", json={
            "id": test_id,
            "translated": "틴더모드 수정 번역문",
            "backup": False
        })
        assert approve_res.status_code == 403
        assert "검수 완료" in approve_res.json()["detail"]

        # 8-1. Security Guard: AI review quick_edit must be BLOCKED with HTTP 403!
        quick_edit_res = client.post("/api/ai_review/context/quick_edit", json={
            "translation_id": test_id,
            "translated_text": "AI 빠른 수정 시도"
        })
        assert quick_edit_res.status_code == 403
        assert "검수 완료" in quick_edit_res.json()["detail"]

        # 9. Unlock chapter via API
        unlock_res = client.put("/api/chapters/review", json={
            "url": test_url,
            "is_reviewed": False,
            "folder_name": test_folder
        })
        assert unlock_res.status_code == 200
        client.put(f"/api/books/{test_folder}/review", json={"is_reviewed": False})

        # Now editing should succeed
        upsert_payload[0]["translated"] = "정상적으로 수정된 번역문입니다."
        upsert_ok_res = client.post("/translations/upsert", json=upsert_payload)
        assert upsert_ok_res.status_code == 200

    finally:
        # Cleanup
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM translations WHERE url = ?", (test_url,))
        conn.commit()
        conn.close()
        reviewed_service.set_chapter_reviewed(test_url, False, folder_name=test_folder)
        reviewed_service.set_book_reviewed(test_folder, False)
