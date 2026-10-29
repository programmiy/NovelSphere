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
        assert "cum_episodes" in trend
        assert "ma7_count" in trend
        assert "ma7_chars" in trend
        assert "ma7_episodes" in trend
        assert "episodes" in trend
        assert "avg_chars_per_ep" in trend
    assert "hourly_distribution" in activity
    assert len(activity["hourly_distribution"]) == 24
    # 24시간 활동 분포의 시작 시각이 API 초기화 시각(16시/17시)과 일치해야 함
    first_hour_item = activity["hourly_distribution"][0]
    assert first_hour_item["hour"] == activity["quota_reset_hour"]
    assert first_hour_item["is_reset_start"] is True
    assert "peak_hour" in activity
    assert 0 <= activity["peak_hour"] <= 23
    assert "dow_distribution" in activity
    assert len(activity["dow_distribution"]) == 7
    assert "peak_dow" in activity
    assert "weekday_pct" in activity
    assert "weekend_pct" in activity
    assert "daily_avg_episodes" in activity
    assert "last_7d_episodes" in activity

    # 2-2. efficiency 검증
    assert "efficiency" in data
    eff = data["efficiency"]
    assert "peak_hourly_chars" in eff
    assert "peak_hourly_episodes" in eff
    assert "today_chars_per_call" in eff
    assert "last_7d_books_volume" in eff
    assert "density_avg_chars_per_ep" in eff
    assert "hourly_throughput" in eff
    assert len(eff["hourly_throughput"]) == 24

    # 2-3. performance 검증
    assert "performance" in data
    perf = data["performance"]
    assert "chars_per_sec_avg" in perf
    assert "chars_per_sec_peak" in perf
    assert "est_sec_per_ep" in perf
    assert "est_sec_per_1k" in perf
    assert "engine_grade" in perf
    assert "pipeline_fidelity_pct" in perf

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
        assert "density_badge" in first
        assert "scale_tier" in first
    assert "novels_meta" in data
    assert "top5_share_pct" in data["novels_meta"]
    assert "tiers" in data["novels_meta"]

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
    assert "comparisons" in scale
    assert len(scale["comparisons"]) >= 3
    assert "physical_volume" in scale
    assert "reading_routines" in scale


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

