# 📋 [기능 구현] 관리자 페이지 검색 시 일치 소설 한정 토글 펼침 및 첫 소설 빠른 이동

> **문서 버전**: 1.0.0  
> **작성 일자**: 2026-10-19  
> **수정 파일**:
> - [`server/static/admin/admin-tree.js`](file:///C:/LANOVEL/server/static/admin/admin-tree.js)
> - [`server/static/admin/admin-main.js`](file:///C:/LANOVEL/server/static/admin/admin-main.js)
> - [`server/static/admin/admin-state.js`](file:///C:/LANOVEL/server/static/admin/admin-state.js)
> - [`server/templates/admin.html`](file:///C:/LANOVEL/server/templates/admin.html)
> - [`server/static/admin.css`](file:///C:/LANOVEL/server/static/admin.css)

---

## 1. 개요 및 변경 배경

기존 관리자 페이지(`/admin`)에서 검색창(`searchBox`)에 검색어를 입력했을 때, 검색 결과 유무와 무관하게 모든 소설 폴더(`history-folder-group`)의 아코디언이 일괄적으로 펼쳐져(`isFolderCollapsed = false`), 결과가 없는 수십 개의 빈 소설 폴더까지 화면을 차지하여 심각한 시각적 노이즈와 스크롤 피로를 유발했습니다.

이를 해결하기 위해:
1. **일치 소설 선별 토글**: 검색된 단락이 존재하는 소설(`totalTranslationsInFolder > 0`)만 토글이 풀리고, 일치 단락이 없는 소설은 접힘(`isFolderCollapsed = true`) 상태를 유지하도록 로직을 수정했습니다.
2. **첫 소설 빠른 이동(Quick Jump)**: 검색 결과가 있는 첫 번째 소설로 즉시 부드럽게 스크롤 점프하고 네온 펄스 애니메이션으로 시각적 위치를 안내하는 `Enter` 키 네비게이션 및 `[↓ 첫 소설]` 퀵 점프 버튼을 신설했습니다.

---

## 2. 세부 변경 사항

### 2.1 아코디언 토글 조건 수정 (`admin-tree.js`)
* **AS-IS**:
  ```javascript
  const isFolderCollapsed = (selectedFolder && selectedFolder !== '__all__') ? false : (Boolean(state.currentSearch) ? false : true);
  ```
  검색어가 입력되면 모든 소설의 `isFolderCollapsed`가 무조건 `false`가 됨.
* **TO-BE**:
  ```javascript
  let isFolderCollapsed = true;
  if (selectedFolder && selectedFolder !== '__all__') {
      isFolderCollapsed = false;
  } else if (state.currentSearch) {
      isFolderCollapsed = (totalTranslationsInFolder === 0);
  } else {
      isFolderCollapsed = true;
  }
  ```
  일치 단락이 1개 이상 있는 소설만 `false`(펼침), 0개인 소설은 `true`(접힘) 유지.

### 2.2 퀵 점프 컨트롤 및 상태 관리 (`admin-tree.js`, `admin-state.js`)
* `state.matchedFolders`, `state.currentMatchFolderIndex` 추가.
* 검색 렌더링 시 매칭된 소설 목록을 수집하여 `updateSearchJumpUI(matchedFolders)` 호출.
* `jumpToMatchingNovel(targetIndex)` 구현:
  - 첫 번째 일치 소설로 `scrollIntoView({ behavior: 'smooth', block: 'start' })`.
  - 해당 소설의 헤더(`.folder-group-header`)에 `jump-highlight` 네온 펄스 애니메이션 부여.
  - 다중 일치 소설 시 `Enter` 누를 때마다 다음 소설로 순환 점프, `Shift+Enter` 시 이전 소설 점프.

### 2.3 검색 입력창 연동 (`admin-main.js`)
* `dom.searchBox`에 `keydown` 이벤트 리스너 추가:
  - `Enter` 입력 시 디바운스 대기를 즉시 완료하고 첫 번째/다음 매칭 소설로 점프.
  - `Shift+Enter` 입력 시 이전 매칭 소설로 점프.
* `dom.jumpFirstNovelBtn` 클릭 시 첫 소설로 점프.

### 2.4 UI 및 CSS 마크업 (`admin.html`, `admin.css`)
* `.search-input-wrapper` 내부에 `#searchJumpControls` (`#searchMatchCountBadge`, `#jumpFirstNovelBtn`) 추가.
* `.search-match-count-badge`, `.btn-jump-novel`, `.jump-highlight` 키프레임 애니메이션 추가.

---

## 3. 검증 결과
* `node -c`를 통해 `admin-state.js`, `admin-tree.js`, `admin-main.js`의 자바스크립트 문법 검사 통과 (오류 0건).
* 전체 pytest 257개 테스트 통과 (`257 passed in 10.67s`).
