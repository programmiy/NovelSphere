# Fix JSON Parsing Error with Extra Data

## 개요
번역 API 응답에서 유효한 JSON 데이터 뒤에 불필요한 문자(예: `}]`)가 추가되어 `json.loads`가 실패하는 `Extra data` 오류를 수정했습니다.

## 변경 사항
*   **파일:** `server/routers/translation.py`
*   **내용:**
    *   `json.loads` 실패 시 `json.JSONDecoder().raw_decode()`를 사용하여 파싱을 재시도하는 로직을 추가했습니다.
    *   `raw_decode`는 JSON 문자열이 끝나는 지점을 감지하여 뒤따르는 쓰레기 데이터를 무시할 수 있습니다.
*   **파일:** `.github/workflows/ci-pipeline.yml`
    *   `pytest server/` 명령어가 테스트를 찾지 못하던 문제를 `pytest`로 수정하여 `tests/` 폴더의 테스트가 정상적으로 실행되도록 했습니다.
*   **파일:** `tests/test_json_parsing.py`
    *   JSON 뒤에 데이터가 붙은 경우를 시뮬레이션하는 단위 테스트를 추가했습니다.
*   **파일:** `server/requirements.txt`
    *   CI 환경에서 테스트 실행에 필요한 누락된 의존성(`pydantic-settings`, `celery`, `python-dotenv`, `jinja2`)을 추가했습니다.



## 영향
*   API 응답 형식이 불안정할 때 발생하던 `500 Internal Server Error`가 감소하여 번역 안정성이 향상됩니다.
