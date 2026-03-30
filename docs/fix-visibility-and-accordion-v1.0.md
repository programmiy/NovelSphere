# 가시성 및 아코디언 기본 상태 수정 (v1.0)

## 개요
사용자 피드백에 따라 번역 기록 페이지의 아코디언 그룹 기본 상태와 폴더 기능의 가시성 문제를 해결했습니다.

## 주요 변경 사항

### 1. 번역 기록 토글 기본 상태 변경 (아코디언 그룹 기본 열림)
- `history.js` 파일의 `renderView` 함수에서 아코디언 그룹을 렌더링할 때, `list-group-toggle` 아이콘을 `▼`에서 `▲`로 변경했습니다.
- 이 변경과 기존 CSS (`list-group-content:not(.collapsed) { max-height: 1000px; }`)를 통해 번역 기록 그룹이 기본적으로 열린 상태로 표시되도록 했습니다.

### 2. 폴더 기능 가시성 개선
- `folderFilterDropdown` 및 `moveSelectedToFolderDropdown`과 같은 `.form-select` 요소가 페이지에서 보이지 않던 문제를 해결했습니다.
- `history.html`의 CSS에서 `.form-input, .form-select` 규칙에 다음 속성을 추가했습니다.
    - `background-color: var(--card-bg);`: 배경색을 테마 변수로 설정하여 주변 UI와 더 잘 어울리면서도 명확하게 보이도록 했습니다.
    - `z-index: 10;`: 다른 요소 아래에 렌더링되는 것을 방지하기 위해 높은 `z-index`를 부여했습니다.
    - `position: relative;`: `z-index`가 올바르게 작동하도록 `position` 속성을 설정했습니다.

## 결과
- 번역 기록 그룹이 페이지 로드 시 기본적으로 열린 상태로 표시됩니다.
- 폴더 필터 드롭다운 및 일괄 작업 패널 내 폴더 이동 드롭다운이 페이지에 명확하게 표시됩니다.

이 수정으로 사용자 경험이 더욱 향상되었습니다.