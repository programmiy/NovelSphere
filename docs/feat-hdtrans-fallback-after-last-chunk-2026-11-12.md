# 마지막 꾸러미 이후 번역의 hdTrans 오프라인 엔진 폴백 연동

**작업 일자:** 2026-11-12  
**작업자:** Antigravity AI  
**관련 모듈:**
- `extension/src/core/state.ts`
- `extension/src/core/page_translator.ts`
- `extension/src/background/index.ts`
- `extension/content.js`, `extension/background.js` (빌드 번들)
- `server/routers/translation.py`
- `tests/test_hdtrans_fallback_after_last_chunk.py`

---

## 1. 개요 및 배경

1. **문제 현황**:
   - 원문 복제나 일본어 잔존 단락 감지 시 해당 단락을 자동 삭제 후, 회차 번역의 마지막 정규 꾸러미(Last Chunk Piggyback)에 합류시켜 1회의 API 호출로 해결을 시도함.
   - 그러나 마지막 꾸러미에서도 번역이 실패하거나(원문 복제 재발, 누락 등) 예산 초과분으로 남을 경우, 번역 직전 **분할 재시도(`handleFailure`)** 또는 **`[보완 번역꾸러미]`**가 새로 생성되어 추가 Gemini API 쿼터를 소모(503 과부하, 429 한도 초과 및 RPD 소모)하는 비효율이 발생함.
2. **요구사항**:
   - 마지막 번역 꾸러미를 진행한 이후 발생하는 모든 번역(실패 분할 재시도, 보완 번역꾸러미, 잔여 빈칸 재요청)은 `tools/hdtrans`의 로컬 고속 오프라인 번역 엔진(`hdTrans v0.9.4`)으로 전환하여 API 쿼터 소모를 0건으로 완전 방어.
   - 단, 새 페이지나 다음 페이지(다음 화 자동 이동) 번역 시작 시에는 트리거 플래그가 자동 갱신(초기화)되어 다시 기본 Gemini 모델로 정상 번역이 진행되어야 함.

---

## 2. 주요 변경 사항

### 2.1 크롬 확장 프로그램 (`extension/`)
- **`src/core/state.ts`**:
  - `public isAfterLastChunk = false;` 상태 변수 추가.
  - 마지막 번역 꾸러미를 전송·진행한 이후 발생하는 모든 요청을 추적.
- **`src/background/index.ts`**:
  - `batchTranslate` 액션 핸들러 및 `handleBatchTranslate` 함수에 `forceHdtrans` 플래그 파라미터 연동.
  - 서버 `POST /translate` 호출 시 `bodyPayload.force_hdtrans = true` 전달.
- **`src/core/page_translator.ts`**:
  - **새 페이지 번역 갱신**: `translateAllPTags` 시작 시 `state.isAfterLastChunk = false;`로 즉시 초기화.
  - **트리거 발동 시점**:
    - 마지막 청크(`isLastChunk === true`)의 최초 번역 요청은 기존대로 Gemini로 전송.
    - 마지막 청크의 최초 응답을 수신한 직후 `state.isAfterLastChunk = true;` 발동.
    - 이후 마지막 청크 내 실패 항목으로 인한 `handleFailure` 분할 재시도 및 단일 문장 분할 재시도는 `forceHdtrans: true`로 자동 전환.
  - **정규 청크 순회 종료 직후**:
    - `state.isAfterLastChunk = true;` 보장.
    - 라인 887 `[보완 번역꾸러미]` 실행 시 `translateChunk`가 호출되며 자동으로 `forceHdtrans: true`로 실행 (API 쿼터 소모 0).
  - 사이드바 로그 피드백:
    - `⚡ [hdTrans 오프라인 번역] 마지막 번역 꾸러미 이후 요청(N문장)을 로컬 hdTrans로 번역합니다. (API 쿼터 소모 0회)`

### 2.2 백엔드 서버 (`server/routers/translation.py`)
- **`TranslateRequest`**:
  - `force_hdtrans: Optional[bool] = False` 필드 추가.
- **`translate_texts` (`POST /translate`)**:
  - `force_hdtrans=True` 또는 `model="hdtrans"` 요청 시:
    - `is_hdtrans_available()` 검사 후 `tools/hdtrans/hdtrans.exe` 엔진 직접 호출 (`translate_paragraphs`).
    - 괄호 복원(`restore_brackets`) 및 반복 문자 정돈(`process_repeated_chars`) 수행.
    - Gemini API 키 검사나 `call_gemini_api` 네트워크 호출을 100% 스킵하여 **API 쿼터 소모 0건** 달성.
    - hdTrans 비가용 환경 또는 예외 발생 시에는 기존 Gemini API 호출로 안전하게 자동 폴백.

---

## 3. 검증 결과

- **백엔드 단위/통합 테스트 (`tests/test_hdtrans_fallback_after_last_chunk.py` 외)**:
  - `test_translate_endpoint_force_hdtrans_direct`: `force_hdtrans=True` 시 Gemini 0회 호출, hdTrans 직접 번역 검증 (통과)
  - `test_translate_endpoint_model_hdtrans_direct`: `model="hdtrans"` 시 hdTrans 직접 번역 검증 (통과)
  - `test_translate_endpoint_force_hdtrans_fallback_on_unavailable`: hdTrans 비가용 시 Gemini 안전 폴백 검증 (통과)
  - `test_translate_endpoint_force_hdtrans_fallback_on_exception`: hdTrans 예외 시 Gemini 안전 폴백 검증 (통과)
  - `test_translate_endpoint_normal_request_still_uses_gemini`: 일반 번역 요청 시 Gemini 정상 사용 검증 (통과)
  - 총 14건 pytest 전체 통과 (3.05s)
- **크롬 확장 프로그램 검증**:
  - `npm run typecheck`: TypeScript 정적 타입 검사 에러 0건 통과
  - `npm run build`: esbuild 번들링 정상 완료 (41ms)
  - `npm test`: 23개 코어 테스트 100% 통과 (300ms)
