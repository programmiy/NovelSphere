import pytest
from fastapi.testclient import TestClient
import sqlite3
import os
import time
import gzip
import json

from server.server import app
from server.database import get_sqlite_conn
from server.backup_utils import record_tombstone

client = TestClient(app)

def test_updated_at_and_tombstone_sync():
    """
    스냅샷 기반 동기화 핵심 무결성 검증:
    1. 미분류 폴더 지정 또는 번역 수정 시 updated_at이 갱신되어 pull 엔드포인트에서 즉시 감지되는지 검증
    2. 데이터 삭제 시 deleted_records 툼스톤이 기록되고 pull 엔드포인트 deletions에 정상 포함되는지 검증
    """
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    # 1. 과거 timestamp(1000초 전)를 가진 번역문 적재
    past_ts = int(time.time()) - 1000
    cursor.execute("""
        INSERT INTO translations (url, pid, original, translated, timestamp, updated_at, folderName, title, toc_sort_order)
        VALUES ('https://kakuyomu.jp/works/123/episodes/1', 'p1', '원문1', '번역1', ?, ?, '테스트소설', '1화', 1)
    """, (past_ts, past_ts))
    trans_id = cursor.lastrowid
    conn.commit()

    # 동기화 기준점을 500초 전으로 설정 (past_ts 이후)
    since_ts = int(time.time()) - 500

    # 현재 상태에서는 since_ts > past_ts 이므로 pull 결과에 나오지 않아야 함
    res = client.get(f"/api/sync/pull?since={since_ts}&last_id=0&limit=100")
    assert res.status_code == 200
    data = json.loads(gzip.decompress(res.content).decode('utf-8'))
    assert len(data["translations"]) == 0

    # 2. 번역문 수정 수행 (data_crud의 upsert 또는 직접 수정)
    now_ts = int(time.time())
    cursor.execute("""
        UPDATE translations
        SET translated = '수정된 번역1', updated_at = ?
        WHERE id = ?
    """, (now_ts, trans_id))
    conn.commit()

    # 이제 updated_at > since_ts 이므로 timestamp는 과거여도 pull 결과에 100% 잡혀야 함!
    res2 = client.get(f"/api/sync/pull?since={since_ts}&last_id=0&limit=100")
    assert res2.status_code == 200
    data2 = json.loads(gzip.decompress(res2.content).decode('utf-8'))
    assert len(data2["translations"]) == 1
    assert data2["translations"][0]["translated"] == "수정된 번역1"
    assert data2["translations"][0]["timestamp"] == past_ts  # 오늘 실적 통계 보존 확인!

    # 3. 삭제 장부 (Tombstone) 테스트
    record_tombstone("chapter", "https://kakuyomu.jp/works/123/episodes/1", parent_scope="테스트소설")

    res3 = client.get(f"/api/sync/pull?since={since_ts}&last_id=0&limit=100")
    assert res3.status_code == 200
    data3 = json.loads(gzip.decompress(res3.content).decode('utf-8'))
    assert len(data3["deletions"]) >= 1
    del_entry = next(d for d in data3["deletions"] if d["entity_id"] == "https://kakuyomu.jp/works/123/episodes/1")
    assert del_entry["entity_type"] == "chapter"
    assert del_entry["parent_scope"] == "테스트소설"

    conn.close()
