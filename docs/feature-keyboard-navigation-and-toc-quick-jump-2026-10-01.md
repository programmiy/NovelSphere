# feature-keyboard-navigation-and-toc-quick-jump-2026-10-01

## 1. 개요 및 배경
- **배경**: LANOVEL 웹소설 감상 시 마우스 조작 없이 키보드만으로 이전/다음 화 이동 및 목차 복귀를 지원하고, 다음 회차로 이동했을 때 수동 번역 클릭 없이 자동으로 번역이 시작되는 원스톱 파이프라인의 필요성 대두 (차세대 5대 로드맵 Phase 4 & 5).
- 또한 소설 목차(TOC) 페이지에서 어떤 회차가 번역되었는지 시각적으로 파악하기 어려웠던 문제를 해결하기 위해 회차별 번역 상태 배지와 미번역 회차 퀵 점프 패널을 구축.

## 2. 세부 구현 사항

### 2-1. 브라우저 확장 프로그램 스마트 키보드 내비게이션 & HUD (`extension/content.js`, `extension/content.css`)
- **듀얼 키보드 단축키 지원**:
  - `]` 또는 `L`: 다음 화 이동 (다음 화 진입 시 자동 번역 플래그 `sessionStorage` 연동)
  - `[` 또는 `H`: 이전 화 이동
  - `O` 또는 `T`: 소설 목차(TOC) 페이지로 복귀
  - `N`: 목차 페이지에서 미번역 퀵 점프 패널 토글 및 다음 미번역 항목 포커스
  - `ArrowUp` / `ArrowDown`: 퀵 점프 패널 내 회차 탐색
  - `Enter`: 선택된 미번역 회차로 즉시 진입 및 자동 번역 연동
  - `Escape`: 퀵 점프 패널 닫기
  - *텍스트 입력 필드(`input`, `textarea`, `select`, `contenteditable`) 포커스 중에는 단축키 자동 비활성화*
- **미니멀 플로팅 HUD (Heads-Up Display)**:
  - 키 입력 시 화면 우측 상단에 세련된 다크 글래스모피즘 HUD 배지(`[다음 화로 이동 및 자동 번역...]`, `[이전 화로 이동 중...]`, `[소설 목차로 이동 중...]`) 실시간 피드백 노출.
- **단순 자동 번역 연동**:
  - `]` 또는 `L` 키로 다음 회차로 넘어가면 세션 스토리지 플래그를 통해 페이지 로드 즉시 자동으로 사이드바를 열고 번역 시작(`checkAutoTranslateNextTrigger`).
  - 다음 화 진행은 독자의 속도에 맞추어 수동 단축키 입력으로 제어.

### 2-2. 목차(TOC) 페이지 번역 상태 배지 및 미번역 퀵 점프 패널
- **지원 사이트**: 카쿠요무(`kakuyomu.jp`), 쇼세츠(`syosetu.com`, `novel18.syosetu.com` 등), 노벨업(`novelup.plus`), 하멜른(`syosetu.org`).
- **상태 배지 렌더링**:
  - 목차 내 에피소드 링크를 자동 수집하여 서버 API에 배치 조회.
  - 번역 완료: 에메랄드 그린 배지 (`.lanovel-toc-badge.translated`)
  - 미번역: 앰버 배지 (`.lanovel-toc-badge.untranslated`)
- **미번역 퀵 점프 패널**:
  - 접힘 상태: 화면 우측 하단 `[⚡ 미번역 N화] [N]` 미니 플로팅 배지 버튼.
  - 펼침 상태: 세련된 다크 글래스모피즘 슬라이드 드로어에 미번역 회차 목록 나열, 클릭 또는 `N` / 방향키 + `Enter`로 즉시 진입.
  - `N`키 입력 시 목차 원문 페이지의 해당 링크 위치로도 `scrollIntoView` 동기화.

### 2-3. 백엔드 URL 번역 상태 배치 확인 API (`server/routers/books.py`)
- **엔드포인트**: `POST /api/check_translated_urls`
- **입력**: `CheckUrlsRequest(urls=List[str])`
- **동작**: 목차의 모든 URL을 SQLite chunking(900개 단위) 및 슬래시 정규화 매칭을 거쳐 단 1ms 만에 번역된 URL 집합(`translated_urls`)을 반환.

## 3. 검증 결과
- `tests/test_library_viewer_api.py`에 `test_check_translated_urls_batch` 단위 테스트 추가 완료.
- 전체 테스트 126건 100% 통과 (Pass 126 / Fail 0).
- 자바스크립트 구문 문법 검사(`node -c extension/content.js`) 정상 통과.
