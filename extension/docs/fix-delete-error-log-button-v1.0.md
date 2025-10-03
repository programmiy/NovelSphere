# API 오류 로그 삭제 버튼 작동 오류 수정 (v1.0)

## 변경 사항 요약
번역 기록 페이지의 API 오류 로그 섹션에 있는 "로그 삭제" 버튼이 작동하지 않던 버그를 수정했습니다.

## 상세 내용
이전 구현에서는 `deleteErrorLogBtn`에 대한 클릭 이벤트 리스너가 `historyContainer`의 일반 클릭 이벤트 위임 로직 내에 포함되어 있었습니다. 하지만 `deleteErrorLogBtn`은 `historyContainer`의 자손이 아닌 형제 요소인 `errorLogContainer` 내부에 있었기 때문에, `historyContainer`의 이벤트 리스너가 해당 클릭 이벤트를 감지하지 못했습니다.

이 문제를 해결하기 위해 `history.js`의 `DOMContentLoaded` 이벤트 리스너 내에서 `deleteErrorLogBtn`에 대한 직접적인 클릭 이벤트 리스너를 추가했습니다. 이제 버튼 클릭 시 `chrome.storage.local`에서 `error_log`를 성공적으로 제거하고, `errorLogContainer`를 숨겨 UI에서 오류 로그를 제거합니다.

### 변경된 파일
- `history.js`
- `docs/fix-delete-error-log-button-v1.0.md` (새 문서)

### 주요 변경 로직
- `history.js`:
    - `historyContainer`의 클릭 이벤트 리스너에서 `deleteErrorLogBtn` 관련 로직 제거.
    - `DOMContentLoaded` 블록 내에서 `deleteErrorLogBtn`에 대한 직접 클릭 이벤트 리스너 추가.
    - 오류 로그 삭제 시 `errorLogContainer`를 `remove()` 대신 `style.display = 'none'`으로 숨기도록 변경하여 더 안전하게 처리.

## 사용 방법
API 오류 로그가 표시될 때 "로그 삭제" 버튼을 클릭하면 오류 로그가 삭제되고 UI에서 사라집니다.
