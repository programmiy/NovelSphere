# 구분선 설정 및 저장 기본 공통 키워드 'あとがき' 추가

- **작성 일자**: 2026-11-07
- **관련 모듈**:
  - `server/routers/separators.py`
  - `extension/src/core/separators.ts`
  - `extension/src/ui/sidebar.ts`
  - `extension/content.js` (빌드 결과물)
  - `extension/tests/core.test.ts`
  - `tests/test_separators.py`

---

## 1. 개요 및 요구사항

- **요구사항**: 구분선 설정 저장 시 및 기본 공통 구분선 목록에 키워드 `あとがき`를 추가.
- **배경**:
  - 기존 공통 기본 구분선(`DEFAULT_GLOBAL_SEPARATORS`)에는 `＜あとがき＞`, `&lt;あとがき&gt;`, `【あとがき】`와 같이 괄호로 감싸진 형태만 등록되어 있어, 웹소설(소설가가 되자, 카쿠요무 등)에서 작가들이 괄호 없이 단독으로 작성하는 `あとがき` 또는 다양한 기호로 감싼 형태(예: `――あとがき――`)가 기본 구분선으로 인식되지 않고 번역되는 문제가 발생함.
  - 공통 구분선 목록(`DEFAULT_GLOBAL_SEPARATORS`)에 `あとがき`를 추가함으로써, 소설별 구분선 설정 저장 시 `use_defaults=True` 상태에서 기본적으로 `あとがき` 키워드가 항상 유효 구분선(`effective_separators`)에 포함되어 안전하게 후기 단락 번역 제외를 보장하도록 개선.

---

## 2. 주요 구현 내용

### 2-1. 서버 라우터 기본 구분선 갱신 (`server/routers/separators.py`)
- `DEFAULT_GLOBAL_SEPARATORS` 리스트에 `"あとがき"` 키워드 추가:
  ```python
  DEFAULT_GLOBAL_SEPARATORS = [
      "＜あとがき＞",
      "&lt;あとがき&gt;",
      "【あとがき】",
      "あとがき",
      "＜解説＞",
      "【大事なお知らせ】",
      "【宣伝】",
      "お読み頂きありがとうございます！"
  ]
  ```
- `POST /api/separators` (소설별 구분선 설정 저장) 및 `GET /api/separators` (구분선 조회) 시 `use_defaults=True`인 경우 `effective_separators`에 `あとがき`가 기본으로 포함되어 클라이언트 및 DB 설정과 완벽하게 동기화됨.

### 2-2. 확장 프로그램 코어 및 UI 갱신 (`extension/src/`)
- `extension/src/core/separators.ts`:
  - `DEFAULT_GLOBAL_SEPARATORS` 배열에 `'あとがき'` 추가.
  - 구체적인 괄호 키워드(`＜あとがき＞`, `【あとがき】`) 뒤에 배치하여 기존 매칭 상세도를 보존하면서 단독 `あとがき`도 완벽히 매칭.
- `extension/src/ui/sidebar.ts`:
  - 구분선 패널 내 공통 기본 체크박스 라벨에 `あとがき` 안내 문구 갱신 (`공통 후기 키워드 포함 (あとがき, ＜あとがき＞, 【大事なお知らせ】 등)`).
- `extension/content.js`:
  - `npm run build`를 통해 번들 스크립트 최신화 완료.

---

## 3. 테스트 및 검증 결과

1. **확장 프로그램 유닛 테스트 (`npm test`)**:
   - `extension/tests/core.test.ts`에 단독 `あとがき` 매칭 및 후기 단락 제외 검증 테스트 케이스 추가 완료:
     - `separators: DEFAULT_GLOBAL_SEPARATORS includes plain あとがき and detects it as separator`
   - 전체 22개 테스트 100% 통과 (PASS).
2. **타입체크 (`npm run typecheck`)**:
   - `tsc --noEmit` 성공 (오류 0건).
3. **서버 백엔드 단위 테스트 (`pytest tests/test_separators.py`)**:
   - `DEFAULT_GLOBAL_SEPARATORS` 내 `あとがき` 존재 검증.
   - `POST /api/separators` 저장 시 `effective_separators` 내 `あとがき` 포함 검증.
   - `GET /api/separators` 조회 및 `DELETE` 기본값 복원 시 `effective_separators` 내 `あとがき` 보존 검증.
   - 격리된 테스트 환경(`test_isolated.db`)에서 2개 테스트 모두 100% 통과 (PASS).
