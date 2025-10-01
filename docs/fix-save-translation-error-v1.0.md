# 번역 수정 기능 오류 해결 v1.0

## 변경 사항

- `history.js`에서 번역 기록 수정 시 `saveEditedTranslation is not defined` 오류가 발생하는 문제를 해결했습니다.
- 누락되었던 `openEditModal` 함수와 `saveEditedTranslation` 함수를 구현하고 추가했습니다.
  - `openEditModal`: 수정 버튼 클릭 시, 해당 번역 내용을 담은 수정 모달을 엽니다.
  - `saveEditedTranslation`: 모달에서 '저장' 버튼 클릭 시, 수정된 번역 내용을 `chrome.storage`에 저장합니다.

## 영향

- 이제 번역 기록 페이지에서 각 항목의 '수정' 버튼이 정상적으로 동작합니다.
- 사용자는 기존 번역 내용을 수정하고 저장할 수 있습니다.