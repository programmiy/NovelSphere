# Fix: admin.js ReferenceError

- **날짜:** 2025-11-06
- **작성자:** Gemini

## 변경 사항

`admin.js` 파일에서 `autoStartCheckbox`와 `enableDragDropCheckbox` 변수가 선언되지 않은 상태에서 사용되어 발생하는 `ReferenceError`를 수정했습니다.

### 수정 내용

- 파일 상단의 변수 선언문에 누락되었던 `autoStartCheckbox`와 `enableDragDropCheckbox`를 추가하여 정상적으로 참조할 수 있도록 수정했습니다.
