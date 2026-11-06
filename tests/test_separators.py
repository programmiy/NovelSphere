import pytest
from fastapi.testclient import TestClient
from server.server import app
from server.routers.separators import DEFAULT_GLOBAL_SEPARATORS

client = TestClient(app)

def test_default_global_separators_contains_atogaki():
    """기본 공통 구분선 목록에 'あとがき' 키워드가 포함되어 있는지 검증"""
    assert "あとがき" in DEFAULT_GLOBAL_SEPARATORS
    assert "＜あとがき＞" in DEFAULT_GLOBAL_SEPARATORS
    assert "【あとがき】" in DEFAULT_GLOBAL_SEPARATORS

def test_save_and_get_separator_setting_with_atogaki():
    """구분선 설정 저장 및 조회 시 'あとがき'가 effective_separators에 올바르게 포함되는지 검증"""
    novel_title = "테스트_후기소설_20261107"
    
    # 1. 소설별 커스텀 구분선 저장 (기본값 포함 모드)
    save_resp = client.post(
        "/api/separators",
        json={
            "novel_title": novel_title,
            "separators": ["―――", "◇◇◇"],
            "use_defaults": True
        }
    )
    assert save_resp.status_code == 200
    save_data = save_resp.json()
    assert save_data["novel_title"] == novel_title
    assert "あとがき" in save_data["effective_separators"]
    assert "―――" in save_data["effective_separators"]
    assert "◇◇◇" in save_data["effective_separators"]
    assert "―――" in save_data["custom_separators"]
    
    # 2. 조회 검증
    get_resp = client.get(f"/api/separators?novel_title={novel_title}")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert get_data["novel_title"] == novel_title
    assert get_data["is_custom"] is True
    assert get_data["use_defaults"] is True
    assert "あとがき" in get_data["effective_separators"]
    assert "あとがき" in get_data["global_defaults"]
    
    # 3. 설정 삭제(기본값 복원) 검증
    del_resp = client.delete(f"/api/separators?novel_title={novel_title}")
    assert del_resp.status_code == 200
    del_data = del_resp.json()
    assert "あとがき" in del_data["effective_separators"]
