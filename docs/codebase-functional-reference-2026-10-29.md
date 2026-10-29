# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트가 사용자 요구사항 및 구어체 지시를 입력받았을 때, 혼선이나 회귀(Regression) 없이 전체 아키텍처와 1:1 타깃 코드를 0초 만에 직관적으로 파악할 수 있도록 압축 정리한 단일 진실 공급원(SSOT) 기술 레퍼런스입니다.
> **최신 동기화 일자**: 2026-10-29 (플로팅 HUD 실시간 번역 진행도 및 다음 번역간 초 단위 카운트다운 타이머 고도화; 통계 & 품질 분석 HUD 대개편: Throughput 처리 속도 스펙트럼 차트 및 방어 산출 엔진 탑재, 전 탭 통계 고도화(AI 텍스트 정제율·상위 5대 점유율 스펙트럼·소설 4대 규모 티어·명작 문학 환산 및 서가 물리적 부피), 신규 5번째 탭 '번역 성능 & AI 엔진 효율' 개설; 번역 회차 수(Episodes) 메트릭 및 회차당 분량 밀도(Density) 지표 전면 탑재; 단락별 1-클릭 원본 순간이동 및 상호작용 동기화 시스템; C:\ServerHub 공동 서버 관리자 고도화; 번역 통계 KST 16시 리셋 정렬)

---

## ⚡ 빠른 탐색용 핵심 모듈 & 라우터 맵 (Fast Lookup)

| 구분 | 파일 경로 | 핵심 역할 및 주요 함수/클래스 |
| :--- | :--- | :--- |
| **통합 허브** | `C:\ServerHub\server_hub.pyw`<br>`C:\ServerHub\log_viewer.pyw`<br>`C:\ServerHub\hub_utils.py` | **공동 서버 관리 트레이 & 실시간 모니터링**: LANOVEL(8001) + ASMR Vault(8000) 동시 제어, Windows Named Mutex 단일 인스턴스 보장, `kill_by_port` 포트 기반 프로세스 종료, `rotate_log_file` 자동 로테이션, `SO_LINGER` 소켓 `TIME_WAIT` 방지, LANOVEL venv 표준 바인딩 |
| **데스크톱** | `main.py` | PyWebView 윈도우 + 시스템 트레이(`Pystray`) + 서버/셀러리 서브프로세스 수명주기 관리 |
| **설정/연결** | `server/settings.py` | Pydantic 환경변수 (.env), Gemini 모델(`gemini-3.5-flash-lite`), 포트(8001), CORS 허용 출처, 보안 토큰 해시 |
| **보안 코어** | `server/security.py` | PBKDF2-HMAC-SHA256 (10만 회 솔트 해시), `verify_token` 상수 시간 비교, `is_safe_external_url` SSRF 사설망 방어 |
| **DB 코어** | `server/database.py` | SQLite WAL 모드, `busy_timeout=5000`, `REGEXP`, `TO_QUOTA_DATE`, `TO_QUOTA_HOUR`(`TO_KST_HOUR`), `TO_QUOTA_DOW` 주입, SQLAlchemy 세션 제너레이터 |
| **ORM 모델** | `server/models.py` | `Translation`, `BookActivity`(`is_visible` 포함), `NovelSeparatorSetting`, `TranslationTrash`, `SpecialBatchQueue` 등 13개 테이블 |
| **RPM 관리** | `server/services/rpm_manager.py` | **2단계 슬라이딩 윈도우(API 60초 + 회차 5분)**, 최근 회차 가중 적응형 휴식([`proactive_rpm_rest`](file:///C:/LANOVEL/server/services/rpm_manager.py)), 세션 소켓 재생성, 회차 기반 가변 딜레이 계산([`calculate_episode_adaptive_delay`](file:///C:/LANOVEL/server/services/rpm_manager.py)) |
| **품질/복원** | `server/rule_classifier.py` | 100% 룰베이스 번역 품질 분류(규칙 1~4), 대사 괄호(`「%」`) 자동 복원([`restore_brackets`](file:///C:/LANOVEL/server/rule_classifier.py)) |
| **알림/현황판** | `server/notifications.py` | 배민 스타일 단일 번역 현황판([`update_translation_status`](file:///C:/LANOVEL/server/notifications.py)), Gemini API 오류 통계, 인메모리 버퍼 & SSE 스트림 |
| **서버 코어** | `server/server.py` | **16개 라우터 등록**, `lanovel_security_middleware` (루프백 100% 프리패스 + LAN 토큰 검증 + CSRF 차단), Windows IOCP WinError 64 클라이언트 접속 끊김 예외 필터링, FTS5 가상테이블/트리거, 30분 괄호복원, 백업, 큐 틱 루프([`queue_tick_loop`](file:///C:/LANOVEL/server/routers/remote.py)) 수명주기 관리 |
| **번역 엔진** | `server/routers/translation.py` | Gemini 호출, 기본모델 verbatim 2단계 자체 복구([`_recover_verbatim_items`](file:///C:/LANOVEL/server/routers/translation.py)), 17시 안전 중단, **`GET /api/rpm_status`** |
| **데이터 CRUD** | `server/routers/data_crud.py` | FTS5 전문 검색, N+1 제거 upsert, 이상 번역 검출, 복원 센터 모달(휴지통/알림) |
| **사전/코퍼스** | `server/routers/dictionary.py` | **100% No-AI 사전 연동 및 누적 코퍼스 검색** (`GET /api/dictionary/lookup`, `GET /api/dictionary/links`) |
| **사전 서비스** | `server/services/dictionary_service.py` | 네이버/Weblio/Jisho/Goo 사전 링크 생성, 34만+ 문장 코퍼스 검색, 빈도 등급 및 한국어 대응 표현 통계 |
| **서재/책** | `server/routers/books.py` | 도서 숨김/표시, URL 번역 상태 배치 확인([`check_translated_urls`](file:///C:/LANOVEL/server/routers/books.py)), NovelUp+ 줄거리 크롤링, 회차 내 위치 복원 |
| **목차 파서** | `server/routers/toc_importer.py` | 카쿠요무(Apollo State Next.js), 소설가가 되자 100화 단위 다중 페이징 순회([`fetch_all_syosetu_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)), NovelUp+ ([`fetch_all_novelup_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)) 목차 수집 (`POST /api/import-toc`) |
| **동기화** | `server/routers/sync.py` | 모바일 초고속 양방향 동기화: `/ping`, 하이브리드 zlib 압축 SQLite 시드 DB(`/full-pack`), `/pull`, `/push` |
| **앱 배포** | `server/routers/app_release.py` | 모바일 OTA 무선 자동 업데이트: `/api/app/version`, `/api/app/download`, 웹 랜딩 페이지(`/download`) |
| **구분선** | `server/routers/separators.py` | 후기/광고 번역 차단용 소설별 구분선 CRUD (공통 7종, 프리셋 6종) |
| **원격 허브** | `server/routers/remote.py` | 모바일/웹 리모컨 (`/command`, `/status`, `/ws`, `/poll`, `/report`, `/ack`) 및 연속 번역 큐 제어 API (`/queue`, `/queue/config`, `/queue/reorder`, `/queue/event`) |
| **소설 큐 러너** | `server/novel_queue.py` | **원격 소설 연속 번역 대기열 엔진**: `QueueRunner`, `NovelQueueManager`, 신데렐라 모드(17시 쿼터 중단 및 익일 자율 복구), 3회 재시도 및 건너뛰기 안전장치 |
| **특별 적재** | `server/routers/special_batch.py` | 배치 번역/보정본 검수 UI(`/special_batch`), 카드 헤더 [🔗 원본 ↗] 링크, 승인 시 원래 소설 폴더 자동 상속, 미분류(None) 보존, 일괄 승인 |
| **크롬 확장** | `extension/` | **TypeScript + esbuild 단일 책임 모듈화 구조**: `src/content.ts`, `src/background/` (`remote_ws.ts`, `queue_tabs.ts`, `index.ts`), `src/scrapers/` (`syosetu.ts`, `kakuyomu.ts` 등), `src/core/` (`state.ts`, `chunker.ts`(글자 수 연동 가변 청킹: 기본 45개·대화문 최대 75개·1300자 밀도 분할), `filters.ts`, `turbo.ts`, `separators.ts`, `adaptive_throttle.ts`, `dom_applier.ts`(`jumpToParagraph` 해시/PID 기반 부드러운 스크롤 & 펄스 발광, 화면 비율 65% 규칙 동적 사이드바 제어), `row_actions.ts`, `page_translator.ts`, `queue_session.ts`), `src/ui/` (`sidebar.ts`, `review_panel.ts`, `separator_panel.ts`, `hud.ts`(플로팅 미니멀 & 프로그레스/카운트다운 타이머 HUD), `key_nav.ts`, `toc_quick_jump.ts`) |
| **모바일 앱** | `mobile_app/lib/`<br>`mobile_app/shaders/` | **하이퍼 에스테틱 Luminary UI & Impeller GLSL 셰이더 (v1.7.0)** (`replaceSeedDatabase` 원자적 시드 교체, 진도/북마크 동기화 역전 방지, 상단고정·독서잔디 양방향 동기화, TTS 유니코드 정규화 캐시, OLED 셰이더 완전 바이패스 절전 & `onAccentColor` 고대비 가독성, 볼륨키 넘김 MethodChannel, 원문 대역 병기/여백 슬라이더, `_RuleEditorCardItem` IME 한글 자모 분리 방지) |
| **웹 프론트** | `server/static/admin/` | **ES 모듈 분리 관리자 UI**: `admin-main.js` (진입점 & 단축키), `admin-tree.js` (3단계 트리, 단락별 1-클릭 [🔗 원본 ↗] 버튼 및 PID 배지 링크, 검색 시 소설 폴더 자동 전개 차단 `isFolderCollapsed = true` 및 사이버네틱 일치 표시등 `novel-match-lamp`, 회차 지연 로딩 Lazy Loading 유지로 검색 렉 0ms, `updateSearchJumpUI`, `jumpToMatchingNovel`), `admin-state.js` (전역 상태 및 DOM 캐시), `admin-dock.js`, `admin-analytics.js`(회차·문단·글자·밀도 4종 메트릭, Throughput 속도 스펙트럼 차트, 신규 번역 성능 & AI 엔진 탭, 텍스트 정제율, 상위 5대 점유율 바, 문학 대비 인포그래픽, KST 24시간 활동 프로필·하루 시작 16시 인디케이터), `admin-restore.js`, `admin-find-replace.js` |
| **웹 프론트** | `server/static/` | `viewer.js` (3D 닉시관 인디케이터, 사전 & 용례 학습 패널), `library.js` (증기 차분기관 톱니/배관/압력계 대시보드), `admin-fx.js` (사이버네틱 오디오 & 파티클 엔진) |
| **검수 가속화** | `review_acceleration_plan/` | **검수완료율 가속화 및 DB 용량 최적화 전략 입안서**(`review_boost_strategy.md`): Trigram FTS5 및 1시간 주기 백업 용량 방어, 검수완료(`is_reviewed`) 기반 Cold Data 격리 & 회차 통압축 로드맵, 완결 근접도(Near-Completion) & 콤보/연쇄폭발/정화율 게이미피케이션 기획 |

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 플랫폼 (Kakuyomu / Syosetu / NovelUp+ / Hameln / Alphapolis) ]
           ▲
           │ DOM 파싱 (p/l 태그, 소설명 감지, 구분선 감지, 다음 화 '次へ' 자동 이동)
           │ 스마트 키보드 내비게이션 (]/L 다음화+자동번역, [/H 이전화, O/T 목차, N 미번역 퀵점프)
           │ URL 해시(#L15, #p15) 기반 특정 단락 순간이동 + 펄스 발광 + 화면 비율 65% 이상 시 사이드바 동기화
           ▼
[ 크롬 확장 프로그램 (extension/src/ -> build.js -> extension/content.js & background.js) ]
   - src/core/page_translator.ts & dom_applier.ts: jumpToParagraph(rawPid), hashchange 이벤트 실시간 감지
   - src/core/dom_applier.ts & row_actions.ts: 본문 DOM 주입/복원, 개별 문장 인라인 저장 및 단건 즉시 재번역
   - src/background/remote_ws.ts: WebSocket(ws://127.0.0.1:8001/api/remote/ws) + HTTP 폴링 백오프, 원격 명령 실행
   - src/ui/: 사이드바(sidebar.ts), 알림 센터 연계 검수 패널(review_panel.ts), 구분선 자동 제외/복원 패널(separator_panel.ts), 플로팅 HUD(hud.ts: 프로그레스 바 & 카운트다운 타이머), 목차 배지 & 퀵점프 패널 (toc_quick_jump.ts)
           │ HTTP (POST /translate, GET /api/rpm_status, POST /api/check_translated_urls, POST /api/import-toc, WS /api/remote/ws, POST /api/remote/queue/event)
           ▼
[ FastAPI 백엔드 서버 (server/server.py: 8001 포트) ]
   - server/routers/ai_review.py: AI 단락 검수 및 2차 재재번역 큐 API (url, pid 반환)
   - server/templates/: ai_review, ai_reretranslate, db_editor, special_batch 각 검수 시스템 [🔗 원본 ↗] 링크 제공
   - server/services/rpm_manager.py: 2단계 윈도우 RPM 및 회차 분당 빈도 연동 적응형 지연 (8s~55s)
   - server/novel_queue.py: 연속 번역 큐 스케줄러 & 신데렐라(17시 중단-익일 재개) 워커
   - server/routers/books.py & sync.py: 북마크/활동로그 및 모바일 zlib 압축 SQLite 시드 전송
           ▲
           │ SQLAlchemy ORM + WAL Mode (busy_timeout 5000ms)
           ▼
[ SQLite 데이터베이스 (server/translations.db) ]
```

---

## 2. 사용자 지시 및 발화-코드 1:1 매핑 사전 (Intent Routing Dictionary)

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 처리 내용 |
| :--- | :--- | :--- |
| **"HUD 알림 보강해줘 / 다음 번역 타이머 띄워줘 / HUD에 번역 진행도 표시"** | `extension/src/ui/hud.ts`<br>`extension/content.css`<br>`extension/src/core/page_translator.ts`<br>`extension/src/content.ts` | 화면 우측 상단 플로팅 HUD(#lanovel-hud)에 `showLanovelProgressHud` 및 `startLanovelCountdownHud`를 탑재하여 번역 묶음 진행도(백분율, N/M문장, 그라디언트 프로그레스 바), 묶음 간 대기 및 다음 화 이동 적응형 지연(8s~55s)의 실시간 초 단위 카운트다운 타이머, 번역 완료 통계(총 문장수 및 이번 연속 N화)를 시각적으로 즉각 안내 |
| **"단락 링크 누르면 해당 단락으로 순간이동하고 클릭 효과 주기" / "원문 페이지 해당 단락으로 점프"** | `extension/src/core/dom_applier.ts`<br>`extension/src/content.ts`<br>`server/static/admin/admin-tree.js`<br>`server/templates/ai_review.html`<br>`server/templates/ai_reretranslate.html`<br>`server/templates/db_editor.html`<br>`server/templates/special_batch.html` | admin.html 단락 행 및 4종 검수 시스템에 1-클릭 `[🔗 원본 ↗]` 버튼(`target="lanovel_novel_reader"`, `${url}#${pid}`) 배치. 크롬 확장의 `jumpToParagraph()`가 URL 해시(#PID)를 파싱하여 부드러운 스크롤 & 펄스 발광(`lanovel-highlight-pulse`). 창 너비가 모니터의 65% 이상일 때만 사이드바를 자동 오픈하여 해당 번역 행 동기화(`lanovel-row-highlight`), 미만일 때는 본문 집중 유지. 탭 재사용 시 `hashchange`로 무새로고침 즉각 순간이동. |
| **"일별 추이 하단에 연도 추가해줘 / 그래프 밀도 너무 높아서 큰창으로 보게 해줘 / 뷰어 기능 전부 넣어줘"** | `server/templates/admin.html`<br>`server/static/admin/admin-analytics.js`<br>`server/static/admin/admin-main.js` | 일별 추이 X축 레이블에 연도(`YY.MM.DD`) 표기. `[심층 뷰어 (큰창)]` 버튼 및 `#trendGraphViewerModal`(95vw, 90vh) 탑재. 밀도 해소를 위한 일간/주간/월간 집계 주기 전환, 4종 차트 스타일(Area, Bar, Spline, Step), 휠 줌/슬라이더 범위 조절, 피크 마커·평균선·주말 음영 오버레이, 상단 크로스헤어 HUD 인스펙터, PNG/CSV 내보내기 지원. |
| **"통계 속도 차트 추가해줘 / 탭별 통계 더 추가해줘 / 번역 성능 탭 개설해줘"** | `server/routers/admin.py`<br>`server/templates/admin.html`<br>`server/static/admin/admin-analytics.js`<br>`tests/test_admin_analytics.py` | Throughput 섹션에 시간대별 속도 스펙트럼 SVG 차트 탑재 및 클라이언트 방어 산출(`getSafeEfficiency`) 보장. 탭 2(품질)에 정제율·용어 보존율 카드, 탭 3(작품)에 상위 5대 점유율 스펙트럼 바·4대 규모 티어 카드, 탭 4(규모)에 명작 문학 대비·서가 물리적 부피 카드 추가. 신규 5번째 탭 '번역 성능 & AI 엔진 효율'(`tabStatPerformance`) 개설하여 초당 처리속도, 회차당 소요시간, 성능 시계열 곡선 차트, 파이프라인 무결성 HUD 제공. |
| **"통계 모듈에 회차수도 넣어줘 / 번역 속도·처리 효율성(Throughput) 지표 추가해줘"** | `server/routers/admin.py`<br>`server/templates/admin.html`<br>`server/static/admin/admin-analytics.js`<br>`tests/test_admin_analytics.py` | 일별 추이에 `episodes` 집계 및 `cum_episodes`, `ma7_episodes` 산출. 메트릭 버튼을 `[회차 수] [문단 수] [글자 수] [회차당 분량]` 4종으로 확장. Throughput & Efficiency HUD(시간당 최대 속도, API 호출당 청킹 수율, 회차당 분량 밀도, 주간 완독 환산량) 추가 및 툴팁에 `당일 N화·N문단·N자` 3종 종합 브레이크다운 출력. |
| **"통계 모듈 손봐줘 / 하루 시작점(초기화 시간) 통계에 적용해줘 / 통계 시간대 왜곡"** | `server/database.py`<br>`server/routers/admin.py`<br>`server/static/admin/admin-analytics.js`<br>`server/static/admin/admin-state.js`<br>`tests/test_admin_analytics.py` | `_sqlite_to_quota_hour`를 한국 시간(KST)으로 수정 및 `TO_KST_HOUR` 등록. 24시간 활동 분포를 API 초기화 시각(16시/17시)부터 시작하는 24시간 순환 정렬(`[16..23, 0..15]`)로 개편하고 `is_reset_start` 하루 시작점 배지 및 실제 피크 시간대(KST) 도출. `admin-state.js`에서 `quota_window_start_ts` 1순위 참조 및 9시간 중복 차감 버그 해결. |
| **"서버 허브 개선해줘 / 중복 실행 막아줘 / 로그 파일 너무 커 / 포트 안 닫혀"** | `C:\ServerHub\server_hub.pyw`<br>`C:\ServerHub\log_viewer.pyw`<br>`C:\ServerHub\hub_utils.py`<br>`start_server_hub.bat`<br>`open_logs.bat` | `acquire_single_instance_mutex`로 트레이/뷰어 프로세스 이중 실행 방지. `kill_by_port`로 포트 8000/8001 점유 프로세스 트리 확실하게 강제 종료. `SO_LINGER (1, 0)` 즉각 해제 소켓으로 `TIME_WAIT` 소켓 누적 원천 차단. 15MB 초과 시 `.old` 백업 및 0바이트 리셋 로그 자동 로테이션. `poll_logs`(300ms)와 서버 상태 체크(2.5s)를 분리하여 네트워크 부하 절감. `C:\LANOVEL\venv` 가상환경 표준 바인딩. |
| **"원격으로 여러 소설 연속 번역해줘 / 큐 등록해줘 / 신데렐라 모드 켜줘"** | `server/novel_queue.py`<br>`server/routers/remote.py`<br>`extension/src/core/queue_session.ts`<br>`mobile_app/lib/ui/remote/remote_control_screen.dart`<br>`mobile_app/lib/services/remote_control_service.dart` | 폰 리모컨 화면 `_queueSection`에서 URL 추가·삭제·재시도·드래그 순서 변경·목록 자동 진행/신데렐라 스위치·최근 이슈 3개 관리(`RemoteControlService.fetchQueue/addQueueUrls/removeQueueItem/reorderQueue/retryQueueItem/setQueueConfig`). 폰 리모컨에 소설 개요 URL 목록을 전송(`POST /api/remote/queue`)하면 서버 `QueueRunner`가 에피소드 파싱 및 차례대로 탭 이동 명령 발송. 17시 마감 시 신데렐라 모드가 안전 대기 후 다음날 자동 재개. |
| **"모바일 앱 빌드해줘 / 릴리즈 APK 만들어줘"** | `scripts/setup_mobile.ps1`<br>`mobile_app/pubspec.yaml` | `.\scripts\setup_mobile.ps1 -BuildApk` 실행. Flutter release APK 컴파일 후 `server/static/lanovel-reader-release.apk` 자동 복사 및 Wi-Fi 연결 기기에 실시간 무설치 업데이트 신호 발송. |
| **"소설 회차 목록 펼치지마(렉 심해), 일치 단락 존재 표시등 띄워주면 내가 알아서 펼칠게"** | `server/static/admin/admin-tree.js`<br>`server/static/admin.css` | 검색 시에도 소설 폴더를 자동으로 펼치지 않고 `isFolderCollapsed = true` 강제 유지. 일치 소설 헤더에 네온 펄스 표시등(`.novel-match-lamp`, 일치 단락수/회차수)을 띄우고, 비일치 소설은 반투명 처리. 점프 이동 시에도 폴더를 열지 않고 헤더 위치 스크롤 및 네온 펄스 하이라이트만 진행하여 사용자 자율 열람 보장. |
| **"관리자에서 검색할 때 일치하는 소설만 펼쳐줘" / "첫 소설로 이동"** | `server/static/admin/admin-tree.js`<br>`server/static/admin/admin-main.js`<br>`server/static/admin.css` | `jumpToMatchingNovel()`을 통해 첫 번째 일치 소설로 `scrollIntoView` 및 네온 펄스(`jump-highlight`) 재생. `Enter` 및 `[↓ 첫 소설]` 버튼 바인딩. |
| **"검색할 때 렉 너무 심해" / "화면 멈춰"** | `server/static/admin/admin-tree.js`<br>`server/static/admin.css` | 검색 시 모든 회차의 테이블 행을 강제로 그리던 `shouldRenderImmediately` 제거. 회차 아코디언은 기본 접힘(`isUrlGroupCollapsed = true`) 및 일치 뱃지 표시, 클릭 시 `renderUrlGroupContent()`를 통한 0.01초 지연 로딩(Lazy Loading)으로 DOM 폭발 렉 99.8% 제거. |
| **"텍스트 칠 때마다 동적 검색하는 거 리소스 낭비야" / "Enter나 버튼 눌러서 검색하게 해줘"** | `server/templates/admin.html`<br>`server/static/admin/admin-main.js`<br>`server/static/admin.css` | 실시간 300ms 디바운스 검색 리스너 폐지. 타이핑 중 렌더링 0회. `Enter` 키 또는 `[검색]` 버튼 클릭 시에만 1회 검색 실행 및 첫 소설 자동 점프. 이미 검색된 상태에서 재차 `Enter` 시 다음 일치 소설, `Shift+Enter` 시 이전 소설 순환. `Esc` 또는 `[✕]` 클릭 시 검색 초기화. |
| **"확장 프로그램 수정하고 빌드해줘" / "확장 빌드해줘"** | `extension/build.js`<br>`extension/package.json` | `npm run build`로 20ms 내에 `content.js`와 `background.js` 초고속 번들링. `npm run typecheck`로 타입 오류 선제 검사. |
| **"확장 프로그램 검수 패널 / 재번역 검수 / 제외 단락 복원"** | `extension/src/ui/review_panel.ts`<br>`extension/src/ui/separator_panel.ts`<br>`extension/src/core/row_actions.ts` | 알림 센터 연계 재번역 검수(`#review-target-panel`, `✓ 검수 완료`), 구분선 자동 제외 검수 및 복원(`#separator-exclude-panel`, `🛡️`), 개별 행 저장 및 단건 재번역(`🔄`). |
| **"원격 제어 안 돼" / "모바일 리모컨 상태 안 올라와"** | `extension/src/background/remote_ws.ts`<br>`extension/src/core/state.ts` | WebSocket(`ws://127.0.0.1:8001/api/remote/ws`) 연결 상태 점검. `state.broadcastStatus()`를 통해 주기적(2초) 및 상태 변화 시 직접 디스패치. |
| **"최근 소설이 분당 번역수가 늘어나서 rpm제한에 걸려"** | `extension/src/core/adaptive_throttle.ts`<br>`server/services/rpm_manager.py` | 최근 5분간 번역된 회차 수를 실시간 추적하여, 회차가 많을수록 다음 화 이동 대기시간을 8초에서 최대 55초까지 계단식으로 늘려 분당 호출 폭증 차단. |
| **"키보드로 다음화 넘어가게 해줘" / "단축키로 다음화 이동"** | `extension/src/ui/key_nav.ts`<br>`extension/src/ui/hud.ts` | `]` 또는 `L` 누르면 세션 플래그 설정 후 다음 화로 이동 -> 새 페이지 로드 즉시 자동 번역 시작 + 플로팅 HUD 안내. |
| **"목차에서 안 읽은(미번역) 화만 골라서 보고 싶어 / 100화 넘는 소설 회차에서 목차가 누락돼 / N키로 목차 서랍 열어줘"** | `extension/src/ui/toc_quick_jump.ts`<br>`extension/src/scrapers/syosetu.ts`<br>`extension/src/ui/key_nav.ts`<br>`server/routers/toc_importer.py` | 목차 감지 시 상태 배지 부착 및 `[⚡ 미번역 N화]` 퀵 점프 드로어 제공. 본문 회차 페이지(`.../128/` 등)에서도 백엔드 `POST /api/import-toc`를 통해 100화 단위 페이징 전체를 순회 수집하여 101~170화 누락 원천 차단. `findTocLink()` N코드 패턴 검증으로 `.c-announce` 오매칭 방지. 본문 페이지에서도 `N` 키로 서랍 즉시 띄우기 및 순차 포커스 이동/`Enter` 진입 지원. |
| **"DB 보호해줘" / "데이터 유실 방지" / "스마트 백업"** | `server/database.py`<br>`server/backup_utils.py`<br>`server/server.py` | SQLite C-Authorizer(`DROP TABLE` 차단), SQLAlchemy `before_cursor_execute`(전건 DELETE 차단), 비서버 스크립트 `query_only=ON`, 1시간 주기 스마트 스킵 및 음수 역전 시 백업 중단 & 모바일 비상 경보(`db_alert`). |
| **"모바일에서 유실 데이터 복구"** | `server/routers/sync.py`<br>`mobile_app/lib/services/sync_service.dart` | `POST /api/sync/rescue-from-mobile`: 모바일에 캐시된 압축 챕터 중 PC DB에 없는 누락 회차(비파괴 INSERT OR IGNORE)만을 안전 복원. |
| **"번역할 때 문장이 너무 자잘하게 쪼개져 / 청크 분할 너무 잦아 / 대화문 많은데 RPM 낭비돼"** | `extension/src/core/chunker.ts`<br>`extension/src/core/page_translator.ts` | 짧은 대화문이 많은 소설에서도 무조건 40개에서 자르지 않고, 누적 글자 수가 1,300자 미만이면 최대 75문장까지 한 청크에 결합하는 글자 수 연동 적응형 가변 청킹(`createBudgetChunks`) 적용. 서술형(1,300자 이상)은 45개에서 분할하여 Gemini 1:1 매핑 안전 마진 및 RPM 호출 효율 동시 확보. |
