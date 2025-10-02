# 번역 기록 텍스트 잘림 현상 수정 (v1.1)

## 문제점
번역 기록 페이지(`history.html`)에서 각 번역 기록의 텍스트 내용이 길 경우, 텍스트가 잘려서 전체 내용을 확인하기 어려운 문제가 있었습니다. 이전 수정(v1.0)에서 개별 텍스트 블록의 줄바꿈을 허용했지만, URL 그룹 컨테이너의 `max-height` 제한으로 인해 여전히 내용이 완전히 표시되지 않는 경우가 발생했습니다.

## 수정 내용
`history.html` 파일의 CSS에서 `.list-group-content:not(.collapsed)` 선택자에 적용된 `max-height: 1000px;` 속성을 `max-height: none;`으로 변경했습니다. 이 변경으로 인해 URL 그룹 컨테이너가 펼쳐졌을 때 높이 제한이 사라져, 모든 번역 기록 내용이 잘림 없이 표시될 수 있도록 했습니다.

## 변경 전
```css
.list-group-content:not(.collapsed) { max-height: 1000px; /* 충분히 큰 값으로 설정 */ }
```

## 변경 후
```css
.list-group-content:not(.collapsed) { max-height: none; /* 충분히 큰 값으로 설정 */ }
```

## 영향
이 변경으로 인해 번역 기록 페이지에서 긴 번역 텍스트를 포함하는 URL 그룹 컨테이너가 높이 제한 없이 모든 내용을 표시하게 됩니다. UI 레이아웃은 텍스트 길이에 따라 동적으로 조정됩니다.
