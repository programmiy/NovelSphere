# 관리페이지 번역 통계 회차 수 지표 및 Throughput 분석 엔진 추가 (2026-10-29)

## 1. 개요
- 관리페이지 통계 & 품질 심층 분석 대시보드(`GET /admin/analytics` 및 `admin-analytics.js`)에 기존 문단 수, 글자 수에 더해 **'번역 회차 수(Episodes)'** 및 **'회차당 평균 분량 밀도(Density)'** 시각화 지표를 전면 탑재.
- 번역 속도 및 처리 효율성을 분석할 수 있는 **Throughput & Efficiency HUD** 카드 데크 및 API 청킹 수율 분석 엔진 구축.

## 2. 주요 변경 사항

### 1) 백엔드 통계 집계 엔진 확장 (`server/routers/admin.py`)
- **일별 추이 지표 확장 (`daily_trends`)**:
  - `COUNT(DISTINCT url) as episodes` 집계 추가.
  - 일별 데이터에 `episodes`, `avg_chars_per_ep`, `avg_paras_per_ep` 산출.
  - 회차 수 누적치(`cum_episodes`) 및 7일 이동평균(`ma7_episodes`) 산출.
- **KPI 지표 보강**:
  - `daily_avg_episodes`: 일평균 번역 회차 수 산출.
  - `peak_episodes_count` / `peak_episodes_date`: 역대 하루 최다 번역 회차 수 및 일자 산출.
  - `last_7d_episodes`: 최근 7일간 번역 회차 수 합산.
- **시간대별/요일별 24시간 분포에 회차 수 연동**:
  - `hourly_distribution` 및 `dow_distribution`에 `episodes` 및 `chars` 집계 필드 추가.
- **번역 속도 및 처리 효율성(Throughput & Efficiency) 지표 신설**:
  - `peak_hourly_chars` / `peak_hourly_paras` / `peak_hourly_episodes`: 시간당 최고 번역 속도.
  - `today_chars_per_call` / `today_paras_per_call`: API 호출 1회당 청킹 번역 수율.
  - `last_7d_books_volume`: 최근 7일 생산량의 단행본 권수 환산치.
  - `efficiency` 딕셔너리로 API 응답에 서빙.

### 2) 웹 관리자 UI 및 SVG 차트 고도화 (`admin.html`, `admin-analytics.js`)
- **지표 전환 버튼 확장 (`#activityMetricButtons`)**:
  - `[회차 수] [문단 수] [글자 수] [회차당 분량]` 4개 모드 완벽 지원.
  - 기본 메트릭을 `episodes`로 설정하여 일별 회차 추이를 기본 렌더링.
- **SVG 인터랙티브 차트 툴팁 종합 정보 표기**:
  - 선택된 메트릭에 맞춰 `화`, `자`, `문단`, `자/화` 단위 자동 바인딩.
  - 툴팁 하단에 `당일: N화 · N문단 · N자` 3종 종합 실적 브레이크다운 출력.
- **Throughput Analytics HUD 카드 데크 추가**:
  - 🚀 시간당 최대 처리속도 (`N자/h`, 회차/문단/시간)
  - 📦 API 호출당 청킹 밀도 (`N자/회`, 호출당 문단 수율)
  - 📐 회차당 평균 분량 밀도 (`N자/화`, 회차당 문단 구성)
  - 📚 최근 7일 완독 환산량 (`N권 분량`, 일평균 번역 페이스)
- **시간대별/요일별 툴팁에 회차수 동시 표기**:
  - `N시: N문단 (N화) [N%] N자 번역` 상세 안내.

### 3) 단위 테스트 검증 (`tests/test_admin_analytics.py`)
- `daily_trends` 내 `episodes`, `cum_episodes`, `ma7_episodes`, `avg_chars_per_ep` 필드 정합성 검증.
- `efficiency` 딕셔너리 구조 및 산출 값 검증 추가 통과.
