import pytest
from unittest.mock import patch
from server.services.translation_engine import TranslationItemInput
from server.services.translation_recovery import (
    _translate_sub_batch_with_safety_split,
    _fallback_hdtrans_or_split,
)


def test_sub_batch_safety_split_with_hdtrans_on_blocked():
    """1차 또는 하위 분할 단계에서 is_safety_blocked 감지 시 hdTrans로 대체 번역되는지 검증"""
    items = [
        TranslationItemInput(id="1", text="こんにちは。"),
        TranslationItemInput(id="2", text="さようなら。"),
    ]
    # Gemini API가 promptFeedback blockReason PROHIBITED_CONTENT 반환하도록 모의
    mock_resp = {
        "promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}
    }

    with patch("server.services.translation_recovery.call_gemini_api", return_value=mock_resp), \
         patch("server.services.translation_recovery.translate_paragraphs", return_value=["안녕하세요.", "안녕히 가세요."]):
        
        translated_map, censored_ids = _translate_sub_batch_with_safety_split(
            items=items,
            api_url="https://mock.gemini/api",
            wait_time_on_block=0,
            depth=1
        )

        assert translated_map["1"] == "안녕하세요."
        assert translated_map["2"] == "안녕히 가세요."
        assert len(censored_ids) == 0


def test_sub_batch_safety_split_finish_reason_prohibited():
    """candidate의 finishReason이 PROHIBITED_CONTENT일 때 hdTrans 대체 번역 검증"""
    items = [
        TranslationItemInput(id="10", text="テスト文1"),
        TranslationItemInput(id="20", text="テスト文2"),
    ]
    mock_resp = {
        "candidates": [{
            "finishReason": "PROHIBITED_CONTENT",
            "content": {"parts": [{"text": ""}]}
        }]
    }

    with patch("server.services.translation_recovery.call_gemini_api", return_value=mock_resp), \
         patch("server.services.translation_recovery.translate_paragraphs", return_value=["테스트문1", "테스트문2"]):
        
        translated_map, censored_ids = _translate_sub_batch_with_safety_split(
            items=items,
            api_url="https://mock.gemini/api",
            wait_time_on_block=0,
            depth=1
        )

        assert translated_map["10"] == "테스트문1"
        assert translated_map["20"] == "테스트문2"
        assert len(censored_ids) == 0


def test_sub_batch_single_item_blocked_with_hdtrans():
    """단일 문장에서 검열 발생 시 Fast-Fail 생략 대신 hdTrans 번역 수행 검증"""
    items = [
        TranslationItemInput(id="99", text="危険な単語"),
    ]
    mock_resp = {
        "candidates": [{
            "finishReason": "SAFETY",
            "content": {"parts": [{"text": ""}]}
        }]
    }

    with patch("server.services.translation_recovery.call_gemini_api", return_value=mock_resp), \
         patch("server.services.translation_recovery.translate_paragraphs", return_value=["위험한 단어"]):
        
        translated_map, censored_ids = _translate_sub_batch_with_safety_split(
            items=items,
            api_url="https://mock.gemini/api",
            wait_time_on_block=0,
            depth=1
        )

        assert translated_map["99"] == "위험한 단어"
        assert len(censored_ids) == 0


def test_sub_batch_hdtrans_unavailable_fallback():
    """hdTrans를 사용할 수 없거나 실패할 때 기존 분할 및 Fast-Fail 생략으로 안전하게 폴백하는지 검증"""
    items = [
        TranslationItemInput(id="77", text="危険な単語"),
    ]
    mock_resp = {
        "promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}
    }

    with patch("server.services.translation_recovery.call_gemini_api", return_value=mock_resp), \
         patch("server.services.translation_recovery.is_hdtrans_available", return_value=False):
        
        translated_map, censored_ids = _translate_sub_batch_with_safety_split(
            items=items,
            api_url="https://mock.gemini/api",
            wait_time_on_block=0,
            depth=1
        )

        assert translated_map["77"] == "[검열로 인해 번역 생략]"
        assert "77" in censored_ids


def test_sub_batch_hdtrans_exception_fallback():
    """hdTrans 실행 도중 예외 발생 시 기존 로직으로 안전하게 폴백하는지 검증"""
    items = [
        TranslationItemInput(id="88", text="エラーテスト"),
    ]
    mock_resp = {
        "promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}
    }

    with patch("server.services.translation_recovery.call_gemini_api", return_value=mock_resp), \
         patch("server.services.translation_recovery.is_hdtrans_available", return_value=True), \
         patch("server.services.translation_recovery.translate_paragraphs", side_effect=RuntimeError("Subprocess failed")):
        
        translated_map, censored_ids = _translate_sub_batch_with_safety_split(
            items=items,
            api_url="https://mock.gemini/api",
            wait_time_on_block=0,
            depth=1
        )

        assert translated_map["88"] == "[검열로 인해 번역 생략]"
        assert "88" in censored_ids


from fastapi.testclient import TestClient
from server.server import app

client = TestClient(app)


def test_translate_endpoint_prohibited_content_with_hdtrans():
    """
    POST /translate 호출 시 배치 검열 발생 -> 1차 분할 그룹(first_half) 검열 발생
    -> first_half는 hdTrans로 대체 번역되고, second_half는 Gemini 정상 번역되어
    전체 번역 결과가 누락 없이 반환되는지 엔드-투-엔드 검증
    """
    payload = {
        "url": "https://ncode.syosetu.com/n1234/1/",
        "title": "테스트 에피소드",
        "items": [
            {"id": "p1", "text": "第1文: センシティブな表現"},
            {"id": "p2", "text": "第2文: センシティブな表現2"},
            {"id": "p3", "text": "第3文: 平凡な日常の描写"},
            {"id": "p4", "text": "第4文: 穏やかな夕暮れの風景"},
        ]
    }

    # API 응답 시퀀스:
    # 1회차 (전체 배치): PROHIBITED_CONTENT 차단
    # 2회차 (first_half): PROHIBITED_CONTENT 차단 -> hdTrans 호출
    # 3회차 (second_half): 정상 번역 JSON 응답
    mock_batch_blocked = {
        "promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}
    }
    mock_first_half_blocked = {
        "promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}
    }
    mock_second_half_success = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{
                    "text": '[{"id": "p3", "translated": "제3문: 평범한 일상의 묘사"}, {"id": "p4", "translated": "제4문: 온화한 해질녘의 풍경"}]'
                }]
            }
        }]
    }

    api_call_sequence = [
        mock_batch_blocked,
        mock_first_half_blocked,
        mock_second_half_success,
    ]

    def mock_call_gemini(url, prompt):
        if api_call_sequence:
            return api_call_sequence.pop(0)
        return mock_second_half_success

    def mock_hdtrans(paragraphs):
        kor_map = {
            "第1文: センシティブな表現": "제1문: 민감한 표현 (hdTrans)",
            "第2文: センシティブな表現2": "제2문: 민감한 표현 2 (hdTrans)",
        }
        return [kor_map.get(p, f"번역됨: {p}") for p in paragraphs]

    with patch("server.routers.translation.time.sleep", return_value=None), \
         patch("server.services.translation_recovery.time.sleep", return_value=None), \
         patch("server.routers.translation.call_gemini_api", side_effect=mock_call_gemini), \
         patch("server.services.translation_recovery.call_gemini_api", side_effect=mock_call_gemini), \
         patch("server.services.translation_recovery.translate_paragraphs", side_effect=mock_hdtrans):

        response = client.post("/translate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert "translations" in data
        trans_list = data["translations"]
        assert len(trans_list) == 4

        trans_map = {t["id"]: t for t in trans_list}
        # first_half는 hdTrans로 번역
        assert "(hdTrans)" in trans_map["p1"]["translated"]
        assert "(hdTrans)" in trans_map["p2"]["translated"]
        # second_half는 Gemini로 번역
        assert trans_map["p3"]["translated"] == "제3문: 평범한 일상의 묘사"
        assert trans_map["p4"]["translated"] == "제4문: 온화한 해질녘의 풍경"
        # 검열 생략 없이 모두 번역문 보유
        for t in trans_list:
            assert t["censored"] is False
            assert len(t["translated"]) > 0

