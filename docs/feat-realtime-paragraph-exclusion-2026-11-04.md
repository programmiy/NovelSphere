# 번역 진행 중 특정 문단 이후/이전 실시간 동적 제외 & 본문 직접 조작 엔진

> **작업 일자**: 2026-11-04  
> **관련 모듈**: `extension/src/core/dom_applier.ts`, `extension/src/core/row_actions.ts`, `extension/src/core/page_translator.ts`, `extension/src/core/state.ts`, `extension/src/ui/sidebar.ts`, `extension/content.css`, `server/routers/translation.py`, `tests/test_exclude_restore.py`, `extension/tests/core.test.ts`

---

## 1. 개요 및 배경

기존 사이드바 기반 번역 제외의 한계(화면 가로 스크롤 발생, 번역 진행 중 플레이스홀더 상태에서 버튼 미노출, 하단 후기만 제외 가능하고 상단 머리말/공지 제외 불가)를 전면 해소하기 위해:
1. **소설 본문 직접 조작 스마트 플로팅 액션 위젯 (`#lanovel-p-action-pill`)** 구축: 본문 문단에 마우스를 올리면 사이드바를 열지 않고도 문단 우측 상단에 즉시 조작 버튼이 노출됨.
2. **양방향 문단 제외 지원**:
   - **`[⬆️ 위로 제외]`**: 첫 문단부터 해당 문단까지 (상단 공지/머리말/전 화 요약) 일괄 번역 제외.
   - **`[⬇️ 아래로 제외]`**: 해당 문단부터 본문 끝까지 (하단 후기/작가의 말/선전) 일괄 번역 제외.
   - **`[↩️ 제외 해제]`**: 이미 제외된 영역 위에서 원클릭 복원.
3. **번역 진행 도중 즉시 반응**: 번역 중(`⏳ 번역 중...` 상태)이라도 본문 및 사이드바에서 버튼이 100% 상시 노출되며, 클릭 즉시 번역 파이프라인에서 0ms로 건너뜁니다.
4. **사이드바 컬럼 너비 최적화**: 18% -> 25% 확장 및 여백 최적화로 가로 스크롤 없이 한 화면에 쏙 들어가도록 조정.

---

## 2. 핵심 변경 및 구현 내역

### 2.1 본문 스마트 플로팅 액션 위젯 (`extension/src/core/dom_applier.ts`, `extension/content.css`)
- **`ensureParagraphActionPill()` & `positionPillForParagraph(p)`**:
  - `document.body`에 글래스모피즘 미니 플로팅 위젯 (`#lanovel-p-action-pill`) 단 1개를 주입하여 가볍고 부드럽게 재사용 (DOM 오버헤드 0%).
  - 본문 문단(`p[id]`)에 마우스를 올리면 문단 우측 끝 상단에 스냅되어 부드럽게 페이드인.
  - 제외되지 않은 문단: `[⬆️ 위로 제외]` (앰버) + `[⬇️ 아래로 제외]` (로즈) 2개 버튼 노출.
  - 제외된 문단: `[↩️ 제외 해제]` (에메랄드 그린) 1개 버튼 노출.
  - 마우스가 문단과 위젯을 벗어나면 250ms 디바운스 후 자연스럽게 페이드아웃.

### 2.2 양방향 문단 제외 엔진 (`extension/src/core/row_actions.ts`)
- **`applyExclusionToParagraphs(targets, pivotPid, directionLabel, icon)` (공통 엔진)**:
  - 지정된 문단 목록 전체를 `state.manualExcludedPids`, `state.userDeletedTranslationPids`, `state.exclusionSet`에 즉시 등록.
  - 기번역문 원문 복원, 본문 `.lanovel-excluded-paragraph` 부착 (취소선, 딤, 좌측 레드 점선 바).
  - 사이드바 행 `.lanovel-excluded-row`, `🚫 [번역 제외됨]` 상태 갱신.
  - 백엔드 `POST /translations/exclude` 비동기 저장.
- **`excludeParagraphAndBefore(endPid)`**:
  - 첫 문단(`index 0`)부터 `endPid`까지 상단 머리말/공지 문단들 일괄 번역 제외.
- **`excludeParagraphAndAfter(startPid)`**:
  - `startPid`부터 본문 끝까지 하단 후기/작가의말 문단들 일괄 번역 제외.
- **`restoreExcludedParagraphAndAfter(pivotPid)`**:
  - 연결된 제외 문단들의 제외 상태를 해제하고 원상태로 복원 (`POST /translations/restore_excluded`).

### 2.3 번역 중 상시 노출 및 사이드바 비율 최적화 (`extension/src/ui/sidebar.ts`, `content.css`)
- **`addPlaceholderRows` 및 `updateSidebarWithTranslations` 누락 해결**:
  - 번역 진행 중(`⏳ 번역 중...` 상태)이라도 `[⬆️] [⬇️]` 버튼이 확실하게 생성되고 동작하도록 수정.
- **테이블 컬럼 너비 조정**:
  - 1컬럼(원문): 37%, 2컬럼(번역): 38%, 3컬럼(액션): 25%.
  - `padding: 6px 3px`, `flex-wrap: nowrap`, `gap: 2px`로 최적화하여 460px 사이드바에서 가로 스크롤 없이 `[저장] [🔄] [⬆️] [⬇️]` 4개 버튼이 완벽하게 한눈에 노출.

### 2.4 백엔드 안전 연동 (`server/routers/translation.py`, `tests/test_exclude_restore.py`)
- `ExcludeRequest`에 `url` 및 `originals` 지원을 추가하여, 미번역 문장과 기번역 문장 모두 `ExcludedSentence`에 안전 등록 및 `TranslationTrash` 보관.
- 격리 테스트 `test_exclude_by_url_and_originals` 통과.

---

## 3. 검증 결과

1. **단위 테스트**: `npm --prefix extension test` 21개 전체 통과.
2. **타입스크립트 정적 검사**: `npm --prefix extension run typecheck` 에러 0건.
3. **컴파일 번들링**: `npm --prefix extension run build` esbuild 45ms 완료.
4. **백엔드 테스트**: `pytest tests/test_exclude_restore.py` 2건 전체 통과.
