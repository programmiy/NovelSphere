# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트가 사용자 요구사항 및 구어체 지시를 입력받았을 때, 혼선이나 회귀(Regression) 없이 전체 아키텍처와 1:1 타깃 코드를 0초 만에 직관적으로 파악할 수 있도록 압축 정리한 단일 진실 공급원(SSOT) 기술 레퍼런스입니다.
> **최신 동기화 일자**: 2026-10-15 (크롬 확장 프로그램 TypeScript 모듈화 및 esbuild 빌드 파이프라인 구축 완료: 4,540줄 단일 content.js 및 remote_content.js의 wrapGlobal 해킹 전면 폐기, scrapers/·core/·ui/ 3계층 모듈화, 중앙 상태 머신 연동 원격 제어 직접 발행; 모바일 Luminary UI v1.4.0; PC 서재 증기 차분기관 톱니/배관/압력계 & 3D 닉시관 UI; 최근 번역 회차 연동 적응형 RPM 방어 시스템; 사전 연동 및 34만 누적 번역 코퍼스 학습/교정 엔진)

---

## ⚡ 빠른 탐색용 핵심 모듈 & 라우터 맵 (Fast Lookup)

| 구분 | 파일 경로 | 핵심 역할 및 주요 함수/클래스 |
| :--- | :--- | :--- |
| **데스크톱** | `main.py` | PyWebView 윈도우 + 시스템 트레이(`Pystray`) + 서버/셀러리 서브프로세스 수명주기 관리 |
| **설정/연결** | `server/settings.py` | Pydantic 환경변수 (.env), Gemini 모델(`gemini-3.5-flash-lite`), 포트(8001), CORS 허용 출처, 보안 토큰 해시 |
| **보안 코어** | `server/security.py` | PBKDF2-HMAC-SHA256 (10만 회 솔트 해시), `verify_token` 상수 시간 비교, `is_safe_external_url` SSRF 사설망 방어 |
| **DB 코어** | `server/database.py` | SQLite WAL 모드, `busy_timeout=5000`, `REGEXP` 함수 주입, SQLAlchemy 세션 제너레이터 |
| **ORM 모델** | `server/models.py` | `Translation`, `BookActivity`(`is_visible` 포함), `NovelSeparatorSetting`, `TranslationTrash` 등 12개 테이블 |
| **RPM 관리** | `server/services/rpm_manager.py` | **2단계 슬라이딩 윈도우(API 60초 + 회차 5분)**, 최근 회차 가중 적응형 휴식([`proactive_rpm_rest`](file:///C:/LANOVEL/server/services/rpm_manager.py)), 세션 소켓 재생성, 회차 기반 가변 딜레이 계산([`calculate_episode_adaptive_delay`](file:///C:/LANOVEL/server/services/rpm_manager.py)) |
| **품질/복원** | `server/rule_classifier.py` | 100% 룰베이스 번역 품질 분류(규칙 1~4), 대사 괄호(`「%」`) 자동 복원([`restore_brackets`](file:///C:/LANOVEL/server/rule_classifier.py)) |
| **알림/현황판** | `server/notifications.py` | 배민 스타일 단일 번역 현황판([`update_translation_status`](file:///C:/LANOVEL/server/notifications.py)), Gemini API 오류 통계, 인메모리 버퍼 & SSE 스트림 |
| **서버 코어** | `server/server.py` | **15개 라우터 등록**, `lanovel_security_middleware` (루프백 100% 프리패스 + LAN 토큰 검증 + CSRF 차단), FTS5 가상테이블/트리거, 30분 괄호복원, 백업 |
| **번역 엔진** | `server/routers/translation.py` | Gemini 호출, 기본모델 verbatim 2단계 자체 복구([`_recover_verbatim_items`](file:///C:/LANOVEL/server/routers/translation.py)), 17시 안전 중단, **`GET /api/rpm_status`** |
| **데이터 CRUD** | `server/routers/data_crud.py` | FTS5 전문 검색, N+1 제거 upsert, 이상 번역 검출, 복원 센터 모달(휴지통/알림) |
| **사전/코퍼스** | `server/routers/dictionary.py` | **100% No-AI 사전 연동 및 누적 코퍼스 검색** (`GET /api/dictionary/lookup`, `GET /api/dictionary/links`) |
| **사전 서비스** | `server/services/dictionary_service.py` | 네이버/Weblio/Jisho/Goo 사전 링크 생성, 34만+ 문장 코퍼스 검색, 빈도 등급 및 한국어 대응 표현 통계 |
| **서재/책** | `server/routers/books.py` | 도서 숨김/표시, URL 번역 상태 배치 확인([`check_translated_urls`](file:///C:/LANOVEL/server/routers/books.py)), NovelUp+ 줄거리 크롤링, 회차 내 위치 복원 |
| **목차 파서** | `server/routers/toc_importer.py` | 카쿠요무(Apollo State Next.js), 소설가가 되자, NovelUp+ ([`fetch_all_novelup_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)) 목차 수집 |
| **동기화** | `server/routers/sync.py` | 모바일 초고속 양방향 동기화: `/ping`, 하이브리드 zlib 압축 SQLite 시드 DB(`/full-pack`), `/pull`, `/push` |
| **앱 배포** | `server/routers/app_release.py` | 모바일 OTA 무선 자동 업데이트: `/api/app/version`, `/api/app/download`, 웹 랜딩 페이지(`/download`) |
| **구분선** | `server/routers/separators.py` | 후기/광고 번역 차단용 소설별 구분선 CRUD (공통 7종, 프리셋 6종) |
| **원격 허브** | `server/routers/remote.py` | 모바일/웹 리모컨 (`/command`, `/status`, `/ws`, `/poll`, `/report`, `/ack`) |
| **크롬 확장** | `extension/` | **TypeScript + esbuild 모듈화 구조**: `src/content.ts` (클린 엔트리), `src/background/` (`remote_ws.ts`, `index.ts`), `src/scrapers/` (플랫폼별 DOM 파서), `src/core/` (상태 머신, 청킹, 적응형 스로틀링, 번역 실행), `src/ui/` (사이드바, HUD, 단축키, 목차 퀵점프) |
| **모바일 앱** | `mobile_app/lib/` | **v1.4.0 하이퍼 에스테틱 Luminary UI** (`hyper_aesthetic_theme.dart`, `HyperAmbientMeshBackground`, `HyperGlassCard`, `HyperHapticPill`, `HyperProgressRing`, 플로팅 글래스 네비게이션 독 & 뷰어 에어-글래스 컨트롤 허브, Sqflite 하이브리드 압축 DB, 루비/방점 렌더러) |
| **웹 프론트** | `server/static/` | `viewer.js` (3D 닉시관 인디케이터, 사전 & 용례 학습 패널), `library.js` (증기 차분기관 톱니/배관/압력계 대시보드), `admin.js` |

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 플랫폼 (Kakuyomu / Syosetu / NovelUp+ / Hameln / Alphapolis) ]
           ▲
           │ DOM 파싱 (p/l 태그, 소설명 감지, 구분선 감지, 다음 화 '次へ' 자동 이동)
           │ 스마트 키보드 내비게이션 (]/L 다음화+자동번역, [/H 이전화, O/T 목차, N 미번역 퀵점프)
           ▼
[ 크롬 확장 프로그램 (extension/src/ -> build.js -> extension/content.js & background.js) ]
   - src/scrapers/: 카쿠요무, 소설가가 되자, 노벨업, 하멜른, 알파폴리스 DOM 파서
   - src/core/state.ts: wrapGlobal 멍키패치 완전 폐기, 중앙 상태 머신에서 remoteStatus 직접 디스패치
   - src/core/page_translator.ts: 가변 청킹, 적응형 스로틀링(8~55초), 문장 분할 재시도, DOM 치환
   - src/background/remote_ws.ts: WebSocket(ws://127.0.0.1:8001/api/remote/ws) + HTTP 폴링 백오프, 원격 명령 실행
   - src/ui/: 사이드바, 플로팅 HUD, 목차 배지 & 퀵점프 패널
           │ HTTP (POST /translate, GET /api/rpm_status, POST /api/check_translated_urls, WS /api/remote/ws)
           ▼
[ FastAPI 백엔드 서버 (server:app, Port: 8001) ]
   - translation.py        ──▶ [ Google Gemini API ] (gemini-3.5-flash-lite / gemini-3.8-flash)
   - rpm_manager.py        ──▶ [ API 60초 + 회차 5분 2단계 슬라이딩 윈도우 & 선제적 쿨다운 휴식 ]
   - dictionary.py         ──▶ [ dictionary_service.py ] (100% No-AI, 34만+ 누적 SQLite 코퍼스 & 포털 사전 연동)
   - remote.py             ──▶ [ remote_control.py ] (모바일 앱 리모컨 <-> 크롬 확장 탭 양방향 제어)
   - data_crud.py          ──▶ [ SQLite DB (translations.db - WAL Mode) ]
   - books.py              ──▶ [ FTS5 가상 테이블 및 URL 번역 배치 확인 API ]
   - sync.py               ──▶ [ 하이브리드 zlib 압축 SQLite 시드 DB 생성 엔진 ]
   - app_release.py        ──▶ [ 모바일 APK 패키징 및 OTA 업데이트 배포 ]
   - notifications.py      ──▶ [ 인메모리 배민 스타일 단일 번역 현황판 & 로컬 SSE 브로드캐스트 ]
   - rule_classifier.py (100% 룰베이스 번역 품질 검증 및 대사 괄호 「%」 자동 복원)
           ▲
           │ Wi-Fi 로컬 네트워크 동기화 (HTTP Gzip/zlib) & OTA 무선 업데이트
           ▼
[ 클라이언트 생태계 (Desktop Web & Mobile Native) ]
   1. 데스크톱 앱 (main.py): PyWebView + Pystray 시스템 트레이
   2. 웹 프론트엔드 (static/):
      - library.html / library.css: 증기 차분기관(구리 배관, 기어 클러스터, 5구 황동 압력계 게이지, 펀치카드 도서 목록)
      - viewer.html / viewer.css: 3D 진공관 닉시관(Nixie Tube) 오렌지 네온 회차 & 인디케이터
      - viewer.js: 📖 사전 & 누적 용례 학습 패널 (Shift+D/W), 단어 선택 플로팅 툴팁, 수동 수정 연동
   3. 모바일 독립 앱 (mobile_app/): Flutter 기반 하이퍼 에스테틱 Luminary 리더 (v1.4.0)
```

---

## 2. 크롬 확장 프로그램 TypeScript 모듈 구조 (`extension/`)

```
extension/
├── src/
│   ├── types/                  # 공통 타입 정의
│   │   ├── novel.ts            # ParagraphItem, TranslationRecord, SeparatorConfig
│   │   └── remote.ts           # RemoteStatusPayload, RemoteCommand, RemotePhase
│   ├── scrapers/               # 플랫폼별 DOM 파서
│   │   ├── base.ts             # PlatformScraper 인터페이스
│   │   ├── kakuyomu.ts         # 카쿠요무 (works/, widget-toc-episode, 에피소드 제목)
│   │   ├── syosetu.ts          # 소설가가 되자 (ncode, c-pager, p-eplist)
│   │   ├── novelup.ts          # 노벨업플러스 (episode_content div->p 정규화, storyList)
│   │   ├── hameln.ts           # 하멜른 (novel/, table 목차, 次へ)
│   │   ├── alphapolis.ts       # 알파폴리스 (novel/, 에피소드 제목, navigation)
│   │   ├── generic.ts          # 폴백 스크래퍼
│   │   └── index.ts            # getScraper() 팩토리
│   ├── core/                   # 핵심 비즈니스 로직
│   │   ├── state.ts            # 중앙 집중식 상태 관리 및 원격 제어 직접 발행
│   │   ├── chunker.ts          # 글자 수/토큰 예산 기반 가변 청킹 (최대 2,000자 / 40문장)
│   │   ├── filters.ts          # 기호 전용 Fast-path 필터, 일본어/중국어/원문복붙 판별
│   │   ├── turbo.ts            # 쾌속모드 및 16시/17시 쿼터 초기화 정각 감지
│   │   ├── separators.ts       # 상단 잡글/하단 후기 구분선 분석 및 API 연동
│   │   ├── adaptive_throttle.ts# 최근 5분 번역 회차 슬라이딩 윈도우 및 가변 딜레이
│   │   └── page_translator.ts  # 번역 실행, 청크 전송, 재시도, 본문 치환, 서버 저장
│   ├── ui/                     # UI 컴포넌트
│   │   ├── hud.ts              # 플로팅 미니멀 HUD (showLanovelHud)
│   │   ├── key_nav.ts          # 단축키 내비게이션 (], L, [, H, O, T, N, Enter)
│   │   ├── sidebar.ts          # 사이드바 DOM 주입, 번역 테이블, 로그 콘솔, 모달
│   │   └── toc_quick_jump.ts   # 목차 상태 배지 및 미번역 퀵 점프 패널
│   └── content.ts              # 클린 오케스트레이션 엔트리포인트 (~280줄)
├── background/
│   ├── remote_ws.ts            # WebSocket/폴링 원격 제어 클라이언트
│   └── index.ts                # 서비스 워커 메인 엔트리 (API 중계, 쿼터 에러 핸들링)
├── build.js                    # 15줄 esbuild 초경량 번들러 스크립트
├── package.json                # TypeScript, esbuild, @types/chrome 의존성 (완전 격리)
├── tsconfig.json               # ES2022, bundler 모듈 해석, strict 타입 체크
├── manifest.json               # MV3 설정 ("js": ["content.js"] 단일 스크립트)
└── legacy_backup/              # 기존 레거시 파일 5종 안전 보관 (npm run rollback 지원)
```

---

## 3. 사용자 지시 및 발화-코드 1:1 매핑 사전 (Intent Routing Dictionary)

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 처리 내용 |
| :--- | :--- | :--- |
| **"확장 프로그램 수정하고 빌드해줘" / "확장 빌드해줘"** | `extension/build.js`<br>`extension/package.json` | `npm run build`로 20ms 내에 `content.js`와 `background.js` 초고속 번들링. `npm run typecheck`로 타입 오류 선제 검사. |
| **"확장 프로그램 이전 코드로 되돌려줘" / "롤백해줘"** | `extension/package.json` (`npm run rollback`)<br>`extension/legacy_backup/` | `npm run rollback` 실행 시 `legacy_backup/`에 보관된 레거시 5종 파일로 1초 만에 100% 원상복구. |
| **"원격 제어 안 돼" / "모바일 리모컨 상태 안 올라와"** | `extension/src/background/remote_ws.ts`<br>`extension/src/core/state.ts` | WebSocket(`ws://127.0.0.1:8001/api/remote/ws`) 연결 상태 점검. `state.broadcastStatus()`를 통해 주기적(2초) 및 상태 변화 시 직접 디스패치. |
| **"최근 소설이 분당 번역수가 늘어나서 rpm제한에 걸려"** | `extension/src/core/adaptive_throttle.ts`<br>`server/services/rpm_manager.py` | 최근 5분간 번역된 회차 수를 실시간 추적하여, 회차가 많을수록 다음 화 이동 대기시간을 8초에서 최대 55초까지 계단식으로 늘려 분당 호출 폭증 차단. |
| **"키보드로 다음화 넘어가게 해줘" / "단축키로 다음화 이동"** | `extension/src/ui/key_nav.ts`<br>`extension/src/ui/hud.ts` | `]` 또는 `L` 누르면 세션 플래그 설정 후 다음 화로 이동 -> 새 페이지 로드 즉시 자동 번역 시작 + 플로팅 HUD 안내. |
| **"목차에서 안 읽은(미번역) 화만 골라서 보고 싶어"** | `extension/src/ui/toc_quick_jump.ts`<br>`server/routers/books.py` | 목차 페이지 감지 시 에피소드 링크별 번역 여부 배지 부착, 우측 하단 `[⚡ 미번역 N화]` 퀵 점프 드로어 제공, `N`키 순차 탐색 및 `Enter` 진입. |
| **"소설 플랫폼 파싱 안 돼" / "새로운 소설 사이트 지원해줘"** | `extension/src/scrapers/` (`base.ts`, `*.ts`) | `PlatformScraper` 인터페이스를 구현하여 새 사이트 추가. 소설명, 에피소드명, 다음화/이전화 링크 셀렉터 캡슐화. |
