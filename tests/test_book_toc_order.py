import pytest
from server.database import get_sqlite_conn
from server.services.book_service import update_book_toc_order

def test_update_book_toc_order_updates_url_metadata():
    """update_book_toc_order 실행 시 translations 및 url_metadata의 sort_order가 정상 갱신되는지 검증"""
    conn = get_sqlite_conn()
    cursor = conn.cursor()

    # 테스트 데이터 준비
    url1 = "https://kakuyomu.jp/works/123/episodes/1"
    url2 = "https://kakuyomu.jp/works/123/episodes/2"
    folder = "목차테스트소설"

    cursor.execute("""
        INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
        VALUES (?, 'p1', '第1話', '제1화', 1000, ?, '1화')
    """, (url1, folder))
    cursor.execute("""
        INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
        VALUES (?, 'p1', '第2話', '제2화', 1000, ?, '2화')
    """, (url2, folder))

    # url_metadata 테이블에도 레코드 추가
    cursor.execute("INSERT OR REPLACE INTO url_metadata (url, sort_order) VALUES (?, 99)", (url1,))
    cursor.execute("INSERT OR REPLACE INTO url_metadata (url, sort_order) VALUES (?, 99)", (url2,))
    conn.commit()
    conn.close()

    try:
        # 역순 정렬 지정
        new_order = [
            {"url": url2, "title": "2화 (수정)"},
            {"url": url1, "title": "1화 (수정)"}
        ]
        updated_count = update_book_toc_order(folder, new_order)
        assert updated_count == 2

        # DB 검증
        conn = get_sqlite_conn(as_dict=True)
        cursor = conn.cursor()

        # translations 검증
        cursor.execute("SELECT url, toc_sort_order, title FROM translations WHERE url = ?", (url2,))
        row2 = cursor.fetchone()
        assert row2["toc_sort_order"] == 0
        assert row2["title"] == "2화 (수정)"

        cursor.execute("SELECT url, toc_sort_order, title FROM translations WHERE url = ?", (url1,))
        row1 = cursor.fetchone()
        assert row1["toc_sort_order"] == 1
        assert row1["title"] == "1화 (수정)"

        # url_metadata 검증 (오류 없이 sort_order가 0, 1로 정상 저장되었는지)
        cursor.execute("SELECT sort_order FROM url_metadata WHERE url = ?", (url2,))
        meta2 = cursor.fetchone()
        assert meta2["sort_order"] == 0

        cursor.execute("SELECT sort_order FROM url_metadata WHERE url = ?", (url1,))
        meta1 = cursor.fetchone()
        assert meta1["sort_order"] == 1

        conn.close()

    finally:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM translations WHERE folderName = ?", (folder,))
        cursor.execute("DELETE FROM url_metadata WHERE url IN (?, ?)", (url1, url2))
        conn.commit()
        conn.close()
