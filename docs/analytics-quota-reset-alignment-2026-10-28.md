# 관리페이지 번역 통계 모듈 API 초기화 주기 정합성 개선 (2026-10-28)

## 1. 개요 및 배경
- 프로젝트 내에서 '하루'의 기준은 Gemini API 일일 쿼터 초기화 시점(미국 태평양 자정 = 한국 시간 서머타임 16:00, 표준시 17:00 KST)을 시작점으로 규정하고 있음.
- 그러나 관리페이지 통계 모듈(`GET /admin/analytics` 및 `admin-analytics.js`)에서 24시간 활동 분포 및 클라이언트 쿼터 윈도우 계산에 시차 왜곡 및 기준점 불일치가 존재하여 통계 데이터가 실 활동 주기와 어긋나는 결함이 확인됨.

## 2. 주요 결함 및 수정 내용

### 1) 24시간 시간대별 활동 프로필 KST 기준 복원 및 초기화 시각 시작점 정렬
- **문제점**:
  - `_sqlite_to_quota_hour(ts)`가 미국 태평양(LA) 시간대의 `hour(0~23)`를 반환하여, 한국 시간 16시~24시(저녁 집중 번역 시간대)가 차트상 새벽 0시~8시로 왜곡되고 피크 시간대가 새벽 4시로 잘못 표시됨.
- **수정**:
  - `server/database.py`: `_sqlite_to_quota_hour` 함수를 `Asia/Seoul(KST)` 표준시 기준으로 수정하고 `TO_KST_HOUR` SQLite 커스텀 함수로 등록.
  - `server/routers/admin.py`: `hourly_distribution` 산출 시 `quota_reset_hour`(16시 또는 17시)부터 시작하여 다음날 15시까지 순차적으로 24시간을 순환 정렬(`[16..23, 0..15]`).
  - 각 시간 슬롯에 `is_reset_start: (h == quota_reset_hour)` 플래그를 추가하여 하루의 시작 시점을 명시.
  - 피크 시간대(`peak_hour`)가 한국 시간 기준(실제 피크 20시)으로 정상 산출되도록 개선.

### 2) 웹 관리자 UI 시각화 고도화 (`admin-analytics.js`)
- **수정**:
  - `renderHourlySvg()`: API 초기화 시작 시간 바(16시)에 눈에 띄는 고유 색상(Cyan `#06b6d4`) 및 하단 라벨 `⚡16시` 강조 표기.
  - 툴팁에 `(KST)` 명시 및 하루 시작점 태그(`⚡ 하루 시작점(API 초기화)`) 추가.
  - 피크 시간대 배지를 `🔥 피크 시간대: N시 (N건, KST 기준)`으로 직관화.

### 3) 클라이언트 쿼터 윈도우 기준점 계산 버그 해결 (`admin-state.js`)
- **문제점**:
  - `getQuotaWindowStartMs()`가 서버 응답에 없는 `period_reset_time_kst` 필드를 조회하고, fallback 계산에서 9시간(KST)을 중복 차감하여 16:00 KST가 아닌 오전 07:00 KST를 오늘 시작점으로 잡던 버그 존재.
- **수정**:
  - 서버에서 제공하는 `quota_window_start_ts` 및 `today_start_ts` Unix timestamp를 1순위로 즉시 활용(오차 0ms).
  - fallback 계산 시 KST 시각 기준 당일/전일 `resetHour` 타임스탬프를 정확히 계산하도록 수식 정비.

## 3. 검증 결과
- `tests/test_admin_analytics.py`:
  - 24시간 활동 분포 0번째 시간(`hour`)이 `quota_reset_hour`와 일치하는지(`is_reset_start == True`), 피크 시간대가 정상 KST 범위인지 전수 검증 추가 통과 (3 passed in 1.04s).
- 전체 단위 테스트 264개 회귀 검증 완료.
