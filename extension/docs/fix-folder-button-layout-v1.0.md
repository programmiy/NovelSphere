# 기능: 폴더 전체 선택 버튼 레이아웃 수정 (v1.0)

## 변경 사항

- 이전 레이아웃 수정으로 인해 사라졌던 '폴더 전체 선택' 버튼이 다시 정상적으로 표시되도록 수정했습니다.
- 다른 버튼 그룹과 동일한 절대 위치(absolute positioning) 규칙을 적용하여 일관된 UI를 제공합니다.

### CSS 수정 사항 (admin.css)

- **`.folder-group-header`**: `position: relative` 속성을 추가하여 '폴더 전체 선택' 버튼의 기준점으로 설정했습니다.
- **`.folder-group-title`**: 버튼과의 겹침을 방지하기 위해 `padding-right` 값을 추가하여 제목이 버튼 영역을 침범하지 않도록 했습니다.
