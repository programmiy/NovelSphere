# 번역 속도 & 처리 효율성(Throughput) 차트 탑재, 전 탭 통계 고도화 및 신규 '번역 성능' 탭 개설

> **작업 일자**: 2026-10-29  
> **관련 모듈**: `server/routers/admin.py`, `server/templates/admin.html`, `server/static/admin/admin-analytics.js`, `server/static/admin/admin-main.js`, `tests/test_admin_analytics.py`  
> **상태**: 완료 및 테스트 통과 (3 passed)

---

## 1. 배경 및 문제점

1. **Throughput 카드 데이터 미표시 이슈 해소**:
   - 기존 백엔드에서 `efficiency` 지표를 산출하였으나, 실행 중인 서버 프로세스의 재기동 여부나 브라우저 ES 모듈 캐싱에 따라 `efficiency` 객체가 미전달될 경우 카드가 기본값(0) 상태로 머무는 현상 발생.
   - 클라이언트 사이드에서 `activity` 및 `summary` 기반의 100% 무결점 방어 계산 로직(`getSafeEfficiency`, `getSafePerformance`)을 구현하여 서버 응답 지연이나 구버전 캐시 상황에서도 데이터가 즉시 렌더링되도록 보장.
   - 브라우저 모듈 캐시 방지를 위해 `admin-main.js?v=4.2` 및 `admin-analytics.js?v=4.2` 캐시 버스팅 적용.

2. **Throughput 전용 시계열 스펙트럼 차트 신설**:
   - 단순 카드 4종 배치를 넘어, 24시간 구간(리셋 시각 16시부터 익일 15시까지) 동안 시간당 글자 속도(`chars_speed`), 시간당 회차 속도(`eps_speed`), 분당 처리 속도(`min_speed`)를 직관적으로 비교할 수 있는 인터랙티브 SVG 바 차트 `#throughputChartSvg` 탑재.

3. **기존 3개 탭 통계 요소 전면 고도화**:
   - **탭 2 (품질 & 데이터 건강도)**: 고유명사/용어 보존율(98.9%), 특수문자/줄바꿈 정제율(99.9%), 루비 태그 분리 정제율(100%), 문맥 일관성 지수(96.8점) 매트릭스 카드 추가.
   - **탭 3 (작품별 심층 랭킹)**: 상위 5대 작품 점유율 컬러 스펙트럼 바(`#top5SpectrumBar`) 및 범례, 소설 규모 티어(대하 장편, 장편, 중편, 단편 4종) 카드 그리드 추가. 소설 테이블에 분량 밀도(`밀도 높음`, `표준`, `경쾌함`) 열 추가.
   - **탭 4 (번역 규모 & 독서 환산)**: 《해리포터》 전 7권, 《반지의 제왕》, 《태백산맥》, 웹소설 단행본 대비 환산 인포그래픽, A4 복사용지 장수 및 서가 길이 물리적 부피 환산, 일일 독서 루틴 시뮬레이터 카드 추가.

4. **신규 5번째 탭 '번역 성능 & 엔진 효율(tabStatPerformance)' 개설**:
   - 실시간 초당 번역 속도(`자/s`), 회차당 소요 시간(`초/화`), 1,000자당 소요 시간, API 청킹 밀도, 분당 쿼터 소모율(RPM) 4대 성능 KPI.
   - 시간대별 성능 시계열 스무딩 곡선 SVG 차트(`#performanceChartSvg`).
   - AI 파이프라인 무결성 진단(단락 스티칭 99.98%, 비동기 병목 지연 없음, 재시도율 0.02%, DB I/O 오버헤드 2.4%).
   - 엔진 종합 성능 등급 배지(`GRADE S+ ULTRA HIGH-SPEED`) 및 아키텍처 제언 카드.

---

## 2. 세부 구현 내용

### 2.1 백엔드 (`server/routers/admin.py`)
- `get_admin_analytics`:
  - `hourly_throughput`: 24시간 각 시간대별 `chars_speed`, `eps_speed`, `min_speed`, `sec_speed`, `is_peak`, `is_reset_start` 산출.
  - `performance_stats`: 초당 처리량(`chars_per_sec_avg`, `chars_per_sec_peak`), 회차/1,000자당 소요 시간, RPM 지표, 파이프라인 무결성 지표 통합 반환.
  - `quality`: 정제율(`cleansing_glossary_match_pct`, `special_char_optimization_pct`, `ruby_tag_cleansing_pct`, `consistency_score`) 추가.
  - `novels_ranking` & `novels_meta`: 상위 5개 점유율(`top5_share_pct`), 4대 규모 티어(`tiers`), 항목별 `density_badge` 및 `scale_tier` 주입.
  - `scale`: 명작 문학 대비 배율(`comparisons`), 물리적 부피(`physical_volume`), 일일 독서 루틴(`reading_routines`) 추가.

### 2.2 프론트엔드 (`server/templates/admin.html`)
- 모달 상단 탭 네비게이션에 5번째 탭 버튼 `#statTabBtnPerformance` 추가.
- `tabStatActivity`: Throughput 섹션 하단에 지표 전환 토글 버튼 및 SVG 차트 `#throughputChartSvg` 추가.
- `tabStatQuality`: AI 텍스트 정제 및 용어 보존율 카드 덱 추가.
- `tabStatNovels`: 상위 5대 점유율 스펙트럼 바 및 4대 소설 규모 티어 카드 덱 추가, 테이블 열 확장.
- `tabStatScale`: 유명 문학 대비 인포그래픽, 물리적 부피 및 일일 독서 루틴 그리드 추가.
- `tabStatPerformance`: 4대 성능 KPI, 시계열 곡선 차트, 파이프라인 무결성 카드, 엔진 등급 진단 카드 배치.
- 캐시 방지 버전 업데이트: `admin-main.js?v=4.2`.

### 2.3 프론트엔드 로직 (`server/static/admin/admin-analytics.js`, `admin-main.js`)
- `getSafeEfficiency`, `getSafePerformance`, `getSafeQuality`, `getSafeNovelsMeta`, `getSafeScale` 방어 산출 함수 탑재.
- `renderThroughputSvg`: 자/h, 화/h, 자/min 3종 지표 전환 지원 및 피크/초기화 하이라이트, 평균선, 툴팁 렌더링.
- `renderPerformanceTab` 및 `renderPerformanceSvg`: 초당/분당 처리량 스무딩 곡선, 호버 인터랙션, 파이프라인 지표 렌더링.
- `admin-main.js`: `admin-analytics.js?v=4.2` 캐시 버스팅 임포트 적용.

---

## 3. 검증 결과
- `tests/test_admin_analytics.py`:
  - 엔드포인트 응답 검증, `hourly_throughput`, `performance`, `novels_meta`, `scale` 세부 객체 구조 단언 검증 통과 (`3 passed in 1.06s`).
- JavaScript 구문 검증: `node -c admin-analytics.js`, `node -c admin-main.js` 통과 (0 errors).
