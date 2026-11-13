import json
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from server.models import Base, Translation, SpecialBatchQueue
from server.routers.ai_review import clean_ai_translation
from server.routers.data_crud import TranslationItem, upsert_translations
from server.routers.special_batch import ApproveRequest, BatchApproveRequest, approve_staged_item, batch_approve_staged
from server.server import app
from server.services.translation_engine import (
    TRANSLATION_SYSTEM_INSTRUCTION,
    TranslationItemInput,
    _build_translation_prompt,
    post_process_translated_text,
    strip_html_hallucinations,
)
from server.services.translation_recovery import _recover_verbatim_items


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_prompts_forbid_html_and_strikethrough_hallucinations():
    """시스템 지침과 번역 프롬프트에 HTML/취소선 태그 금지 지시가 포함되어 있는지 검증"""
    inst_text = TRANSLATION_SYSTEM_INSTRUCTION["parts"][0]["text"]
    assert "PLAIN TEXT ONLY" in inst_text
    assert "NEVER emit HTML/XML tags" in inst_text
    assert "<span>" in inst_text

    prompt = _build_translation_prompt([TranslationItemInput(id="1", text="「ああ……」")])
    assert "HTML/XML tags" in prompt
    assert "strikethrough" in prompt.lower()


def test_strip_html_hallucinations_removes_llm_markup():
    """실제 DB 사례를 포함한 LLM 환각 HTML 태그 및 취소선 블록 제거 검증"""
    assert strip_html_hallucinations("<span>「아……」</span>") == "「아……」"
    assert (
        strip_html_hallucinations("나의 애원을 비웃듯, 선배는 더욱 짓궂게 자궁구를 <s>희롱해</s> 괴롭혀 온다.")
        == "나의 애원을 비웃듯, 선배는 더욱 짓궂게 자궁구를 괴롭혀 온다."
    )
    assert (
        strip_html_hallucinations("그에 맞서는 요알은 무심하게 그녀의 질 구멍을 <s>공략</s>몰아붙인다.")
        == "그에 맞서는 요알은 무심하게 그녀의 질 구멍을 몰아붙인다."
    )
    assert (
        strip_html_hallucinations('<span class="hl" style="color:red">대사</span> <!-- note -->')
        == "대사"
    )
    assert strip_html_hallucinations("<SPAN>대문자 태그</SPAN>") == "대문자 태그"
    assert strip_html_hallucinations("<div><b><strong>강조</strong></b></div>") == "강조"
    assert strip_html_hallucinations("고아 종료 태그</td>") == "고아 종료 태그"
    assert strip_html_hallucinations("<del>이전</del> 수정본") == "수정본"
    assert strip_html_hallucinations("<strike>오타</strike> 정정") == "정정"
    assert strip_html_hallucinations("<s>닫힘 누락 태그 문장") == "닫힘 누락 태그 문장"
    assert strip_html_hallucinations("<p>첫 줄.</p><p>둘째 줄.</p>") == "첫 줄.\n둘째 줄."
    assert strip_html_hallucinations("첫 줄.<br/>둘째 줄.") == "첫 줄.\n둘째 줄."
    assert strip_html_hallucinations("<s>전부 취소</s>") == ""


def test_strip_html_hallucinations_preserves_legitimate_novel_brackets():
    """소설 본문의 일반 꺾쇠 기호, 상태창, 이모티콘, 부등식은 전혀 손상되지 않는지 검증"""
    safe_samples = [
        "<머리말>",
        "(>_<)",
        "<시스템: 레벨 업!>",
        "<Level 1>",
        "<System>",
        "<Skill: Flame>",
        "<Status>",
        "a < b 그리고 b > c",
        "p < 10 이고 q > 5",
        "<b-rank>",
        "<p.12>",
        "",
        None,
    ]
    for sample in safe_samples:
        assert strip_html_hallucinations(sample) == sample


def test_post_process_strips_html_before_bracket_restoration():
    """HTML 태그 제거 후 괄호 복원이 실행되어 <span>「...」</span> 형태로 재래핑되지 않는지 검증"""
    processed, is_verbatim, cat = post_process_translated_text(
        "「そうだね」",
        "<span>그렇지</span>",
    )
    assert processed == "「그렇지」"
    assert is_verbatim is False
    assert cat is None

    # 전부 취소선으로 출력되어 빈 문자열이 되면 verbatim/empty로 감지해 복구 대상으로 넘겨야 함
    empty_proc, empty_verbatim, empty_cat = post_process_translated_text(
        "「そうだね」",
        "<s>오역만</s>",
    )
    assert empty_proc == ""
    assert empty_verbatim is True
    assert empty_cat == "verbatim"


def test_translate_endpoint_strips_html_hallucinations():
    """POST /translate 응답에서 Gemini의 HTML/취소선 환각이 자동 정제되어 반환되는지 검증"""
    client = TestClient(app)
    payload = {
        "items": [
            {"id": "p1", "text": "「ああ……」"},
            {"id": "p2", "text": "彼は微笑んだ。"},
        ],
        "url": "https://example.com/novel/test_html_strip",
    }
    mock_resp = {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {
                    "parts": [
                        {
                            "text": json.dumps(
                                [
                                    {"id": "p1", "translated": "<span>아……</span>"},
                                    {"id": "p2", "translated": "그는 <s>웃었다</s> 미소 지었다."},
                                ],
                                ensure_ascii=False,
                            )
                        }
                    ]
                },
            }
        ]
    }

    with patch("server.routers.translation.call_gemini_api", return_value=mock_resp):
        response = client.post("/translate", json=payload)

    assert response.status_code == 200
    items = response.json()["translations"]
    assert items[0]["translated"] == "「아……」"
    assert items[1]["translated"] == "그는 미소 지었다."


def test_recover_verbatim_items_strips_html_tags(monkeypatch):
    """verbatim/언어이탈 복구 경로에서도 프롬프트 금지 및 HTML 후처리 제거가 적용되는지 검증"""
    captured_prompts = []

    def mock_call_gemini_api(api_url, prompt):
        captured_prompts.append(prompt)
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    [
                                        {
                                            "id": f"L{i}",
                                            "translated": f"<span><s>구번역</s> 복구된 문장 {i}</span>",
                                        }
                                        for i in range(1, 5)
                                    ],
                                    ensure_ascii=False,
                                )
                            }
                        ]
                    }
                }
            ]
        }

    import server.services.translation_recovery as rec_module

    monkeypatch.setattr(rec_module, "call_gemini_api", mock_call_gemini_api)

    items_to_translate = [TranslationItemInput(id=f"L{i}", text=f"テスト文{i}") for i in range(1, 5)]
    verbatim_detected = [
        {"id": f"L{i}", "original": f"テスト文{i}", "translated": f"テスト文{i}", "category": "verbatim"}
        for i in range(1, 5)
    ]
    translated_results = {}

    remaining = _recover_verbatim_items(
        verbatim_detected_items=verbatim_detected,
        items_to_translate=items_to_translate,
        translated_results=translated_results,
        api_url="https://mock.api/gemini",
    )

    assert remaining == []
    assert len(captured_prompts) == 1
    assert "HTML/XML tags" in captured_prompts[0]
    for i in range(1, 5):
        assert translated_results[f"L{i}"]["translated"] == f"복구된 문장 {i}"


def test_clean_ai_translation_strips_html_tags():
    """AI 검수 큐 정제 함수가 문자열/딕셔너리/리스트에서 HTML 태그를 제거하는지 검증"""
    assert clean_ai_translation('<span>「아…… 으……♥」</span>') == "「아…… 으……♥」"
    assert clean_ai_translation({"translated": "<b><s>오역</s> 본문</b>"}) == "본문"
    assert clean_ai_translation(['<p>첫째 줄</p>']) == "첫째 줄"


def test_upsert_translations_blocks_html_hallucinations(db_session):
    """/translations 저장 시점에 HTML 태그를 제거한 뒤 괄호 복원하여 DB에 적재하는지 검증"""
    items = [
        TranslationItem(
            url="https://ncode.syosetu.com/n9999zz/1/",
            pid="p1",
            original="「ああ……」",
            translated="<span>아……</span>",
            timestamp=1700000000,
            folderName="HtmlGuardNovel",
            title="1화",
        ),
        TranslationItem(
            url="https://ncode.syosetu.com/n9999zz/1/",
            pid="p2",
            original="これは<머리말>です。",
            translated="이것은 <머리말>입니다.",
            timestamp=1700000000,
            folderName="HtmlGuardNovel",
            title="1화",
        ),
    ]
    res = upsert_translations(items, db=db_session)
    assert res["inserted"] == 2

    rows = db_session.query(Translation).order_by(Translation.pid.asc()).all()
    assert rows[0].translated == "「아……」"
    assert rows[1].translated == "이것은 <머리말>입니다."


def test_special_batch_approve_strips_html_tags(db_session):
    """특별 적재 승인 시에도 HTML 태그가 제거되어 translations에 반영되는지 검증"""
    it1 = SpecialBatchQueue(
        batch_id="batch_html_test_1",
        url="https://example.com/special/1",
        folder_name="SpecialNovel",
        chapter_title="1화",
        chapter_index=1,
        pid="p1",
        original_text="「테스트」",
        translated_text="<span>「테스트 단건」</span>",
        status="staged",
        created_at=100,
    )
    it2 = SpecialBatchQueue(
        batch_id="batch_html_test_1",
        url="https://example.com/special/1",
        folder_name="SpecialNovel",
        chapter_title="1화",
        chapter_index=1,
        pid="p2",
        original_text="「테스트2」",
        translated_text="<s>구번역</s> 「테스트 일괄」",
        status="staged",
        created_at=100,
    )
    db_session.add_all([it1, it2])
    db_session.commit()

    approve_staged_item(ApproveRequest(id=it1.id), db=db_session)
    batch_approve_staged(BatchApproveRequest(batch_id="batch_html_test_1"), db=db_session)

    saved = db_session.query(Translation).order_by(Translation.pid.asc()).all()
    assert len(saved) == 2
    assert saved[0].translated == "「테스트 단건」"
    assert saved[1].translated == "「테스트 일괄」"
