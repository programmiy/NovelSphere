# Fix JSON Parsing Error with Extra Data

## 개요
번역 API 응답에서 유효한 JSON 데이터 뒤에 불필요한 문자(예: `}]`)가 추가되어 `json.loads`가 실패하는 `Extra data` 오류를 수정했습니다.

## 변경 사항
*   **파일:** `server/routers/translation.py`
*   **내용:**
    *   `json.loads` 실패 시 `json.JSONDecoder().raw_decode()`를 사용하여 파싱을 재시도하는 로직을 추가했습니다.
    *   `raw_decode`는 JSON 문자열이 끝나는 지점을 감지하여 뒤따르는 쓰레기 데이터를 무시할 수 있습니다.

## 영향
*   API 응답 형식이 불안정할 때 발생하던 `500 Internal Server Error`가 감소하여 번역 안정성이 향상됩니다.
