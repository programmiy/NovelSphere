# API 문서 자동화 및 고도화 (2025-11-12)

## 1. 개요

- **작업:** 로드맵의 "API 문서 자동화 및 고도화" 항목을 구현했습니다.
- **목표:** FastAPI의 자동 문서 생성 기능(Swagger UI, ReDoc)을 적극적으로 활용하기 위해 각 API 엔드포인트에 `tags`, `summary`, `description`을 추가하여 API의 기능과 사용법을 명확하게 파악할 수 있도록 개선했습니다.

## 2. 상세 변경 내역

`server/routers` 디렉토리 내의 모든 라우터 파일에 있는 API 엔드포인트에 다음 정보가 추가되었습니다:

-   **`tags`**: API 그룹화를 위한 태그 (예: "Admin", "Books", "Data CRUD", "DB Editor", "System", "Tasks", "TOC Importer", "URL Config", "UI", "Debug").
-   **`summary`**: API의 간략한 요약.
-   **`description`**: API의 상세 설명.

### 2.1. `server/routers/admin.py`

-   `/admin/cleanup_urls` (POST): URL 조각 정리
-   `/admin/cleanup_pids` (POST): PID 정리

### 2.2. `server/routers/books.py`

-   `/api/books/{folder_name}/urls` (PUT): 책 URL 순서 업데이트
-   `/folders` (GET): 모든 폴더(책) 목록 조회
-   `/api/books` (GET): 모든 책 목록 조회 (폴더와 동일)
-   `/api/folders` (POST): 새 폴더(책) 생성
-   `/api/folders/{folder_name}` (PUT): 폴더(책) 이름 변경
-   `/api/books/pin` (POST): 책 고정/고정 해제
-   `/api/books/{folder_name}/urls` (GET): 책의 URL 목록 조회
-   `/api/books/{folder_name}/chapters` (GET): 책의 챕터 목록 조회
-   `/api/books/{folder_name}/chapter` (GET): 특정 챕터 내용 조회
-   `/api/books/{folder_name}/export` (GET): 책을 HTML로 내보내기
-   `/api/books/{folder_name}/tags` (PUT): 책 태그 업데이트
-   `/api/books/{folder_name}/activity` (PUT): 책 활동 정보 업데이트
-   `/api/books/{folder_name}/activity` (GET): 책 활동 정보 조회
-   `/api/books/{folder_name}/crawl-summary` (POST): 책 요약 정보 크롤링 시작

### 2.3. `server/routers/data_crud.py`

-   `/translations` (GET): 번역 기록 조회
-   `/translations/upsert` (POST): 번역 기록 추가 또는 업데이트
-   `/translations/move` (PUT): 번역 기록 이동
-   `/translations/delete` (POST): 번역 기록 삭제
-   `/paged_translations` (GET): 페이지별 번역 기록 조회
-   `/translations_by_folder` (GET): 폴더별 번역 기록 조회
-   `/stream` (GET): 번역 데이터 스트리밍
-   `/migrate` (POST): 데이터 마이그레이션

### 2.4. `server/routers/db_editor.py`

-   `/db_editor` (GET): DB 편집기 페이지 조회
-   `/api/db_editor/{table_name}` (POST): DB 레코드 생성
-   `/api/db_editor/{table_name}/{record_id}` (PUT): DB 레코드 업데이트
-   `/api/db_editor/{table_name}/{record_id}` (DELETE): DB 레코드 삭제

### 2.5. `server/routers/system.py`

-   `/health` (GET): 상태 확인
-   `/api/settings/autostart` (GET): 자동 시작 설정 조회
-   `/api/logs` (GET): 최신 로그 조회
-   `/api/allowed_origins` (GET): 허용된 CORS 출처 조회
-   `/debug/urls_by_folder` (GET): 폴더별 URL 디버그 조회
-   `/api/debug/find_translation` (GET): 쿼리로 번역 기록 찾기

### 2.6. `server/routers/tasks.py`

-   `/fetch_missing_titles` (POST): 누락된 제목 가져오기
-   `/task_status/{task_id}` (GET): Celery 작업 상태 조회

### 2.7. `server/routers/toc_importer.py`

-   `/api/import-toc` (POST): 목차 가져오기

### 2.8. `server/routers/translation.py`

-   `/translate` (POST): 텍스트 번역
-   `/excluded_sentences` (GET): 제외된 문장 조회
-   `/translations/exclude` (POST): 번역 기록 제외
-   `/translations/find_replace` (POST): 찾아 바꾸기
-   `/translations/url_title` (PUT): URL에 대한 제목 업데이트

### 2.9. `server/routers/ui.py`

-   `/book` (GET): 책 UI 페이지
-   `/viewer` (GET): 뷰어 UI 페이지
-   `/admin` (GET): 관리자 UI 페이지
-   `/logs` (GET): 로그 뷰어 UI 페이지
-   `/library` (GET): 서재 UI 페이지
-   `/` (GET): 루트 페이지 (서재 UI)

### 2.10. `server/routers/url_config.py`

-   `/api/urls/apply` (POST): URL 적용 상태 토글
-   `/api/url_metadata` (PUT): URL 메타데이터 업데이트
-   `/api/url_metadata/batch` (PUT): URL 메타데이터 일괄 업데이트
-   `/api/urls/apply_status` (GET): URL 적용 상태 조회

## 3. 기대 효과

-   API 명세가 항상 최신 상태로 유지되며, Swagger UI/ReDoc을 통해 쉽게 접근할 수 있습니다.
-   프론트엔드 개발자 및 API 연동 시 협업 효율성이 증대됩니다.
-   API의 기능과 사용법을 별도의 문서 없이도 명확하게 파악할 수 있습니다.
