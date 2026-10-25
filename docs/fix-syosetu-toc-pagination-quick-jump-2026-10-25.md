# 소설가가 되자 100화 단위 페이징 원격 목차 수집 연동 및 단축키 N 퀵 점프 개선

## 1. 개요 및 배경
- **문제 현상**: 소설가가 되자(Syosetu)에서 100화가 넘어가는 장편 소설(예: n5955en, 전 170화) 번역 중, 101화 이후(예: 128화) 본문 페이지에서 미번역 회차 서랍을 조회하면 목차가 누락되거나 "⚠️ 목차에서 회차 목록을 찾지 못했습니다." 오류가 발생하는 증상.
- **결정적 원인 상세 분석**:
  1. **URL 패턴 역산 순위 및 작품정보 오매칭**:
     - 쇼세츠 본문 페이지 최상단 메뉴(`.c-menu__body`)에 `https://ncode.syosetu.com/novelview/infotop/ncode/n5955en/?ref=ncodeheader` (작품 정보 링크)가 존재함.
     - `findTocLink()`가 DOM을 탐색하며 N코드 정규식 매칭 시 이 작품정보 URL을 첫 번째로 낚아채 목차 주소로 반환함.
     - 백엔드 `/api/import-toc`와 브라우저 단일 fetch 모두 작품정보 페이지를 긁어오게 되어 회차 목록(`.p-eplist`)을 0개로 판단, "⚠️ 목차에서 회차 목록을 찾지 못했습니다." 오류를 발생시킴.
  2. **로그인 안내 배너(`.c-announce--note`) 오매칭**:
     - 쇼세츠 본문 상단에 `div.c-announce.c-announce--note` 배너가 존재하며 내부 링크가 `https://syosetu.com/login/input/?redirectlink=.../n5955en/...` 임.
     - 단순 `.c-announce a[href*="/n"]` 셀렉터 사용 시 로그인 페이지 URL 및 "ログイン" 텍스트를 소설 제목으로 잘못 추출함.
  3. **본문 페이지 `.c-breadcrumbs` 부재**:
     - 쇼세츠 회차 페이지에는 빵부스러기 네비게이션이 없거나 비어있어, DOM 링크 대신 브라우저 주소창(`https://ncode.syosetu.com/n5955en/128/`)의 N코드 패턴 역산이 가장 안전함.
  4. **회차 페이지 'N' 단축키 무반응**:
     - 회차 페이지에서는 `isTocPage === false`이고 서랍이 열려 있지 않으면 'N' 키 입력이 무시됨.

## 2. 세부 변경 사항

### 2.1 URL 패턴 기반 목차 URL 역산 1순위화 (`toc_quick_jump.ts`)
- `getNovelTocUrl()`에서 DOM 링크 탐색보다 **URL 패턴 기반 N코드 역산(`https://ncode.syosetu.com/n5955en/`)을 1순위로 즉시 실행**.
  - 본문 페이지 URL이 이미 `.../n5955en/128/` 형식이므로, 외부 DOM의 로그인 링크·작품정보 링크 간섭 0%, 0ms 만에 정확한 목차 URL 획득 보장.
- `loadRemoteTocEpisodes()`에서 백엔드 `POST /api/import-toc` (`body: { toc_url: tocUrl }`)를 우선 호출하도록 개선.
  - 서버 `server/routers/toc_importer.py`의 `fetch_all_syosetu_chapters()`가 쇼세츠의 100화 단위 페이지(`c-pager__item--next`, `?p=2`, `?p=3`...)를 최대 100페이지까지 모두 순회하여 170개 전체 챕터를 누락 없이 수집.
  - 백엔드 조회 실패 시 브라우저 단일 fetch로 안전하게 fallback.
- `toggleQuickJumpFromSidebar()`를 통해 서랍이 열릴 때 아직 포커스가 없는 경우 첫 번째 미번역 회차(`quickJumpFocusedIndex`)를 자동 선택 및 스크롤 포커스 UI 업데이트 적용.

### 2.2 Syosetu DOM 스크래퍼 셀렉터 강화 (`syosetu.ts`)
- `detectNovelTitle()`:
  - 로그인 배너(`.c-announce--note`)를 제외(`:not(.c-announce--note)`)하고, 순수 N코드 목차 패턴 링크(`/n5955en/`)만을 필터링하여 정확한 소설 제목 추출.
- `findTocLink()`:
  - 본문 하단 목차 직접 링크(`目次`)를 우선 확인하고, 상단 소설 헤더 중 `login`, `novelview`, `infotop`, `notice`, `mypage`를 엄격히 제외한 순수 N코드 목차 링크만 반환.
- Node.js 테스트 및 SSR 환경 안전성 보장을 위해 `typeof document === 'undefined'` 가드 추가.

### 2.3 본문 회차 페이지 'N' 키 내비게이션 바인딩 (`key_nav.ts`)
- 본문 회차 페이지에서 서랍이 닫혀 있거나 로드되지 않은 상태에서 'N' 키를 누르면 `toggleQuickJumpFromSidebar()`를 즉시 호출하여 백그라운드 원격 목차 로드 및 서랍 자동 표시.
- 이미 서랍이 열려 있는 상태에서 'N'을 누르면 순차 포커스 이동(`handleQuickJumpNKey()`), `Enter` 누르면 해당 미번역 회차로 자동 번역 진입 지원.

### 2.4 단위 테스트 보강 (`tests/core.test.ts`)
- `SyosetuScraper`의 workKey 추출, 목차 URL 패턴 역산(`getNovelTocUrl`), `.c-announce` 회피 검증 단위 테스트 추가 (18개 테스트 전체 통과).

## 3. 검증 결과
- TypeScript 컴파일 검사: `npm run typecheck` 통과 (0 errors).
- 빌드 검사: `npm run build` 번들 정상 생성 (`content.js` 237.1kb, `background.js` 24.4kb).
- 단위 테스트: `npm run test` 18개 전 항목 통과 (Pass 18, Fail 0).
- 실서버 `/api/import-toc` 170화 전수 수집 검증: n5955en 1화~170화 완전 수집 확인.
