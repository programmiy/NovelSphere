import json
import pytest
from server.routers.translation import parse_translation_response

def mock_parsing_logic(clean_json_text):
    """
    server/routers/translation.py에 적용된 파싱 로직의 핵심 부분을 테스트하기 위한 함수 (하위 호환성 유지)
    """
    try:
        try:
            translated_data = json.loads(clean_json_text, strict=False)
        except json.JSONDecodeError:
            # Try raw_decode to handle extra data at the end (e.g. "}]" artifact)
            translated_data, _ = json.JSONDecoder(strict=False).raw_decode(clean_json_text)
        return translated_data
    except Exception as e:
        raise e

def test_json_with_extra_data():
    # 케이스 1: 정상 JSON
    normal_json = '[{"id": "p1", "translated": "hello"}]'
    assert mock_parsing_logic(normal_json) == [{"id": "p1", "translated": "hello"}]

    # 케이스 2: 뒤에 찌꺼기(}] )가 붙은 경우 (실제 오류 발생 사례)
    buggy_json = '[{"id": "p1", "translated": "hello"}]\n}]'
    assert mock_parsing_logic(buggy_json) == [{"id": "p1", "translated": "hello"}]

    # 케이스 3: 뒤에 랜덤한 텍스트가 붙은 경우
    random_extra = '[{"id": "p1", "translated": "hello"}] some random stuff'
    assert mock_parsing_logic(random_extra) == [{"id": "p1", "translated": "hello"}]

def test_invalid_json():
    # 완전히 잘못된 JSON은 여전히 실패해야 함
    invalid_json = '{"id": "p1", "translated": "hello"' # 닫는 괄호 없음
    with pytest.raises(json.JSONDecodeError):
        mock_parsing_logic(invalid_json)

def test_control_character_in_translation():
    # 유저 오류 사례: 문자열 내부에 이스케이프되지 않은 제어 문자(줄바꿈 \n, 탭 \t)가 포함된 경우
    # Invalid control character at: line 44 column 60
    multiline_json = '[\n  {"id": "p1", "translated": "첫번째 줄\n두번째 줄\t탭문자"}\n]'
    result = parse_translation_response(multiline_json)
    assert result == {"p1": "첫번째 줄\n두번째 줄\t탭문자"}

def test_markdown_code_fence():
    # 마크다운 코드 블록으로 감싸진 경우
    fenced_json = '```json\n[{"id": "p1", "translated": "안녕"}]\n```'
    result = parse_translation_response(fenced_json)
    assert result == {"p1": "안녕"}

def test_trailing_comma():
    # 후행 쉼표가 붙은 경우
    trailing_comma_json = '[{"id": "p1", "translated": "안녕"}, ]'
    result = parse_translation_response(trailing_comma_json)
    assert result == {"p1": "안녕"}

def test_invalid_escape_sequence():
    # 유효하지 않은 이스케이프(예: \? 또는 \ )가 포함된 경우
    invalid_escape_json = '[{"id": "p1", "translated": "물음표\\?와 공백\\ 이스케이프"}]'
    result = parse_translation_response(invalid_escape_json)
    assert "p1" in result

def test_wrapped_dict_format():
    # translations 키로 감싸진 딕셔너리 형태인 경우
    wrapped_json = '{"translations": [{"id": "p1", "translated": "안녕"}]}'
    result = parse_translation_response(wrapped_json)
    assert result == {"p1": "안녕"}

def test_truncated_json_regex_fallback():
    # 토큰 제한 등으로 JSON 뒷부분이 잘렸을 때 완료된 항목들을 정규식으로 복구
    truncated = '[{"id": "p1", "translated": "첫번째"}, {"id": "p2", "translated": "두번째"}, {"id": "p3", "trans'
    result = parse_translation_response(truncated)
    assert result == {"p1": "첫번째", "p2": "두번째"}

def test_corrupted_json_regex_recovery():
    # 중간에 문법 오류가 섞여 일반 JSON 파서가 실패하는 경우 정규식 폴백으로 정상 객체들을 추출
    corrupted = '[{"id": "p1", "translated": "첫번째"}, some broken syntax in the middle {"id": "p2", "translated": "두번째"}]'
    result = parse_translation_response(corrupted)
    assert result == {"p1": "첫번째", "p2": "두번째"}

def test_alternate_field_names():
    # Gemini가 translated 대신 text, translation, korean 등의 키를 반환한 경우
    case1 = '[{"id": "p1", "text": "텍스트 번역"}, {"id": "p2", "translation": "번역 번역"}]'
    result = parse_translation_response(case1)
    assert result == {"p1": "텍스트 번역", "p2": "번역 번역"}

def test_line_based_fallback():
    # Gemini가 JSON 규격을 무시하고 라인 기반으로 응답한 경우
    line_text = 'p1: 첫번째 대사\np2: 두번째 대사'
    result = parse_translation_response(line_text)
    assert result == {"p1": "첫번째 대사", "p2": "두번째 대사"}

def test_soft_refusal_detection():
    # R18 성인 소설 등에서 finishReason: STOP이지만 텍스트로 소프트 거절한 경우 감지
    from server.routers.translation import is_safety_blocked
    fake_refusal_response = {
        "candidates": [{
            "finishReason": "STOP",
            "content": {
                "parts": [{"text": "I cannot fulfill this request. I am unable to generate sexually explicit content."}]
            }
        }]
    }
    blocked, reason = is_safety_blocked(fake_refusal_response)
    assert blocked is True
    assert "SOFT_REFUSAL" in reason

