# 미국 서머타임(DST) 시작·종료 전주기 타임존 정합성 및 정각 안전 중단 전면 개편 (2026-11-01)

## 1. 개요 및 배경
- Gemini API 일일 쿼터(RPD)는 미국 태평양(America/Los_Angeles) 자정(00:00 PT)에 초기화됩니다.
- 한국 표준시(KST) 기준으로는:
  - **서머타임(PDT, UTC-7)** 적용 시: **오후 4시 (16:00 KST)**
  - **표준시(PST, UTC-8)** 적용 시: **오후 5시 (17:00 KST)**
- 그러나 기존 백엔드(`server/quota.py`)의 `is_us_dst()` 함수가 한국 시각(KST)과 미국 태평양 시각(PT) 간의 16~17시간 시차를 고려하지 않고, '11월 첫째 주 일요일 02:00'를 한국 시간 새벽 2시로 단순 비교하는 심각한 결함이 있었습니다.
- 이로 인해 한국 시간 11월 1일 새벽 2시가 지나자마자 백엔드 전체가 "서머타임이 종료되었다"고 16시간 조기 오판하여:
  - 백엔드 쿼터 초기화 시각이 `17시`로 먼저 넘어가 번역기의 **16시 정각 안전 중단(503)** 신호가 발생하지 않음.
  - 관리자 대시보드(Admin HTML), 24시간 통계 차트, 모바일 앱의 쿼터 기준이 `17시`로 어긋남.
  - 반면 크롬 확장은 브라우저 `Intl` API로 현지 시간(PDT)을 직접 조회하여 홀로 `16시`로 알림 로그를 띄우는 시스템 간 불일치가 발생함.

---

## 2. 주요 결함 및 수정 내용

### 1) 백엔드 타임존 엔진 전면 개편 (`server/quota.py`)
- **문제점**:
  - `datetime.datetime.now()`(KST)와 `dst_end`(02:00 naive)를 단순 비교하여 현지 해제 시점(한국 시각 11월 1일 18:00)보다 16시간 일찍 표준시로 오판.
- **수정**:
  - Python `zoneinfo.ZoneInfo("America/Los_Angeles")` 및 `Asia/Seoul` 기반의 정밀 타임존 엔진 도입.
  - `is_us_dst(dt)`: 입력 시각을 LA 현지 시각으로 변환 후 `la_dt.dst().total_seconds() > 0`으로 실시간 공인 서머타임 판정 (tzdata 없는 환경 대비 UTC 10:00/09:00 정밀 fallback 탑재).
  - `get_current_quota_window_start(now)`: 미국 LA 현지 당일 자정(00:00:00)을 KST로 변환하여 쿼터 윈도우 시작 시각 산출 (전환일에도 1초 오차 0ms).
  - `get_next_quota_reset_dt(now)` 및 `get_next_quota_reset_hour(now)`: 다음 리셋 정각 시각과 해당 시간(16 또는 17)을 계산하는 신규 SSOT 함수 추가.
  - `get_quota_summary()`: `next_reset_hour` 및 `next_reset_ts` 필드를 추가 탑재하여 클라이언트와 완벽 동기화.

### 2) 번역 정각 안전 중단 엔진 정밀화 (`server/routers/translation.py`)
- **문제점**:
  - `_QuotaStopState`가 `now.hour` 단일 시간값만 비교하여, 서머타임 전환일에 16시 리셋 직후 내일 17시 리셋 타깃이 설정되었을 때 당일 17시에 오작동하거나 16시 정각 중단이 누락되는 구조적 결함 존재.
- **수정**:
  - `_QuotaStopState`: 날짜를 포함한 절대 타임스탬프(`next_reset_dt.timestamp()`) 기반으로 개편.
  - 다음 리셋 정각 60분 전부터 직전까지 활성 번역 중일 때만 정확히 1회 무장(`_armed = True`).
  - 정각 타임스탬프를 통과하는 순간 즉시 503 안전 중단(`오후 X시(쿼터 초기화 시간)가 되어 자동 번역을 중지합니다`)을 단 1회 발생시키고 자동 무장 해제.
  - 새로고침 후 재개 시 번역이 차단되지 않고 정상 진행되도록 보장.

### 3) 크롬 확장 모듈 정합성 및 빌드 (`extension/src/core/turbo.ts` & `content.js`)
- **수정**:
  - `isUsDstRule`: 브라우저 로컬 시각 naive 비교를 제거하고, UTC 기반 공식 타임스탬프(`Date.UTC(..., 10, 0, 0)` / `Date.UTC(..., 9, 0, 0)`)로 정밀화.
  - `getNextLaMidnightTimestamp`: 0.05ms 이진 탐색 알고리즘을 도입하여 3월 서머타임 개시일(23시간) 및 11월 해제일(25시간)에도 다음 LA 자정 타임스탬프를 1초 오차 없이 정확히 산출.
  - `getCurrentQuotaWindow`: 수동 오버라이드가 아닐 때 `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now)`를 기반으로 LA 현지 일자(`YYYY-MM-DD_HH`)를 키로 직접 창출.
  - `npm run build`를 통해 `content.js`, `background.js` 번들 컴파일 완료.

### 4) 단위 테스트 정비 (`tests/test_quota_reset_guard.py` & `test_quota_logic.py`)
- **수정**:
  - 3월 서머타임 개시 시점(한국 시각 3월 둘째 일요일 19:00:00 KST) 및 11월 서머타임 종료 시점(한국 시각 11월 첫째 일요일 18:00:00 KST)의 경계값 테스트 케이스를 최신 사양으로 정비.
  - 정각 안전 중단 `_QuotaStopState`의 경계 통과 테스트 추가.

---

## 3. 검증 결과
- **백엔드 테스트**:
  - `tests/test_quota_reset_guard.py` 5개 케이스 100% 통과 (0.55s).
  - `tests/test_quota_logic.py` 2개 케이스 100% 통과.
  - `tests/test_admin_analytics.py`, `tests/test_notifications.py` 13개 케이스 100% 통과.
- **크롬 확장 테스트**:
  - `npm test`: 20개 테스트 전원 통과 (194ms).
- **실행 결과 확인 (2026-11-01 17:02 KST 기준)**:
  - `is_us_dst`: True (미국 LA는 11/1 01:02 PDT로 서머타임 유지 중)
  - `current_window_start`: 2026-11-01 16:00:00 (오늘 16시 리셋 정상 집계)
  - `next_reset_dt`: 2026-11-02 17:00:00 (내일 17시로 다음 타깃 정확히 설정)
  - 오늘 API 호출 15회 및 번역 문단 643건이 오염 없이 실시간 동기화됨.
