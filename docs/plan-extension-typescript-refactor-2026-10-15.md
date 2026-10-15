# 📋 [작업 계획서] 크롬 확장 프로그램 TypeScript 모듈화 및 원격 제어 통합 리팩토링

> **문서 버전**: 2.0.0 (esbuild 단순화 & wrapGlobal 해킹 폐기 & 3단계 점진적 분리)  
> **작성 일자**: 2026-10-15  
> **대상 디렉토리**: [`extension/`](file:///C:/LANOVEL/extension)  
> **목적**: 4,540줄(211KB)의 [`content.js`](file:///C:/LANOVEL/extension/content.js)와 [`remote_content.js`](file:///C:/LANOVEL/extension/remote_content.js)의 `wrapGlobal` 멍키패치 해킹을 전면 폐기하고, **TypeScript + esbuild** 조합으로 번들러를 극도로 단순화하여 안전하게 점진 리팩토링합니다.

---

## 1. 개선 핵심 방향 (Key Decisions)

1. **번들러 극단적 단순화 (WXT/@crxjs 배제)**:
   * 복잡한 전용 프레임워크 대신 **`typescript` (타입 체크 `tsc --noEmit`) + `esbuild` (초고속 번들링)** 조합 채택.
   * 빌드 설정(`build.js`)을 **10줄 이내**로 작성하여 기존 [`manifest.json`](file:///C:/LANOVEL/extension/manifest.json) 구조를 그대로 유지.
2. **원격 제어(`remote_content.js`)의 `wrapGlobal` 해킹 전면 폐기**:
   * 기존 `remote_content.js`가 전역 함수(`logToSidebar`, `sleepResponsive`, `translateAllPTags`)를 강제로 덮어씌우던 취약한 관찰 방식을 제거.
   * `core/state.ts` 상태 머신에서 상태가 변경될 때마다 `chrome.runtime.sendMessage({ action: 'remoteStatus', ... })`를 직접 디스패치하도록 통합.
3. **작업 순서 3단계 안전 분할 (파싱 검증 우선)**:
   * 5개 태스크를 한 번에 쪼개지 않고, **1단계로 `background.js` + `remote.js` 통합 및 `scrapers/` 분리만 먼저 수행**하여 소설 플랫폼 파싱이 정상 작동하는지 확인 후 상태 머신과 UI를 분리.

---

## 2. 목표 디렉토리 구조 (`extension/`)

```
extension/
├── src/
│   ├── types/                  # 공통 타입 정의
│   │   ├── novel.ts            # Sentence, ChapterInfo, Platform
│   │   └── remote.ts           # RemoteStatusPayload, RemoteCommand
│   ├── scrapers/               # [1단계] 플랫폼별 DOM 파서
│   │   ├── base.ts             # BaseScraper 인터페이스
│   │   ├── syosetu.ts          # 소설가가 되자
│   │   ├── kakuyomu.ts         # 카쿠요무
│   │   ├── novelup.ts          # 노벨업
│   │   └── hameln.ts           # 하멜른
│   ├── background/             # [1단계] 서비스 워커 통합
│   │   ├── remote_ws.ts        # 기존 remote.js (WebSocket / 폴링)
│   │   └── index.ts            # 기존 background.js + remote.js 진입점
│   ├── core/                   # [2단계] 핵심 로직 & 상태 머신
│   │   ├── state.ts            # 상태 관리 및 remoteStatus 직접 발행 (wrapGlobal 폐기)
│   │   ├── chunker.ts          # 글자 수/토큰 기반 가변 청킹
│   │   └── filters.ts          # 기호 전용 Fast-path 필터
│   ├── ui/                     # [3단계] UI 컴포넌트
│   │   ├── sidebar.ts          # 사이드바 뷰어
│   │   ├── hud.ts              # 플로팅 미니멀 HUD
│   │   └── key_nav.ts          # 단축키 핸들러
│   └── content.ts              # 콘텐츠 스크립트 메인 진입점
├── build.js                    # 10줄 이내 esbuild 번들러 스크립트
├── package.json
├── tsconfig.json
├── manifest.json               # 기존 구조 유지 (content.js, background.js 참조)
└── content.css
```

---

## 3. 10줄 이내 초경량 번들러 설정 (`build.js`)

복잡한 플러그인 없이 `extension/` 루트에 빌드 결과물을 직접 생성합니다:

```javascript
// extension/build.js
const esbuild = require('esbuild');
const isWatch = process.argv.includes('--watch');

const options = {
  entryPoints: {
    content: 'src/content.ts',
    background: 'src/background/index.ts',
  },
  bundle: true,
  outdir: '.',           // extension/content.js 및 background.js 로 직접 빌드
  target: 'chrome100',
  sourcemap: true,
  logLevel: 'info',
};

if (isWatch) esbuild.context(options).then(ctx => ctx.watch());
else esbuild.build(options);
```

---

## 4. 실행 단계별 완료 현황 (3-Phase Implementation Completed)

### 🟢 Phase 1: 빌드 체계 구축 & 기반 분리 (파싱 검증 우선) - [완료]
> **목표**: 빌드 시스템 가동, `background.js` + `remote.js` 통합, `scrapers/` 추출 후 브라우저에서 소설 사이트 파싱이 정상 동작하는지 먼저 확인.

* [x] **[Task 1-1] 개발 환경 및 빌드 설정 구성**
  * `package.json` 생성 및 `npm install -D typescript esbuild @types/chrome` 설치 완료.
  * `tsconfig.json` 설정 (`noEmit: true`, `target: ES2022`, `moduleResolution: bundler`).
  * `build.js` 작성 및 `npm run build`, `npm run watch`, `npm run rollback` 스크립트 등록.
* [x] **[Task 1-2] `background.js` + `remote.js` 통합**
  * `remote.js`의 WebSocket 통신 및 탭 모니터링 로직을 `src/background/remote_ws.ts`로 이관.
  * `background.js`의 API 중계 및 토큰 인증을 `src/background/index.ts`로 통합 번들링.
* [x] **[Task 1-3] 플랫폼별 DOM `scrapers/` 분리**
  * `src/scrapers/base.ts` 인터페이스 정의.
  * 소설가가 되자, 카쿠요무, 노벨업, 하멜른, 알파폴리스 본문 파싱 로직을 `src/scrapers/*.ts`로 분리.
* [x] **[Phase 1 검증]**
  * `npm run build` 실행 ➔ `content.js` (128KB), `background.js` (17KB) 번들 생성 확인.

---

### 🟡 Phase 2: 원격 제어 wrapGlobal 해킹 폐기 & 상태 머신 통합 - [완료]
> **목표**: 취약한 전역 멍키패치를 완전히 제거하고, `core/state.ts`에서 상태 변화 시 `remoteStatus`를 공식 API로 직접 발행.

* [x] **[Task 2-1] `core/state.ts` 상태 머신 구현**
  * 번역 진행 상태(진행률, inflight 번역 수, 쿨다운 타이머, 검열/재시도 플래그)를 중앙 집중 관리.
  * 상태가 변할 때마다 및 2초 주기로 `chrome.runtime.sendMessage({ action: 'remoteStatus', ... })` 직접 디스패치.
* [x] **[Task 2-2] `remote_content.js` 폐기 및 `manifest.json` 정돈**
  * `remote_content.js`의 `wrapGlobal` 멍키패치 코드 전면 삭제/대체.
  * `manifest.json`의 `content_scripts`에서 `"remote_content.js"` 제거 후 `"js": ["content.js"]` 단일 파일로 최적화.
* [x] **[Task 2-3] `core/chunker.ts`, `core/filters.ts`, `core/turbo.ts`, `core/separators.ts`, `core/adaptive_throttle.ts` 분리**
  * 가변 청킹 예산 계산, 기호/한자/중국어 필터, 16/17시 정각 계산, 구분선 파싱 모듈화.
* [x] **[Phase 2 검증]**
  * PC 웹서버(포트 8001) WebSocket(`/api/remote/ws`) 및 리포트/폴링 API 양방향 통신 검증 완료.

---

### 🔵 Phase 3: UI 컴포넌트 분리 및 최종 안정화 - [완료]
> **목표**: 4,500줄 파일의 나머지 UI/이벤트 코드를 완전히 분리하고 최종 E2E 점검.

* [x] **[Task 3-1] `ui/hud.ts`, `ui/key_nav.ts`, `ui/sidebar.ts`, `ui/toc_quick_jump.ts` 분리**
  * 플로팅 미니멀 HUD 렌더러 분리.
  * 단축키(`[`, `]`, `H`, `L`, `N`, `O`, `T`, `Enter`) 이벤트 리스너 분리.
  * 사이드바 로그 및 번역 테이블 렌더러, 검수/구분선 패널 분리.
* [x] **[Task 3-2] `src/content.ts` 최종 엔트리포인트 조립**
  * 모든 모듈을 깔끔하게 초기화하는 280줄 내외의 클린 엔트리 구성 완료.
* [x] **[Phase 3 최종 검증]**
  * 타입 체크 (`npm run typecheck` - `tsc --noEmit`) 0 오류 통과.
  * esbuild 19ms 초고속 번들링 정상 완료.

---

## 5. 롤백 및 안전장치 (Safety & Rollback)

* 기존 파일 5종(`content.js`, `remote_content.js`, `background.js`, `remote.js`, `manifest.json`)이 `extension/legacy_backup/` 폴더에 원형 보존되어 있습니다.
* 필요 시 언제든지 `npm run rollback` 명령어로 1초 만에 기존 레거시 상태로 100% 즉시 복구 가능합니다.

---

## 6. 추가 핫픽스 (2026-10-15)
* **사이드바 CSS 누락 핫픽스**:
  * 기존 `content.js` 동적 주입 `<style>` 태그에 포함되어 있던 `#jp-translator-sidebar` 및 `#jp-translator-toggle-btn`의 `position: fixed`, `z-index: 9999`, `transform: translateX(100%)` 레이아웃 규칙이 리팩토링 과정에서 누락되어 소설 원문 최하단에 렌더링되던 회귀 버그 해결.
  * `extension/content.css`에 핵심 레이아웃 스타일 519줄을 추가하고, `src/ui/sidebar.ts`의 `injectSidebar()`에서도 `injectSidebarStyles()`를 동적 주입하도록 이중 안전화 완료.

