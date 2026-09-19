# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트와 개발자가 사용자의 요구사항, 용어, 수정 지시를 혼선 없이 정확히 파악하고 대응할 수 있도록, 프로젝트 전반의 아키텍처, 데이터 흐름, 파일별 세세한 함수/클래스 동작 및 의도 매핑 가이드를 정리한 영구 기술 레퍼런스 문서입니다.
> **작성 일자**: 2026-09-19

---

## 목차 (Table of Contents)
1. [시스템 전체 아키텍처 및 데이터 흐름](#1-시스템-전체-아키텍처-및-데이터-흐름)
2. [데스크톱 런처 및 설정 (Launcher & Settings)](#2-데스크톱-런처-및-설정-launcher--settings)
   - `main.py`
   - `server/settings.py`
   - `server/database.py`
   - `server/models.py`
   - `server/utils.py`
   - `server/rule_classifier.py`
   - `server/celery_app.py`
3. [FastAPI 서버 코어 및 라이프사이클](#3-fastapi-서버-코어-및-라이프사이클)
   - `server/server.py`
4. [백엔드 라우터별 세부 함수 및 API 엔드포인트](#4-백엔드-라우터별-세부-함수-및-api-엔드포인트)
   - `server/routers/translation.py` (번역 엔진 및 재시도/검열 분할/품질 검증)
   - `server/routers/data_crud.py` (번역 데이터 CRUD, FTS5 검색, 이상 번역/휴지통/알림 센터)
   - `server/routers/books.py` (서재, 목차 순서, 활동 내역, 줄거리 크롤링, HTML 내보내기)
   - `server/routers/separators.py` (소설별 번역 중단 구분선 관리)
   - `server/routers/toc_importer.py` (카쿠요무/소설가가 되자 목차 크롤링 및 파싱)
   - `server/routers/tasks.py` (Celery 및 BackgroundTasks 백그라운드 크롤링)
   - `server/routers/url_config.py` (URL 번역 적용 토글 및 메타데이터)
   - `server/routers/system.py` (시스템 상태, 로그 조회, CORS)
   - `server/routers/db_editor.py` (웹 DB 관리자 및 레코드 수정)
   - `server/routers/admin.py` (URL 조각 및 특수 PID 정리)
   - `server/routers/ui.py` (템플릿 서빙 라우터)
5. [크롬 확장 프로그램 세부 함수 동작 (Chrome Extension)](#5-크롬-확장-프로그램-세부-함수-동작-chrome-extension)
   - `extension/background.js`
   - `extension/content.js`
6. [웹 프론트엔드 UI 스크립트 세부 함수 동작 (Frontend UI)](#6-웹-프론트엔드-ui-스크립트-세부-함수-동작-frontend-ui)
   - `server/static/admin.js` (관리자 대시보드 & 데이터 정리)
   - `server/static/viewer.js` (웹 뷰어 & 독서 위치 관리)
   - `server/static/library.js` (서재 카드 뷰 & 태그/북마크)
7. [사용자 지시 및 발화-코드 1:1 매핑 사전](#7-사용자-지시-및-발화-코드-11-매핑-사전)

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 사이트 (Kakuyomu / Syosetu) ]
           ▲
           │ DOM 파싱 (문단 p/l 태그, 소설명, 구분선 감지)
           ▼
[ 크롬 확장 프로그램 (extension) ]
   - content.js (DOM 치환, 사이드바 UI, 번역 제어)
   - background.js (API 중계, 인증, 오류 로깅)
           │ HTTP (POST /translate, GET/POST /api/...)
           ▼
[ FastAPI 백엔드 서버 (server:app, Port: 8001) ]
   - translation.py ──▶ [ Google Gemini API ] (gemini-3.5-flash-lite / gemini-3.8-flash)
   - data_crud.py   ──▶ [ SQLite DB (translations.db - WAL Mode) ]
   - books.py       ──▶ [ FTS5 가상 테이블 (translations_fts) ]
   - tasks.py       ──▶ [ Celery Worker / Redis (Port: 6379) ] (Fallback: BackgroundTasks)
           ▲
           │ HTTP & WebSocket / SSE / Static
           ▼
[ 클라이언트 UI / 데스크톱 애플리케이션 ]
   - main.py (PyWebView 데스크톱 윈도우 + Pystray 트레이 + 프로세스 매니저)
   - static/library.js (서재 페이지: /library)
   - static/viewer.js (단일 뷰어 페이지: /viewer)
   - static/admin.js (관리자 및 데이터 관리: /admin)
```

---

## 2. 데스크톱 런처 및 설정 (Launcher & Settings)

### `main.py`
애플리케이션의 진입점이자 데스크톱 환경(PyWebView + System Tray) 래퍼입니다.
- `enable_autostart()`: Windows 시작 프로그램 폴더(`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`)에 VBS 스크립트를 생성하여 부팅 시 백그라운드(최소화)로 자동 실행되도록 설정.
- `disable_autostart()`: 등록된 시작 프로그램 VBS 파일을 삭제하여 자동 시작 해제.
- `start_server()`: FastAPI(uvicorn) 백엔드를 서브프로세스(`sys.executable -m uvicorn server.server:app`)로 실행. `settings.debug`일 경우 `--reload` 옵션 부착.
- `start_celery_worker()`: Celery 비동기 워커를 서브프로세스(`sys.executable -m celery -A server.celery_app worker`)로 기동.
- `stop_process(proc, name)`: 실행 중인 프로세스를 안전하게 종료(`terminate` 후 3초 타임아웃, 미종료 시 `kill`).
- `on_tray_menu_select(icon, item)`: 시스템 트레이 메뉴 클릭 이벤트 처리. "Open Library" 선택 시 웹뷰 창 표시, "Exit" 선택 시 서버/셀러리 서브프로세스를 모두 정리하고 프로그램 종료.
- `wait_for_server(target_url, timeout, interval)`: uvicorn 서버가 완전히 켜질 때까지 HTTP GET 요청을 보내 폴링하며 대기.
- `start_webview()`: PyWebView 라이브러리를 사용해 1200x800 크기의 네이티브 데스크톱 윈도우를 띄우고 `http://127.0.0.1:8001/library`로 진입.
- `main()` (엔트리포인트): 트레이 아이콘 설정, 서버/셀러리 스레드 실행, 웹뷰 기동을 총괄.

### `server/settings.py`
Pydantic `BaseSettings`를 기반으로 환경 변수와 `.env` 파일을 자동 로드하여 중앙 관리합니다.
- `app_name`: `"LANOVEL"`
- `server_host`, `server_port`: 기본값 `127.0.0.1:8001`
- `gemini_api_key`: Gemini API 인증 키
- `gemini_default_model`: 기본 번역 모델 (`gemini-3.5-flash-lite`)
- `gemini_retranslation_model`: 단락 재번역용 모델 (`gemini-3.8-flash`)
- `database_url`: `sqlite:///server/translations.db`
- `allowed_origins`: 카쿠요무, 쇼세츠, 로컬호스트 등 CORS 허용 출처
- `redis_url`: Celery 브로커 URL (`redis://localhost:6379/0`)
- `log_dir`, `backup_dir`, `static_dir`, `templates_dir`: 디렉터리 경로 상수
- `backup_threshold_seconds`: 자동 백업 런타임 누적 기준 (24시간 = 86400초)

### `server/database.py`
SQLite의 동시성 및 무결성을 극대화하기 위한 DB 연결 계층입니다.
- `get_db_path()`: DB URL에서 윈도우/리눅스 호환 로컬 파일 시스템 경로를 추출.
- `dict_factory(cursor, row)`: 원시 sqlite3 커서의 행 결과를 딕셔너리(`{컬럼명: 값}`) 형태로 변환.
- `get_sqlite_conn(as_dict, timeout)`: WAL 모드(`PRAGMA journal_mode=WAL`), 동기화 최적화(`synchronous=NORMAL`), 대기시간(`busy_timeout=5000`), 외래키 활성화(`foreign_keys=ON`) 및 사용자 정의 정규식 함수 `REGEXP`를 등록한 원시 SQLite 커넥션 반환.
- `db_connection(as_dict, timeout)`: `get_sqlite_conn`을 감싸 자동 `close()`를 보장하는 컨텍스트 매니저.
- `_db_connect(dbapi_connection, _)`: SQLAlchemy `engine` 연결 시 SQLite 최적화 PRAGMA 및 REGEXP 함수 자동 주입.
- `get_db()`: FastAPI 의존성 주입(`Depends(get_db)`)용 SQLAlchemy 세션 제너레이터.

### `server/models.py`
SQLAlchemy ORM 테이블 정의 (총 12개 모델):
1. `Translation`: 핵심 번역 데이터 (id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order). 고유키: `(url, pid, original)`.
2. `ExcludedSentence`: 번역 제외 문장 (url, original 고유 제약).
3. `PinnedBook`: 상단 고정된 책 폴더명 (`folderName` PK).
4. `Tag`: 책 분류용 태그 (id, name 고유).
5. `BookTag`: 책과 태그의 다대다 매핑 (book_folderName, tag_id).
6. `BookActivity`: 독서 진도 및 메타데이터 (folderName, last_read_timestamp, last_read_pid, is_bookmarked, notes, summary, summary_source_url).
7. `AppliedUrl`: 웹페이지 상 번역이 활성화된 URL 기록.
8. `UrlMetadata`: 소설 내 URL별 순서(`sort_order`) 및 최초 번역 접근 시각(`first_accessed_at`).
9. `NovelSeparatorSetting`: 소설별 후기/광고 번역 중단 구분선 설정 (novel_title, separators JSON, use_defaults).
10. `TranslationTrash`: 비정상 번역 및 삭제된 번역 단락 보관소 (original_translation_id, reason_category, deleted_at, cleanup_batch_id).
11. `CleanupNotification`: 문제 단락 자동 삭제 시 생성되는 7일 보존 알림 센터 (batch_id, novel_title, episode_title, url, deleted_count, is_dismissed, created_at, dismissed_at).
12. `CleanupQueuedItem`: 이상 번역에서 원문 정리 섹션으로 이동된 대기열 (translation_id, queued_at).

### `server/utils.py`
- `normalize_url(url)`: URL 끝의 슬래시(`/`)와 해시태그(`#...`)를 제거하고 소문자 도메인/스킴으로 표준화.
- `natural_sort_key(s)`: 전각 숫자(`０１２`)를 반각(`012`)으로 정규화(NFKC)하고 숫자를 int 단위로 쪼개어 `001 -> 002 -> 010 -> 100` 순서로 올바르게 정렬하는 자연 정렬 키 생성기.

### `server/rule_classifier.py`
LLM 호출 없이 순수 유니코드와 정규식으로 100% 결정론적으로 번역 품질을 검증하는 룰베이스 엔진입니다.
- `normalize_text(text)`: NFKC 정규화 및 공백 정리.
- `is_symbol_or_punct_only(text)`: 공백, 기호, 숫자, 문장부호(`「……!?」`, `◆◆◆`, `------`) 및 단독 숨소리(`っ`)만으로 구성되었는지 판별 (정상 번역으로 보존하기 위함).
- `has_japanese_text(text)`: 텍스트에 히라가나, 가타카나, 한자가 1자 이상 포함되어 번역 대상인지 판별.
- `is_verbatim_copy(original, translated)`: 원문에 일본어가 있는데 번역문이 원문과 동일하거나 한글 없이 일본어가 그대로 복사되었는지 판별 (원문 복붙 방어).
- `extract_untranslated_keywords(original, translated)`: 번역문 속에 잔류한 일본어 가나 단어(조사/어휘) 및 간체자 키워드를 추출 (유사 번역 단락 추천 시 검색어로 사용).
- `classify_translation(original, translated)`:
  - `'normal'`: 정상 번역
  - `'verbatim_or_empty'`: 규칙 1 (원문 그대로 복사 또는 빈 번역)
  - `'paraphrased_jp'`: 규칙 2 (한글 없이 일본어 가나가 포함된 원문 변형/패러프레이징)
  - `'other_language'`: 규칙 3 (한국어 없이 간체자나 영어 등 타 언어로 출력)
  - `'partial_untranslated'`: 규칙 4 (한국어는 있으나 일본어 가나가 잔류한 일부 미번역)

### `GEMINI.md` (개발 워크플로우 및 레퍼런스 유지 관리 지침)
- **사전 레퍼런스 필독 규칙**: 모든 작업 시작 전 `docs/codebase-functional-reference-YYYY-MM-DD.md` 최신 버전을 먼저 숙지.
- **실시간 지식 누적**: 작업 중 파악된 새 로직, 추가된 함수, 주의점을 레퍼런스 문서에 실시간 업데이트.
- **작업 마무리 및 버전 관리**: 작업 완료 시 레퍼런스 문서를 코드베이스와 일치하도록 정돈하고 날짜/버전별 파일명 갱신.
- **단일 원자적 커밋**: 코드 수정본, 개별 작업 문서(`docs/[기능]-[날짜].md`), 갱신된 레퍼런스 문서를 반드시 하나의 커밋으로 통합.
- **원격 저장소 및 푸시**: 원격은 `main`만 사용(`origin` 미사용). 사용자에게 푸시 여부를 질문하여 승인 시 `git push main extra:main` 실행.

### `server/celery_app.py`
- Celery 애플리케이션 인스턴스 초기화 (`server.celery_app`). Redis 브로커 연동.

---

## 3. FastAPI 서버 코어 및 라이프사이클

### `server/server.py`
- 로깅: `TimedRotatingFileHandler` (자정마다 롤링, 7일 보존), 콘솔 스트림 핸들러, uvicorn 액세스 로거 통합.
- `_update_runtime_metadata()`: 서버 누적 실행 시간을 `server_meta.json`에 영속화.
- `perform_sqlite_backup(src_path, dst_path)`: WAL 모드에서도 안전한 `sqlite3.backup()` 온라인 백업 API 실행.
- `rotate_backups(backup_dir, max_backups=7)`: `translations_backup_YYYYMMDD_HHMMSS.db` 파일 중 최신 7개만 유지하고 이전 백업 삭제.
- `backup_check_task()`: 백그라운드에서 10분(600초)마다 루프를 돌며, 누적 실행 시간이 24시간(`backup_threshold_seconds`)을 넘기면 자동으로 SQLite 온라인 백업 수행 후 롤링.
- `lifespan(app)`:
  - 서버 시작 시: 메타데이터 로드, 백업 태스크 스케줄링, DB 테이블 생성, `ix_title` 및 `ix_folder_title` 인덱스 생성, **FTS5 가상 테이블(`translations_fts`) 생성 및 트리거(INSERT, DELETE, UPDATE) 구성**, FTS 인덱스 빌드.
  - 서버 종료 시: 백업 태스크 취소, 누적 가동 시간 기록, `engine.dispose()`를 통한 커넥션 풀 안전 해제.
- `get_git_commit_hash()`: Git 커밋 단축 해시 추출.
- `serve_service_worker()`: `/service-worker.js` 서빙 시 `__GIT_HASH__`를 주입하여 새 커밋 배포 시 브라우저 캐시 자동 갱신(Cache Busting).

---

## 4. 백엔드 라우터별 세부 함수 및 API 엔드포인트

### `server/routers/translation.py` (번역 엔진 및 재시도/검열 분할/품질 검증)
- `TRANSLATION_SYSTEM_INSTRUCTION`: 원문 복사 금지(No Echoing), 단락 간 독립성(No Repetition Loop), 가나 잔존 금지(Zero Kana Leakage), 따옴표/기호 보존, JSON 스키마 준수를 강제하는 시스템 프롬프트.
- `TRANSLATION_RESPONSE_SCHEMA`: `[{"id": "...", "translated": "..."}]` 형태의 엄격한 구조화된 출력 스키마.
- `call_gemini_api(api_url, prompt, api_key, system_instruction)`: `requests.Session`을 통해 쿠키 격리, 헤더 인증(`x-goog-api-key`), 낮은 온도(`temperature=0.3`), JSON MIME 응답 강제 및 세이프티 필터 `BLOCK_NONE` 적용 호출.
- `process_repeated_chars(text)`: LLM 반복 루프 방어. 6번 이상 반복되는 동일 문자를 `'(반복)'`으로 치환.
- `parse_translation_response(raw_text)`:
  - 1차: 마크다운 코드 블록 제거 후 `json.loads(strict=False)`
  - 2차: `json.JSONDecoder.raw_decode` (후미 쓰레기 문자열 허용)
  - 3차: 대괄호 `[...]` 또는 중괄호 `{...}` 슬라이싱 및 잘린 배열 자동 닫기(`]`)
  - 4차: 후행 쉼표(Trailing comma) 및 잘못된 백슬래시 이스케이프 정규식 치환 복구
  - 5차: 정규식 기반 `{"id": ..., "translated": ...}` 개별 객체 폴백 추출
- `_build_translation_prompt(items)`: 번역 요청 JSON 배열과 번역 지침 프롬프트 생성.
- `handle_verbatim_cleanup_items(db, url, verbatim_items, folder_name, title)`:
  - 번역문이 원문과 동일한 복붙 문장을 감지 시 **DB에서 즉시 삭제**하고 `TranslationTrash`로 이동.
  - `CleanupNotification` 알림을 생성하고 Windows Toast 데스크톱 알림 발송.
- `is_safety_blocked(data)`: Gemini API 응답에서 `finishReason`이 SAFETY/PROHIBITED_CONTENT인지 또는 본문에 소프트 거절 문구("cannot fulfill", "申し訳ありません" 등)가 포함되었는지 감지.
- `_translate_sub_batch_with_safety_split(items, api_url, wait_time_on_block, depth)`:
  - 검열이나 파싱 에러 발생 시 단락 배열을 재귀적으로 **2분할(Binary Split)**하여 번역 진행.
  - 단일 문장까지 분할되었는데도 검열될 경우 **Fast-Fail**을 적용하여 `'[검열로 인해 번역 생략]'` 처리하고 전체 번역 프로세스가 중단되지 않도록 보호.
- **엔드포인트**:
  - `POST /translate`:
    - **오후 5시 경계 감지 (Thread-safe)**: 16시대에 시작되어 17시를 넘어가면 503 에러를 발생시켜 자동 번역 중단.
    - 제외 문장(`ExcludedSentence`) 필터링.
    - 503 Overload 발생 시 RPM 소모 방지를 위해 **즉시 실패 처리 및 데스크톱 알림**.
    - 지수 백오프(1, 2, 4, 8초) 기반 최대 5회 재시도.
    - 검열 발생 시 40초 대기 후 2분할 번역 시도.
    - 원문 복붙 단락 자동 감지 및 삭제 격리.
  - `GET /excluded_sentences`: 특정 URL의 제외된 원문 텍스트 목록 반환.
  - `POST /translations/exclude`: 지정 ID들을 제외 목록에 등록하고 원본 레코드 삭제.
  - `POST /translations/find_replace`: 폴더 범위, 원문 조건, 정규식/대소문자 옵션을 지원하는 번역문 전역 일괄 찾아바꾸기.
  - `PUT /translations/url_title`: 특정 URL을 가진 모든 번역 레코드의 제목 일괄 수정.

### `server/routers/data_crud.py` (번역 데이터 CRUD & 데이터 관리)
- `GET /translations`:
  - **FTS5 전문 검색**: 검색어가 들어오면 `translations_fts MATCH`를 1차 시도하고 실패 시 `LIKE` 폴백.
  - **URL 정규화 매칭**: 프로토콜(http/https), www 유무, 끝 슬래시 유무 등 최대 8가지 URL 변형을 자동 생성하여 완전 일치 검색.
  - 페이징 지원.
- `POST /translations/upsert`:
  - URL별 최초 접근 시각(`UrlMetadata.first_accessed_at`) 일괄 기록.
  - 1회 일괄 쿼리로 기존 번역을 메모리 맵에 적재하여 **N+1 쿼리 완전 제거**.
  - 원문 복붙 문장 및 빈 번역 레코드가 DB에 오염 적재되는 것을 차단하고 트래시/알림으로 자동 분기.
  - 단일 트랜잭션 원자적 커밋.
- `PUT /translations/move`: 500개 청크 단위로 분할하여 SQLite 변수 한도(999개)를 넘지 않고 폴더 일괄 이동.
- `POST /translations/delete`: 500개 청크 단위 안전 일괄 삭제.
- `GET /translations_by_folder`:
  - 폴더별, URL별 계층 그룹화.
  - `light=True` 파라미터 지원: 본문 원문/번역문을 빈 문자열로 내려주어 네트워크 전송량과 프론트엔드 렌더링 부하를 90% 이상 절감.
  - `toc_sort_order` 및 URL 자연 정렬(`natural_sort_key`) 반영.
  - 번역 적용 URL 집합(`_applied_urls`) 동시 반환.
- `GET /translations/abnormal`: 규칙 3(타 언어), 규칙 4(일부 미번역) 단락 검출, 미번역 키워드 추출, 정리 대기열 포함 여부 표기.
- `POST /translations/move_to_cleanup`: 이상 번역 항목을 수동으로 `CleanupQueuedItem` 대기열에 등록.
- `GET /translations/cleanup_queue`: 규칙 1(원문 그대로), 규칙 2(원문 변형), 수동 이동 단락을 통합 조회.
- `POST /translations/cleanup_queue/delete`: 대기열 단락 일괄 삭제 후 `TranslationTrash` 보관 및 `CleanupNotification` 알림 발송.
- `GET /translations/trash`: 휴지통 최근 1000건 조회.
- `POST /translations/trash/restore`: 휴지통 단락 원복 복원.
- `GET /cleanup/notifications`: 활성 알림 및 7일 이내 해제된 알림 조회 (7일 지난 항목은 자동 영구 삭제).
- `POST /cleanup/notifications/{id}/dismiss`: 알림 개별 해제.
- `POST /cleanup/notifications/dismiss_all`: 알림 전체 해제.
- `GET /cleanup/review_targets`: 확장 프로그램 연동용. 특정 URL에 대해 최근 삭제/정리된 단락 PID와 원문 목록 반환 (알림 연계 재번역 검수용).
- `GET /translations/similar_examples`: 특정 미번역 키워드가 포함된 단락 중 정상(`normal`)으로 분류된 유사 단락을 추천 (동일 소설 우선, 타 소설 보충).
- `GET /stream`: Server-Sent Events(SSE) 방식으로 번역 데이터를 실시간 스트리밍.
- `POST /migrate`: `migration_data.json` 데이터베이스 마이그레이션.

### `server/routers/books.py` (서재, 책, 챕터 및 독서 활동)
- `PUT /api/books/{folder_name}/urls`: 책 내 URL들의 목차 순서(`toc_sort_order`)와 제목을 일괄 업데이트.
- `GET /folders`, `GET /api/books`: 전체 책(폴더) 목록, 고정(`pinned`) 여부, 연결된 태그, 최근 읽은 시간/PID/북마크/메모 등 활동 정보 종합 반환.
- `POST /api/folders`: 새 책(폴더) 생성.
- `PUT /api/folders/{folder_name}`: 책 이름 변경 시 `translations`, `book_activity`, `pinned_books`, `book_tags` 4개 테이블 동시 갱신.
- `POST /api/books/pin`: 책 고정/고정 해제 토글.
- `GET /api/books/{folder_name}/urls`: 책에 속한 URL 목록을 `toc_sort_order` 및 자연 정렬로 반환.
- `GET /api/books/{folder_name}/chapters`: 책에 속한 고유 챕터 제목 목록 반환.
- `GET /api/books/{folder_name}/chapter`: 특정 챕터 본문 단락들을 PID 자연 순서(`p1, p2, ..., l1, l2, ...`)로 정렬하여 반환.
- `GET /api/books/{folder_name}/export`: `viewer.css`와 `viewer.js`, 전체 소설 본문 JSON을 단일 HTML 파일로 번들링하여 **외부 서버 없이 브라우저에서 바로 읽을 수 있는 독립 실행형 HTML 파일 다운로드**.
- `PUT /api/books/{folder_name}/tags`: 책에 지정된 태그 목록 갱신.
- `PUT /api/books/{folder_name}/activity`: 마지막 읽은 위치(PID, 타임스탬프), 북마크, 메모, 줄거리 업데이트.
- `GET /api/books/{folder_name}/activity`: 책 활동 정보 조회.
- `_crawl_and_update_summary_worker`: 쇼세츠(novel_ex), 카쿠요무(WorkIntroductionText) 또는 메타 태그에서 줄거리 원문을 크롤링하여 `book_activity.summary`에 저장.
- `POST /api/books/{folder_name}/crawl-summary`: 줄거리 크롤링 백그라운드 태스크 기동.

### `server/routers/separators.py` (소설별 번역 중단 구분선 관리)
- `DEFAULT_GLOBAL_SEPARATORS`: 기본 공통 구분선 (`＜あとがき＞`, `【あとがき】`, `お読み頂きありがとうございます！` 등 7종).
- `PRESET_SEPARATORS`: 프리셋 기호 구분선 (`◎◎◎`, `----------`, `***`, `――――` 등 6종).
- `GET /api/separators`: 전체 소설 구분선 목록 또는 특정 소설의 활성 구분선 조회.
- `POST /api/separators`: 소설별 커스텀 구분선 목록 및 기본값 포함 여부 저장.
- `DELETE /api/separators`: 특정 소설의 커스텀 구분선 삭제(초기화).
- `GET /api/separators/by-url`: 현재 열람 중인 URL에 매핑된 소설의 구분선 설정을 즉시 반환 (확장 프로그램 자동 로딩용).

### `server/routers/toc_importer.py` (목차 크롤링 및 파싱)
- `POST /api/import-toc`: 카쿠요무 또는 쇼세츠 URL을 입력받아 전체 에피소드 제목과 URL 목록을 추출.
- `parse_kakuyomu(html_content, base_url)`: Next.js의 `__NEXT_DATA__` 내 Apollo State JSON을 파싱하여 `tableOfContentsV2`, 챕터 유니온, 에피소드 유니온을 재귀 순회해 완전한 목차를 추출.
- `fetch_all_syosetu_chapters(start_url, headers, cookies)`: 쇼세츠/노벨18 페이지네이션을 최대 100페이지까지 순회하며 `.p-eplist` 및 레거시 목차 링크를 자동 수집.

### `server/routers/tasks.py` (백그라운드 크롤링 태스크)
- `_fetch_and_update_title_worker(url)`: 단일 URL에 접속하여 `<title>` 태그를 파싱하고 유효성 검사 후 DB 업데이트.
- `_process_urls_fallback_worker(urls, task_id)`: Celery가 없을 때 FastAPI 인프로세스 `BackgroundTasks`로 1초 딜레이를 두고 순회 크롤링하는 폴백 워커.
- `process_urls_in_background_task`: Celery 비동기 작업 태스크.
- `POST /fetch_missing_titles`: 제목이 누락되었거나 비정상적인 모든 URL에 대해 백그라운드 크롤링 시작 (Celery 우선, 실패 시 BackgroundTasks 자동 전환).
- `GET /task_status/{task_id}`: 진행률(퍼센트, 현재/총합) 조회.

### `server/routers/url_config.py` (URL 적용 상태)
- `POST /api/urls/apply`: 특정 URL의 번역 적용 상태를 `applied_urls` 테이블에 등록/삭제.
- `PUT /api/url_metadata`: URL 정렬 순서 업데이트.
- `PUT /api/url_metadata/batch`: URL 정렬 순서 일괄 업데이트.
- `GET /api/urls/apply_status`: 특정 URL이 번역 적용 상태인지 확인.

### `server/routers/system.py` (시스템 및 디버그)
- `GET /health`: 서버 상태 점검 (`{"status": "ok"}`).
- `GET /api/settings/autostart`: 자동 시작 설정 확인.
- `GET /api/logs`: `app.log` 파일에서 최근 1000줄을 읽어 메모리 과부하 없이 반환.
- `GET /api/allowed_origins`: CORS 허용 목록 반환.
- `GET /debug/urls_by_folder`: 디버그용 폴더별 URL 조회.
- `GET /api/debug/find_translation`: 쿼리로 번역 레코드 검색.

### `server/routers/db_editor.py` (웹 DB 관리자)
- `GET /db_editor`: 8개 주요 테이블의 레코드를 조회하고 특정 ID로 점프(`jump_to_id`) 가능한 온디맨드 뷰어 렌더링.
- `POST /api/db_editor/{table_name}`: 테이블 레코드 생성.
- `PUT /api/db_editor/{table_name}/{record_id}`: 기본키를 자동 감지하여 레코드 필드 수정.
- `DELETE /api/db_editor/{table_name}/{record_id}`: 레코드 삭제.

### `server/routers/admin.py` (관리자 정리 작업)
- `POST /admin/cleanup_urls`: URL 끝에 붙은 `#end` 등 해시 파편을 DB 전체에서 제거.
- `POST /admin/cleanup_pids`: 카쿠요무 특수 PID인 `la...`, `lp...`를 가진 레코드를 제외 목록(`excluded_sentences`)으로 이전하고 번역 테이블에서 삭제.

### `server/routers/ui.py` (템플릿 서빙)
- `/book`, `/viewer`, `/admin`, `/logs`, `/library`, `/`: Jinja2 템플릿 서빙.

---

## 5. 크롬 확장 프로그램 세부 함수 동작 (Chrome Extension)

### `extension/background.js`
- `migrateQuotes()`: 기존 로컬 스토리지 번역 데이터의 큰따옴표(`"..."`)를 원문 대괄호(`「...」`, `『...』`) 스타일로 1회 일괄 마이그레이션.
- `chrome.runtime.onInstalled`: 우클릭 컨텍스트 메뉴(번역하기, 번역 기록 보기) 생성.
- `chrome.runtime.onMessage`:
  - `action: 'batchTranslate'`: `handleBatchTranslate` 호출. 429 감지 시 중단 플래그 반환.
  - `action: 'fetchTitle'`: `fetchPageTitle` 호출.
- `fetchPageTitle(url)`: 웹 페이지에 쿠키를 포함해 접근하여 `<title>` 태그 파싱.
- `handleBatchTranslate(items, sourceUrl, isRetranslation, model)`: 로컬 서버 `http://127.0.0.1:8001/translate`로 POST 요청 전송.
- `saveErrorLog(items, error, url)`: 실패한 번역 요청을 `chrome.storage.local`에 최대 20개까지 저장.

### `extension/content.js`
웹소설 웹페이지에 직접 삽입되어 DOM을 조작하고 번역 UI를 제공하는 핵심 스크립트입니다.
- **소설 및 구분선 관리**:
  - `detectNovelTitle()`: 서버 DB 확인 -> 카쿠요무/쇼세츠 DOM 요소 탐색 -> `document.title` 파싱 순으로 소설 본 제목을 판별.
  - `loadNovelSeparators(novelTitle)`: 서버에서 해당 소설의 구분선 목록을 로드.
  - `saveNovelSeparators(novelTitle, customSeparators, useDefaults)`: 커스텀 구분선 서버 저장.
  - `resetNovelSeparators(novelTitle)`: 구분선 기본값으로 리셋.
  - `checkSeparatorMatch(text, separators)`: 문단 텍스트가 구분선에 부합하는지 검사.
  - `toggleSeparatorPanel()`, `renderSeparatorSettingsPanel()`: 사이드바 내 구분선 설정 UI 토글 및 렌더링.
  - `addSeparator(sep)`, `removeSeparator(sep)`: 구분선 추가 및 삭제.
- **알림 센터 연계 재번역 검수**:
  - `checkAndLoadReviewTargets()`: 서버의 `/cleanup/review_targets`를 호출하여 최근 삭제/정리된 단락이 있는지 확인.
  - `renderReviewTargetPanel()`: 상단에 검수 안내 배너 렌더링.
  - `focusAndScrollToPid(pid)`: 검수 대상 단락으로 부드럽게 스크롤 및 포커스.
  - `highlightReviewTargetDOMs()`: 본문 및 사이드바에서 문제 단락에 시각적 하이라이트 부여.
- **페이지 초기화 및 본문 번역 치환**:
  - `init()`: 소설 제목 감지, 구분선 로드, 기존 번역/제외 목록 로드, 사이드바 주입, 적용 상태 동기화.
  - `fetchTranslationsForUrl(url)`: 로컬 서버의 `/translations` 엔드포인트에서 기존 번역 로드.
  - `fetchExclusionsForUrl(url)`: 제외된 문장 목록 로드.
  - `applyTranslationsToPage(translations)`: 본문 문단의 일본어 텍스트를 한국어 번역문으로 부드럽게 치환 (`data-original-text` 보존).
  - `restoreOriginalPage()`: 본문을 원래 일본어 텍스트로 원복.
  - `setPageApplyStatus(applied, syncStorageAndServer)`: 페이지 적용 상태 변경 및 서버 `/api/urls/apply` 동기화.
  - `togglePageApplyStatus()`: 적용/원문보기 토글 버튼 클릭 처리.
- **사이드바 및 인터랙션**:
  - `injectSidebar()`: 플로팅 번역 사이드바(전체 번역, 재번역, 진행률, 단락 목록, 구분선 설정)를 페이지 DOM에 주입.
  - `handleSidebarRowClick(pid, e)`: 사이드바 행 클릭 시 본문의 해당 문단으로 자동 스크롤.
  - `setupParagraphInteraction()`: 본문 문단 호버 시 사이드바 연동 하이라이트.
  - `showSidebar()`, `hideSidebar()`, `toggleSidebar()`: 사이드바 표시/숨김.
- **번역 실행 파이프라인**:
  - `getTargetParagraphs()`: 사이트별(쇼세츠 `.p-novel__body p`, 카쿠요무 `.widget-episodeBody p`) 번역 대상 단락 목록 추출.
  - `translateAllPTags(isRetranslation)`:
    - 문단들을 20개 단위(`chunkArray`)로 분할.
    - 구분선을 만나면 **번역 즉시 중단(후기/광고 번역 차단)**.
    - `background.js`로 `batchTranslate` 메시지 전송.
    - 실시간 진행률 표시줄 갱신.
    - 번역 결과를 서버 `/translations/upsert`에 배치 저장.
    - 완료 시 본문 자동 치환 적용.
  - `retranslateSingleRow(pid, originalText)`: 개별 단락 우측 재번역 버튼 클릭 시 고성능 모델(`gemini-3.8-flash`)로 단일 재번역 수행 및 즉시 교체 저장.

---

## 6. 웹 프론트엔드 UI 스크립트 세부 함수 동작 (Frontend UI)

### `server/static/admin.js` (관리자 대시보드 & 데이터 관리)
- `loadAndRenderGrouped()`: `/translations_by_folder?light=true`를 호출하여 전체 번역 데이터를 아코디언 형태로 경량 고속 렌더링.
- `updateStatistics(groupedData)`: 상단 통계 바(전체 단락 수, 전체 소설 수, 에피소드 수 등) 갱신.
- `renderGroupedHistory(dataToRender)`: 폴더(소설)별, URL(화)별 계층 트리 렌더링.
- `renderUrlGroupContent(listGroupEl)`: 사용자가 URL 아코디언을 펼쳤을 때 온디맨드로 실제 본문 단락들을 로드하여 렌더링.
- `loadAndRenderAbnormal()`: `/translations/abnormal`을 호출하여 규칙 3(타 언어), 규칙 4(일부 미번역) 단락을 필터링 표시.
- `toggleCleanupQueue()`, `loadAndRenderCleanupQueue()`: 규칙 1(원문 그대로), 규칙 2(원문 변형) 대기열 렌더링.
- `deleteSelectedCleanup()`, `deleteAllCleanup()`: 대기열 단락 삭제 -> 휴지통 이동 및 알림 발송.
- `moveToCleanupQueueSelected()`: 선택한 이상 단락을 원문 정리 대기열로 이전.
- `loadNotificationsAndBadge()`: 활성 알림 개수를 조회해 상단 복원 센터 배지 카운트 갱신.
- `openRestoreCenterModal()`, `switchRestoreTab()`: 복원 센터 모달(알림 탭 / 휴지통 탭) 제어.
- `loadAndRenderNotifications()`, `dismissNotification()`, `dismissAllNotifications()`: 알림 목록 렌더링 및 해제.
- `loadAndRenderTrash()`, `restoreTrashItem()`, `restoreAllTrash()`: 휴지통 조회 및 복원.
- `handleTranslatedFocus(el)`, `loadSimilarRecommendations()`: 번역문 입력창 포커스 시 잔류 가나 키워드를 감지하여 **우측에 유사 정상 번역 단락 추천 카드 자동 표시**.
- `openFindReplaceModal()`, `countOccurrences()`, `executeGlobalFindReplace()`: 찾아바꾸기 모달 및 전역 치환 실행.
- `toggleApplyStatus(url, button)`: 특정 URL의 번역 적용 상태를 토글.
- `deleteSelectedTranslations()`, `moveSelectedTranslationsToFolder()`: 체크박스로 다중 선택된 단락 일괄 삭제/이동.
- `renameFolder(oldName, newName)`: 폴더(소설) 이름 일괄 변경.
- `fetchAllTitles()`: 제목 없는 URL 크롤링 비동기 작업 트리거.

### `server/static/viewer.js` (웹 뷰어 & 독서 위치 관리)
- `loadBook()`: URL 파라미터(`?book=...`)로부터 소설의 챕터 목록과 독서 활동(`last_read_pid`, `last_read_timestamp`)을 로드.
- `loadChapter(chapterIndex, pagePosition, startPid)`: 특정 챕터 본문을 로드하고 페이징 수행 후 지정 PID 위치로 이동.
- `paginate()`: 뷰어 컨테이너 너비/높이에 맞춰 단락들을 여러 페이지로 분할 계산.
- `renderPage(pageIndex)`: 계산된 페이지의 단락들을 뷰어 화면에 렌더링.
- `showPrevPage()`, `showNextPage()`: 이전/다음 페이지로 이동 (챕터 경계 시 이전/다음 챕터 자동 전환).
- `populateToc()`, `updateActiveTocItem()`: 좌측 목차 사이드바 구성 및 현재 챕터 하이라이트.
- `toggleOriginalView()`: 원문/번역문 대조 모드 토글.
- `saveLastReadPosition()`, `commitPosition(useKeepalive)`: 페이지 전환 시 현재 읽고 있는 챕터 및 PID를 디바운스(또는 `sendBeacon`)로 서버 `/api/books/{folder}/activity`에 자동 저장.
- `handleKeyPress(e)`, `handleBookClick(e)`, `handleTouchStart/Move/End`: 키보드 방향키, 클릭(좌/우 30% 영역 페이지 넘김, 중앙 메뉴 토글), 모바일 터치/스와이프 제스처 처리.
- `toggleFocusMode()`, `toggleNightMode()`: 집중 모드(전체화면) 및 야간 다크 모드 토글.
- `enableEditing(translationItem)`, `saveChanges(translationItem)`: 뷰어 본문 텍스트 더블클릭 시 인라인 수정 모드 진입 및 서버 저장.

### `server/static/library.js` (서재 카드 뷰 & 태그/북마크)
- `fetchBooks()`: 서버 `/api/books`로부터 전체 소설 목록과 메타데이터(고정, 태그, 활동) 조회.
- `renderBooks()`: 서재 화면에 소설 카드 그리드 렌더링 (고정된 책 상단 정렬, 북마크 아이콘, 마지막 읽은 화 표시).
- `renderTagFilters()`: 상단 태그 필터 버튼 목록 렌더링.
- `togglePin(folderName)`: 책 고정/해제.
- `toggleBookmark(bookName)`: 북마크 토글.
- `openEditModal(bookName)`, `handleSaveModal()`: 소설 정보 수정 모달(이름 변경, 태그 편집, 메모 작성, 줄거리 확인).
- `handleAddNewTag(e)`: 새 태그 생성 및 책에 할당.
- `handleCrawlSummary()`: 줄거리 크롤링 트리거.
- `handleDownloadOffline(bookName)`, `handleDownloadAllOffline()`: PWA Service Worker 캐시를 활용한 오프라인 읽기 다운로드.
- `openUrlListModal(bookName)`: 소설 내 에피소드 목록 모달 표시 및 드래그 앤 드롭 순서 변경.
- `handleImportToc()`: 카쿠요무/쇼세츠 URL로부터 목차를 가져와 순서 자동 정렬.
- `handleFetchMissingTitles()`: 제목 없는 URL 백그라운드 크롤링 실행 및 폴링 진행률 표시.

---

## 7. 사용자 지시 및 발화-코드 1:1 매핑 사전

사용자가 일상적인 자연어로 요청했을 때, 즉시 매핑해야 하는 핵심 코드 위치와 역할입니다.

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 동작 및 주의사항 |
| :--- | :--- | :--- |
| **"원문 복붙된 것들 다 지워줘" / "일본어가 그대로 번역이라고 나와"** | `server/rule_classifier.py` (`is_verbatim_copy`)<br>`server/routers/translation.py` (`handle_verbatim_cleanup_items`)<br>`server/routers/data_crud.py` (`get_cleanup_queue`, `delete_cleanup_queue`) | 원문 복붙 단락은 `TranslationTrash`로 이동되고 `CleanupNotification`에 등록되어 7일간 보존되며, 알림 센터에서 복원 가능. |
| **"번역 품질 이상한 것들(다른 언어나 미번역) 검사해줘"** | `server/rule_classifier.py` (`classify_translation`)<br>`server/routers/data_crud.py` (`get_abnormal_translations`)<br>`server/static/admin.js` (`loadAndRenderAbnormal`) | 규칙 3(타언어/간체자), 규칙 4(한국어 내 가나 잔류)를 유니코드 정규식으로 100% 탐지. |
| **"후기나 광고 나오면 번역 멈추게 해줘" / "구분선 밑으로 번역 안 되게 해줘"** | `server/routers/separators.py`<br>`extension/content.js` (`checkSeparatorMatch`, `translateAllPTags`) | `activeSeparators` 매칭 시 `translateAllPTags` 루프를 `break`하여 그 아래 문단 번역을 완전 차단. |
| **"오후 5시 넘었는데 번역이 멈췄어" / "5시 자동 중지 조건 확인해줘"** | `server/routers/translation.py` (`translate_texts` 라인 718-730) | 오후 4시대에 시작된 프로세스가 17시를 넘기면 스레드 안전 락 하에서 503 에러를 던져 중단됨. |
| **"Gemini 모델 바꿔줘" / "재번역할 때 다른 모델 쓰게 해줘"** | `server/settings.py` (`gemini_default_model`, `gemini_retranslation_model`)<br>`server/routers/translation.py` (`selected_model` 분기) | 일반 번역은 `gemini-3.5-flash-lite`, 단락 재번역(`is_retranslation=True`)은 `gemini-3.8-flash` 사용. |
| **"뷰어에서 읽던 위치(진도)가 저장이 안 돼"** | `server/static/viewer.js` (`saveLastReadPosition`, `commitPosition`)<br>`server/routers/books.py` (`update_book_activity`) | `last_read_pid`와 타임스탬프를 디바운스/keepalive로 서버에 전송. |
| **"카쿠요무/쇼세츠 목차 순서가 이상해" / "화수 정렬이 꼬였어"** | `server/utils.py` (`natural_sort_key`)<br>`server/routers/toc_importer.py` (`import_toc`)<br>`server/routers/books.py` (`update_book_urls_order`) | `natural_sort_key`를 사용해 001, 002, 010, 100 자연 정렬 적용. 카쿠요무는 Apollo State V2 지원. |
| **"단락 번역 결과에 따옴표가 이상하게 바뀌어"** | `extension/background.js` (`migrateQuotes`)<br>`server/routers/translation.py` (`TRANSLATION_SYSTEM_INSTRUCTION` 4번) | 일본식 따옴표(`「...」`, `『...』`)를 강제 보존하도록 프롬프트와 정규식이 구성됨. |
| **"서버 켜질 때 백업 어떻게 돌아가?"** | `server/server.py` (`backup_check_task`, `perform_sqlite_backup`, `rotate_backups`) | 24시간 가동 시마다 SQLite 온라인 백업 실행, 최신 7개 유지 롤링. |
| **"특정 단어 전체 찾아바꾸기 해줘"** | `server/routers/translation.py` (`find_replace_all`)<br>`server/static/admin.js` (`executeGlobalFindReplace`) | 폴더 범위, 원문 조건, 정규식, 대소문자 구분을 지원하여 DB 전체 치환. |
| **"책을 파일 하나로 저장해서 인터넷 없이 보고 싶어"** | `server/routers/books.py` (`export_book_as_html`) | CSS/JS와 소설 JSON 데이터를 인라인 결합한 단일 HTML 파일 내보내기. |
