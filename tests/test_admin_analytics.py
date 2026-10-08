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
    assert summary["quota_reset_hour"] in (16, 17)
    assert "is_us_dst" in summary
    assert "reset_note" in summary
    assert "quota_window_start_ts" in summary

    # 2. activity 검증
    activity = data["activity"]
    assert activity["quota_reset_hour"] in (16, 17)
    assert "is_us_dst" in activity
    assert "reset_note" in activity
    assert "quota_window_start_ts" in activity
    assert "daily_avg_count" in activity
    assert "daily_avg_chars" in activity
    assert "peak_count" in activity
    assert "streak_days" in activity
    assert "daily_trends" in activity
    assert isinstance(activity["daily_trends"], list)
    if activity["daily_trends"]:
        trend = activity["daily_trends"][0]
        assert "cum_count" in trend
        assert "cum_chars" in trend
        assert "ma7_count" in trend
        assert "ma7_chars" in trend
    assert "hourly_distribution" in activity
    assert len(activity["hourly_distribution"]) == 24
    assert "peak_hour" in activity
    assert "dow_distribution" in activity
    assert len(activity["dow_distribution"]) == 7
    assert "peak_dow" in activity
    assert "weekday_pct" in activity
    assert "weekend_pct" in activity

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


def test_novel_analytics_drilldown():
    """GET /admin/analytics/novel 특정 소설 회차별 분량 및 스파크라인 엔드포인트 검증"""
    # 1. 파라미터 누락 시 400
    err_res = client.get("/admin/analytics/novel?folder_name=")
    assert err_res.status_code == 400

    # 2. 존재하는 소설 또는 미분류로 정상 응답 검증
    res = client.get("/admin/analytics/novel?folder_name=미분류")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "total_episodes" in data
    assert "applied_episodes" in data
    assert "applied_pct" in data
    assert "avg_chars_per_ep" in data
    assert "episodes" in data
    assert isinstance(data["episodes"], list)

