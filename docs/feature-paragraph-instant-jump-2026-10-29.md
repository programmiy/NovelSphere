# [기능 명세서] 단락별 1-클릭 원본 순간이동 및 상호작용 동기화 시스템

**문서 작성일**: 2026-10-29  
**대상 모듈**:
* 크롬 확장 프로그램: `extension/src/core/dom_applier.ts`, `extension/src/core/page_translator.ts`, `extension/src/content.ts`
* 웹 관리자 UI: `server/static/admin/admin-tree.js`, `server/static/admin/admin-drawer.js`, `server/static/admin/admin-restore.js`
* 4종 검수 시스템:
  * AI 번역 검수: `server/templates/ai_review.html`
  * AI 재재번역 센터: `server/routers/ai_review.py`, `server/templates/ai_reretranslate.html`
  * 인명·용어 교정기: `server/templates/db_editor.html`
  * 특별 적재 검수: `server/templates/special_batch.html`

---

## 1. 개요 및 배경

관리자 페이지(`admin.html`) 및 4종의 검수 시스템(`ai_review`, `ai_reretranslate`, `db_editor`, `special_batch`)에서 번역 문장을 검토할 때, 특정 단락의 원작 웹소설 문맥을 즉각 확인해야 하는 경우가 빈번합니다.
기존에는 회차 전체 페이지만 열리거나 수동으로 스크롤을 찾아야 했으나, 본 기능을 통해 **각 단락마다 배치된 1-클릭 `[🔗 원본 ↗]` 버튼**을 누르는 즉시 해당 원본 소설 단락으로 순간이동하고, 마치 소설 본문에서 해당 단락을 직접 누른 것과 같은 시각적·기능적 상호작용(펄스 발광 + 사이드바 동기화)을 완벽하게 재현하도록 개선했습니다.

---

## 2. 주요 구현 상세

### 2.1 크롬 확장 프로그램 (`extension/`)
* **`jumpToParagraph(rawPid: string)` 코어 엔진 구현 (`dom_applier.ts`)**:
  * URL 해시(`#L15`, `#p15`, raw PID)를 파싱하여 플랫폼별(Syosetu, Kakuyomu 등) DOM ID와 정밀 매핑.
  * 해당 단락으로 부드럽게 중앙 정렬 스크롤 (`scrollIntoView({ behavior: 'smooth', block: 'center' })`).
  * 펄스 발광 애니메이션 (`lanovel-highlight-pulse`, 1.6초) 부여.
* **화면 비율 65% 동적 사이드바 제어**:
  * `window.innerWidth / screen.availWidth >= 0.65` 계산:
    * **65% 이상**: LANOVEL 번역 사이드바 자동 오픈(`showSidebar()`) + 사이드바 내 해당 번역 행 스크롤 및 포커스 발광(`lanovel-row-highlight`)까지 완전 동기화.
    * **65% 미만 (화면 분할 등 좁은 뷰)**: 사이드바를 열지 않고 본문 공간을 보존하며 단락 스크롤 및 펄스 하이라이트만 실행.
* **단일 탭 재사용 및 `hashchange` 실시간 반응 (`content.ts`)**:
  * `target="lanovel_novel_reader"`로 열릴 때 탭이 무한정 증식하지 않고 기존 열려 있는 소설 리더 탭을 재사용.
  * 탭 전환 시 새로고침 없이 즉각 이동할 수 있도록 `window.addEventListener('hashchange', ...)` 리스너 등록.

### 2.2 관리자 페이지 (`server/static/admin/`)
* **`admin-tree.js`**:
  * `renderItem(t, groupUrl)`: 각 단락 행의 '원문 복사' 옆에 `[🔗 원본 ↗]` 링크 버튼 추가.
  * 단락의 `[PID 배지]` 또한 클릭 시 해당 단락으로 즉시 이동하도록 링크 스타일 적용.
  * 회차 헤더의 `[🔗 원본 ↗]` 버튼 타깃을 `target="lanovel_novel_reader"`로 일원화.
* **`admin-drawer.js` / `admin-restore.js`**:
  * 미분류 서랍 및 복구 검수 링크의 타깃을 일관되게 `lanovel_novel_reader`로 동기화.

### 2.3 4종 검수 시스템 연동
1. **AI 번역 검수 (`ai_review.html`)**:
   * 상단 메인 툴바의 `[🔗 원본]` 버튼을 `${item.url}#${item.pid}` 및 `target="lanovel_novel_reader"`로 갱신.
   * 전후 맥락 패널(`urlWithPid`) 및 유사 번역 목록(`targetUrl`)의 링크도 해당 PID 앵커로 정규화.
2. **AI 재재번역 센터 (`server/routers/ai_review.py`, `ai_reretranslate.html`)**:
   * 백엔드 API(`/api/ai_review/reretranslate/queue`)에서 `url`과 `pid`를 반환하도록 모델 직렬화 보강.
   * 각 모델 서랍의 `sentence-row` 우측 액션에 `[🔗 원본 ↗]` 버튼 추가.
3. **인명·용어 교정기 (`db_editor.html`)**:
   * 틴더st 카드 헤더의 회차 제목 옆에 `[🔗 원본 ↗]` 버튼(`cardExtLink`) 배치.
   * 일괄 리스트 모드의 회차명 셀에도 `[🔗 원본 ↗]` 버튼 배치.
4. **특별 적재 검수 (`special_batch.html`)**:
   * 카드 상단 메타 바의 PID 옆에 `[🔗 원본 ↗]` 버튼(`cardSpecialExtLink`) 배치.

---

## 3. 검증 및 빌드 결과

* `npm run build`: `content.js` (239.2kb), `background.js` (24.4kb) 22ms 빌드 완료.
* `npm run typecheck`: TypeScript 정적 타입 검사 무결점 통과 (0 errors).
* Python 백엔드 구문 검사(`py_compile`): 오류 없음.
