# Fix: `PROHIBITED_CONTENT` 오류 시 재시도 로직 수정 (v1.0)

## 변경 사항

- `extension/content.js` 파일의 번역 재시도 로직을 수정했습니다.

## 상세 설명

- Gemini API로부터 `PROHIBITED_CONTENT` 오류를 수신했을 때, 불필요한 재시도 대기 시간(exponential backoff)을 거치지 않도록 변경했습니다.
- 해당 오류가 발생하면, 즉시 해당 번역 항목을 "번역 실패: PROHIBITED_CONTENT"로 처리하고 다음 작업으로 넘어가도록 수정하여, 불필요한 지연을 없애고 API 오류에 더 빠르게 대응할 수 있도록 개선했습니다.