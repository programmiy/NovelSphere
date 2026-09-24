# 확장 프로그램 구분선 설정 연계 번역 자동 제외 및 검수 알림 패널

- **작성 일자**: 2026-09-24
- **관련 모듈**: `extension/content.js`, `extension/content.css`, `server/routers/translation.py`

---

## 1. 개요 및 도입 배경

- **도입 배경**:
  - 소설별 번역 중단 구분선(`activeSeparators`)을 확장 프로그램에서 지정하기 전에 이미 번역이 진행되어 데이터베이스에 저장되었거나, 신규 구분선이 추가된 경우 번역이 완료된 웹페이지 접속 시 구분선 기호나 문자열(예: `＜あとがき＞`, `【あとがき】`, `***`, `――――` 등)이 한국어로 번역되어 페이지 본문에 노출되는 문제가 있었습니다.
  - 기존에는 관리페이지(`/admin`)에서 해당 단락을 일일이 찾아 `❌ 제외` 버튼을 수동으로 눌러야 하는 불편함이 있었습니다.
  - 또한 제외 처리 사실을 사용자가 쉽게 인지할 수 있도록, 검수탭과 유사한 카드 형태의 알림 배너가 상단에 필요했으며, 사이드바 하단 로그 창의 불필요한 콘솔 메시지 과부하(`(하단로그는 x)`)를 방지해야 했습니다.

---

## 2. 주요 구현 내용

### 2-1. 구분선 일치 번역 자동 감지 및 제외 (`checkAndExcludeSeparatorTranslations`)
- **실행 시점**:
  1. `init()` 단계에서 `ensureTranslationsLoaded()` 완료 직후 (번역 완료 페이지 접속 시).
  2. 사이드바 구분선 설정 패널에서 `[💾 설정 저장]` 클릭 직후.
- **감지 로직**:
  - 불러온 `translations` 목록을 순회하며 원문 텍스트(`t.original`) 및 본문 DOM 문단 텍스트(HTML 태그 제거)가 `checkSeparatorMatch(text, activeSeparators)`에 매칭되는지 확인.
  - 유효한 번역문(`t.translated`)이 존재하는 항목들을 선별.
- **관리페이지 "제외" 기능 연계 (`POST /translations/exclude`)**:
  - 선별된 번역 ID 목록을 서버의 `/translations/exclude` 엔드포인트로 전송.
  - 서버에서 해당 레코드를 `ExcludedSentence`에 영구 등록하고 `Translation` 테이블에서 안전하게 삭제.
- **클라이언트 상태 및 DOM 동기화**:
  - `exclusionSet`에 해당 원문 및 장음 정규화 텍스트 즉시 추가.
  - `translationCache`에서 해당 `pid` 삭제 및 `translations` 배열에서 제거.
  - 사이드바 테이블에 기 등록된 행(`tr[data-pid]`) 제거 및 테이블 빈 상태(`updateEmptyState`) 갱신.
  - 본문 DOM에 이미 번역문이 적용된 경우 원래 원문으로 복원 및 적용 스타일/클래스 제거.

### 2-2. 검수탭 스타일 알림 패널 UI (`renderSeparatorExcludePanel`)
- 사이드바 상단에 `#separator-exclude-panel` 배너 렌더링.
- **UI 구성**:
  - 헤더: 아이콘(`🛡️`), 제외 건수 배지, 닫기 버튼.
  - 본문: 설명 문구 및 제외된 항목별 카드(`separator-exclude-card`).
  - 카드 내용: 문장 ID, 일치한 구분선 명칭, 원문 텍스트, 제외/삭제된 번역문(취소선 `<del>` 스타일).
  - 카드 클릭 시: `focusAndScrollToPid(item.pid)`를 호출하여 본문 해당 문단으로 부드러운 스크롤 및 펄스 하이라이트 제공.
- 사용자가 즉시 확인할 수 있도록 `showSidebar()`를 호출하여 사이드바 노출.
- **요구사항 준수**: `logToSidebar`는 일체 호출하지 않아 하단 로그 콘솔을 오염시키지 않음 (`하단로그는 x`).

---

## 3. 변경 파일 목록

| 파일 경로 | 변경 내용 요약 |
| :--- | :--- |
| `extension/content.js` | `checkAndExcludeSeparatorTranslations`, `renderSeparatorExcludePanel` 추가, `init()` 및 설정 저장 핸들러 연동, 사이드바 DOM에 `#separator-exclude-panel` 추가 |
| `extension/content.css` | `.separator-exclude-panel`, `.separator-exclude-card` 등 전용 스타일 추가 (엠버-오렌지 테마) |

---

## 4. 검증 결과

1. **JS 문법 검증**: `node -c extension/content.js` 구문 에러 없음 통과.
2. **단위 테스트 전체 통과**: `pytest` 71개 테스트 100% 정상 통과.
