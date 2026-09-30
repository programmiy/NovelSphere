import time
import pytest
from fastapi.testclient import TestClient
from server.server import app
from server.routers.data_crud import clean_chapter_title
from server.database import get_sqlite_conn

client = TestClient(app)

def test_clean_chapter_title_novelup():
    title = "お酒と先輩彼女との甘々同居ラブコメは二十歳になってから（こばやJ） - 同居の合図は親公認の挨拶から | 小説投稿サイトノベルアップ＋"
    url = "https://novelup.plus/story/579402635/960921147"
    cleaned = clean_chapter_title(title, url)
    assert cleaned == "同居の合図は親公認の挨拶から"

def test_clean_chapter_title_novelup_without_url():
    title = "お酒と先輩彼女 - 第1話 | 小説投稿サイトノベルアップ＋"
    cleaned = clean_chapter_title(title)
    assert cleaned == "第1話"

def test_toc_importer_novelup():
    from unittest.mock import patch, MagicMock
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.apparent_encoding = "utf-8"
    ep_html = "".join([f'<div class="episodeListItem"><a class="episodeTitle" href="/story/579402635/{960921147 if i == 0 else 960921147 + i}">{"同居の合図は親公認の挨拶から" if i == 0 else f"第{i+1}話"}</a></div>' for i in range(50)])
    mock_resp.text = f'<div id="section_episode">{ep_html}</div>'

    with patch("server.routers.toc_importer.requests.get", return_value=mock_resp):
        response = client.post(
            "/api/import-toc",
            json={"toc_url": "https://novelup.plus/story/579402635/960921147"}
        )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) == 50
    assert data[0]["title"] == "同居の合図は親公認의挨拶から" or data[0]["title"] == "同居の合図は親公認の挨拶から"
    assert data[0]["url"] == "https://novelup.plus/story/579402635/960921147"

def test_separators_novelup_prefix():
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    dummy_url = "https://novelup.plus/story/999999999/111111111"
    try:
        cursor.execute("""
            INSERT OR REPLACE INTO translations (url, folderName, pid, original, translated, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (dummy_url, "테스트_노벨업_소설", "L1", "テスト", "테스트", int(time.time())))
        conn.commit()
    finally:
        conn.close()

    try:
        query_url = "https://novelup.plus/story/999999999/222222222"
        resp = client.get(f"/api/novel_info?url={query_url}")
        assert resp.status_code == 200
        res_data = resp.json()
        assert res_data["folderName"] == "테스트_노벨업_소설"
        assert res_data["matched_by"] == "series_prefix"
    finally:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM translations WHERE folderName = '테스트_노벨업_소설'")
        conn.commit()
        conn.close()

def test_url_config_novelup_story_apply_status():
    story_url = "https://novelup.plus/story/888888888"
    ep_url = "https://novelup.plus/story/888888888/123456789"

    try:
        resp = client.post("/api/urls/apply", json={"url": story_url, "apply": True})
        assert resp.status_code == 200

        status_resp = client.get(f"/api/urls/apply_status?url={ep_url}")
        assert status_resp.status_code == 200
        assert status_resp.json()["applied"] is True
    finally:
        client.post("/api/urls/apply", json={"url": story_url, "apply": False})
