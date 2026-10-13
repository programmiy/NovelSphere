import pytest
from fastapi.testclient import TestClient
from server.server import app
from server.settings import settings
from server.security import hash_token, verify_token, is_safe_external_url

client = TestClient(app)

RAW_TOKEN = "lnv_1lFxviC0NUXQqwUVwSuPM-QhxMieK_BX"


def test_hash_token_and_verification():
    """PBKDF2-HMAC-SHA256 단방향 암호화 해시 생성 및 검증 테스트"""
    h = hash_token(RAW_TOKEN)
    assert h.startswith("pbkdf2_sha256$100000$")
    assert verify_token(RAW_TOKEN, h) is True
    assert verify_token("wrong_token", h) is False
    assert verify_token("", h) is False
    assert verify_token(None, h) is False


def test_is_safe_external_url_ssrf_prevention():
    """SSRF 방어 유틸리티 검증: 내부망/루프백/특수 도메인 차단, 정상 공용 URL 허용"""
    # 차단 대상 (루프백, 사설 IP, 내부 도메인)
    assert is_safe_external_url("http://localhost:8000") is False
    assert is_safe_external_url("http://127.0.0.1:8001/admin") is False
    assert is_safe_external_url("http://192.168.1.1/router") is False
    assert is_safe_external_url("http://10.0.0.1/secret") is False
    assert is_safe_external_url("http://172.16.0.1/") is False
    assert is_safe_external_url("http://internal.service.local/") is False
    assert is_safe_external_url("file:///etc/passwd") is False
    assert is_safe_external_url("gopher://127.0.0.1:6379") is False

    # 허용 대상 (정상 공용 웹소설 사이트)
    assert is_safe_external_url("https://kakuyomu.jp/works/123") is True
    assert is_safe_external_url("https://ncode.syosetu.com/n1234a/") is True
    assert is_safe_external_url("https://novelup.plus/story/567") is True


def test_loopback_freepass_and_upload_protection():
    """로컬 루프백 접속은 프리패스 통과하되, 외부 Cross-Origin CSRF 시도는 차단"""
    # 1. 일반 API는 루프백에서 인증 헤더 없이 자유롭게 통과
    res = client.get("/health")
    assert res.status_code == 200

    # 2. 로컬 루프백 정상 APK 업로드 요청은 프리패스 (바이너리 누락 시 엔드포인트의 400 반환)
    res_upload_local = client.post("/api/app/upload")
    assert res_upload_local.status_code == 400

    # 3. 브라우저 악성 사이트(Cross-Origin)를 통한 CSRF 공격 시도는 차단 (403)
    res_csrf = client.post("/api/app/upload", headers={"Origin": "https://malicious-site.com"})
    assert res_csrf.status_code == 403
    assert "Cross-Origin CSRF" in res_csrf.text


def test_lan_security_middleware_non_loopback():
    """외부 LAN(192.168.x.x 등) 클라이언트의 접근 제어 검증"""
    lan_client = TestClient(app, client=("192.168.1.100", 54321))

    # 1. 정적 에셋 및 공개 페이지는 비인가 LAN에서도 열림
    res_pub = lan_client.get("/download")
    assert res_pub.status_code == 200

    # 2. 비인가 LAN에서의 API 접근 차단 (401)
    res_denied = lan_client.get("/api/status/summary")
    assert res_denied.status_code == 401
    assert "LAN Access Denied" in res_denied.text

    # 3. 잘못된 토큰 제공 시 차단
    res_wrong = lan_client.get(
        "/api/status/summary",
        headers={"X-Lanovel-Key": "wrong_key"}
    )
    assert res_wrong.status_code == 401

    # 4. 올바른 원본 토큰(X-Lanovel-Key 헤더) 제공 시 정상 통과
    res_ok_header = lan_client.get(
        "/api/status/summary",
        headers={"X-Lanovel-Key": RAW_TOKEN}
    )
    assert res_ok_header.status_code == 200

    # 5. 올바른 원본 토큰(URL 쿼리 파라미터 ?key=) 제공 시에도 정상 통과
    res_ok_query = lan_client.get(
        f"/api/status/summary?key={RAW_TOKEN}"
    )
    assert res_ok_query.status_code == 200


def test_path_traversal_protection_in_sync():
    """TTS 및 패키지 삭제 엔드포인트의 경로 조작(Path Traversal) 방어 검증"""
    # 1. tts-pack 경로 탈출 시도
    res = client.get("/api/sync/tts-pack?book=../../windows&chapter=win.ini")
    assert res.status_code in (400, 404)

    # 2. full-pack 파일 정리 경로 탈출 시도
    res_del_routed = client.delete("/api/sync/full-pack/.._test_db")
    assert res_del_routed.status_code == 200
    assert res_del_routed.json()["status"] == "not_found"

