import pytest
from fastapi.testclient import TestClient
from server.server import app

client = TestClient(app)

def test_admin_analytics_endpoint():
    """GET /admin/analytics 종합 통계 분석 엔드포인트 응답 및 구조 검증"""
    res = client.get("/admin/analytics")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["scope"] == "전체"

    # 1. summary 검증
    summary = data["summary"]
    assert "total_books" in summary
    assert "total_episodes" in summary
    assert "total_paragraphs" in summary
    assert "total_kr_chars" in summary
    assert "total_jp_chars" in summary
    assert "expansion_ratio" in summary
    assert summary["expansion_ratio"] >= 0

    # 2. activity 검증
    activity = data["activity"]
    assert "daily_avg_count" in activity
    assert "daily_avg_chars" in activity
    assert "peak_count" in activity
    assert "streak_days" in activity
    assert "daily_trends" in activity
    assert isinstance(activity["daily_trends"], list)
    assert "hourly_distribution" in activity
    assert len(activity["hourly_distribution"]) == 24
    assert "peak_hour" in activity

    # 3. quality 검증
    quality = data["quality"]
    assert "health_score" in quality
    assert 0 <= quality["health_score"] <= 100
    assert "normal_rate" in quality
    assert "empty_rate" in quality
    assert "abnormal_rate" in quality
    assert "length_distribution" in quality
    assert len(quality["length_distribution"]) == 5

    # 4. novels 검증
    novels = data["novels"]
    assert isinstance(novels, list)
    if novels:
        first = novels[0]
        assert "rank" in first
        assert "name" in first
        assert "episode_count" in first
        assert "paragraph_count" in first
        assert "total_chars" in first
        assert "share_pct" in first

    # 5. scale 검증
    scale = data["scale"]
    assert "kr_chars" in scale
    assert "books_count" in scale
    assert "manuscript_count" in scale
    assert "reading_hours" in scale
    assert "pace_fast_hours" in scale
    assert "pace_standard_hours" in scale
    assert "pace_slow_hours" in scale
    assert "novel_fit_badge" in scale


def test_admin_analytics_with_folder_scope():
    """GET /admin/analytics?folder_name=... 특정 폴더 스코프 조회 검증"""
    res = client.get("/admin/analytics?folder_name=테스트소설")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["scope"] == "테스트소설"
    assert "summary" in data
    assert "activity" in data
    assert "quality" in data
