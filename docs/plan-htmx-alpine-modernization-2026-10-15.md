# 📋 [작업 계획서] 웹 프론트엔드 모듈화 및 슬림화 (HTMX 폐기 ➔ ES Module 분리 & Alpine.js 선별 도입)

> **문서 버전**: 2.0.0 (HTMX 전면 폐기 & 네이티브 ES Modules 분리 & Alpine.js 선별 적용)  
> **작성 일자**: 2026-10-15  
> **대상 디렉토리**: [`server/static/`](file:///C:/LANOVEL/server/static), [`server/templates/`](file:///C:/LANOVEL/server/templates)  
> **목적**: 4,648줄(211KB)의 [`server/static/admin.js`](file:///C:/LANOVEL/server/static/admin.js)를 브라우저 네이티브 ES Modules로 기능별 분할하고, 모달/탭 상태 제어에 Alpine.js를 선별 도입하여 빌드 도구 없이 프론트엔드 유지보수성을 극대화합니다.

---

## 1. 아키텍처 재검토: 왜 HTMX는 이 프로젝트에서 악수(Bad Move)인가?

1. **백엔드 라우터의 이중 관리 지옥 방지 (단일 JSON API 보존)**:
   * LANOVEL은 **Flutter 모바일 앱([`mobile_app`](file:///C:/LANOVEL/mobile_app))과 크롬 확장([`extension`](file:///C:/LANOVEL/extension))이 동일한 백엔드 API를 공유**합니다.
   * HTMX를 도입하면 모바일용 JSON 엔드포인트와 웹용 HTML 조각(TemplateResponse) 엔드포인트를 이중으로 유지보수해야 하므로 라우터가 2배로 비대해집니다.
2. **틴더형 카드 스와이프([`ai_review`](file:///C:/LANOVEL/server/templates/ai_review.html))의 즉각적 반응성(Optimistic UI) 보존**:
   * 현재 `ai_review`는 큐 데이터를 메모리에 미리 배열로 캐싱하여 **단축키나 스와이프 시 0ms로 즉시 다음 카드를 전환**하고 비동기 백그라운드 저장을 수행합니다.
   * HTMX 서버 렌더링으로 매 카드마다 왕복하면 50~200ms 지연이 발생하여 빠른 연속 검수가 불가능해집니다.
3. **`admin.js`의 실제 비대화 원인**:
   * 단순 `fetch` 때문이 아니라, **SVG 차트 좌표 계산(일일 트렌드/히트맵/도넛), 텍스트 드래그 선택 영역 감지, 3단계 폴더-회차-문단 트리 상태 관리, 체크박스 일괄 선택** 등 순수 클라이언트 로직이 대부분입니다. 이는 어차피 HTMX로 대체할 수 없습니다.
4. **스팀펑크 FX 및 이벤트 리스너 파괴 방지**:
   * [`admin-fx.js`](file:///C:/LANOVEL/server/static/admin-fx.js)와 [`steampunk-sound.js`](file:///C:/LANOVEL/server/static/steampunk-sound.js)는 DOM 요소에 직접 효과음과 파티클 이벤트를 바인딩합니다. HTMX가 DOM을 통째로 교체하면 이벤트 리스너가 유실되어 매번 재바인딩하는 보일러플레이트가 발생합니다.

---

## 2. 채택 아키텍처: No-Build Native ES Modules + Alpine.js

별도의 번들러(Node, Vite, Webpack) 없이, **현대 브라우저가 기본 지원하는 `<script type="module">`과 경량 Alpine.js**만 활용합니다.

```
[ 기존 FastAPI 백엔드 ]
       │ 100% 순수 JSON API 유지 (모바일 / 웹 / 확장 단일 진실 공급원)
       ▼
[ server/templates/admin.html ]
       │ <script type="module" src="/static/admin/admin-main.js">
       ▼
[ server/static/admin/ (ES Modules) ]
       ├── admin-state.js       (전역 상태, 정규식, DOM 캐시)
       ├── admin-analytics.js   (SVG 차트 좌표 계산, 히트맵, 쿼터 요약)
       ├── admin-tree.js        (3단계 폴더-회차-문단 트리 렌더링, 체크박스)
       ├── admin-dock.js        (텍스트 드래그 감지, 유사 번역 슬라이딩 도크)
       ├── admin-restore.js     (복원 센터 모달: 알림, 휴지통, 화이트리스트)
       └── admin-main.js        (진입점: 이벤트 위임 및 오케스트레이션)
```

* **Alpine.js의 역할**: 백엔드 통신 방식을 바꾸지 않고, **모달 창 여닫기(`x-show`), 탭 전환(`currentTab`), 드롭다운 토글**에만 선언적으로 적용하여 수백 줄의 수동 DOM 숨김/표시 코드 제거.

---

## 3. 새 세션 실행 단계별 체크리스트 (Step-by-Step Tasks)

### [Task 1] `admin.js` 모듈 디렉토리 구성 및 상태 분리
* [ ] `server/static/admin/` 디렉토리 신설.
* [ ] [`admin-state.js`](file:///C:/LANOVEL/server/static/admin/admin-state.js):
  * `groupedTranslations`, `allFolders`, `selectedIds`, `translationStatuses` 등 전역 상태 및 상수를 export.
  * 이벤트 버스 또는 상태 갱신 함수 제공.

### [Task 2] SVG 차트 & 통계 모듈 분리 ([`admin-analytics.js`](file:///C:/LANOVEL/server/static/admin/admin-analytics.js))
* [ ] `admin.js`에서 가장 긴 순수 연산 로직인 SVG 렌더링 분리:
  * `renderDailyTrendSvg(dailyStats)`: 폴리라인 좌표 및 툴팁 계산.
  * `renderHourlyHeatmap(hourlyStats)`: 24시간 히트맵 그리드 렌더러.
  * `renderModelRatioDonut(modelStats)`: Gemini 모델 사용 비율 도넛 SVG.
* [ ] DOM 요소 의존성을 인자로 주입받는 순수 렌더 함수로 캡슐화.

### [Task 3] 유사 번역 도크 & 드래그 선택 모듈 분리 ([`admin-dock.js`](file:///C:/LANOVEL/server/static/admin/admin-dock.js))
* [ ] `selectionchange` 및 마우스 드래그 이벤트 감지 로직 분리.
* [ ] 하단 슬라이딩 도크(`similarRecommendPanel`) 열기/닫기/토글 및 사전(네이버/Jisho/Weblio) 팝업 링크 바인딩 로직 모듈화.

### [Task 4] 3단계 트리 & 복원 센터 분리
* [ ] [`admin-tree.js`](file:///C:/LANOVEL/server/static/admin/admin-tree.js):
  * 폴더 ➔ 회차 ➔ 문단 렌더링 및 SortableJS 드래그 앤 드롭 인스턴스 관리.
  * 체크박스 일괄 선택(`selectAll`), 개별 선택, 일괄 치환/삭제 액션.
* [ ] [`admin-restore.js`](file:///C:/LANOVEL/server/static/admin/admin-restore.js):
  * 복원 센터(알림 내역, 휴지통 복구, 이상 번역 화이트리스트) 데이터 로드 및 렌더러.

### [Task 5] `admin-main.js` 진입점 연결 및 Alpine.js 적용
* [ ] [`admin-main.js`](file:///C:/LANOVEL/server/static/admin/admin-main.js):
  * 각 하위 모듈(`analytics`, `tree`, `dock`, `restore`)을 import하여 `DOMContentLoaded`에서 단일 초기화.
* [ ] [`server/static/vendor/alpine.min.js`](file:///C:/LANOVEL/server/static/vendor/alpine.min.js) 추가:
  * `admin.html`의 복원 센터 모달, 일괄 치환 모달에 `x-data="{ open: false }"` 선언적 바인딩 적용.
* [ ] [`server/templates/admin.html`](file:///C:/LANOVEL/server/templates/admin.html)의 스크립트 태그를 모듈 방식으로 변경:
  ```html
  <script type="module" src="{{ url_for('static', path='admin/admin-main.js') }}"></script>
  ```

---

## 4. 검증 및 테스트 방법 (Verification)

1. **브라우저 콘솔 무오류 검증**:
   * 브라우저에서 `/admin` 접속 후 개발자 도구(F12) Console에서 ES Module 임포트 404 또는 문법 에러 0건 확인.
2. **핵심 인터랙션 기능 보존 검증**:
   * **차트**: 일일 트렌드 SVG 폴리라인 및 호버 툴팁 정상 렌더링 확인.
   * **트리**: 폴더 및 회차 아코디언 토글, 문장 일괄 체크박스 선택 정상 동작.
   * **도크**: 본문 텍스트 드래그 시 하단 유사 번역 도크 자동 팝업 확인.
   * **FX/사운드**: 스팀펑크 기어 회전 및 버튼 클릭 사운드 효과음 누락 없이 작동 확인.
3. **모바일 앱 & 확장 프로그램 영향도 검증**:
   * 백엔드 API를 단 1줄도 변경하지 않았으므로, 모바일 앱 동기화(`/sync`) 및 확장 통신 정상 동작 확인.

---

## 5. 롤백 및 안전장치 (Safety & Rollback)

* 기존 단일 파일 [`server/static/admin.js`](file:///C:/LANOVEL/server/static/admin.js)는 `server/static/admin.js.bak`으로 보존합니다.
* 비상 시 `admin.html`의 스크립트 태그를 다시 `<script src="admin.js"></script>`로 변경하는 즉시 1초 만에 원복할 수 있습니다.
