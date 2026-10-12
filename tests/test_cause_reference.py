import pytest
from fastapi.testclient import TestClient

from server.server import app
from server.database import SessionLocal
from server.models import Translation, AiReviewQueue
from server.services.similarity_service import (
    get_cause_keywords,
    get_top5_expressions,
    get_cause_reference_data
)

client = TestClient(app)

def test_get_cause_keywords():
    # 1. 번역문에 잔존 가나가 있는 경우
    orig = "「やっぱり、そう思う？」"
    tra = "「やっぱり, 그렇게 생각해?」"
    kws = get_cause_keywords(orig, tra, tra)
    assert "やっぱり" in kws

    # 2. 번역문은 정상 한글인데 원문에 가나/한자가 있는 경우
    orig2 = "彼はスキルを発動した。"
    tra2 = "그는 능력을 발동했다."
    kws2 = get_cause_keywords(orig2, tra2, tra2)
    assert len(kws2) > 0
    assert any("スキル" in k or "発動" in k for k in kws2)

def test_cause_reference_data_and_top5():
    db = SessionLocal()
    try:
        # DB에 존재하는 대표 키워드로 조회 테스트
        data = get_cause_reference_data(
            keyword="スキル",
            folder=None,
            exclude_id=None,
            limit=5,
            db=db
        )
        assert "keyword" in data
        assert data["keyword"] == "スキル"
        assert "top5_expressions" in data
        assert "examples" in data
        assert isinstance(data["top5_expressions"], list)
        assert isinstance(data["examples"], list)
        
        # 스킬이 코퍼스에 존재한다면 Top 5에 '스킬' 포함 여부 확인
        if data["top5_expressions"]:
            top_words = [item["word"] for item in data["top5_expressions"]]
            assert "스킬" in top_words
    finally:
        db.close()

def test_api_cause_reference_endpoint():
    res = client.get("/api/ai_review/cause_reference?keyword=スキル&limit=4")
    assert res.status_code == 200
    data = res.json()
    assert data["keyword"] == "スキル"
    assert "top5_expressions" in data
    assert "examples" in data

def test_api_admin_similar_recommendation_fallback():
    res = client.get("/api/admin/similar_recommendation?keyword=やっぱり")
    assert res.status_code == 200
    data = res.json()
    assert data["keyword"] == "やっぱり"
    assert "results" in data
    assert "top5_expressions" in data
    assert "examples" in data
