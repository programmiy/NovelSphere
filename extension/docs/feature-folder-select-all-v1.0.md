# 폴더 탭 전체 선택 기능 추가 및 UI 개선 (v1.0)

## 변경 사항 요약
번역 기록 페이지의 폴더 탭에 "전체 선택" 기능을 추가하고, 해당 버튼을 폴더 이름의 오른쪽에 정렬하여 UI를 개선했습니다. 이제 사용자는 특정 폴더 내의 모든 번역 기록을 한 번의 클릭으로 선택하거나 선택 해제할 수 있으며, UI 가독성도 향상되었습니다.

## 상세 내용
`history.js` 파일에 `folder-select-all-checkbox`에 대한 이벤트 리스너를 추가했습니다. 이 체크박스가 변경될 때, 해당 폴더 그룹(`history-folder-group`) 내의 모든 개별 번역 기록 체크박스(`item-checkbox`)의 상태를 동기화합니다.

UI 정렬을 위해 다음과 같은 변경 사항이 적용되었습니다:
- `history.html`의 `.folder-group-title` CSS 규칙에 `flex-grow: 1;`을 추가하여 폴더 제목이 사용 가능한 모든 공간을 차지하도록 했습니다.
- `history.js`에서 동적으로 생성되는 폴더 그룹의 "전체 선택" 체크박스를 포함하는 `<label>` 태그에서 `style="margin-left: auto;"` 인라인 스타일을 제거했습니다.

이러한 변경을 통해 폴더 이름은 왼쪽 정렬되고, "전체 선택" 버튼은 폴더 헤더의 가장 오른쪽에 위치하게 됩니다.

### 변경된 파일
- `history.js`
- `history.html`
- `docs/feature-folder-select-all-v1.0.md` (문서 업데이트)

### 주요 변경 로직
- `historyContainer`의 `change` 이벤트 리스너에 `folder-select-all-checkbox`를 처리하는 로직 추가.
- 체크박스 상태에 따라 해당 폴더 내의 모든 `item-checkbox`의 `checked` 속성 업데이트.
- `updateBulkActionPanel()` 호출을 통해 대량 작업 패널의 상태를 최신화.
- `history.html`의 `.folder-group-title`에 `flex-grow: 1;` CSS 속성 추가.
- `history.js` 내에서 동적으로 생성되는 폴더 그룹의 "전체 선택" `<label>`에서 `margin-left: auto` 인라인 스타일 제거.

## 사용 방법
1. 번역 기록 페이지로 이동합니다.
2. 폴더 탭에서 특정 폴더 옆에 있는 "전체 선택" 체크박스를 클릭합니다.
3. 해당 폴더 내의 모든 번역 기록이 선택되거나 선택 해제됩니다.
4. "전체 선택" 버튼이 폴더 제목의 오른쪽에 정렬되어 표시됩니다.
