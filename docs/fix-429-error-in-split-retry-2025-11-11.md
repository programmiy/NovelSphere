# 수정: 문장 분할 재시도 중 429 오류 처리

## 개요

번역 실패 시 문장을 분할하여 재시도하는 `retryWithSentenceSplitting` 함수에서 429 (Too Many Requests) 오류가 발생했을 때, 전체 번역 프로세스가 중단되지 않는 버그를 수정했습니다.

## 주요 변경 사항

- **오류 처리 로직 추가**:
  - `content.js`의 `retryWithSentenceSplitting` 함수 내에, `background.js`로부터 번역 중단 메시지(`{stop: true}`)를 수신했을 때 이를 처리하는 로직을 추가했습니다.
- **동작 일관성 확보**:
  - 이제 문장 분할 재시도 중에 429 오류가 발생하더라도, 일반 번역 요청 시와 동일하게 `isTranslationCancelled` 플래그가 `true`로 설정됩니다.
  - 이를 통해 전체 번역 프로세스가 즉시 중단되어, 불필요한 API 요청과 오류를 방지합니다.
