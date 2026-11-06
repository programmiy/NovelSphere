# Gemini API 503(과부하) 에러 계측 제외 및 현황판 동기화 (2026-11-06)

## 1. 개요 및 목적
- **목적**: Gemini API 요청 시 발생하는 일시적 서버 과부하(`503 UNAVAILABLE / Overload`) 에러 응답을 관리자(`admin.js`) 및 모바일 앱의 일일 API 계측(API 사용량, 호출 수, 쿼터 소모율)에서 원천 제외하여, 실제 성공적으로 번역되거나 처리된 유효 API 호출량만 정확하게 계측되도록 보정.
- **배경**: 구글 Gemini API 503 과부하 에러는 서버의 일시적 용량 부족으로 인해 요청이 반려된 상태임에도 기존에는 `record_api_call(status_code=503)`이 `ApiCallLog` 테이블에 기록되고 카운트되어, 실제 번역이 수행되지 않았는데도 쿼터 호출 수(`api_calls_today`)가 소모된 것처럼 왜곡되는 현상이 존재했음.

---

## 2. 세부 변경 사항

### 2.1. 백엔드 쿼터 엔진 (`server/quota.py`)
1. **`record_api_call(model, status_code)`**:
   - `status_code == 503`인 경우 `ApiCallLog`에 레코드를 삽입하지 않고 즉시 반환(Guard Clause).
2. **`get_today_api_call_count()`**:
   - 쿼터 윈도우 집계 시 `ApiCallLog.status_code != 503` 조건을 추가하여 기존 DB에 잔존할 수 있는 503 기록도 계측에서 원천 배제.
3. **`_seed_calls_from_translations_if_needed(db, window_start_ts)`**:
   - 시드 판정 카운트 시에도 `status_code != 503` 필터 적용.

### 2.2. 번역 엔진 및 복구 엔진
1. **`server/services/translation_engine.py`**:
   - `response.status_code != 503`일 때만 `record_api_call`을 호출하도록 1차 방어.
   - 예외 처리 블록(`RequestException`)에서도 `status_code != 503` 검사 후 기록.
2. **`server/services/translation_recovery.py`**:
   - verbatim 복구 요청의 `res.status_code != 503` 검사 후 `record_api_call` 호출.

### 2.3. 웹 관리자 & 모바일 앱 동기화
- **웹 관리자 (`admin-tree.js`, `admin-analytics.js`)**:
  - `/api/notifications/summary` 및 `/api/admin/analytics`의 `api_calls_today`, `today_api_calls`, `today_paras_per_call`, `rpm_usage_est`가 503을 제외한 유효 호출 수 기반으로 정확히 산출됨.
- **모바일 앱 (`mobile_app/`)**:
  - `StatusDashboardService`가 서버의 `/api/status/summary`를 구독하므로 안드로이드 대시보드 알림 및 서재 상단 실시간 진행 배너의 "오늘 API N/500회" 수치가 503 제외 수치와 100% 동기화됨.
  - 앱 버전 판올림 (`1.7.3+2026110601`) 및 릴리즈 APK 빌드 완료.

---

## 3. 검증 내역
- `tests/test_quota_logic.py`:
  - `test_quota_excludes_503` 단위 테스트 추가:
    1) `record_api_call(status_code=503)` 호출 시 호출 수 불변 확인
    2) DB에 직접 `status_code=503`을 삽입해도 `get_today_api_call_count()`에서 카운트 제외 확인
    3) 정상 200 호출 시 카운트 +1 정상 증가 확인
- `tests/test_admin_analytics.py`: 관리자 통계 연동 3개 테스트 전체 통과 확인.
