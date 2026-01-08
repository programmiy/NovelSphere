import json
import pytest

def mock_parsing_logic(clean_json_text):
    """
    server/routers/translation.py에 적용된 파싱 로직의 핵심 부분을 테스트하기 위한 함수
    """
    try:
        try:
            translated_data = json.loads(clean_json_text)
        except json.JSONDecodeError:
            # Try raw_decode to handle extra data at the end (e.g. "}]" artifact)
            translated_data, _ = json.JSONDecoder().raw_decode(clean_json_text)
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
