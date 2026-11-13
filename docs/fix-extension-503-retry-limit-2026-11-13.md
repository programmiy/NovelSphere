# 크롬 확장 HTTP 503 과부하 재시도 분리·상한 축소 및 세션 재사용 결함 수정

## 1. 개요 및 배경
- **현상**: Gemini API 과부하(`HTTP 503`)가 발생하면 백엔드가 매 503마다 `recycle_gemini_session()`으로 TCP/TLS 세션을 즉시 초기화하고 `HTTP 503`을 반환했음에도, 크롬 확장 측에서 약 41~48초 대기 후 총 5회 재시도(~3분)한 뒤 다시 문단 반갈 분할(`handleFailure`)·문장 분할 재시도까지 진입하여 장시간 대기와 불필요한 일일 쿼터(RPD) 소모를 유발함.
- **원인 분석**:
  1. `extension/src/core/page_translator.ts`의 `translateChunk()`에서 `response.error` 수신 시 `throw new Error(response.error)`로 HTTP 상태 코드(`response.status === 503`)를 유실함.
  2. 이로 인해 503 과부하가 일반 네트워크/통신 오류와 동일 경로(`MAX_MESSAGE_RETRIES = 5`, `40 + 2^attempt`초 지수 백오프 + 최종 실패 시 `handleFailure()` 반갈 분할 및 문장 분할)를 탔음.
  3. 서버 측 `server/services/translation_recovery.py`의 `_recover_verbatim_items()`도 Step 2 진입 전 `gemini_session = get_gemini_session()`을 루프 밖에 캐싱해 두어, 루프 중 `call_gemini_api()` 또는 `recycle_gemini_session()`으로 기존 세션이 닫힌 뒤에도 닫힌 세션 변수로 `.post()`를 호출하는 결함이 있었음. 또한 `server/services/rpm_manager.py`의 `get_gemini_session()` / `recycle_gemini_session()`에 세션 교체 락이 없었음.

## 2. 구현 내용
1. **확장 503 과부하 전용 재시도 정책 모듈 신설 (`extension/src/core/retry_policy.ts`)**:
   - `MAX_503_ATTEMPTS = 3` (최초 1회 + 서버 세션 초기화 직후 `OVERLOAD_503_RETRY_DELAY_MS = 5000`ms 쿨다운 재시도 2회 = 503 최대 3회 연속 허용), `MAX_COMMUNICATION_RETRIES = 5`.
   - `createResponseError(message, status)`: 에러 throw 시 `status` 속성을 보존.
   - `isServiceUnavailable503Error(error)`: `status === 503` 또는 명확한 HTTP 503/과부하 에러 문자열을 판별하되, 본문/숫자 오탐(`p503`, `총 503자` 등) 배제.
   - `decideChunkRetryAction(attempt, error)`:
     - `503` 오류: `attempt < 2`(1·2회차 503)에서만 짧은 5초 대기 후 재시도(`retry`, `isOverload503: true`), `attempt >= 2`(3회 연속 503 발생)이면 4번째 호출 없이 `pause_503` 반환(반갈 분할 `split_fallback` 전면 차단).
     - 일반 통신 오류: 기존 `41s -> 42s -> 44s -> 48s` 5회 재시도 후 `split_fallback` 유지.
2. **번역 루프 분리·일시정지 공통화 및 상태 보고 보강 (`extension/src/core/page_translator.ts`, `state.ts`)**:
   - `translateChunk()`가 `createResponseError(response.error, response.status)`를 throw하고 `decideChunkRetryAction()` 분기를 적용.
   - `decision.action === 'pause_503'` 또는 `response.stop`(429 등) 시 `pauseTranslationForManualResume()` 공통 헬퍼로 `'번역 중'` 셀을 비우고 재개 버튼(`▶️`, `state.resolveResume`) 대기로 안전 일시정지. (`handleFailure` 반갈/문장 분할 및 미완료 `hdTrans` 강제 덮어쓰기 진입 차단)
   - `pauseTranslationForManualResume()` 대기 중 취소 버튼 대응을 위해 5초 재시도 대기에 `sleepResponsive()` 적용 및 대기 종료/일시정지 시 `state.retryDelayUntil = 0` 초기화.
   - `handleFailure()` 문장 분할 경로에도 `503`/정각 중단/`stop` 가드 추가.
   - `state.ts`의 `buildStatusPayload()`에서 `this.resolveResume` 대기 시 원격 상태 `phase = 'paused'`가 정확히 보고되도록 보완.
3. **서버 세션 초기화 동시성 및 재사용 결함 수정 (`rpm_manager.py`, `translation_recovery.py`)**:
   - `server/services/rpm_manager.py`: `_SESSION_LOCK`을 추가하여 `get_gemini_session()` 및 `recycle_gemini_session()`의 세션 교체·해제를 스레드 안전하게 보호.
   - `server/services/translation_recovery.py`: `_recover_verbatim_items()`에서 루프 밖 `gemini_session` 캐싱을 제거하고 Step 2 일반 텍스트 복구 요청 시 매번 `get_gemini_session().post(...)`를 동적 조회하도록 수정.

## 3. 검증 결과
- **확장 타입체크 / 단위 테스트 / 빌드**:
  - `npm run typecheck` 통과 (`0` errors).
  - `npm run test`: `27 passed, 0 failed` (`extension/tests/core.test.ts` 내 503 분류·3회 연속 상한·반갈 분할 차단·일반 통신 오류 백오프·`resolveResume` 일시정지 상태 등 4건 신규 테스트 포함).
  - `npm run build`: `content.js`, `background.js` 및 소스맵 번들링 완료.
- **백엔드 린트 및 테스트**:
  - `.\venv\Scripts\ruff.exe check server/` 통과 (`All checks passed!`).
  - `.\venv\Scripts\python.exe -m pytest tests/test_rpm_breather.py tests/test_quota_logic.py tests/test_verbatim_cleanup.py tests/test_services_modularization.py tests/test_censorship_hdtrans_fallback.py tests/test_notifications.py tests/test_quota_reset_guard.py`: `64 passed in 1.65s` (`test_recycle_gemini_session_thread_safe` 신규 추가 포함).
