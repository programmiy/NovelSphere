# Gemini API 호출 중복 기록(2중 카운트) 버그 해결 및 쿼터 괴리 원인 분석 (2026-11-07)

## 1. 개요 및 배경
- **문제 현상**: 실제 구글 API 사용량/콘솔 수치와 LANOVEL 로컬에 기록되는 API 호출 수치(`api_call_logs`, `api_calls_today`) 간에 괴리가 발생.
- **원인 분석**:
  1. **치명적인 에러 2중 기록 버그**: `server/services/translation_engine.py`의 `call_gemini_api()`에서 `response = session.post(...)` 직후 `record_api_call()`을 1회 호출하고, 이어서 `response.raise_for_status()`에서 503(Overload) 또는 429(Rate Limit) 예외가 발생하면 `except requests.exceptions.RequestException` 블록으로 빠져 `record_api_call()`을 **한 번 더 호출**하여 **모든 실패 요청이 정확히 2번씩 중복 기록**되는 치명적 결함 발견.
  2. **구글 게이트웨이와 로컬 집계 주기 시차**: 구글 AI Studio/GCP 메트릭 콘솔은 사용자 브라우저 시간(KST 00:00~23:59) 또는 UTC 기준인 반면, 실제 Gemini 무료 티어 일일 쿼터 버킷은 **미국 태평양 시간(PT) 자정 = 한국 시간 오후 5시(17:00)** 기준임.
  3. **자체 2차 복구 호출 누적**: 미번역 단락 발생 시 `_recover_verbatim_items` 등이 백그라운드에서 추가 호출을 수행하여 회차 수 대비 실제 API 호출 수가 증가.

---

## 2. 세부 변경 사항

### 2.1. 번역 엔진 중복 기록 차단 (`server/services/translation_engine.py`)
- `call_gemini_api()` 내 `except requests.exceptions.RequestException` 블록에서:
  - 이미 `response` 객체를 받아 `try` 블록에서 `record_api_call()`이 완료된 HTTP 에러(503, 429, 500 등)는 추가 기록하지 않음.
  - 네트워크 단절이나 타임아웃 등으로 `e.response is None`인 순수 연결 실패 건만 500으로 1회 기록하도록 가드 보강.

### 2.2. 단위 테스트 보강 (`tests/test_quota_logic.py`)
- `test_call_gemini_api_no_duplicate_on_error`: 503 HTTPError 발생 시 정확히 1회만 카운트되고 2중 기록되지 않음을 모킹 검증.

---

## 3. 검증 결과
- `tests/test_quota_logic.py`: 중복 기록 방지 검증 포함 단위 테스트 4건 전체 통과.
- 실제 DB 확인: 기존에 503/429 발생 시 동일 타임스탬프에 2개씩 레코드가 쌓이던 문제가 원천 차단됨.
