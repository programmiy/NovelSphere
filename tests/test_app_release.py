import pytest
from fastapi.testclient import TestClient
from server.server import app

client = TestClient(app)

def test_app_version_endpoint():
    """GET /api/app/version 정상 응답 및 필수 메타데이터 키 검증"""
    res = client.get("/api/app/version")
    assert res.status_code == 200
    data = res.json()
    assert "version" in data
    assert "build_number" in data
    assert "has_apk" in data
    assert "download_url" in data
    assert data["download_url"] == "/api/app/download"
    assert isinstance(data["build_number"], int)

def test_download_page_html():
    """GET /download 웹 랜딩 페이지 렌더링 및 주요 UI 요소 검증"""
    res = client.get("/download")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    html = res.text
    assert "LANOVEL Reader" in html
    assert "/api/app/download" in html
    assert "APK 다운로드" in html

def test_apk_download_endpoint():
    """GET /api/app/download 엔드포인트 동작 검증"""
    res = client.get("/api/app/download")
    # APK 파일이 빌드되어 존재할 경우 200, 헤더 및 Content-Type 검증
    if res.status_code == 200:
        assert res.headers["content-type"] == "application/vnd.android.package-archive"
        assert len(res.content) > 1000000 # 최소 1MB 이상
    else:
        # APK가 아직 빌드되지 않은 환경에서는 404 반환
        assert res.status_code == 404
