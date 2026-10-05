# LANOVEL 개발 작업 목록 (TODO)

## 📌 다음 세션 작업 예정
- [x] **인명·고유명사 검수/교정기 (db_editor 대체) 개발 (완료)**
  - 상세 기획서: [`docs/character-fixer-and-tinder-review-system-2026-10-05.md`](file:///C:/LANOVEL/docs/character-fixer-and-tinder-review-system-2026-10-05.md)
  - 대상 소설: `누나가 마 니 선생이라고 느그 좋아하면 안되나?` (남주 `悠 ➔ 유우`, 여주 `百合華 ➔ 유리카` 등 838건 오류 데이터)
  - 소설별 규칙 관리 시스템 (`server/data/character_rules.json`)
  - 틴더 스타일 단일 카드 검수 모드 + 일괄 리스트 검수 모드 구현
  - `server/routers/db_editor.py` 및 `server/templates/db_editor.html` 전면 개편
