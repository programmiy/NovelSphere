# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트가 사용자 요구사항 및 구어체 지시를 입력받았을 때, 혼선이나 회귀(Regression) 없이 전체 아키텍처와 1:1 타깃 코드를 0초 만에 직관적으로 파악할 수 있도록 압축 정리한 단일 진실 공급원(SSOT) 기술 레퍼런스입니다.
> **최신 동기화 일자**: 2026-09-27 (모바일 번역문 루비/방점 출판사 스타일 자동 렌더링, Flutter 독립 앱, OTA 무선 업데이트, 초고속 압축 동기화, 배민 스타일 단일 번역 현황판 알림, NovelUp+ 플랫폼 전면 지원, 룰베이스 품질 보정 및 도서 숨김 기능 통합)

---

## ⚡ 빠른 탐색용 핵심 모듈 & 라우터 맵 (Fast Lookup)

| 구분 | 파일 경로 | 핵심 역할 및 주요 함수/클래스 |
| :--- | :--- | :--- |
| **데스크톱** | `main.py` | PyWebView 윈도우 + 시스템 트레이(`Pystray`) + 서버/셀러리 서브프로세스 수명주기 관리 |
| **설정/연결** | `server/settings.py` | Pydantic 환경변수 (.env), Gemini 모델(`gemini-3.5-flash-lite`), 포트(8001), CORS 허용 출처 |
| **DB 코어** | `server/database.py` | SQLite WAL 모드, `busy_timeout=5000`, `REGEXP` 함수 주입, SQLAlchemy 세션 제너레이터 |
| **ORM 모델** | `server/models.py` | `Translation`, `BookActivity`(`is_visible` 포함), `NovelSeparatorSetting`, `TranslationTrash` 등 12개 테이블 |
| **품질/복원** | `server/rule_classifier.py` | 100% 룰베이스 번역 품질 분류(규칙 1~4), 대사 괄호(`「%」`) 자동 복원([`restore_brackets`](file:///C:/LANOVEL/server/rule_classifier.py)) |
| **알림/현황판** | `server/notifications.py` | 배민 스타일 단일 번역 현황판([`update_translation_status`](file:///C:/LANOVEL/server/notifications.py)), Gemini API 오류 통계, 인메모리 버퍼 & SSE 스트림 |
| **서버 코어** | `server/server.py` | 14개 라우터 등록, FTS5 가상테이블/트리거, 30분 괄호복원 태스크, 24시간 온라인 백업, 캐시 버스팅 |
| **번역 엔진** | `server/routers/translation.py` | Gemini 호출, 기본모델 verbatim 2단계 자체 복구([`_recover_verbatim_items`](file:///C:/LANOVEL/server/routers/translation.py)), 17시 안전 중단 |
| **데이터 CRUD** | `server/routers/data_crud.py` | FTS5 전문 검색, N+1 제거 upsert, 이상 번역 검출, 복원 센터 모달(휴지통/알림) |
| **서재/책** | `server/routers/books.py` | 도서 숨김/표시([`update_book_visibility`](file:///C:/LANOVEL/server/routers/books.py)), NovelUp+ 줄거리 크롤링, 회차 내 페이지/스크롤 복원 |
| **목차 파서** | `server/routers/toc_importer.py` | 카쿠요무(Apollo State Next.js), 소설가가 되자, **NovelUp+** ([`fetch_all_novelup_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)) 목차 수집 |
| **동기화** | `server/routers/sync.py` | 모바일 초고속 양방향 동기화: `/ping`, 하이브리드 zlib 압축 SQLite 시드 DB(`/full-pack`), `/pull`, `/push` |
| **앱 배포** | `server/routers/app_release.py` | 모바일 OTA 무선 자동 업데이트: `/api/app/version`, `/api/app/download`, 웹 랜딩 페이지(`/download`) |
| **구분선** | `server/routers/separators.py` | 후기/광고 번역 차단용 소설별 구분선 CRUD (공통 7종, 프리셋 6종) |
| **크롬 확장** | `extension/content.js` | NovelUp+ 지원, 쾌속모드 동적 단축, 빈칸 문장 자동 보완, 구분선 후속 단락 일괄 제외, DOM 치환 |
| **모바일 앱** | `mobile_app/lib/` | Flutter 네이티브 리더 (Sqflite 하이브리드 압축 DB, 루비/방점 렌더러, 배민 스타일 ID 9001 현황판, TTS) |
| **웹 프론트** | `server/static/` | `viewer.js` (롱프레스 단락 편집, 위치 복원), `library.js` (숨김 도서 필터), `admin.js` |

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 플랫폼 (Kakuyomu / Syosetu / NovelUp+) ]
           ▲
           │ DOM 파싱 (p/l 태그, 소설명 감지, 구분선 감지, 다음 화 '次へ' 자동 이동)
           ▼
[ 크롬 확장 프로그램 (extension) ]
   - content.js: 실시간 쾌속모드 대기시간 단축(8초->2초), 번역 직전 빈칸 보완, 구분선 후속 단락 일괄 제외
   - background.js: API 중계, 토큰 인증, 에러 로깅
           │ HTTP (POST /translate, GET/POST /api/...)
           ▼
[ FastAPI 백엔드 서버 (server:app, Port: 8001) ]
   - translation.py   ──▶ [ Google Gemini API ] (gemini-3.5-flash-lite / gemini-3.8-flash)
                          (기본 모델 verbatim 2단계 자체 복구: 단일 JSON -> 순수 텍스트 -> 화살표 분리)
   - data_crud.py     ──▶ [ SQLite DB (translations.db - WAL Mode) ]
   - books.py         ──▶ [ FTS5 가상 테이블 (translations_fts) ]
   - sync.py          ──▶ [ 하이브리드 zlib 압축 SQLite 시드 DB 생성 엔진 (150MB -> ~26MB Gzip) ]
   - app_release.py   ──▶ [ 모바일 APK 패키징 및 OTA 업데이트 배포 ]
   - notifications.py ──▶ [ 인메모리 배민 스타일 단일 번역 현황판 & 로컬 SSE 브로드캐스트 ]
   - rule_classifier.py (100% 룰베이스 번역 품질 검증 및 대사 괄호 「%」 자동 복원)
   - server.py (30분 주기 DB 괄호 복원 태스크 & 24시간 온라인 백업 & 유휴 알림 3분 자동 정리)
           ▲
           │ Wi-Fi 로컬 네트워크 동기화 (HTTP Gzip/zlib) & OTA 무선 업데이트
           ▼
[ 클라이언트 생태계 (Desktop Web & Mobile Native) ]
   1. 데스크톱 앱 (main.py): PyWebView + Pystray 시스템 트레이
   2. 웹 프론트엔드 (static/): library.js (숨김 필터), viewer.js (롱프레스 편집), admin.js
   3. 모바일 독립 앱 (mobile_app/): Flutter 기반 네이티브 리더 (Android / iOS)
      - Sqflite 로컬 오프라인 DB (1ms 챕터 zlib 압축 해제, autoHealMissingChapters 회차 자동 치유)
      - NovelRubyText: 번역문 내 루비(`단어《루비》`) 및 방점(`글(・)`) 출판사급 상단 첨자 자동 렌더링
      - 고정 ID 9001 배민 스타일 단일 번역 현황판 알림 (삼성 Now Bar/잠금화면 규격 호환)
      - 원클릭 무선 자동 업데이트 (OTA, PackageInstaller)
      - 백그라운드 TTS 음성 리더 & 12가지 테마 & 듀얼 페이징/스크롤 뷰어
```

---

## 2. 번역 및 데이터 처리 파이프라인 (Life of a Translation)

```
1. [웹 페이지 로드] 
   content.js가 소설 사이트(카쿠요무/쇼세츠/NovelUp+) 감지 -> 구분선 목록 조회(/api/separators/by-url)
   -> 이미 번역된 문장이 구분선과 일치하면 후속 단락까지 일괄 제외(/translations/exclude)
2. [번역 실행] 
   20개 단위 청크 번역(/translate) -> 쾌속모드 활성화 시 대기시간 동적 단축(8초 -> 2초)
   -> 17시 경계 감지(16시대 프로세스 차단) -> Gemini API 호출
3. [품질 검증 및 자체 복구]
   - 원문 복붙(verbatim) 감지 시: 기본 모델로 1차 단일 JSON -> 2차 스키마 프리 순수 텍스트 -> 화살표 분리 복구
   - 최종 복구 실패 항목만 TranslationTrash로 안전 격리 (새로고침 시 스킵 방지를 위해 deletedTranslationPids 분리)
   - 대사 괄호(「%」) 누락/변형 발견 시 restore_brackets로 실시간 복원
4. [알림 및 현황판 갱신]
   서버 notifications.py의 TranslationStatusBoard 갱신 -> 모바일 앱이 고정 ID(9001) 배민 스타일 상단바로 진행률 표시
5. [번역 완료 직전 빈칸 보완]
   미번역 구두점/특수기호/빈칸 문장을 마지막 번역꾸러미에 자동 포함하여 보완 완료
```

---

## 3. 백엔드 핵심 모듈 명세

### `server/server.py` (라이프사이클 및 코어 서비스)
- **14개 라우터 등록**: `ui`, `translation`, `data_crud`, `books`, `system`, `tasks`, `admin`, `url_config`, `db_editor`, `toc_importer`, `separators`, `notifications`, `sync`, `app_release`.
- **`lifespan(app)`**:
  - 시작 시: DB 자동 마이그레이션 (`book_activity.is_completed`, `book_activity.is_visible`), FTS5 가상테이블 및 트리거(`translations_ai`, `translations_ad`, `translations_au`) 생성, 30분 주기 대사 괄호 복원 태스크(`periodic_bracket_restoration_task`), 24시간 온라인 백업 태스크(`backup_check_task`).
  - 종료 시: 백그라운드 태스크 취소, 런타임 메타데이터 영속화, `engine.dispose()`.
- **캐시 버스팅**: `GET /service-worker.js` 서빙 시 최신 Git 커밋 해시(`get_git_commit_hash()`) 주입.
- **통합 요약 API**: `GET /api/status/summary` 제공.

### `server/settings.py` (설정 중앙 관리)
- `gemini_default_model`: `gemini-3.5-flash-lite` (기본 번역 및 verbatim 자체 복구용)
- `gemini_retranslation_model`: `gemini-3.8-flash` (단일 단락 고성능 재번역용)
- `ntfy_enabled`: `False` (외부 ntfy 의존성 완전 분리, 자체 인메모리 현황판 구동)
- `allowed_origins`: 카쿠요무, 쇼세츠, **NovelUp+ (`https://novelup.plus`)**, 로컬호스트 등 CORS 허용

### `server/models.py` (핵심 ORM 모델 - 총 12개)
- `Translation`: `(id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order)`. 고유키: `(url, pid, original)`.
- `BookActivity`: `(folderName PK, last_read_timestamp, last_read_pid, last_read_chapter_title, is_completed, is_visible, is_bookmarked, notes, summary)`.
- `TranslationTrash`: 비정상 번역 및 삭제 단락 보관소 (`original_translation_id`, `reason_category`, `deleted_at`).
- `CleanupNotification`: 문제 단락 자동 격리 7일 보존 알림 센터.

### `server/rule_classifier.py` (100% 룰베이스 품질 검증 & 괄호 복원)
- `classify_translation(original, translated)`:
  - `'normal'`: 정상 번역
  - `'verbatim_or_empty'`: 규칙 1 (원문 복붙 또는 빈 번역)
  - `'paraphrased_jp'`: 규칙 2 (한글 없이 가나가 포함된 원문 변형)
  - `'other_language'`: 규칙 3 (한글 없이 간체자/영어 등 타 언어로 출력)
  - `'partial_untranslated'`: 규칙 4 (한글은 있으나 가나가 잔류한 일부 미번역)
- `restore_brackets(original, translated)`:
  - **규칙 대상**: 원문의 처음과 끝이 `「%」`로 둘러싸인 대사 문장에만 한정 적용 (독백/중간 괄호 제외).
  - 따옴표(`"`, `'`, `“`, `‘`, `«`) 치환 및 한쪽/완전 누락된 괄호 복원. 다중 괄호(`「「...」」`) 및 화자 접두어 보존.
- `batch_restore_brackets_in_db(db_conn)`: DB 내 누락/변형된 대사 괄호 고속 일괄 복원.

### `server/notifications.py` (배민 스타일 단일 현황판 & 오류 통계)
- **외부 ntfy 분리**: `settings.ntfy_enabled == False` 시 외부 HTTP 요청 차단.
- **`TranslationStatusBoard`**: 활성 여부, 작품/회차명, 문장 진행률, 15분 미갱신 시 자동 비활성화(Idle).
- **Gemini API 오류 통계**: `record_api_error_stat(error_type)`, `get_api_error_stats()` (429 Quota, 503 Overload 등 실시간 집계).
- **인메모리 버퍼 & SSE**: `_NOTIFICATION_HISTORY` (최근 50개 링버퍼), `_SSE_SUBSCRIBERS` 브로드캐스트.

---

## 4. 백엔드 라우터별 세부 API 엔드포인트

### 1) `server/routers/translation.py` (번역 엔진 코어)
- `POST /translate`:
  - 17시 안전 중단 락, 최대 5회 지수 백오프, 실시간 `restore_brackets` 대사 괄호 복원.
  - **`_recover_verbatim_items`**: 기본 모델(`gemini-3.5-flash-lite`)로 1차 단일 JSON -> 2차 스키마 프리 순수 텍스트 -> 화살표(`->`) 분리 자체 복구.
- `POST /translations/find_replace`: 폴더 범위, 원문 조건, 정규식을 지원하는 전역 찾아바꾸기.
- `POST /translations/exclude`: 지정 ID 번역 제외 목록 등록 및 레코드 삭제.

### 2) `server/routers/data_crud.py` (데이터 관리 & FTS5)
- `GET /translations`: FTS5 전문 검색(실패 시 LIKE 폴백), URL 정규화 일치 검색, 페이징.
- `POST /translations/upsert`: N+1 제거 메모리 맵 적재, `restore_brackets` 통과 후 저장, 복붙 격리.
- `GET /translations/abnormal`: 규칙 3(타 언어), 규칙 4(일부 미번역) 검출.
- `GET /cleanup/notifications`, `GET /translations/trash`: 알림 센터 및 휴지통 복원 관리.

### 3) `server/routers/books.py` (서재 및 도서 활동)
- `GET /folders`, `GET /api/books`: `include_hidden=false` 기본 적용으로 숨김 도서(`is_visible == 0`) 필터링.
- **`PUT /api/books/{folder_name}/visibility`**: 도서 숨김/표시(`is_visible: bool`) 토글 API.
- `PUT /api/books/{folder_name}/activity`: 회차 내부 세부 페이지/스크롤 위치 및 독서 진도 저장.
- `POST /api/books/{folder_name}/crawl-summary`: 카쿠요무, 쇼세츠 및 **NovelUp+ (`.novel_synopsis`)** 줄거리 크롤링.
- `GET /api/books/{folder_name}/export`: 독립 오프라인 HTML 파일 내보내기.

### 4) `server/routers/toc_importer.py` (목차 크롤링)
- `POST /api/import-toc`:
  - 카쿠요무 (Apollo State JSON 파싱), 쇼세츠 (최대 100페이지 목차 순회).
  - **NovelUp+**: `fetch_all_novelup_chapters`로 `https://novelup.plus/story/{id}` 및 페이지네이션(`?p={page}`)을 순회하며 `.episode_list`, `.episode_title` 에피소드 자동 수집.

### 5) `server/routers/sync.py` (모바일 초고속 압축 동기화)
- `GET /api/sync/ping`: 0.05초 만에 서버 통신 가능 여부 확인.
- `GET /api/sync/full-pack`: 하이브리드 SQLite 시드 DB(zlib 압축 BLOB) 생성 후 Gzip 스트리밍 다운로드 (150MB -> ~26MB). 전송 완료 후 PC 임시파일 자동 정리.
- `DELETE /api/sync/full-pack/{pack_id}`: 모바일 무결성 검증 완료 즉시 PC 임시 압축 팩 안전 삭제.
- `GET /api/sync/pull`: `since` 이후 신규 번역 및 회차 zlib 압축 BLOB 증분 수신.
- `POST /api/sync/push`: 모바일에서 기록한 독서 활동, 독서 통계, 인라인 수정 단락 역동기화.

### 6) `server/routers/app_release.py` (모바일 OTA 무선 자동 업데이트)
- `GET /api/app/version`: 최신 앱 버전 메타데이터 반환 (`pubspec.yaml` 및 빌드된 APK 분석).
- `GET /api/app/download`: 최신 릴리즈 APK 바이너리 스트리밍 다운로드.
- `GET /download`: 모바일 브라우저 전용 반응형 APK 다운로드 웹 랜딩 페이지 서빙.

---

## 5. Flutter 모바일 독립 서재 애플리케이션 (`mobile_app/`)

### 1) 데이터 모델 계층 (`models/`)
- `book.dart` (소설 메타 및 `isVisible`, `isPinned`), `chapter.dart` (회차 및 zlib `compressedContent`), `sentence.dart` (단락 본문), `reading_log.dart` (일일 독서 통계), `glossary_rule.dart` (치환 사전), `app_notification.dart` (인앱 알림).

### 2) 핵심 서비스 계층 (`services/`)
- **`local_db_service.dart` (Sqflite 로컬 오프라인 DB)**:
  - 챕터 오픈 시 zlib BLOB을 1ms 이내로 실시간 압축 해제.
  - **`autoHealMissingChapters()`**: 동기화 후 누락되거나 어긋난 회차 DB 구조 자동 치유.
- **`sync_service.dart` (압축 동기화 서비스)**:
  - Wi-Fi 감지 -> 핑 -> 전체 시드 다운로드/해제 -> 서버 임시파일 삭제 호출 -> 증분 pull/push.
- **`status_dashboard_service.dart` (스마트 가변 폴링)**:
  - 번역 진행 중에는 가변 단축 주기, 유휴 상태 시에는 **초저전력 15분 주기**로 `/api/status/summary` 폴링.
- **`local_notification_service.dart` (배민 스타일 단일 번역 현황판)**:
  - **고정 ID 9001 단일 알림**: 여러 알림 없이 단 1개의 현황판에서 진행 바와 에러 통계 갱신.
  - **삼성 Now Bar / 잠금화면 진행바 호환**, 유휴 상태 3분 후 자동 해제.
- **`app_update_service.dart` (OTA 무선 업데이트)**:
  - 버전 체크 -> 백그라운드 APK 다운로드 -> Android PackageInstaller 원클릭 무선 설치.
- **`tts_audio_service.dart`**: `flutter_tts` 백그라운드 음성 리더 (문장 하이라이트, 배속 제어).

### 3) 사용자 인터페이스 계층 (`ui/`)
- `library_screen.dart`: 카드 서재, 숨김 도서 토글, 당겨서 동기화(Pull-to-refresh).
- `reader_screen.dart`: **500ms 롱프레스 제스처 시에만 편집 모달 호출**, 페이징/스크롤 듀얼 모드, 회차 내 위치 자동 복원.
- **`novel_ruby_text.dart` (신규)**:
  - **`NovelRubyParser`**: `hasRubyOrBouten`으로 일반 문장 O(1) 고속 통과. `글(・)` 방점 및 `단어《루비》` 패턴 자동 분리.
  - **`NovelRubyText`**: 방점과 루비를 `WidgetSpan` 상단 첨자로 완벽 렌더링.
- `settings_screen.dart`: Wi-Fi SSID 원터치 자동 등록, OTA 업데이트 확인, 동기화 제어.

---

## 6. 크롬 확장 프로그램 (`extension/`) 세부 동작
- **NovelUp+ 지원**: 본문 셀렉터, 소설명 감지, 다음 화(`次へ`) 링크 자동 이동.
- **쾌속모드 대기시간 즉각 동적 단축**: 루프 순회 중 `fastMode` 감지 시 즉시 8초 -> 2초로 대기 단축.
- **미번역 빈칸 문장 마지막 보완**: 번역 완료 직전 잔여 빈칸/기호 문장을 마지막 청크에 자동 편입.
- **격리 단락 분리 (`deletedTranslationPids` vs `userDeletedTranslationPids`)**: 원문 복붙 격리 항목이 새로고침 시 번역 스킵되는 현상 방지.
- **구분선 후속 단락 일괄 제외**: 첫 단락 보호 예외 로직 및 검수탭 스타일 패널 알림.

---

## 7. 웹 프론트엔드 UI (`server/static/`) 세부 동작
- **`viewer.js`**: 모바일 웹 뷰어 터치 충돌 해결을 위한 롱프레스(500ms) 편집 모달 분리, 회차 내 페이지/스크롤 복원.
- **`library.js` & `library_mobile.js`**: 도서 숨김/표시(`PUT /api/books/{folder_name}/visibility`) 토글 및 상단 숨김 도서 보기 필터.
- **`admin.js`**: 경량 모드 아코디언, 이상 번역 검출, 복원 센터 모달, 전역 찾아바꾸기.

---

## 8. 불변 규칙 및 안전 가드 (Critical Guardrails)

1. **오후 5시 번역 안전 중단**: 16시대에 시작된 번역 프로세스가 17시를 넘기면 스레드 안전 락 하에서 503 에러를 던져 중단됨.
2. **원문 복붙(verbatim) 2단계 자체 복구 우선**: 발견 즉시 격리하지 않고 기본 모델(gemini-3.5-flash-lite)로 단일 JSON -> 순수 텍스트 -> 화살표 분리를 먼저 시도한 뒤, 최종 실패 항목만 격리.
3. **대사 괄호 복원 범위 한정**: 원문이 `「%」`로 시작하고 끝나는 대사 문장에만 한정 적용 (문장 중간 괄호/독백 배제).
4. **ntfy 외부 의존성 분리**: `settings.ntfy_enabled`가 꺼져 있을 때는 외부 ntfy 서버로의 HTTP 요청을 원천 차단.
5. **모바일 동기화 시드 삭제**: 모바일 앱이 `/api/sync/full-pack` 다운로드 및 압축 해제 검증을 마치면 반드시 `DELETE /api/sync/full-pack/{pack_id}`를 호출하여 PC 측 임시 파일을 삭제해야 함.

---

## 9. 사용자 지시 및 발화-코드 1:1 매핑 사전 (Intent Routing Dictionary)

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 처리 내용 |
| :--- | :--- | :--- |
| **"번역문에 루비/방점 나오게 해줘" / "단어 위에 점/루비 표시해줘"** | `mobile_app/lib/ui/viewer/novel_ruby_text.dart`<br>`mobile_app/lib/ui/viewer/reader_screen.dart` | `NovelRubyParser`로 `글(・)` 방점 및 `단어《루비》` 패턴 자동 감지 -> O(1) 필터링 후 `NovelRubyText` 위젯으로 출판사급 상단 첨자 렌더링. |
| **"스마트폰 독립 앱으로 보고 싶어" / "모바일 앱 동기화해줘"** | `server/routers/sync.py`<br>`mobile_app/lib/services/sync_service.dart`<br>`mobile_app/lib/services/local_db_service.dart` | 하이브리드 zlib 압축 SQLite 시드 DB를 Gzip 스트리밍 다운로드. 1ms 챕터 압축 해제 및 양방향 증분 pull/push. |
| **"모바일 앱 업데이트 어떻게 해?" / "새 버전 앱 깔아줘"** | `server/routers/app_release.py`<br>`mobile_app/lib/services/app_update_service.dart` | `/api/app/version` 비교 후 백그라운드 APK 다운로드 및 PackageInstaller 기반 원클릭 무선 OTA 설치. |
| **"푸시 알림 너무 많이 와" / "배민처럼 하나로 합쳐줘" / "상단바에 진행바 띄워줘"** | `server/notifications.py` (`TranslationStatusBoard`)<br>`mobile_app/lib/services/local_notification_service.dart`<br>`mobile_app/lib/services/status_dashboard_service.dart` | 고정 ID(9001) 단일 번역 현황판 알림으로 진행률/에러 통계 실시간 갱신. 삼성 Now Bar/잠금화면 호환 및 3분 유휴 자동 해제. |
| **"노벨업 플러스 번역해줘" / "novelup.plus 지원해줘"** | `server/routers/toc_importer.py` (`fetch_all_novelup_chapters`)<br>`server/routers/books.py` (`_crawl_and_update_summary_worker`)<br>`extension/content.js`<br>`server/settings.py` | NovelUp+ 목차 파싱, 줄거리 크롤링(`.novel_synopsis`), 뷰어 본문 치환 및 다음 화 자동 이동 전면 지원. |
| **"원문 복붙된 것들 다 지워줘" / "일본어가 그대로 번역이라고 나와"** | `server/routers/translation.py` (`_recover_verbatim_items`, `handle_verbatim_cleanup_items`)<br>`server/rule_classifier.py` (`is_verbatim_copy`) | 기본 모델(gemini-3.5-flash-lite)로 단일 JSON 및 순수 텍스트 2단계 자체 복구. 화살표(`->`) 분리 후 실패 항목만 격리. |
| **"다 읽은 책 숨기고 싶어" / "서재에서 책 안 보이게 해줘"** | `server/models.py` (`BookActivity.is_visible`)<br>`server/routers/books.py` (`update_book_visibility`, `get_folders`)<br>`server/static/library.js`<br>`mobile_app/lib/ui/library/library_screen.dart` | `is_visible` 필터링 및 서재 "숨긴 도서 표시" 토글 버튼 제공. |
| **"모바일에서 페이지 넘기려는데 자꾸 수정창이 떠"** | `server/static/viewer.js`<br>`mobile_app/lib/ui/viewer/reader_screen.dart` | 우측 넘김 터치와 편집 충돌 해결: 500ms 이상 **롱프레스(Long-press)** 시에만 수정 모달 오픈. |
| **"번역 중에 쾌속모드 켰는데 왜 안 빨라져?"** | `extension/content.js` (`translateAllPTags`) | 루프 순회마다 실시간으로 쾌속모드 플래그 체크하여 즉각 8초 -> 2초 대기시간 단축 동적 반영. |
| **"번역 끝나갈 때 빈칸 문장들이 남아있어"** | `extension/content.js`<br>`server/routers/translation.py` | 번역 직전 미번역 빈칸 문장들을 마지막 번역 꾸러미에 자동 포함 및 보완 메커니즘 가동. |
| **"원문에 「 」 괄호가 있는데 번역문에 없어" / "대사 괄호 복원해줘"** | `server/rule_classifier.py` (`restore_brackets`, `batch_restore_brackets_in_db`)<br>`server/server.py` (`periodic_bracket_restoration_task`) | 원문이 `「%」`인 대사 문장에만 한정 적용. 30분 주기 백그라운드 자동 복구 및 실시간 적재 시 자동 복원. |
| **"구분선 밑으로 번역 안 되게 해줘" / "구분선 다음 단락들도 같이 제외해줘"** | `server/routers/separators.py`<br>`extension/content.js` (`checkAndExcludeSeparatorTranslations`) | 구분선 발견 시 첫 단락을 제외하고 후속 단락 전체를 일괄 제외 등록 및 DOM 정리. |
| **"뷰어에서 읽던 위치(진도)가 저장이 안 돼"** | `server/static/viewer.js`<br>`mobile_app/lib/ui/viewer/reader_screen.dart`<br>`server/routers/books.py` | 회차 내부 페이지/스크롤 위치를 정확히 저장 및 복원. |
| **"Gemini 모델 바꿔줘" / "재번역할 때 다른 모델 쓰게 해줘"** | `server/settings.py` (`gemini_default_model`, `gemini_retranslation_model`)<br>`server/routers/translation.py` | 일반 번역은 `gemini-3.5-flash-lite`, 단락 재번역은 `gemini-3.8-flash` 분기 사용. |
| **"책을 파일 하나로 저장해서 인터넷 없이 보고 싶어"** | `server/routers/books.py` (`export_book_as_html`) | CSS/JS와 소설 JSON 데이터를 인라인 결합한 단일 HTML 파일 내보내기. |
