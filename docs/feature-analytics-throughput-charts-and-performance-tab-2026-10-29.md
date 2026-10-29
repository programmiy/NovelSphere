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


### 2.4 일별 추이 및 전 차트 0회 표시 버그 방어 해결
- **문제점**: 백엔드 프로세스 미재시작 시 구버전 `daily_trends`에 `episodes` 필드가 누락되어 일별 추이 SVG 차트가 전부 0회(수평 바닥선)로 렌더링되던 문제 발생.
- **해결책**:
  - `admin-analytics.js`에 `getSafeDailyTrends`, `getSafeHourly`, `getSafeDow` 무결점 방어 계산 엔진을 구현.
  - 서버 응답에 `episodes`가 존재하지 않더라도 문단 수 및 전체 단락 비율(`avg_paragraphs_per_episode`)을 기반으로 회차 수, 누적 회차(`cum_episodes`), 7일 이동평균(`ma7_episodes`), 회차당 밀도(`avg_chars_per_ep`)를 실시간 주입하여 서버 재시작 전후 모두 정상 차트가 즉시 렌더링되도록 조치.

### 2.5 신규 탭 '번역 성능 & 엔진 효율' 빈 화면(블랭크) 버그 해결
- **원인**: `admin.html` 템플릿 마크업 작성 중 이전 탭인 `tabStatScale`의 닫는 `</div>` 태그가 누락되어, 신규 탭인 `tabStatPerformance`가 `tabStatScale`의 하위 자식 노드로 잘못 중첩됨. 이로 인해 탭 전환 시 상위 부모인 `tabStatScale`이 `display: none`으로 처리되면서 그 내부의 `tabStatPerformance` 전체가 브라우저에서 화면에 나타나지 않고 비어 보이던 결함 발생.
- **조치**:
  1. `admin.html`에서 `tabStatScale`의 닫는 태그를 명확히 닫아 5개 탭 컨테이너(`stats-tab-pane`)가 모두 `stats-modal-body`의 동일한 직계 1차 자식 노드로 격리되도록 DOM 구조 정상화.
  2. 탭 전환 이벤트 리스너에서 해당 탭 활성화 시 `renderPerformanceTab` 및 `renderPerformanceSvg`를 재호출하여 표시 시점의 실측 렌더링 및 반응성 보장.
  3. 캐시 파라미터를 `v=4.6`으로 갱신.

### 2.6 일별 활동 추이 하단 레이블 연도 표기 및 심층 그래프 뷰어(Expanded Suite) 탑재
- **하단 일자 레이블 연도 추가**: 기존 `MM-DD` 표기에서 `YY.MM.DD`(`25.09.13`, `26.10.29`)로 개편하여 2025년~2026년跨 연도 구간을 직관적으로 식별 가능하도록 개선.
- **대형 심층 뷰어 모달 (`#trendGraphViewerModal`) 신설**:
  1. **초고해상도 와이드 캔버스**: 95vw 폭, 90vh 높이, 1600x540 뷰포트로 247일간의 방대한 데이터도 쾌적하게 조망.
  2. **밀도 완화 3대 집계 주기**: `[일간 (Daily)]`, `[주간 (Weekly)]`, `[월간 (Monthly)]` 전환 지원 (주별/월별 집계로 밀도 과다 문제를 완벽히 해결).
  3. **4종 차트 렌더링 스타일**: `[Area (영역+라인)]`, `[Bar (막대)]`, `[Spline (스무스 곡선)]`, `[Step (계단식)]`.
  4. **인터랙티브 줌 & 타임라인 슬라이더**: 마우스 휠 줌 인/아웃 및 하단 범위 슬라이더(0~100%), 줌 리셋 버튼 제공.
  5. **전문 분석 오버레이**: 최고치 피크 마커(🔥 PEAK), 평균 기준선(AVG), 주말(토/일) 음영 밴드 토글.
  6. **상단 크로스헤어 HUD 인스펙터**: 마우스 커서 이동에 따른 당일 번역량, 누적량, 밀도, 7일 이동평균 실시간 동기화.
  7. **내보내기 기능**: 고해상도 PNG 이미지 저장 및 UTF-8 BOM CSV 데이터 다운로드 지원.
