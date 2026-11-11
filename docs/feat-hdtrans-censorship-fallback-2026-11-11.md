# 검열 분할 번역 시 hdTrans 오프라인 대체 번역 연동

**작업 일자:** 2026-11-11  
**작업자:** Antigravity AI  
**관련 모듈:**
- `server/services/translation_recovery.py`
- `server/routers/translation.py`
- `server/services/hdtrans_service.py`
- `tests/test_censorship_hdtrans_fallback.py`

---

## 1. 개요 및 배경

Gemini API를 사용한 소설 배치 번역 도중 성인/민감 콘텐츠 등으로 인해 `PROHIBITED_CONTENT`, `SAFETY`, `BLOCKLIST` 등의 검열 차단이 발생할 경우:
1. 기존 시스템은 40초 대기 후 1차 2분할(`first_half`, `second_half`)을 시도.
2. 하지만 1차 분할 그룹에서도 검열 문장이 포함되어 있으면 또다시 40초를 대기하고 2차 4분할을 시도.
3. 이로 인해 40초 이상의 긴 지연이 반복 발생하며 Gemini API의 503(Service Unavailable) 또는 429(Rate Limit) 오류를 유발하고, 결국 단일 문장 Fast-Fail에 도달하여 `[검열로 인해 번역 생략]` 처리되는 문제가 발생.

이를 해결하기 위해 `tools/hdtrans`에 기탑재된 로컬 고속 오프라인 번역 엔진(`hdTrans v0.9.4`)을 검열 분할 단계에 연동하여, **1차 검열 분할 단계(및 이후 분할된 다른 문장 그룹)에서 검열이 감지될 경우 해당 문장 그룹을 로컬 hdTrans로 즉시 대체 번역**하도록 개선하였습니다.

---

## 2. 주요 변경 사항

### 2.1 `server/services/translation_recovery.py`
- `_fallback_hdtrans_or_split` 헬퍼 함수 신설:
  - 분할 번역(`depth >= 1`) 도중 `is_safety_blocked` 또는 `finishReason in ('SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT')` 감지 시 호출.
  - `is_hdtrans_available()` 확인:
    - 로컬 `hdtrans.exe`가 가용할 경우, 지연 대기나 추가 하위 분할 없이 해당 `items` 전체를 `hdtrans_service.translate_paragraphs`로 즉시 일괄 번역하여 반환.
    - hdTrans 번역 실패 또는 비가용 환경에서는 기존의 안전 대기(40초) 후 2분할 또는 Fast-Fail(`[검열로 인해 번역 생략]`) 로직으로 안전 폴백.
- `_translate_sub_batch_with_safety_split`:
  - 1차 분할 단계(`depth=1`) 및 이후 단계에서 검열 발생 시 `_fallback_hdtrans_or_split`을 통해 처리.
  - `first_half` 처리 시 검열이 나면 즉시 hdTrans로 번역하고, 이후 `second_half`("분할된 다른 문장 그룹")에서도 검열이 발견될 경우 동일하게 hdTrans로 번역 처리. (두 번째 그룹에 검열이 없으면 Gemini 번역 정상 활용)

### 2.2 `server/routers/translation.py`
- 단일 문장 배치(`len(items_to_translate) == 1`)에서 최초 API 호출 시 검열 차단 발생 시:
  - 기존: 무조건 `[검열로 인해 번역 생략]` 처리
  - 개선: `is_hdtrans_available()` 확인 후 hdTrans 엔진으로 즉시 대체 번역 수행, 실패 시에만 생략 처리로 폴백.

---

## 3. 검증 결과

- `tests/test_censorship_hdtrans_fallback.py`:
  - `test_sub_batch_safety_split_with_hdtrans_on_blocked`: 1차 분할 검열 시 hdTrans 대체 번역 검증 (통과)
  - `test_sub_batch_safety_split_finish_reason_prohibited`: finishReason PROHIBITED_CONTENT 시 hdTrans 대체 번역 검증 (통과)
  - `test_sub_batch_single_item_blocked_with_hdtrans`: 단일 문장 검열 시 hdTrans 대체 번역 검증 (통과)
  - `test_sub_batch_hdtrans_unavailable_fallback`: hdTrans 비가용 시 기존 Fast-Fail 생략 폴백 검증 (통과)
  - `test_sub_batch_hdtrans_exception_fallback`: hdTrans 예외 발생 시 안전 폴백 검증 (통과)
  - `test_translate_endpoint_prohibited_content_with_hdtrans`: 배치 검열 -> 1차 분할 그룹 검열 -> hdTrans 번역 + 2차 정상 그룹 Gemini 번역 결합 응답 엔드-투-엔드 검증 (통과)
- 기존 테스트 리그레션 검증:
  - `tests/test_hdtrans_service.py` 3건 전체 통과
  - 총 9건 테스트 전체 통과 (0.96s)
