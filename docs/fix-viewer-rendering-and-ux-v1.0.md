# 수정: 뷰어 렌더링 버그 및 UX 개선

## 버전

v1.0

## 변경 사항

### 버그 수정

- 뷰어 페이지에서 특정 괄호 `()` 문자가 포함된 번역문을 불러올 때 `undefined`로 표시되던 렌더링 오류를 수정했습니다.
- `viewer.js`의 `escapeHtml` 함수 로직을 더 안정적인 코드로 교체하여 문제를 해결했습니다.

### 기능 개선

- 뷰어 페이지의 내비게이션 UI를 개선했습니다.
- 기존의 하단 버튼 방식 대신, 마우스를 책의 좌우 영역에 올리면 나타나는 화살표 UI를 통해 페이지를 넘길 수 있도록 변경하여 사용성을 높였습니다.

## 변경된 파일

- `server/templates/viewer.html`
- `server/static/viewer.css`
- `server/static/viewer.js`
