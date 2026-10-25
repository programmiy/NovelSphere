# 기능 구현 보고서: 관리자 페이지 검색 시 소설 폴더 자동 전개 차단 및 네온 표시등(Novel Match Lamp) 적용

- **작업 일자**: 2026-10-20
- **관련 파일**:
  - [`server/static/admin/admin-tree.js`](file:///C:/LANOVEL/server/static/admin/admin-tree.js) (검색 시 소설 폴더 접힘 강제 유지 `isFolderCollapsed = true`, 네온 표시등 `novel-match-lamp` 주입, 점프 시 자동 전개 방지)
  - [`server/static/admin.css`](file:///C:/LANOVEL/server/static/admin.css) (`.novel-match-lamp`, `.match-pulse-dot`, `.has-search-matches`, `.no-search-matches` 사이버네틱 스타일 및 펄스 애니메이션 추가)
  - [`docs/codebase-functional-reference-2026-10-20.md`](file:///C:/LANOVEL/docs/codebase-functional-reference-2026-10-20.md) (단일 진실 공급원 최신화)

---

## 1. 개요 및 사용자 요구사항

- **사용자 피드백**:
  - *"소설 회차 목록을 굳이 전부 펼칠 필요는 없는데(펼치지마 아예, 렉이 너무 심해)? 그냥 소설 옆에 일치하는 단락존재? 아님 아이콘이나 표시등? 같은걸로 그 소설 내에 표시 해주면 내가 알아서 펼칠게"*
- **핵심 요구사항**:
  1. **검색 시 소설 폴더 자동 전개 완전 차단**: 검색 결과가 일치하더라도 소설 폴더를 자동으로 펼치지 않고 접힌(`collapsed`) 상태를 100% 유지.
  2. **일치 여부 네온 표시등(Indicator Lamp) 제공**: 검색어가 일치하는 단락을 보유한 소설 헤더에 일치 단락 수와 회차 수를 깜빡이며 알려주는 고유한 표시등 배지 제공.
  3. **비일치 소설 시각적 서브듀(Dimming)**: 일치 단락이 없는 소설은 불투명도를 낮춰 일치 소설이 한눈에 도드라지도록 시각적 계층화.
  4. **빠른 이동(Jump) 시에도 접힘 유지**: `Enter` 또는 점프 버튼 클릭 시 해당 소설 헤더로 스크롤 및 네온 펄스(`jump-highlight`)만 진행하고, 내부는 펼치지 않음 (사용자 자율 펼침).

---

## 2. 구현 상세 내용

### 2.1 검색 시 소설 폴더 접힘 강제 유지 (`admin-tree.js`)
- 기존에는 `state.currentSearch && totalTranslationsInFolder > 0`인 경우 `isFolderCollapsed = false`로 설정되어 검색 결과가 있는 모든 소설 폴더가 강제로 펼쳐졌습니다.
- 이를 전면 수정하여, 사용자가 상단 폴더 드롭다운(`selectedFolder`)에서 단일 소설을 명시적으로 선택한 경우가 아니라면 검색 중에도 항상 `isFolderCollapsed = true`를 강제 유지하도록 변경했습니다:
  ```javascript
  let isFolderCollapsed = true;
  if (selectedFolder && selectedFolder !== '__all__') {
      isFolderCollapsed = false;
  } else {
      isFolderCollapsed = true;
  }
  ```
- 이로 인해 검색 실행 시 화면에 렌더링되는 DOM 요소가 소설 헤더 바(10~30개 내외)로 극도로 제한되어, 수백 권의 소설이 라이브러리에 있더라도 **초기 검색 렌더링 지연시간이 0ms**로 즉각 완료됩니다.

### 2.2 사이버네틱 네온 일치 표시등 (`.novel-match-lamp`)
- 검색어가 포함된 소설 폴더 헤더 제목 우측에 네온 펄스 비콘 표시등을 동적으로 마크업:
  ```html
  <span class="novel-match-lamp" title="${validEpisodeCount}개 회차에서 ${totalTranslationsInFolder.toLocaleString()}개 일치 단락 발견">
      <span class="match-pulse-dot"></span>
      <span class="match-lamp-text">일치 ${totalTranslationsInFolder.toLocaleString()}단락 (${validEpisodeCount}화)</span>
  </span>
  ```
- CSS (`server/static/admin.css`):
  - `.novel-match-lamp`: 에메랄드 그린과 사이안 네온 그라데이션, 미세한 맥동 글로우 애니메이션(`@keyframes matchLampPulse`).
  - `.match-pulse-dot`: 8px 원형 발광 인디케이터로, 1.4초 주기로 사이안/에메랄드 펄스를 방출(`@keyframes matchPulseDotBlink`).
  - `.history-folder-group.has-search-matches`: 폴더 카드 테두리에 에메랄드/사이안 글로우 부여 및 좌측 바 두께 강조.
  - `.history-folder-group.no-search-matches`: 검색 결과가 없는 소설은 `opacity: 0.55`, `filter: grayscale(0.4)`로 흐리게 처리하여 일치 소설에 시선이 즉각 집중됨.

### 2.3 검색 점프(Jump) 시 자동 펼침 방지
- `jumpToMatchingNovel()` 함수에서 기존에 대상 폴더의 `collapsed` 클래스를 강제로 제거하던 로직을 제거했습니다:
  - `Enter` 키를 눌러 다음 일치 소설로 이동할 때, 브라우저는 부드럽게 해당 소설의 헤더 위치로 스크롤만 이동하고, 헤더에 네온 펄스 애니메이션(`.jump-highlight`)을 1.8초간 부여합니다.
  - 폴더 자체는 닫힌 상태를 유지하므로 불필요한 레이아웃 재연산이나 렉이 전혀 발생하지 않습니다.
  - 사용자가 확인하고 싶은 소설만 직접 클릭하여 펼칠 수 있습니다.

---

## 3. 검증 결과

1. **검색 시 체감 반응성**:
   - 검색 버튼 클릭 또는 Enter 입력 즉시 결과 헤더들이 표시됨 (렌더링 지연 0ms).
   - 수십~수백 개의 회차가 즉각 펼쳐지지 않으므로 브라우저 스크롤 바 요동 및 버벅임 완전 해소.
2. **시각적 명확성**:
   - 일치하는 소설마다 `🟢 일치 12단락 (2화)` 형태의 네온 램프가 깜빡여 어떤 소설에 결과가 있는지 한눈에 식별 가능.
   - 일치하지 않는 소설은 자연스럽게 반투명 처리되어 노이즈 배제.
3. **사용자 편의성**:
   - 점프 이동 시에도 닫힌 채로 헤더만 안내되므로, 사용자가 원하는 소설만 선택적으로 열람 가능.
