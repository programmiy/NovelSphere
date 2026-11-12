import pytest
import time
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from server.database import get_db
from server.models import Base, SentenceHighlight, Translation
from server.server import app

# 인메모리 격리 테스트 DB 세팅
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def test_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_highlights_crud_and_counts(client, test_db):
    # 1. 하이라이트 생성
    payload = {
        "book_name": "테스트소설1",
        "chapter_title": "제1화",
        "url": "https://ncode.syosetu.com/n1111/1/",
        "pid": "p5",
        "original": "彼は剣を抜いた。",
        "translated": "그는 검을 뽑았다.",
        "note": "어색함"
    }
    res = client.post("/api/highlights", json=payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["book_name"] == "테스트소설1"
    assert data["pid"] == "p5"
    assert data["is_resolved"] == 0
    h_id = data["id"]

    # 2. 카운트 조회
    res_cnt = client.get("/api/highlights/counts")
    assert res_cnt.status_code == 200
    cnt_data = res_cnt.json()
    assert cnt_data["total"] == 1
    assert cnt_data["by_book"]["테스트소설1"] == 1

    # 3. 목록 조회
    res_list = client.get("/api/highlights?book_name=테스트소설1")
    assert res_list.status_code == 200
    items = res_list.json()
    assert len(items) == 1
    assert items[0]["id"] == h_id

    # 4. 해결(Resolve) 처리
    res_resolve = client.post("/api/highlights/resolve", json={"url": payload["url"], "pid": payload["pid"]})
    assert res_resolve.status_code == 200
    assert res_resolve.json()["resolved_count"] == 1

    # 5. 해결 후 카운트 확인
    res_cnt2 = client.get("/api/highlights/counts")
    assert res_cnt2.json()["total"] == 0

    # 6. 삭제 테스트 (다시 하나 만들고 삭제)
    res_new = client.post("/api/highlights", json={
        "book_name": "테스트소설2",
        "chapter_title": "제2화",
        "url": "https://ncode.syosetu.com/n1111/2/",
        "pid": "p10",
        "original": "テスト",
        "translated": "테스트"
    })
    new_id = res_new.json()["id"]
    res_del = client.delete(f"/api/highlights/{new_id}")
    assert res_del.status_code == 200
    assert res_del.json()["deleted_id"] == new_id
