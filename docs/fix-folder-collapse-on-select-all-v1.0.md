# 폴더 탭 전체 선택 시 접힘 동작 방지 (v1.0)

## 변경 사항 요약
번역 기록 페이지의 폴더 탭에서 "전체 선택" 체크박스를 클릭할 때 폴더가 접히거나 펼쳐지는 동작을 방지하도록 수정했습니다.

## 상세 내용
이전 구현에서는 "전체 선택" 체크박스가 `folder-group-header` 내부에 위치해 있었기 때문에, 체크박스를 클릭하면 이벤트 버블링으로 인해 `folder-group-header`의 클릭 이벤트 리스너가 트리거되어 폴더가 접히거나 펼쳐지는 문제가 있었습니다.

이 문제를 해결하기 위해 `history.js`의 `historyContainer`에 위임된 클릭 이벤트 리스너 내에서, 클릭된 요소가 `folder-select-all-checkbox`인 경우 `event.stopPropagation()`을 호출하도록 로직을 추가했습니다. 이로써 체크박스 클릭 이벤트가 `folder-group-header`까지 전파되는 것을 막아, 폴더의 접힘/펼침 동작을 방지합니다.

### 변경된 파일
- `history.js`
- `docs/fix-folder-collapse-on-select-all-v1.0.md` (새 문서)

### 주요 변경 로직
- `history.js`: `historyContainer`의 클릭 이벤트 리스너 내에서 `folder-select-all-checkbox` 클릭 시 `event.stopPropagation()` 호출 로직 추가.

## 사용 방법
폴더 탭에서 "전체 선택" 체크박스를 클릭해도 폴더가 접히거나 펼쳐지지 않습니다.
