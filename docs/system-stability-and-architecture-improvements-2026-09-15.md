# 시스템 안정성, 데이터 무결성 및 성능 최적화 9대 과제 완료 보고서 (2026-09-15)

## 1. 개요
* LANOVEL 시스템 전반의 아키텍처 완성도와 안정성을 극대화하기 위해, 실제 데이터 유실, 크롤링 누락, 메모리 과부하, 디스크 고갈, 서비스 중단을 유발할 수 있는 9대 핵심 과제를 선별하여 전면 개선 및 검증을 완료했습니다.

---

## 2. 주요 개선 사항

### 2-1. 폴더(책) 이름 변경 시 연관 테이블 외래키 정합성 보장 (server/routers/books.py)
* update_folder_name 시 translations와 book_activity뿐만 아니라 pinned_books(folderName), book_tags(book_folderName) 테이블도 단일 트랜잭션 내에서 원자적으로 동시 UPDATE.
* 책 이름을 변경해도 즐겨찾기 고정(Pin) 상태와 태그 매핑이 유실되지 않도록 데이터 무결성 확보.

### 2-2. 쇼세츠(Syosetu) 100화 이상 다중 페이지(페이징) 목차 수집 지원 (server/routers/toc_importer.py)
* 카쿠요무 tableOfContentsV2 지원 및 쇼세츠의 .c-pager__item--next, ?p=... 페이징 링크 자동 순회 탐색 로직 구축.
* 100화가 초과하는 대작 장편 소설의 전체 챕터를 누락 없이 전 회차 자동 수집.

### 2-3. 백업 파일 자동 보관 주기(Retention) 및 로테이션 관리 (server/server.py)
* rotate_backups 헬퍼 함수를 구축하여 온라인 백업 생성 직후 최신 7개 백업만 유지하고 오래된 백업을 FIFO 방식으로 자동 삭제.
* 장기 구동 시 백업 파일 무한 증식으로 인한 C드라이브 디스크 용량 고갈 위험 원천 차단.

### 2-4. Celery/Redis 미가동 시 FastAPI BackgroundTasks 자동 Fallback (server/routers/tasks.py)
* Redis/Celery가 없는 데스크톱/로컬 환경에서 '누락된 제목 가져오기' 실행 시 500 에러 대신 FastAPI 내장 BackgroundTasks로 자동 전환되어 인프로세스 비동기 실행.
* get_task_status에서 Fallback 진행률 조회 지원 및 task_result.info 예외 방어 코드 적용.

### 2-5. URL 정규화(Normalization) 엔진 통합 (server/utils.py, server/routers/url_config.py, server/routers/admin.py)
* normalize_url 공통 유틸리티를 구축하여 # 조각 제거, 프로토콜/도메인 소문자화, 끝 슬래시 통일.
* toggle_apply_url과 get_apply_status의 일관된 정규화 키 매칭으로 번역 적용 상태 판별 누락 및 중복 저장 버그 해결.
* cleanup_url_fragments 시 UPDATE OR IGNORE 적용으로 UNIQUE 제약 충돌 방지.

### 2-6. 시스템 로그 메모리 보호 Tail 슬라이싱 (server/routers/system.py)
* get_logs에서 collections.deque(f, maxlen=limit)를 적용하여 대용량 로그 파일 전체를 메모리에 적재하지 않고 최신 1,000줄만 고속 반환.
* OOM 메모리 급증 및 브라우저 프리징 방지, errors='replace'로 인코딩 오류 방어.

### 2-7. 서버 셧다운(Lifespan) 시 백그라운드 태스크 및 DB 풀 리소스 안전 해제 (server/server.py)
* 서버 종료(yield 이후) 시 실행 중이던 backup_check_task를 안전하게 캔슬(task.cancel())하고, SQLAlchemy engine.dispose()를 명시적으로 호출하여 리소스 누수 및 SQLite DB 락 잔여 방지.

### 2-8. DB 에디터 온디맨드(On-demand) 로딩 및 테이블 목록 탭 UI (server/routers/db_editor.py, server/templates/db_editor.html)
* 피드백 반영: 초기 페이지 진입 시 8개 전체 테이블 쿼리(풀스캔)를 제거하고 테이블 이름 목록 탭만 빠르게 표시.
* 사용자가 특정 테이블 버튼을 클릭했을 때만 해당 테이블 데이터를 온디맨드로 로드하여 페이지 로딩 속도 극대화.

### 2-9. 웹소설 줄거리 원문 보존 및 크롤러 로깅 대폭 강화 (server/routers/books.py)
* 피드백 반영: 줄거리를 임의로 요약/축약하지 않고 사이트 소개글/시놉시스 원문 전체를 온전히 보존.
* 예외 침묵(pass/return False)을 제거하고 logger.info, logger.warning, logger.error로 실패 URL 및 원인을 상세 기록하여 유지보수성 향상.

---

## 3. 검증 결과
* 전체 단위 테스트: pytest tests/ 33개 항목 100% 통과 (33 passed in 6.61s).
* 기능 검증 스크립트:
  - normalize_url 정규화 및 get_apply_status 일치 확인 통과.
  - get_logs의 1,000줄 Tail 슬라이싱 확인 통과.
  - rotate_backups 최신 7개 유지 및 오래된 백업 파일 자동 삭제 확인 통과.
  - db_editor 미지정 시 0건 쿼리 및 지정 시 단일 테이블 온디맨드 로딩 확인 통과.
  - update_folder_name 시 pinned_books, book_tags 동시 트랜잭션 갱신 확인 통과.
