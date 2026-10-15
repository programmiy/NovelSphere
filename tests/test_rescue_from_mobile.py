import json
import zlib
import base64
import pytest
from fastapi.testclient import TestClient

from server.server import app
from server.database import SessionLocal, get_sqlite_conn
from server.models import Translation, AppliedUrl

client = TestClient(app)

def test_rescue_from_mobile_additive_only():
    # 1. PC DB에 기존 문장 1건 등록
    db = SessionLocal()
    try:
        db.query(Translation).filter(Translation.url == "http://rescue-test.com/1").delete()
        t1 = Translation(
            url="http://rescue-test.com/1",
            pid="p1",
            original="こんにちは",
            translated="안녕하세요 (PC 원본 보존)",
            timestamp=1000,
            folderName="RescueBook",
            title="Ch1"
        )
        db.add(t1)
        db.commit()
    finally:
        db.close()

    # 2. 모바일에서 전송할 챕터 데이터 구성:
    # Ch1: p1(이미 PC에 있음 - 스킵되어야 함), p2(PC에 없음 - 추가되어야 함)
    # Ch2: p1(완전히 새로운 챕터 - 추가되어야 함)
    ch1_sentences = [
        {"pid": "p1", "original": "こんにちは", "translated": "모바일 번역문(무시되어야 함)", "timestamp": 2000, "folderName": "RescueBook", "title": "Ch1"},
        {"pid": "p2", "original": "世界", "translated": "세계 (모바일에서 신규 복원)", "timestamp": 2000, "folderName": "RescueBook", "title": "Ch1"},
    ]
    ch1_blob = base64.b64encode(zlib.compress(json.dumps(ch1_sentences).encode('utf-8'))).decode('ascii')

    ch2_sentences = [
        {"pid": "p1", "original": "さようなら", "translated": "작별 (완전 신규 챕터)", "timestamp": 2000, "folderName": "RescueBook", "title": "Ch2"},
    ]
    ch2_blob = base64.b64encode(zlib.compress(json.dumps(ch2_sentences).encode('utf-8'))).decode('ascii')

    payload = {
        "client_id": "mobile_rescue_test",
        "chapters": [
            {
                "book_name": "RescueBook",
                "title": "Ch1",
                "url": "http://rescue-test.com/1",
                "sort_order": 1,
                "sentence_count": 2,
                "compressed_content": ch1_blob
            },
            {
                "book_name": "RescueBook",
                "title": "Ch2",
                "url": "http://rescue-test.com/2",
                "sort_order": 2,
                "sentence_count": 1,
                "compressed_content": ch2_blob
            }
        ]
    }

    # 3. rescue-from-mobile 호출
    res = client.post("/api/sync/rescue-from-mobile", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["rescued_sentences"] == 2 # p2 of Ch1, p1 of Ch2
    assert data["rescued_chapters"] == 2

    # 4. 검증: PC에 원래 있던 p1의 translated는 절대로 바뀌지 않았어야 함
    db = SessionLocal()
    try:
        p1 = db.query(Translation).filter(Translation.url == "http://rescue-test.com/1", Translation.pid == "p1").first()
        assert p1 is not None
        assert p1.translated == "안녕하세요 (PC 원본 보존)" # 원본 불변 검증!

        p2 = db.query(Translation).filter(Translation.url == "http://rescue-test.com/1", Translation.pid == "p2").first()
        assert p2 is not None
        assert p2.translated == "세계 (모바일에서 신규 복원)" # 신규 추가 검증!

        ch2_p1 = db.query(Translation).filter(Translation.url == "http://rescue-test.com/2", Translation.pid == "p1").first()
        assert ch2_p1 is not None
        assert ch2_p1.translated == "작별 (완전 신규 챕터)"

        # Clean up test rows
        db.query(Translation).filter(Translation.url.like("http://rescue-test.com/%")).delete()
        db.query(AppliedUrl).filter(AppliedUrl.url.like("http://rescue-test.com/%")).delete()
        db.commit()
    finally:
        db.close()
