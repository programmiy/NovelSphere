import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from server.server import app

client = TestClient(app)


def test_translate_endpoint_force_hdtrans_direct():
    """force_hdtrans=True 요청 시 Gemini API 호출 0회, 로컬 hdTrans로 직접 번역되는지 검증"""
    payload = {
        "url": "https://ncode.syosetu.com/n1234/5/",
        "title": "테스트 에피소드",
        "force_hdtrans": True,
        "items": [
            {"id": "p10", "text": "「これは最後の束の後の文です。」"},
            {"id": "p11", "text": "「未完了の空白文を安全に補完します。」"},
        ]
    }

    mock_hdtrans_results = [
        "「이것은 마지막 꾸러미 이후의 문장입니다.」",
        "「미완료 빈칸 문장을 안전하게 보완합니다.」",
    ]

    mock_gemini = MagicMock()

    with patch("server.routers.translation.is_hdtrans_available", return_value=True), \
         patch("server.routers.translation.translate_paragraphs", return_value=mock_hdtrans_results) as mock_hd, \
         patch("server.routers.translation.call_gemini_api", mock_gemini):

        response = client.post("/translate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "translations" in data
        trans_list = data["translations"]
        assert len(trans_list) == 2

        trans_map = {t["id"]: t for t in trans_list}
        assert trans_map["p10"]["translated"] == "「이것은 마지막 꾸러미 이후의 문장입니다.」"
        assert trans_map["p11"]["translated"] == "「미완료 빈칸 문장을 안전하게 보완합니다.」"
        assert trans_map["p10"]["engine"] == "hdtrans"
        assert trans_map["p11"]["engine"] == "hdtrans"

        # Gemini API는 단 1회도 호출되지 않아야 함 (쿼터 소모 0)
        assert mock_gemini.call_count == 0
        assert mock_hd.call_count == 1


def test_translate_endpoint_model_hdtrans_direct():
    """model='hdtrans' 지정 시에도 Gemini API 없이 로컬 hdTrans로 직접 번역되는지 검증"""
    payload = {
        "url": "https://ncode.syosetu.com/n1234/6/",
        "title": "테스트 에피소드",
        "model": "hdtrans",
        "items": [
            {"id": "p20", "text": "テスト文です。"},
        ]
    }

    mock_gemini = MagicMock()

    with patch("server.routers.translation.is_hdtrans_available", return_value=True), \
         patch("server.routers.translation.translate_paragraphs", return_value=["테스트 문장입니다."]) as mock_hd, \
         patch("server.routers.translation.call_gemini_api", mock_gemini):

        response = client.post("/translate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["translations"][0]["translated"] == "테스트 문장입니다."
        assert data["translations"][0]["engine"] == "hdtrans"

        assert mock_gemini.call_count == 0
        assert mock_hd.call_count == 1


def test_translate_endpoint_force_hdtrans_fallback_on_unavailable():
    """force_hdtrans=True여도 hdtrans.exe가 비가용할 때 Gemini API로 안전하게 폴백하는지 검증"""
    payload = {
        "url": "https://ncode.syosetu.com/n1234/7/",
        "title": "테스트 에피소드",
        "force_hdtrans": True,
        "items": [
            {"id": "p30", "text": "安全なフォールバックテスト。"},
        ]
    }

    mock_gemini_resp = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{"text": '[{"id": "p30", "translated": "안전한 폴백 테스트."}]'}]
            }
        }]
    }

    with patch("server.routers.translation.is_hdtrans_available", return_value=False), \
         patch("server.routers.translation.call_gemini_api", return_value=mock_gemini_resp) as mock_gemini:

        response = client.post("/translate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["translations"][0]["translated"] == "안전한 폴백 테스트."
        assert mock_gemini.call_count >= 1


def test_translate_endpoint_force_hdtrans_fallback_on_exception():
    """force_hdtrans=True에서 hdTrans 실행 예외 발생 시 Gemini API로 안전하게 폴백하는지 검증"""
    payload = {
        "url": "https://ncode.syosetu.com/n1234/8/",
        "title": "테스트 에피소드",
        "force_hdtrans": True,
        "items": [
            {"id": "p40", "text": "エラー時フォールバックテスト。"},
        ]
    }

    mock_gemini_resp = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{"text": '[{"id": "p40", "translated": "오류 시 폴백 테스트."}]'}]
            }
        }]
    }

    with patch("server.routers.translation.is_hdtrans_available", return_value=True), \
         patch("server.routers.translation.translate_paragraphs", side_effect=RuntimeError("Subprocess failed")), \
         patch("server.routers.translation.call_gemini_api", return_value=mock_gemini_resp) as mock_gemini:

        response = client.post("/translate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["translations"][0]["translated"] == "오류 시 폴백 테스트."
        assert mock_gemini.call_count >= 1


def test_translate_endpoint_normal_request_still_uses_gemini():
    """force_hdtrans가 지정되지 않은 일반 번역 요청은 기존대로 Gemini API를 사용하는지 검증"""
    payload = {
        "url": "https://ncode.syosetu.com/n1234/9/",
        "title": "테스트 에피소드",
        "items": [
            {"id": "p50", "text": "通常翻訳テスト。"},
        ]
    }

    mock_gemini_resp = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{"text": '[{"id": "p50", "translated": "통상 번역 테스트."}]'}]
            }
        }]
    }

    mock_hd = MagicMock()

    with patch("server.routers.translation.translate_paragraphs", mock_hd), \
         patch("server.routers.translation.call_gemini_api", return_value=mock_gemini_resp) as mock_gemini:

        response = client.post("/translate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["translations"][0]["translated"] == "통상 번역 테스트."
        assert mock_gemini.call_count >= 1
        assert mock_hd.call_count == 0
