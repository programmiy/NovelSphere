# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트와 개발자가 사용자의 요구사항, 용어, 수정 지시를 혼선 없이 정확히 파악하고 대응할 수 있도록, 프로젝트 전반의 아키텍처, 데이터 흐름, 파일별 세세한 함수/클래스 동작 및 의도 매핑 가이드를 정리한 영구 기술 레퍼런스 문서입니다.
> **작성 일자**: 2026-09-24

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
   - `server/routers/translation.py` (번역 엔진 및 재시도/검열 분할/품질 검증/대사 괄호 복원)
   - `server/routers/data_crud.py` (번역 데이터 CRUD, FTS5 검색, 괄호 복원 적재, 이상 번역/휴지통/알림 센터)
   - `server/routers/books.py` (서재, 목차 순서, 활동 내역, 줄거리 크롤링, HTML 내보내기)
   - `server/routers/separators.py` (소설별 번역 중단 구분선 관리)
   - `server/routers/toc_importer.py` (카쿠요무/소설가가 되자 목차 크롤링 및 파싱)
   - `server/routers/tasks.py` (Celery 및 BackgroundTasks 백그라운드 크롤링)
   - `server/routers/url_config.py` (URL 번역 적용 토글 및 메타데이터)
   - `server/routers/system.py` (시스템 상태, 로그 조회, CORS)
   - `server/routers/db_editor.py` (웹 DB 관리자 및 레코드 수정)
   - `server/routers/admin.py` (URL 조각/특수 PID 정리, 룰베이스 괄호 일괄 복원)
   - `server/routers/notifications.py` (ntfy 실시간 푸시 알림 설정 및 테스트 발송)
   - `server/routers/ui.py` (템플릿 서빙 라우터 및 모바일 자동 감지/라우팅)
5. [크롬 확장 프로그램 세부 함수 동작 (Chrome Extension)](#5-크롬-확장-프로그램-세부-함수-동작-chrome-extension)
   - `extension/background.js`
   - `extension/content.js`
6. [웹 프론트엔드 UI 스크립트 세부 함수 동작 (Frontend UI)](#6-웹-프론트엔드-ui-스크립트-세부-함수-동작-frontend-ui)
   - `server/static/admin.js` (관리자 대시보드 & 데이터 관리)
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
   - rule_classifier.py (100% 룰베이스 번역 품질 검증 및 괄호 자동 복원)
   - server.py (30분 주기 DB 괄호 복원 태스크 & 24시간 온라인 백업 태스크)
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
LLM 호출 없이 순수 유니코드와 정규식으로 100% 결정론적으로 번역 품질을 검증하고 누락된 대사 괄호를 자동 복원하는 룰베이스 엔진입니다.
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
- `count_leading_brackets(s, char='「')`, `count_trailing_brackets(s, char='」')`: 문자열 양 끝의 특정 괄호 개수 계산.
- `restore_brackets(original, translated)`:
  - **규칙 대상**: 원문의 처음과 끝이 `「%」`로 둘러싸인 대사 문장에만 한정 적용 (문장 중간 괄호나 독백 제외).
  - 다중 괄호(`「「...」」`), HTML 태그(`<span>...</span>`), 화자 접두어(`쿄코「...」`), 후행 구두점(`「...」.`) 안전 보존.
  - 큰따옴표/작은따옴표/곡선따옴표(`"`, `'`, `“`, `‘`, `«`) 치환 및 단면 누락(`「...`, `...」`), 완전 누락(일반 텍스트) 괄호 자동 추가.
- `batch_restore_brackets_in_db(db_conn)`: DB 내 `original LIKE '「%」'` 문장 중 누락/변형된 번역문을 고속 쿼리로 선별하여 일괄 복원하고 (scanned, updated) 반환.

### `server/celery_app.py`
- Celery 애플리케이션 인스턴스 초기화 (`server.celery_app`). Redis 브로커 연동.

### `server/notifications.py`
- HTTP pub-sub 기반 오픈소스 푸시 서비스 ntfy(`ntfy.sh` 또는 자체 호스팅) 연동 모듈.
- `send_ntfy(...)`: 백그라운드 데몬 스레드 비동기 알림 발송 (논블로킹).
- `notify_translation_progress(...)`: 번역 완료 및 진행률 스마트폰 푸시 알림.
- `notify_task_event(...)`: 백그라운드 태스크(누락 제목 수집 등) 완료 알림.

---

## 3. FastAPI 서버 코어 및 라이프사이클

### `server/server.py`
- 로깅: `TimedRotatingFileHandler` (자정마다 롤링, 7일 보존), 콘솔 스트림 핸들러, uvicorn 액세스 로거 통합.
- `_update_runtime_metadata()`: 서버 누적 실행 시간을 `server_meta.json`에 영속화.
- `perform_sqlite_backup(src_path, dst_path)`: WAL 모드에서도 안전한 `sqlite3.backup()` 온라인 백업 API 실행.
- `rotate_backups(backup_dir, max_backups=7)`: `translations_backup_YYYYMMDD_HHMMSS.db` 파일 중 최신 7개만 유지하고 이전 백업 삭제.
- `backup_check_task()`: 백그라운드에서 10분(600초)마다 루프를 돌며, 누적 실행 시간이 24시간(`backup_threshold_seconds`)을 넘기면 자동으로 SQLite 온라인 백업 수행 후 롤링.
- `run_sync_bracket_restoration()`: DB 커넥션을 획득하여 룰베이스 대사 괄호 누락 복원을 1회 실행하고 로그 기록.
- `periodic_bracket_restoration_task(interval_seconds=1800)`:
  - 서버 시작 10초 후 1차 검사 즉시 실행.
  - 이후 30분(1800초)마다 백그라운드 스레드(`asyncio.to_thread`)로 DB를 점검하여 대사 괄호 누락/변형 레코드를 자동 복구.
- `lifespan(app)`:
  - 서버 시작 시: 메타데이터 로드, 백업 태스크 및 주기적 괄호 복원 태스크(`bracket_task`) 스케줄링, DB 테이블 생성, 인덱스 생성, **FTS5 가상 테이블(`translations_fts`) 생성 및 트리거(INSERT, DELETE, UPDATE) 구성**, FTS 인덱스 빌드.
  - 서버 종료 시: 백업 태스크 및 괄호 복원 태스크 안전 취소(`cancel`), 누적 가동 시간 기록, `engine.dispose()`를 통한 커넥션 풀 안전 해제.
- `get_git_commit_hash()`: Git 커밋 단축 해시 추출.
- `serve_service_worker()`: `/service-worker.js` 서빙 시 `__GIT_HASH__`를 주입하여 새 커밋 배포 시 브라우저 캐시 자동 갱신(Cache Busting).

---

## 4. 백엔드 라우터별 세부 함수 및 API 엔드포인트

### `server/routers/translation.py` (번역 엔진 및 재시도/검열 분할/품질 검증)
- `TRANSLATION_SYSTEM_INSTRUCTION`: 원문 복사 금지(No Echoing), 단락 간 독립성(No Repetition Loop), 가나 잔존 금지(Zero Kana Leakage), 따옴표/기호 보존, JSON 스키마 준수를 강제하는 시스템 프롬프트.
- `TRANSLATION_RESPONSE_SCHEMA`: `[{"id": "...", "translated": "..."}]` 형태의 엄격한 구조화된 출력 스키마.
- `call_gemini_api(api_url, prompt, api_key, system_instruction)`: `requests.Session`을 통해 쿠키 격리, 헤더 인증(`x-goog-api-key`), 낮은 온도(`temperature=0.3`), JSON MIME 응답 강제 및 세이프티 필터 `BLOCK_NONE` 적용 호출.
- `process_repeated_chars(text)`: LLM 반복 루프 방어. 6번 이상 반복되는 동일 문자를 `'(반복)'`으로 치환.
- `parse_translation_response(raw_text)`: 5단계 폴백 파서 (마크다운 제거 -> json.loads -> raw_decode -> 대괄호 슬라이싱 -> 정규식).
- `handle_verbatim_cleanup_items(db, url, verbatim_items, folder_name, title)`: 원문 복붙 문장 감지 시 DB 즉시 삭제, `TranslationTrash` 격리, `CleanupNotification` 알림 발송.
- `is_safety_blocked(data)`: Gemini API 응답에서 안전 필터 차단 및 소프트 거절 문구 감지.
- `_translate_sub_batch_with_safety_split(items, api_url, wait_time_on_block, depth)`: 재귀적 2분할(Binary Split) 및 단일 문장 Fast-Fail 처리.
- **엔드포인트**:
  - `POST /translate`:
    - 오후 5시 경계 감지 (16시대 시작 프로세스가 17시를 넘기면 503 에러로 안전 중단).
    - 지수 백오프 기반 최대 5회 재시도 (503 Overload 시 즉시 실패 및 데스크톱 알림).
    - **번역 결과 반환 전 `restore_brackets(item.text, translated_text)`를 호출하여 실시간 대사 괄호 자동 복원.**
    - 원문 복붙 단락 자동 격리.
  - `GET /excluded_sentences`: 특정 URL의 제외된 원문 텍스트 목록 반환.
  - `POST /translations/exclude`: 지정 ID들을 제외 목록에 등록하고 원본 레코드 삭제.
  - `POST /translations/find_replace`: 폴더 범위, 원문 조건, 정규식/대소문자 옵션을 지원하는 번역문 전역 일괄 찾아바꾸기.
  - `PUT /translations/url_title`: 특정 URL을 가진 모든 번역 레코드의 제목 일괄 수정.

### `server/routers/data_crud.py` (번역 데이터 CRUD & 데이터 관리)
- `GET /translations`: FTS5 전문 검색(실패 시 LIKE 폴백), 8가지 URL 정규화 일치 검색, 페이징 지원.
- `POST /translations/upsert`:
  - URL 최초 접근 시각(`UrlMetadata`) 기록.
  - 1회 일괄 쿼리로 기존 번역을 메모리 맵에 적재하여 N+1 쿼리 제거.
  - **`item.translated`에 대해 `restore_brackets`를 통과시켜 DB 적재 시 괄호 누락 방지.**
  - 원문 복붙/변형 문장 격리 및 빈 번역 차단.
- `PUT /translations/move`: 500개 청크 단위 안전 폴더 이동.
- `POST /translations/delete`: 500개 청크 단위 안전 일괄 삭제.
- `GET /translations_by_folder`: 계층 그룹화, `light=True` 경량화 모드 지원, 자연 정렬(`natural_sort_key`).
- `GET /translations/abnormal`: 규칙 3(타 언어), 규칙 4(일부 미번역) 단락 검출.
- `POST /translations/move_to_cleanup`: 이상 번역 항목을 `CleanupQueuedItem` 대기열에 등록.
- `GET /translations/cleanup_queue`, `POST /translations/cleanup_queue/delete`: 대기열 단락 관리 및 삭제.
- `GET /translations/trash`, `POST /translations/trash/restore`: 휴지통 조회 및 복원.
- `GET /cleanup/notifications`, `POST /cleanup/notifications/{id}/dismiss`: 알림 센터 관리.
- `GET /cleanup/review_targets`: 확장 프로그램 검수용 삭제 단락 조회.
- `GET /translations/similar_examples`: 미번역 키워드 기반 유사 정상 번역 단락 추천.
- `GET /stream`: Server-Sent Events(SSE) 실시간 스트리밍.
- `POST /migrate`: 마이그레이션 데이터 적재.

### `server/routers/books.py` (서재, 책, 챕터 및 독서 활동)
- `PUT /api/books/{folder_name}/urls`: 목차 순서(`toc_sort_order`)와 제목 일괄 갱신.
- `GET /folders`, `GET /api/books`: 전체 책 목록, 고정 여부, 태그, 활동 정보(진도, 북마크, 메모) 종합 반환.
- `POST /api/folders`, `PUT /api/folders/{folder_name}`: 책 생성 및 이름 변경.
- `POST /api/books/pin`: 책 상단 고정 토글.
- `GET /api/books/{folder_name}/urls`, `chapters`, `chapter`: 책 에피소드 및 본문 단락 조회.
- `GET /api/books/{folder_name}/export`: 독립 실행형 단일 오프라인 HTML 파일 내보내기.
- `PUT /api/books/{folder_name}/tags`, `activity`: 태그 및 독서 활동(마지막 읽은 위치, 메모, 북마크) 업데이트.
- `POST /api/books/{folder_name}/crawl-summary`: 줄거리 백그라운드 크롤링.

### `server/routers/separators.py` (소설별 번역 중단 구분선 관리)
- 기본 공통 구분선 7종 및 프리셋 기호 구분선 6종 관리.
- `GET /api/separators`, `POST`, `DELETE`, `GET /api/separators/by-url` 제공.

### `server/routers/toc_importer.py` (목차 크롤링 및 파싱)
- `POST /api/import-toc`: 카쿠요무(Apollo State Next.js JSON 파싱) 및 쇼세츠(최대 100페이지 목차 순회) 에피소드 자동 수집.

### `server/routers/tasks.py` (백그라운드 크롤링 태스크)
- `POST /fetch_missing_titles`: 제목 누락 URL 백그라운드 크롤링 (Celery 우선, BackgroundTasks 폴백).
- `GET /task_status/{task_id}`: 진행률 조회.

### `server/routers/url_config.py` (URL 적용 상태)
- `POST /api/urls/apply`, `PUT /api/url_metadata`, `batch`, `GET /api/urls/apply_status` 제공.

### `server/routers/system.py` (시스템 및 디버그)
- `GET /health`, `GET /api/settings/autostart`, `GET /api/logs`, `GET /api/allowed_origins`, 디버그 엔드포인트 제공.

### `server/routers/db_editor.py` (웹 DB 관리자)
- 8개 주요 테이블 CRUD 및 점프 뷰어 제공.

### `server/routers/admin.py` (관리자 정리 작업)
- `POST /admin/cleanup_urls`: URL 조각(`#end` 등) 제거.
- `POST /admin/cleanup_pids`: 카쿠요무 특수 PID(`la`, `lp`) 제외 처리.
- **`POST /admin/restore_brackets`: 원문 대사 괄호(「%」) 룰베이스 일괄 복원 온디맨드 실행.**

### `server/routers/notifications.py` (ntfy 푸시 알림 API)
- `GET /api/notifications/settings`: 현재 ntfy 토픽, 서버, 알림 활성화 여부 조회.
- `POST /api/notifications/settings`: ntfy 설정 실시간 변경 및 `settings.json` 저장.
- `POST /api/notifications/test`: 테스트 푸시 알림 발송.

### `server/routers/ui.py` (템플릿 서빙 및 모바일 라우팅)
- `is_mobile_request(request)`: 쿼리 파라미터(`?view=mobile/pc`), 쿠키(`lanovel_view_mode`), User-Agent 헤더 순서로 모바일 접속 환경 자동 판별.
- `serve_library_view(request)`: 모바일 감지 시 `library_mobile.html`, 데스크톱 환경 시 `library.html` 동적 서빙.
- `GET /m`: 스마트폰 전용 서재 뷰 엔드포인트.
- `/book`, `/viewer`, `/admin`, `/logs`, `/library`, `/`: Jinja2 템플릿 서빙.

---

## 5. 크롬 확장 프로그램 세부 함수 동작 (Chrome Extension)

### `extension/background.js`
- `migrateQuotes()`: 기존 스토리지 큰따옴표를 대괄호 스타일로 1회 일괄 마이그레이션.
- 우클릭 컨텍스트 메뉴, `action: 'batchTranslate'`, `action: 'fetchTitle'` 메시지 중계 및 실패 에러 로깅.

### `extension/content.js`
- 소설 제목 감지 및 구분선 매칭(`checkSeparatorMatch`).
- 소설별 구분선 설정 기반 기존 번역 자동 제외(`checkAndExcludeSeparatorTranslations` -> `POST /translations/exclude`) 및 사이드바/캐시/DOM 자동 정리.
- 검수탭 스타일의 구분선 제외 알림 패널 렌더링(`renderSeparatorExcludePanel`, 하단 로그 비출력 정책 준수).
- 알림 센터 연계 재번역 검수 배너 및 PID 하이라이트.
- 본문 텍스트 DOM 한국어 치환/원복(`applyTranslationsToPage`, `restoreOriginalPage`).
- 플로팅 사이드바 주입 및 단락 인터랙션.
- 20개 단위 분할 번역 및 구분선 도달 시 번역 즉시 중단(`translateAllPTags`).
- 단일 단락 고성능 모델 재번역(`retranslateSingleRow`).

---

## 6. 웹 프론트엔드 UI 스크립트 세부 함수 동작 (Frontend UI)

### `server/static/admin.js` (관리자 대시보드 & 데이터 관리)
- `loadAndRenderGrouped()`: 경량 모드(`/translations_by_folder?light=true`) 아코디언 고속 렌더링.
- `loadAndRenderAbnormal()`: 이상 번역(규칙 3, 4) 검출 및 대기열 이전.
- 복원 센터 모달(알림/휴지통 탭), 유사 정상 번역 단락 자동 추천, 전역 찾아바꾸기, 폴더명 일괄 변경.

### `server/static/viewer.js` (웹 뷰어 & 독서 위치 관리)
- `loadBook()`, `loadChapter()`, `paginate()`, `renderPage()`: 자동 페이징 및 단락 렌더링.
- 독서 위치 자동 저장(`saveLastReadPosition`, `commitPosition`), 원문/번역문 대조 모드, 집중 모드, 본문 더블클릭 인라인 수정.

### `server/static/library.js` (서재 카드 뷰 & 태그/북마크)
- 소설 카드 그리드 렌더링, 태그 필터링, 상단 고정, 북마크, 줄거리 크롤링, PWA Service Worker 오프라인 다운로드, 목차 순서 드래그 앤 드롭 정렬.

---

## 7. 사용자 지시 및 발화-코드 1:1 매핑 사전

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 동작 및 주의사항 |
| :--- | :--- | :--- |
| **"원문에 「 」 괄호가 있는데 번역문에 없어" / "대사 괄호 복원해줘" / "괄호 누락 주기적으로 검사해줘"** | `server/rule_classifier.py` (`restore_brackets`, `batch_restore_brackets_in_db`)<br>`server/routers/translation.py` (`translate_texts`)<br>`server/routers/data_crud.py` (`upsert_translations`)<br>`server/routers/admin.py` (`admin_restore_brackets`)<br>`server/server.py` (`periodic_bracket_restoration_task`) | 원문이 `「%」`인 대사 문장에만 한정 적용. 따옴표 치환 및 누락 괄호 복원. 30분 주기 백그라운드 자동 복구 및 실시간 적재 시 자동 복원. |
| **"원문 복붙된 것들 다 지워줘" / "일본어가 그대로 번역이라고 나와"** | `server/rule_classifier.py` (`is_verbatim_copy`)<br>`server/routers/translation.py` (`handle_verbatim_cleanup_items`)<br>`server/routers/data_crud.py` (`get_cleanup_queue`, `delete_cleanup_queue`) | 원문 복붙 단락은 `TranslationTrash`로 이동되고 `CleanupNotification`에 등록되어 7일간 보존되며, 알림 센터에서 복원 가능. |
| **"번역 품질 이상한 것들(다른 언어나 미번역) 검사해줘"** | `server/rule_classifier.py` (`classify_translation`)<br>`server/routers/data_crud.py` (`get_abnormal_translations`)<br>`server/static/admin.js` (`loadAndRenderAbnormal`) | 규칙 3(타언어/간체자), 규칙 4(한국어 내 가나 잔류)를 유니코드 정규식으로 100% 탐지. |
| **"구분선 설정에 번역된게 있으면 제외해줘" / "번역된 페이지 접속 시 구분선 번역 제외하고 검수탭처럼 알려줘"** | `extension/content.js` (`checkAndExcludeSeparatorTranslations`, `renderSeparatorExcludePanel`)<br>`server/routers/translation.py` (`exclude_translations`) | 번역 완료 페이지 접속 시 구분선 매칭 번역을 서버 `/translations/exclude`로 삭제 및 제외 등록. 검수탭 스타일 패널 알림 출력(하단 로그 출력 금지). |
| **"후기나 광고 나오면 번역 멈추게 해줘" / "구분선 밑으로 번역 안 되게 해줘"** | `server/routers/separators.py`<br>`extension/content.js` (`checkSeparatorMatch`, `translateAllPTags`) | `activeSeparators` 매칭 시 `translateAllPTags` 루프를 `break`하여 그 아래 문단 번역을 완전 차단. |
| **"오후 5시 넘었는데 번역이 멈췄어" / "5시 자동 중지 조건 확인해줘"** | `server/routers/translation.py` (`translate_texts`) | 오후 4시대에 시작된 프로세스가 17시를 넘기면 스레드 안전 락 하에서 503 에러를 던져 중단됨. |
| **"Gemini 모델 바꿔줘" / "재번역할 때 다른 모델 쓰게 해줘"** | `server/settings.py` (`gemini_default_model`, `gemini_retranslation_model`)<br>`server/routers/translation.py` (`selected_model` 분기) | 일반 번역은 `gemini-3.5-flash-lite`, 단락 재번역(`is_retranslation=True`)은 `gemini-3.8-flash` 사용. |
| **"뷰어에서 읽던 위치(진도)가 저장이 안 돼"** | `server/static/viewer.js` (`saveLastReadPosition`, `commitPosition`)<br>`server/routers/books.py` (`update_book_activity`) | `last_read_pid`와 타임스탬프를 디바운스/keepalive로 서버에 전송. |
| **"카쿠요무/쇼세츠 목차 순서가 이상해" / "화수 정렬이 꼬였어"** | `server/utils.py` (`natural_sort_key`)<br>`server/routers/toc_importer.py` (`import_toc`)<br>`server/routers/books.py` (`update_book_urls_order`) | `natural_sort_key`를 사용해 001, 002, 010, 100 자연 정렬 적용. 카쿠요무는 Apollo State V2 지원. |
| **"단락 번역 결과에 따옴표가 이상하게 바뀌어"** | `extension/background.js` (`migrateQuotes`)<br>`server/routers/translation.py` (`TRANSLATION_SYSTEM_INSTRUCTION` 4번) | 일본식 따옴표(`「...」`, `『...』`)를 강제 보존하도록 프롬프트와 정규식이 구성됨. |
| **"서버 켜질 때 백업 어떻게 돌아가?"** | `server/server.py` (`backup_check_task`, `perform_sqlite_backup`, `rotate_backups`) | 24시간 가동 시마다 SQLite 온라인 백업 실행, 최신 7개 유지 롤링. |
| **"특정 단어 전체 찾아바꾸기 해줘"** | `server/routers/translation.py` (`find_replace_all`)<br>`server/static/admin.js` (`executeGlobalFindReplace`) | 폴더 범위, 원문 조건, 정규식, 대소문자 구분을 지원하여 DB 전체 치환. |
| **"책을 파일 하나로 저장해서 인터넷 없이 보고 싶어"** | `server/routers/books.py` (`export_book_as_html`) | CSS/JS와 소설 JSON 데이터를 인라인 결합한 단일 HTML 파일 내보내기. |
| **"번역 끝나면 폰으로 알림 오게 해줘" / "푸시 알림 설정해줘"** | `server/notifications.py` (`send_ntfy`, `notify_translation_progress`)<br>`server/routers/notifications.py`<br>`server/static/admin.js` | ntfy pub-sub 프로토콜을 사용해 스마트폰/브라우저로 실시간 번역 진행 및 완료 푸시 전송. |
| **"스마트폰(모바일)에서 서재 편하게 보고 싶어" / "모바일 전용 화면 보여줘"** | `server/routers/ui.py` (`is_mobile_request`, `serve_library_view`)<br>`server/templates/library_mobile.html`<br>`server/static/library_mobile.js` | 모바일 접속 시 터치 최적화된 모바일 전용 서재 뷰(`library_mobile.html`) 자동 서빙 및 쿠키 기반 PC/모바일 모드 전환. |
