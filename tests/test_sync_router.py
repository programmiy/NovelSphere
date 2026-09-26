import os
import json
import gzip
import pytest
from fastapi.testclient import TestClient

from server.server import app
from server.database import get_sqlite_conn
from server.models import Translation, BookActivity

client = TestClient(app)

def test_sync_ping():
    """GET /api/sync/ping 엔드포인트 동작 검증"""
    res = client.get("/api/sync/ping")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "online"
    assert data["app_name"] == "LANOVEL"
    assert "server_time" in data
    assert "total_translations" in data

def test_sync_push_and_pull():
    """
    POST /api/sync/push 로 모바일에서 번역문 수정 및 독서 진도 업로드 검증
    GET /api/sync/pull 로 PC에서 변경된 데이터 다운로드 검증
    """
    # 1. 테스트용 번역문 DB에 사전 삽입
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
        VALUES ('http://test.com/1', 'p1', 'テスト原文', '초기 번역문', 1000, '테스트 소설', '1화')
    """)
    trans_id = cursor.lastrowid
    conn.commit()
    conn.close()

    # 2. 모바일 앱에서 번역문 수정 및 활동 정보 Push 전송
    push_payload = {
        "push_timestamp": 2000,
        "modified_translations": [
            {
                "id": trans_id,
                "url": "http://test.com/1",
                "pid": "p1",
                "original": "テスト原文",
                "translated": "모바일에서 수정한 완벽한 번역문",
                "timestamp": 2000,
                "title": "1화",
                "folderName": "테스트 소설"
            }
        ],
        "activities": [
            {
                "folderName": "테스트 소설",
                "last_read_timestamp": 2000,
                "last_read_pid": "p1",
                "last_read_chapter_title": "1화",
                "is_completed": 0,
                "is_visible": 1,
                "is_bookmarked": 1,
                "notes": "모바일에서 작성한 메모"
            }
        ]
    }

    # Gzip 압축 전송
    raw_bytes = json.dumps(push_payload, ensure_ascii=False).encode('utf-8')
    compressed_bytes = gzip.compress(raw_bytes)

    push_res = client.post(
        "/api/sync/push",
        content=compressed_bytes,
        headers={"Content-Type": "application/json", "Content-Encoding": "gzip"}
    )
    assert push_res.status_code == 200
    push_data = push_res.json()
    assert push_data["status"] == "success"
    assert push_data["updated_translations"] >= 1
    assert push_data["updated_activities"] >= 1

    # 3. PC DB에 정상 반영되었는지 직접 확인
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    cursor.execute("SELECT translated FROM translations WHERE id = ?", (trans_id,))
    updated_trans = cursor.fetchone()
    assert updated_trans["translated"] == "모바일에서 수정한 완벽한 번역문"

    cursor.execute("SELECT * FROM book_activity WHERE folderName = '테스트 소설'")
    act = cursor.fetchone()
    assert act["last_read_chapter_title"] == "1화"
    assert act["is_bookmarked"] == 1
    assert act["notes"] == "모바일에서 작성한 메모"
    conn.close()

    # 4. Pull 증분 동기화 테스트
    pull_res = client.get("/api/sync/pull?since=1500")
    assert pull_res.status_code == 200
    # Gzip 압축 해제 검증
    decompressed = gzip.decompress(pull_res.content)
    pull_data = json.loads(decompressed.decode('utf-8'))
    assert "translations" in pull_data
    assert "activities" in pull_data
    assert "updated_chapters" in pull_data
    # 2000 시점에 수정한 번역문이 pull 결과에 포함되어 있는지 확인
    found = any(t["id"] == trans_id for t in pull_data["translations"])
    assert found is True
    # 수정된 회차가 updated_chapters에도 포함되어 있는지 확인
    chap_found = any(c["url"] == "http://test.com/1" for c in pull_data["updated_chapters"])
    assert chap_found is True

def test_sync_glossary_rule():
    """모바일에서 일괄 찾아바꾸기 룰 전송 시 PC DB에도 일괄 치환되는지 검증"""
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
        VALUES ('http://test.com/glossary', 'p2', '田中さん', '다나카 씨는 걸었다', 3000, '치환소설', '2화')
    """)
    trans_id = cursor.lastrowid
    conn.commit()
    conn.close()

    push_payload = {
        "push_timestamp": 3500,
        "modified_translations": [],
        "activities": [],
        "glossary_rules": [
            {
                "folder_scope": "치환소설",
                "find_text": "다나카",
                "replace_text": "김철수",
                "use_regex": False,
                "case_sensitive": False
            }
        ]
    }

    push_res = client.post("/api/sync/push", json=push_payload)
    assert push_res.status_code == 200
    assert push_res.json()["applied_glossary_rules"] >= 1

    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()
    cursor.execute("SELECT translated FROM translations WHERE id = ?", (trans_id,))
    row = cursor.fetchone()
    assert "김철수 씨는 걸었다" in row["translated"]
    conn.close()
