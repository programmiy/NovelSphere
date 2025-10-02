# DOM 요소 누락 및 콘텐츠 잘림 버그 수정 (v1.0)

## 변경 사항 요약
`history.js`의 `loadAndRender` 함수에서 발생하는 "필수 DOM 요소를 찾을 수 없습니다" 오류와 번역 기록 콘텐츠가 일정 개수 이후로 잘려 보이는 버그를 수정했습니다. 또한, `progress-container` 요소가 HTML에 없어 진행 상태 메시지가 표시되지 않던 문제를 해결했습니다.

## 상세 내용
### 1. `loadAndRender` DOM 요소 누락 오류 수정
`history.js`의 `loadAndRender` 함수는 `loadingSkeleton` 요소를 참조하기 전에 `historyContainer.innerHTML = '';`를 통해 `historyContainer`의 내용을 지우고 있었습니다. `loadingSkeleton`이 `historyContainer`의 자식 요소였기 때문에, `historyContainer`가 지워지면서 `loadingSkeleton`도 DOM에서 제거되어 `ReferenceError`가 발생했습니다.

이 문제를 해결하기 위해 `history.html`에서 `<div id="loading-skeleton">`을 `<div id="history-container">`의 외부, 즉 형제 요소로 이동시켰습니다. 이로써 `historyContainer`가 초기화될 때 `loadingSkeleton`이 DOM에서 제거되지 않도록 보장하여 오류를 해결했습니다.

### 2. 번역 기록 콘텐츠 잘림 버그 수정
일부 번역 기록 탭에서 콘텐츠가 일정 개수 이후로 잘려 보이는 문제는 `.list-group-content:not(.collapsed)` CSS 규칙에 설정된 `max-height`가 실제 콘텐츠 길이에 비해 부족했기 때문입니다.

이 문제를 해결하기 위해 `history.html`에서 해당 CSS 규칙의 `max-height` 값을 `none`으로 변경했습니다. 이로써 콘텐츠가 잘림 없이 정상적으로 표시될 수 있도록 했습니다.

### 3. `progress-container` 누락 문제 해결
`history.js`에서 `progressContainer`를 참조하고 있었으나, `history.html`에 해당 HTML 요소가 없어 진행 상태 메시지가 표시되지 않았습니다. `history.html`에 `<div id="progress-container">` 요소를 추가하여 이 문제를 해결했습니다.

### 변경된 파일
- `history.html`
- `docs/fix-dom-and-content-display-v1.0.md` (문서 업데이트)

### 주요 변경 로직
- `history.html`:
    - `<div id="loading-skeleton">`을 `<div id="history-container">`의 형제 요소로 이동.
    - `.list-group-content:not(.collapsed)`의 `max-height`를 `none`으로 변경.
    - `<div id="progress-container">` HTML 요소 추가.

## 사용 방법
이제 번역 기록 페이지에서 DOM 요소 관련 오류 없이 모든 번역 기록 콘텐츠가 정상적으로 표시되며, 진행 상태 메시지도 올바르게 나타납니다.