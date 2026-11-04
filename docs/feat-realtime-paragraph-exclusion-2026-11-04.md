# 번역 진행 중 특정 문단 이후 실시간 동적 제외 & 자동 건너뛰기 엔진

> **작업 일자**: 2026-11-04  
> **관련 모듈**: `extension/src/core/page_translator.ts`, `extension/src/core/row_actions.ts`, `extension/src/core/state.ts`, `extension/src/core/dom_applier.ts`, `extension/src/ui/sidebar.ts`, `extension/content.css`, `server/routers/translation.py`, `tests/test_exclude_restore.py`, `extension/tests/core.test.ts`

---

## 1. 개요 및 배경

웹소설 번역 진행 도중 작가의 말, 후기, 잡담 등이 시작되는 특정 문단을 발견했을 때, 사용자가 **해당 문단부터 본문 끝까지의 모든 문단을 즉시 번역 제외 처리**할 수 있도록 실시간 동적 제외(Real-time Dynamic Exclusion) 파이프라인을 구축하였습니다.
기존 소설별 구분선(Separator)의 하단 후기 자동 제외 메커니즘과 동일하게, 특정 문단을 제외하면 그 문단을 포함하여 이후의 모든 문장들이 즉시 제외 목록에 등록되며, 번역 청크 순회 중 해당 문단들의 차례가 와도 Gemini API 호출을 아예 시도하지 않고 0ms로 건너뜁니다.

---

## 2. 핵심 변경 및 구현 내역

### 2.1 백엔드 (`server/routers/translation.py`)
- **`ExcludeRequest` Pydantic 모델 확장**:
  - `ids: Optional[List[int]] = []`: 기존 ID 기반 번역 삭제 100% 호환.
  - `url: Optional[str] = None`, `originals: Optional[List[str]] = []`: 아직 번역되지 않은 문장(미번역 문단) 및 기번역 문장 일괄 제외 지원.
- **`POST /translations/exclude` 라우터 강화**:
  - 전달된 URL 및 원문 목록(`originals`)을 `ExcludedSentence` 테이블에 `INSERT OR IGNORE`로 즉시 등록.
  - 만약 `translations` 테이블에 이미 번역 레코드가 존재한다면, 데이터 유실 방지 규칙에 따라 `TranslationTrash`로 안전하게 아카이브 보관 후 `translations` 테이블에서 삭제.
  - SQLite 삭제 카운터를 `record_legitimate_deletion`에 기록하여 백업 롤백 알림 방어.

### 2.2 크롬 확장 상태 머신 (`extension/src/core/state.ts`)
- `public manualExcludedPids: Set<string> = new Set()` 필드 신설.
- `public isPidExcluded(pid: string, originalText?: string): boolean`:
  - `manualExcludedPids.has(pid)` 또는 정제된 원문 텍스트가 `exclusionSet`에 포함되어 있는지 0ms로 O(1) 판정.

### 2.3 실시간 파이프라인 동적 차단 (`extension/src/core/page_translator.ts`)
- **청크 전송 직전 필터링 (`translateChunk`)**:
  - `items`를 받으면 전송 직전에 `items.filter(item => !state.isPidExcluded(item.id, item.text))` 수행.
  - 묶음 내 모든 문단이 제외된 경우: API 호출 0회로 스킵하고 다음 루프로 즉시 진행.
  - 일부만 제외된 경우: 제외 문단을 배제한 유효 아이템만 Gemini로 전송.
- **비행 중 응답 필터링 (`response.translations`)**:
  - API 요청이 전송된 찰나에 사용자가 제외 버튼을 눌렀더라도, 응답 수신 시 제외된 문단은 캐시/DOM/DB 주입에서 원천 차단.
- **보완 번역꾸러미 누락 방지 (`getPendingEmptyItems`)**:
  - 제외 처리된 문단은 `userDeletedTranslationPids` 및 `row.dataset.userDeleted`로 마킹되어 마지막 보완 꾸러미에 다시 잡히지 않음.

### 2.4 문단 이후 일괄 제외 & 복원 모듈 (`extension/src/core/row_actions.ts`)
- **`excludeParagraphAndAfter(startPid: string)`**:
  - `startPid`부터 본문 끝까지의 모든 문단 추출.
  - `state.manualExcludedPids` 및 `state.exclusionSet` 즉시 등록.
  - 기번역문이 있다면 본문 DOM을 원문(`dataset.lanovelOriginalHtml`)으로 즉시 복원.
  - 본문 문단에 `.lanovel-excluded-paragraph` 클래스 부착 (취소선, 딤, 좌측 레드 점선 바).
  - 사이드바 행에 `.lanovel-excluded-row` 및 `🚫 [번역 제외됨]` 상태 표시, 버튼을 `[↩️]`(복원)으로 전환.
  - 서버 `POST /translations/exclude` 비동기 동기화.
  - 플로팅 HUD 및 사이드바 로그 실시간 피드백.
- **`restoreExcludedParagraphAndAfter(startPid: string)`**:
  - 제외 상태를 해제하고 원상태(번역 대기 또는 번역문 복구)로 되돌림.
  - 서버 `POST /translations/restore_excluded` 동기화.

### 2.5 UI 인터랙션 및 스타일 (`extension/src/ui/sidebar.ts`, `dom_applier.ts`, `content.css`)
- **사이드바 각 행**:
  - 기존 `[💾 저장] [🔄]` 옆에 **`[✂️]` (이 문단부터 본문 끝까지 번역 제외)** 버튼 배치.
  - 제외된 행은 `[↩️]` (제외 해제) 버튼으로 전환.
- **본문 직접 조작 (`Alt + 클릭`)**:
  - 소설 본문을 읽다가 특정 문단을 `Alt + 클릭`하면, 해당 문단부터 끝까지 번역 제외 및 해제 즉시 토글.
- **스타일 (`content.css`)**:
  - `.lanovel-excluded-paragraph`: 0.52 불투명도, 취소선, 좌측 레드 점선 경계선.
  - `.lanovel-excluded-row`: 사이드바 테이블 은은한 레드 틴트 및 이탤릭 안내.
  - `.exclude-after-btn`: 깔끔한 라운드 미니 버튼 및 호버 애니메이션.

---

## 3. 검증 및 테스트 결과

1. **Python 백엔드 단위 테스트**:
   - `tests/test_exclude_restore.py`: `test_exclude_and_restore_cycle` 및 신규 `test_exclude_by_url_and_originals` 통과 (2 passed).
   - `tests/test_quota_reset_guard.py`: 5 passed.
2. **크롬 확장 단위 테스트**:
   - `extension/tests/core.test.ts`: 신규 `state & dynamic exclusion: isPidExcluded accurately filters excluded PIDs and texts` 포함 21개 테스트 전체 통과 (21 passed).
3. **타입스크립트 정적 분석**:
   - `npm run typecheck` 에러 0건 통과.
4. **번들링 빌드**:
   - `npm run build` esbuild 77ms 만에 `content.js` 및 `background.js` 정상 컴파일 완료.
