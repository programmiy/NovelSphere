# 소설가가 되자 100화 단위 페이징 원격 목차 수집 연동 및 단축키 N 퀵 점프 개선

## 1. 개요 및 배경
- **문제 현상**: 소설가가 되자(Syosetu)에서 100화가 넘어가는 장편 소설(예: n5955en, 전 170화) 번역 중, 101화 이후(예: 128화) 본문 페이지에서 미번역 회차 서랍을 조회하면 목차가 누락되어 "🎉 모든 회차의 번역이 완료되었습니다!"로 표시되거나 128화 이후 회차를 찾지 못하는 증상 발생.
- **결정적 원인**:
  1. **단일 HTML fetch 문제**: `extension/src/ui/toc_quick_jump.ts`의 `loadRemoteTocEpisodes()`가 목차 기본 URL 딱 1페이지만 단발성으로 fetch하여 1~100화만 로드하고 101~170화를 완전히 누락함.
  2. **공지 배너 오매칭**: `SyosetuScraper.findTocLink()` 및 `detectNovelTitle()`이 소설 상단 안내/공지 배너(`.c-announce a[href*="/n"]`)를 매칭하여 `/notice/`, `/news/`, `/novelview/` 링크를 목차로 낚아채서 회차 목록을 찾지 못함.
  3. **회차 페이지 'N' 단축키 무반응**: 본문 회차 페이지에서는 `isTocPage === false`이고 서랍이 열려 있지 않으면 'N' 키 입력이 무시됨.

## 2. 세부 변경 사항

### 2.1 백엔드 `/api/import-toc` 연동 및 다중 페이징 지원 (`toc_quick_jump.ts`)
- `loadRemoteTocEpisodes()`에서 백엔드 `POST /api/import-toc` (`body: { toc_url: tocUrl }`)를 우선 호출하도록 개선.
  - 서버 `server/routers/toc_importer.py`의 `fetch_all_syosetu_chapters()`가 쇼세츠의 100화 단위 페이지(`c-pager__item--next`, `?p=2`, `?p=3`...)를 최대 100페이지까지 모두 순회하여 170개 전체 챕터를 누락 없이 수집.
  - 백엔드 조회 실패 시 기존의 브라우저 단일 fetch로 안전하게 fallback 하도록 구성.
- `toggleQuickJumpFromSidebar()`를 통해 서랍이 열릴 때 아직 포커스가 없는 경우 첫 번째 미번역 회차(`quickJumpFocusedIndex`)를 자동 선택 및 스크롤 포커스 UI 업데이트 적용.

### 2.2 Syosetu DOM 스크래퍼 셀렉터 강화 (`syosetu.ts`)
- `findTocLink()`:
  - 공지 배너 `.c-announce`를 완전히 제거하고 빵부스러기(`.c-breadcrumbs a[href*="/n"]`), `.p-novel__series-link a`, `.novel_title a` 등을 탐색.
  - 매칭된 링크가 유효한 N코드 패턴(`/\/n\d+[a-z]+(\/|$|\?)/i`)을 만족하는지 엄격히 검증하여 공지사항/작품정보 오매칭 원천 차단.
- `detectNovelTitle()`:
  - `.c-announce`를 배제하고 빵부스러기 및 N코드 검증된 링크 우선 추출로 정확한 소설 제목 판별.
- Node.js 테스트 및 SSR 환경 안전성 보장을 위해 `typeof document === 'undefined'` 가드 추가.

### 2.3 본문 회차 페이지 'N' 키 내비게이션 바인딩 (`key_nav.ts`)
- 본문 회차 페이지에서 서랍이 닫혀 있거나 로드되지 않은 상태에서 'N' 키를 누르면 `toggleQuickJumpFromSidebar()`를 즉시 호출하여 백그라운드 원격 목차 로드 및 서랍 자동 표시.
- 이미 서랍이 열려 있는 상태에서 'N'을 누르면 순차 포커스 이동(`handleQuickJumpNKey()`), `Enter` 누르면 해당 미번역 회차로 자동 번역 진입 지원.

### 2.4 단위 테스트 보강 (`tests/core.test.ts`)
- `SyosetuScraper`의 workKey 추출, 목차 URL 패턴 역산(`getNovelTocUrl`), `.c-announce` 회피 검증 단위 테스트 추가 (17개 테스트 전체 통과).

## 3. 검증 결과
- TypeScript 컴파일 검사: `npm run typecheck` 통과 (에러 0건).
- 빌드 검사: `npm run build` 번들 정상 생성 (`content.js` 236.1kb, `background.js` 24.4kb).
- 단위 테스트: `npm run test` 17개 전 항목 통과 (Pass 17, Fail 0).
- 실서버 `/api/import-toc` 170화 전수 수집 검증: n5955en 1화~170화 완전 수집 확인.
