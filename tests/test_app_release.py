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

def test_broadcast_app_update():
    """POST /api/app/broadcast_update 엔드포인트 동작 검증"""
    res = client.post("/api/app/broadcast_update")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["broadcasted"] is True
    assert "version" in data


def test_update_release_notes():
    """POST /api/app/release_notes 및 영속화 검증"""
    test_note = "테스트 릴리즈: 초고속 동기화 및 버그 수정"
    res = client.post("/api/app/release_notes", json={"release_notes": test_note})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    ver_res = client.get("/api/app/version")
    assert ver_res.status_code == 200
    assert ver_res.json()["release_notes"] == test_note


def test_bump_app_version():
    """POST /api/app/bump_version 버전 갱신 검증"""
    ver_res = client.get("/api/app/version")
    cur_build = ver_res.json()["build_number"]

    bump_res = client.post("/api/app/bump_version", json={"build_number": cur_build + 1})
    assert bump_res.status_code == 200
    bump_data = bump_res.json()
    assert bump_data["build_number"] == cur_build + 1

    # 원복 (테스트 후 원래 빌드 번호로 복구)
    client.post("/api/app/bump_version", json={"build_number": cur_build})


def test_upload_apk_validation():
    """POST /api/app/upload 유효성 검증 (크기 미달 시 400)"""
    # 100 바이트의 너무 작은 바이너리는 400 반환해야 함
    dummy_small_bytes = b"PK" + (b"\x00" * 100)
    res = client.post("/api/app/upload", content=dummy_small_bytes)
    assert res.status_code == 400

