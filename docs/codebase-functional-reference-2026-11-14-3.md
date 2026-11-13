# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트가 사용자 요구사항 및 구어체 지시를 입력받았을 때, 혼선이나 회귀(Regression) 없이 전체 아키텍처와 1:1 타깃 코드를 즉시 파악할 수 있도록 압축 정리한 단일 진실 공급원(SSOT) 기술 레퍼런스입니다.
> **최신 동기화 일자**: 2026-11-14 (레퍼런스 문서 구조 분리: 핵심 맵/아키텍처 ↔ 발화-코드 매핑 사전, 과거 버전 `docs/archive/reference/` 이관)

## 📚 레퍼런스 문서 구성 (반드시 함께 확인)

| 문서 | 역할 | 갱신 방식 |
| :--- | :--- | :--- |
| **본 문서** `docs/codebase-functional-reference-YYYY-MM-DD.md` | 모듈·라우터 맵(Fast Lookup) + 시스템 아키텍처/데이터 흐름 = **현재 상태 스냅샷** | 구조·함수·API 변경 시 해당 행을 **덮어써서** 최신화 (이력 누적 금지) 후 파일명 날짜/접미사 갱신 |
| [`docs/reference/intent-routing-dictionary.md`](reference/intent-routing-dictionary.md) | 사용자 발화 ↔ 관련 파일·함수 1:1 매핑 사전 = **작업 이력 색인** | 작업 완료 시 표 **최상단에 1행 추가** (파일명 고정, 날짜 갱신 불필요) |
| `docs/archive/reference/` | 과거 레퍼런스 버전 보관소 | 새 버전 생성 시 직전 버전을 이곳으로 `git mv` (삭제 금지) |
| `docs/[기능]-[YYYY-MM-DD].md` | 개별 변경 작업 상세 문서 | 작업 단위로 신규 생성 |

> [!NOTE]
> 최근 작업 이력의 상세 맥락(배경, 원인, 수정 내역)은 발화-코드 매핑 사전과 개별 작업 문서를 참조하십시오. 본 문서에는 "지금 코드가 어떻게 생겼는가"만 유지합니다.

---

## ⚡ 빠른 탐색용 핵심 모듈 & 라우터 맵 (Fast Lookup)

| 구분 | 파일 경로 | 핵심 역할 및 주요 함수/클래스 |
| :--- | :--- | :--- |
| **통합 허브** | `C:\ServerHub\server_hub.pyw`<br>`C:\ServerHub\log_viewer.pyw`<br>`C:\ServerHub\hub_utils.py` | **공동 서버 관리 트레이 & 실시간 모니터링**: LANOVEL(8001) + ASMR Vault(8000) 동시 제어, Windows Named Mutex 단일 인스턴스 보장, `kill_by_port` 포트 기반 프로세스 종료, `rotate_log_file` 자동 로테이션, `SO_LINGER` 소켓 `TIME_WAIT` 방지, LANOVEL venv 표준 바인딩 |
| **데스크톱** | `main.py` | PyWebView 윈도우 + 시스템 트레이(`Pystray`) + 서버/셀러리 서브프로세스 수명주기 관리 |
| **설정/연결** | `server/settings.py` | Pydantic 환경변수 (.env), Gemini 모델(`gemini-3.5-flash-lite`), 포트(8001), CORS 허용 출처, 보안 토큰 해시 |
| **보안 코어** | `server/security.py` | PBKDF2-HMAC-SHA256 (10만 회 솔트 해시), `verify_token` 상수 시간 비교, `is_safe_external_url` SSRF 사설망 방어 |
| **DB 코어** | `server/database.py` | SQLite WAL 모드, `busy_timeout=5000`, `REGEXP`, `TO_QUOTA_DATE`, `TO_QUOTA_HOUR`(`TO_KST_HOUR`), `TO_QUOTA_DOW` 주입, `PROTECTED_TABLES` (`novel_illustrations` 포함), SQLAlchemy 세션 제너레이터 |
| **ORM 모델** | `server/models.py` | `Translation`, `DeletedRecord`, `BookActivity`(`is_visible` 포함), `SentenceHighlight`(**태블릿 전용 원문 대조 수정 대기 마킹**), `NovelIllustration`(**회차 본문 인라인 삽화 메타데이터**), `NovelSeparatorSetting`, `TranslationTrash`, `ExcludedSentence`, `SpecialBatchQueue`, `ApiCallLog`, `CleanupNotification` 등 24개 모델 클래스 |
| **본문 삽화** | `server/routers/illustrations.py`<br>`server/services/illustration_service.py` | **소설 회차 인라인 삽화 API & 이미지 저장소**: `GET/POST /api/illustrations` (Base64 업로드 + 루프백 전용 `source_path`), `PUT/DELETE /api/illustrations/{id}` (`DeletedRecord(entity_type="illustration")` 기록), `GET /api/illustrations/book/{book}/chapters|pids`, `GET /api/illustrations/{id}/image` (`FileResponse`, Pillow 검증/20MB 상한/경로 탈출 차단) |
| **하이라이트/마킹** | `server/routers/highlights.py` | **태블릿 원문 대조 수정 대기 마킹 라우터**: `GET /api/highlights` (미해결 마킹 목록 조회), `GET /api/highlights/counts` (소설별 미해결 마킹 건수 딕셔너리), `POST /api/highlights` (단건/일괄 하이라이트 생성), `POST /api/highlights/resolve` (수정 완료 마킹 해제), `DELETE /api/highlights/{id}` |
| **RPM 관리** | `server/services/rpm_manager.py` | **2단계 슬라이딩 윈도우(API 60초 + 회차 5분)**, 최근 회차 가중 적응형 휴식([`proactive_rpm_rest`](file:///C:/LANOVEL/server/services/rpm_manager.py)), **`_SESSION_LOCK` 기반 스레드 안전 세션 소켓 재생성(`get_gemini_session`, `recycle_gemini_session`)**, 회차 기반 가변 딜레이 계산([`calculate_episode_adaptive_delay`](file:///C:/LANOVEL/server/services/rpm_manager.py)) |
| **품질/복원** | `server/rule_classifier.py` | 100% 룰베이스 번역 품질 분류(규칙 1~4), 대사 괄호(`「%」`) 자동 복원([`restore_brackets`](file:///C:/LANOVEL/server/rule_classifier.py)) |
| **알림/현황판** | `server/notifications.py` | 배민 스타일 단일 번역 현황판([`update_translation_status`](file:///C:/LANOVEL/server/notifications.py)), Gemini API 오류 통계, 인메모리 버퍼 & SSE 스트림, **정각 리셋 및 비활성 시 `percentage` 최신 쿼터 동기화([`get_translation_status`](file:///C:/LANOVEL/server/notifications.py))** |
| **쿼터 관리** | `server/quota.py` | **Gemini API 일일 쿼터 & 타임존 엔진 SSOT**: `zoneinfo("America/Los_Angeles")` 기반 실시간 `is_us_dst`, LA 자정 기준 쿼터 윈도우 시작([`get_current_quota_window_start`](file:///C:/LANOVEL/server/quota.py)), 다음 리셋 정각([`get_next_quota_reset_dt`](file:///C:/LANOVEL/server/quota.py), [`get_next_quota_reset_hour`](file:///C:/LANOVEL/server/quota.py)), [`get_quota_summary`](file:///C:/LANOVEL/server/quota.py), **구글 게이트웨이 실제 RPD 차감 일치 전건 계측(가짜 시드 배제 및 순수 호출 카운트 SSOT, [`get_today_api_call_count`](file:///C:/LANOVEL/server/quota.py), [`record_api_call`](file:///C:/LANOVEL/server/quota.py))** |
| **서버 코어** | `server/server.py` | **23개 라우터 등록(`ui`, `translation`, `data_crud`, `books`, `system`, `tasks`, `admin`, `url_config`, `db_editor`, `toc_importer`, `separators`, `notifications`, `sync`, `app_release`, `unclassified`, `dictionary`, `corpus_ai`, `ai_review`, `remote`, `special_batch`, `collector`, `highlights`, `illustrations`)**, `lanovel_security_middleware` (루프백·Tailscale 프리패스 + LAN 토큰 검증 + CSRF 차단), Windows IOCP 접속 끊김 예외 필터링, FTS5 가상테이블/트리거, 30분 괄호복원, 백업, 큐 틱 루프 수명주기 관리 |
| **번역 엔진** | `server/routers/translation.py` | Gemini 호출, 실시간 RPM Zone 피드백 반환, [`_post_process_translated_text`](file:///C:/LANOVEL/server/routers/translation.py) → `post_process_translated_text` 공통 후처리(HTML 환각 제거 포함), 기본모델 verbatim 2단계 자체 복구, **`force_hdtrans` 요청 시 로컬 hdTrans 오프라인 엔진 초고속 직접 번역(쿼터 0회)**, **배치 검열 차단 후 단일 문장 검열 발생 시 hdTrans 대체 번역 연동**, **타임스탬프 기반 정각 안전 중단([`_QuotaStopState`](file:///C:/LANOVEL/server/routers/translation.py))**, **`GET /api/rpm_status`**, **`POST /translations/exclude`**, **`POST /translations/restore_excluded`** |
| **번역 엔진 코어** | `server/services/translation_engine.py`<br>`server/services/translation_recovery.py` | `TRANSLATION_SYSTEM_INSTRUCTION` (**PLAIN TEXT ONLY / HTML·취소선 금지**), [`strip_html_hallucinations`](file:///C:/LANOVEL/server/services/translation_engine.py) (환각 HTML 태그·`<s>/<del>/<strike>` 취소선 블록 정제, 일반 `<...>` 보존), [`post_process_translated_text`](file:///C:/LANOVEL/server/services/translation_engine.py) (공통 후처리 파이프라인 SSOT), `call_gemini_api` (실제 구글 전송 전건 `record_api_call`, HTTP 에러 2중 중복 기록 원천 차단, 세션 리사이클링), `_recover_verbatim_items` (스마트 미니배치 15개 단위 묶음 복구, HTML 금지/정제 일원화 및 **매 Step 2 호출 시 `get_gemini_session()` 동적 조회로 닫힌 세션 재사용 차단**), `handle_verbatim_cleanup_items` (동일 회차 기존 활성 알림 UPSERT 갱신, 미분류 자동 승격, 중복 알림 자동 병합 정리), `_fallback_hdtrans_or_split` (검열 감지 시 hdTrans 즉시 대체 번역 연동) |
| **데이터 CRUD** | `server/routers/data_crud.py`<br>`server/services/cleanup_trash_service.py` | FTS5 전문 검색, N+1 제거 `upsert_translations` (**저장 시 `strip_html_hallucinations` 선행 정제 후 `restore_brackets` 괄호 복원**), **검열 회피 소설 외 일반 번역 미분류(`folderName=None`) 적재 및 동일 URL 속성·시각 상속**, **기존 번역 수정 시 원본 `timestamp` 보존 및 매칭 하이라이트 자동 `is_resolved = 1` 처리**, `toc_sort_order` 단락 단위 영구 상속 및 일괄 동기화, 이상 번역 검출, **복원 센터 모달(휴지통/삭제 알림 중복 자동 Deduplication 및 포괄 검수 연계)** |
| **사전/코퍼스** | `server/routers/dictionary.py` | **100% No-AI 사전 연동 및 누적 코퍼스 검색** (`GET /api/dictionary/lookup`, `GET /api/dictionary/links`) |
| **사전 서비스** | `server/services/dictionary_service.py` | 네이버/Weblio/Jisho/Goo 사전 링크 생성, 34만+ 문장 코퍼스 검색, 빈도 등급 및 한국어 대응 표현 통계 |
| **서재/책** | `server/routers/books.py`<br>`server/services/book_service.py` | 도서 숨김/표시, URL 번역 상태 배치 확인([`check_translated_urls`](file:///C:/LANOVEL/server/routers/books.py)), NovelUp+ 줄거리 크롤링, 회차 내 위치 복원, **TOC 목차 순서 갱신([`update_book_toc_order`](file:///C:/LANOVEL/server/services/book_service.py))**, **`update_folder_name` 시 `novel_illustrations.book_name` 연쇄 갱신 및 `get_book_urls` 내 `illustration_count` 주입** |
| **목차 파서** | `server/routers/toc_importer.py` | 카쿠요무(Apollo State Next.js), 소설가가 되자 100화 단위 다중 페이징 순회([`fetch_all_syosetu_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)), NovelUp+ 목차 수집 (`POST /api/import-toc`, 성인/검열 사이트 novel18/noc `over18=yes` 쿠키 자동 주입) |
| **동기화** | `server/routers/sync.py` | **안전 스냅샷 기반 무음 자동 동기화 & 하이라이트·삽화 양방향 전송**: `/ping`, zlib 압축 시드 DB(`/full-pack`, `novel_illustrations` 적재), 증분 다운로드(`/pull`, `highlights`·`illustrations`·`deletions` 동봉), 모바일 수동/자동 변경사항 업로드(`/push`, `highlights` 병합·`deleted_highlights` 해제 반영 및 번역 수정 시 자동 resolve), 긴급 역복구(`/rescue-from-mobile`) |
| **앱 배포** | `server/routers/app_release.py`<br>`tests/test_app_release.py` | 모바일 OTA 무선 자동 업데이트: `/api/app/version` (현재 `v1.8.4.2026111303`), `/api/app/download`, `/api/app/broadcast_update`, 웹 랜딩 페이지(`/download`); 단위 테스트 시 `tmp_path` 격리로 `release_notes.json`/`pubspec.yaml` 오염 차단 |
| **구분선** | `server/routers/separators.py` | 후기/광고 번역 차단용 소설별 구분선 CRUD (공통 7종, 프리셋 6종) |
| **원격 허브** | `server/routers/remote.py` | 모바일/웹 리모컨 (`/command`, `/status`, `/ws`, `/poll`, `/report`, `/ack`) 및 연속 번역 큐 제어 API (`/queue`, `/queue/config`, `/queue/reorder`, `/queue/event`) |
| **소설 큐 러너** | `server/novel_queue.py` | **원격 소설 연속 번역 대기열 엔진**: `QueueRunner`, `NovelQueueManager`, NovelUp+ 공식 바인딩, 신데렐라 모드(17시 쿼터 중단 및 익일 자율 복구), 3회 재시도 및 건너뛰기 안전장치 |
| **원문 수집기** | `server/routers/collector.py`<br>`server/services/collector_service.py`<br>`server/services/hdtrans_service.py`<br>`server/templates/raw_collector.html` | **검열 회피 원문 일괄 수집 & hdTrans 오프라인 초벌 번역 플랫폼**: Gemini API 호출 0회 순수 원문 크롤링, 12화마다 120초 안전 쿨다운, 기수집 회차 0초 스킵, `ManualTranslationNovel` 화이트리스트, hdTrans v0.9.4 로컬 연동 초벌 번역, 서재 검수완료 자동 승격 |
| **인명·용어 교정기** | `server/routers/db_editor.py`<br>`server/templates/db_editor.html`<br>`mobile_app/lib/ui/glossary/character_fixer_screen.dart`<br>`mobile_app/lib/services/character_fixer_service.dart` | **인명·고유명사 검수 & 스마트 잔여 소설 우선 추천 엔진**: `character_rules.json` 기반 불변 조건 정밀 스캔, 틴더 카드 및 일괄 리스트 검수 모드, 소설 진입 시 잔여 수정 건수 최소 소설 자동 1순위 추천 |
| **특별 적재** | `server/routers/special_batch.py` | 배치 번역/보정본 검수 UI(`/special_batch`), 카드 헤더 [🔗 원본 ↗] 링크, **단건/일괄 승인(`approve_staged_item`, `batch_approve_staged`) 시 `strip_html_hallucinations` 정제 적용**, 원래 소설 폴더 자동 상속, 미분류 보존 |
| **미분류 보관소** | `server/routers/unclassified.py` | **미분류 소설 보관함 & 폴더 귀속 엔진**: 작품 메타데이터 자동 파싱, 웹 제목 자동 스크랩, 스마트 기존 폴더 매칭, 폴더명 예약 저장 및 원클릭 즉시 등록 |
| **AI 검수 파이프라인** | `server/routers/ai_review.py`<br>`scripts/fetch_unreviewed.py`<br>`scripts/insert_reviewed_items.py`<br>`scripts/clean_batch_3342_stage1.py`<br>`scripts/insert_other_lang_21.py`<br>`scripts/stage2_part1.py`<br>`scripts/stage2_part2.py`<br>`scripts/run_ai_review_batch.py` | **AI 검수 큐 & 대량 배치 적재 엔진**: 미번역·촉음/장음 오염·타언어 이상치(3,342건 포함 누적 11,204건) 순서 보장 정제 및 1:1 고품질 번역 적재(`REMAINING_TOTAL: 0`), `classify_translation == 'normal'` & CJK-free 전수 검증, HTML·취소선 금지 프롬프트 및 `clean_ai_translation` 내 `strip_html_hallucinations` 정제 연동, `ai_review_queue` 웹 검수 UI([`/ai_review`](http://localhost:8001/ai_review)) |
| **크롬 확장** | `extension/` | **TypeScript + esbuild 단일 책임 모듈화 구조**: 본문 호버 스마트 플로팅 액션 위젯 `#lanovel-p-action-pill`, Alt+클릭 제외 토글, **503 과부하 재시도 정책 분리(`src/core/retry_policy.ts`, 최대 3회 연속 허용·5초 쿨다운 재시도 2회 후 4회차·반갈 분할 없이 `pauseTranslationForManualResume` 안전 일시정지)**, 마지막 꾸러미 이후 hdTrans 오프라인 엔진 자동 전환, 새 페이지 이동 시 갱신(초기화) |
| **모바일 앱 (Flutter)** | `mobile_app/lib/`<br>`mobile_app/shaders/` | **태블릿 S8 / 바형 폰 이원화 전자책 서재 & 업로드 변경 내역 인스펙터**: `DeviceUtils`(`shortestSide >= 600`) 단일 기준 분기로 **태블릿 전용 `[🖊️ 마킹]` 파이프라인**과 바형 폰 뷰 분리(바형 폰에서는 마킹 UI/기능 제거); **`models/pending_upload.dart` + `ui/sync/pending_changes_sheet.dart`로 업로드 대기 내역(이전→이후 Diff·큐 병합·사전 확인) 제공**; `local_db_service.dart` 큐 중복 병합 & `pendingCountNotifier`; `models/novel_illustration.dart` + `illustration_cache_service.dart` + `toc_drawer.dart`(`🖼️ N`) + `reader_screen.dart` Scroll/Paging 본문 삽화·`InteractiveViewer` 라이트박스; 원문 롱프레스 토글; 하단 독 4대 탭 `[서재, 찾아바꾸기, 검수 센터, 설정]` |
| **웹 프론트** | `server/static/admin/` | **ES 모듈 분리 관리자 UI**: `admin-main.js`, `admin-highlights.js`(**상단 `[🖊️ 태블릿 마킹 N건]` 모달 및 즉시 수정·해제 연동**), `admin-tree.js`, `admin-state.js`, `admin-dock.js`, `admin-analytics.js`, `admin-restore.js`, `admin-find-replace.js` |
| **웹 프론트** | `server/static/` | `viewer.js?v=3.3` / `viewer.css?v=3.5` (인라인 삽화 `buildChapterFlowItems` + `#illustration-lightbox` + TOC `🖼️ N`), `library.js?v=3.9` / `library.css?v=3.9` (`본문 삽화` 관리 탭 + 오프라인 프리페치), `library_mobile.js?v=2.3` / `library_mobile.css?v=2.3` (모바일 삽화 관리 UI + TOC 뱃지), `admin-fx.js` (사이버네틱 오디오 & 파티클 엔진) |
| **스킬/빌드 자동화** | `.agents/skills/mobile-release-build/`<br>`.agents/skills/novel-illustration/`<br>`.agents/skills/novel-cover/`<br>`mobile_app/pubspec.yaml`<br>`mobile_app/release_notes.json`<br>`scripts/setup_mobile.ps1`<br>`scripts/check_all.ps1` | **Antigravity 워크스페이스 스킬 & 품질 게이트**: 1) `mobile-release-build` (`SKILL.md`, `scripts/bump_and_build.py` 버전 판올림·APK 빌드·OTA 배포), 2) **`novel-illustration`** (`SKILL.md`, `references/prompt_presets.md`, `scripts/novel_scene_helper.py` Read-Only 회차 장면 추출·`character-save`/`character-list`(`characters_registry.json`)·`--preset illust|cover|wide|square`·`register-illustration` 서버 자동 등록), 3) **`novel-cover`** (`SKILL.md`, `references/cover_design_presets.md`, `scripts/novel_cover_helper.py` Read-Only 줄거리·태그·초반부 `brief` 조회·공용 `character-save`/`character-list`·`--preset cover` `896×1280` 표지 아트·`register-frontispiece` 권두 등록), `ruff check server/ scripts/ .agents/skills/` 0 에러 유지 |

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 플랫폼 (Kakuyomu / Syosetu / NovelUp+ / Hameln / Alphapolis) ]
           ▲
           │ DOM 파싱 (p/l 태그, 소설명 감지, 구분선 감지, 다음 화 '次へ' 자동 이동)
           │ 스마트 키보드 내비게이션 (]/L 다음화+자동번역, [/H 이전화, O/T 목차, N 미번역 퀵점프)
           │ 본문 마우스 호버 스마트 플로팅 위젯 [⬆️ 위로 제외] [⬇️ 아래로 제외] [↩️ 제외 해제]
           │ URL 해시(#L15, #p15) 기반 특정 단락 순간이동 + 펄스 발광
           ▼
[ 크롬 확장 프로그램 (extension/src/ -> build.js -> extension/content.js & background.js) ]
     - src/core/retry_policy.ts: HTTP 503 과부하 분리 판별(isServiceUnavailable503Error, createResponseError) 및 최대 3회 연속 허용(최초 1회 + 5초 대기 2회) 후 4회차·반갈 분할 차단(decideChunkRetryAction)
     - src/core/page_translator.ts: translateChunk 직전 state.isPidExcluded() 차단; 503 지속 또는 stop 시 pauseTranslationForManualResume 공통 일시정지(▶️ 대기); 마지막 꾸러미 이후 발생하는 모든 번역은 state.isAfterLastChunk = true로 hdTrans 전환; 새 페이지/다음 화 이동 시 갱신(초기화)
     - src/core/state.ts: manualExcludedPids, isPidExcluded, isAfterLastChunk (hdTrans 폴백 트리거), buildStatusPayload()(resolveResume 대기 중 paused 보고)
     - src/background/index.ts: batchTranslate 메시지에 forceHdtrans 연동 -> POST /translate에 force_hdtrans 전달
     - src/core/dom_applier.ts: ensureParagraphActionPill, positionPillForParagraph, jumpToParagraph(rawPid)
     - src/background/remote_ws.ts: WebSocket + HTTP 폴링 백오프, 원격 명령 실행
           │ HTTP (POST /translate, GET /api/rpm_status, POST /translations/exclude, POST /translations/restore_excluded, POST /api/check_translated_urls, POST /api/import-toc, WS /api/remote/ws)
           ▼
[ FastAPI 백엔드 서버 (server/server.py: 8001 포트, 23개 라우터) ]
     - server/routers/illustrations.py & server/services/illustration_service.py: 회차 본문 삽화 업로드/수정/삭제/스트리밍 (/api/illustrations) 및 Pillow·경로검증
     - server/services/book_service.py: update_book_toc_order 목차 순서 갱신 시 3단계 다중 시간 폴백
     - server/routers/books.py: update_folder_name (novel_illustrations.book_name 연쇄 갱신), get_book_urls (illustration_count 주입)
     - server/routers/highlights.py: 태블릿 수정 대기 마킹 조회·생성·해제 API (GET /api/highlights, GET /api/highlights/counts, POST /api/highlights/resolve)
     - server/routers/data_crud.py: 번역문 수정 저장(upsert_translations) 시 strip_html_hallucinations 선행 정제 후 restore_brackets 복원 및 매칭 SentenceHighlight 자동 is_resolved = 1 처리
     - server/routers/sync.py: 안전 스냅샷 기반 무음 자동 동기화 & 하이라이트(등록/deleted_highlights 해제)·삽화·툼스톤 양방향 전송(/full-pack, /pull, /push)
     - server/routers/app_release.py: 모바일 OTA 버전 조회(/api/app/version), APK 서빙(/api/app/download), SSE 업데이트 브로드캐스트(/api/app/broadcast_update)
     - server/routers/translation.py: POST /translate에서 force_hdtrans=True 감지 시 tools/hdtrans/hdtrans.exe 엔진 직접 번역; Gemini 결과에 post_process_translated_text(화살표 분리 -> strip_html_hallucinations -> 반복캡핑 -> 괄호복원 -> 품질분류) 일괄 적용
     - server/services/translation_engine.py: TRANSLATION_SYSTEM_INSTRUCTION·프롬프트 HTML/취소선 금지, strip_html_hallucinations·post_process_translated_text SSOT 제공
     - server/services/translation_recovery.py: handle_verbatim_cleanup_items 동일 회차 활성 알림 UPSERT 병합; _recover_verbatim_items 스마트 미니배치(15개 단위) 복구 및 post_process_translated_text 통합; _fallback_hdtrans_or_split 검열 감지 시 hdTrans 즉시 대체 번역
     - server/quota.py: zoneinfo("America/Los_Angeles") 기반 실시간 DST 판정 및 쿼터 윈도우 산출; 구글 게이트웨이 실제 RPD 차감 일치 전건 계측 (SSOT)
     - server/notifications.py: 정각 리셋 및 비활성 시 percentage = q["percentage"](0.0%) 즉시 동기화
           ▲                                          │
           │ ORM + WAL Mode                           │ 무음 자동 동기화 (/full-pack, /pull, /push) & OTA (/api/app/*)
           ▼                                          ▼
[ SQLite DB & 데이터 (server/translations.db, server/data/illustrations/) ]   [ 모바일 / 태블릿 (mobile_app/lib/) ]
     - translations 테이블                                                      - services/device_utils.dart (shortestSide >= 600 폼팩터 판별 SSOT)
     - sentence_highlights 테이블                                               - models/pending_upload.dart & ui/sync/pending_changes_sheet.dart (업로드 변경 내역 Diff·사전 확인)
     - novel_illustrations 테이블 & 이미지 파일                                 - ui/library/library_screen.dart (태블릿 양장본 서가·마킹 / 바형 폰 서재 분리 & 동기화 스튜디오)
     - novel_separators, novel_works, deleted_records 등                        - services/local_db_service.dart (큐 중복 병합, before_translated 보존, pendingCountNotifier)
                                                                                - services/sync_service.dart (inspectPendingChanges, deleted_highlights 푸시)
                                                                                - ui/settings/settings_screen.dart (대기 건수 배너·내역 보기·수동 업로드)
                                                                                - ui/viewer/toc_drawer.dart (회차별 🖼️ N 뱃지)
                                                                                - ui/viewer/reader_screen.dart (Scroll/Paging 삽화·라이트박스 & 태블릿 전용 마킹)
```

---
