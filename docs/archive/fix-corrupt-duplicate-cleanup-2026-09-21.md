# DB 비정상 복제 데이터(Ghost Duplicates) 안전 정리 및 전수 무결성 검증

- **작업 일시**: 2026-09-21
- **관련 브랜치**: extra

---

## 1. 문제 배경 및 증상

사용자로부터 과거에는 정상이었던 번역 데이터가 회차 이름부터 내용까지 이상해졌고, 뷰어에서 단락 1개만 있거나 동일한 단락이 여러 개 중복 노출된다는 현상이 보고됨.

### 데이터 전수 조사 결과 밝혀진 근본 원인
1. 과거 특정 시점(`timestamp = 1780632367`)에 파싱/병합 이상으로 **총 21,847건의 비정상 유령 복제 데이터(Ghost Duplicates)**가 DB에 유입됨.
2. **다중 URL 뭉침 및 숫자 회차명 (1,239건)**:
   - URL 여러 개가 `https://...https://...` 형태로 뭉쳐지고 회차 이름(`title`)에 URL 끝의 19자리 에피소드 숫자 ID(`1177354054892551919` 등)가 입력됨.
   - 각 URL당 단락이 단 1개만 달랑 들어있어 뷰어에서 1개짜리 유령 회차로 표시됨.
3. **단락 중복 노출 (20,567건)**:
   - 원래 정상 번역 단락이 이미 존재하는 상태에서, 원문 끝에 다음 문장 조각/따옴표(`「...」「...`)가 붙고 번역문 끝에 `」i`, `i0`, `」i]` 등의 쓰레기 접미사가 붙은 데이터가 추가 적재됨.
   - `(url, pid, original)` 제약조건상 원문이 미세하게 달라 중복 적재되었고, 뷰어에서 회차를 열면 원래 정상 단락과 오염 단락이 연달아 중복(`p10, p10` 등) 표시됨.

---

## 2. 작업 수행 내용

### 2.1. 사전 안전 백업 생성
- `sqlite3.backup()` 온라인 백업 API를 활용해 현재 DB를 `server/backups/translations_backup_before_corrupt_cleanup_20260921.db`로 100% 안전 보존 (크기: 326MB).

### 2.2. 오염 데이터 안전 제거 (트랜잭션)
- `translations` 테이블에서 `timestamp = 1780632367` 레코드 21,845건 삭제.
- 잔여 (url, pid) 중복 오염 레코드 2건(ID: 192528, 190104) 삭제 (총 21,847건 제거).
- `applied_urls` 테이블에서 뭉쳐진 비정상 URL 1건 삭제.
- SQLite FTS5 트리거(`translations_ad`)를 통해 `translations_fts` 가상 검색 테이블에서도 동기화 정리.

---

## 3. 사후 무결성 전수 검증 결과 (Data Integrity Verification)

| 검증 항목 | 기준 | 실제 결과 | 판정 |
| :--- | :--- | :--- | :--- |
| **정상 데이터 보존 건수** | 221,076건 | 221,076건 | **PASS** |
| **정상 레코드 전수 필드 대조** | 백업본과 불일치 0건 | 0건 (1비트도 불일치 없음) | **PASS** |
| **오삭제된 정상 레코드** | 0건 | 0건 | **PASS** |
| **잔여 오염 데이터 (다중URL, 숫자회차)** | 0건 | 0건 | **PASS** |
| **(url, pid) 단락 중복** | 0건 (작업 전 20,567건) | **0건** | **PASS** |
| **10개 연관 테이블 보존 상태** | 백업본과 100% 일치 | 전 테이블 차이 0건 | **PASS** |
| **FTS5 검색 엔진 정상 동작** | 검색 키워드 매칭 성공 | 정상 매칭 확인 | **PASS** |
| **전체 단위 테스트 (`pytest`)** | 49개 테스트 전원 통과 | 49 passed in 8.27s | **PASS** |

---

## 4. 결론
작업 영역 외의 모든 정상 번역 데이터(221,076건)와 서재, 북마크, 독서 이력 등 모든 연관 데이터가 100% 안전하게 보존되었으며, 뷰어 및 서재의 목차와 본문에서 중복 단락 및 숫자 회차 문제가 완전히 해결되었습니다.

---

## 5. 작업 트리 미반영 변경 사항 동시 스테이징 및 정리 내역

작업 트리에 누적되어 있던 기능 고도화 코드 및 문서 파일들을 통합 스테이징 및 커밋 처리함:

- **문서 (Docs)**:
  - `docs/fix-toc-import-and-natural-sort-2026-09-15.md`: TOC 파서 개편 및 자연 정렬 문서
  - `docs/system-stability-and-architecture-improvements-2026-09-15.md`: 아키텍처 및 안정성 문서
  - `docs/ui-ux-observations-and-future-improvements-2026-09-18.md`: UI/UX 관찰 및 개선 계획
- **백엔드 코어 및 라우터**:
  - `server/database.py`, `server/models.py`, `server/server.py`, `server/settings.py`
  - `server/routers/admin.py`, `server/routers/books.py`, `server/routers/data_crud.py`
  - `server/routers/db_editor.py`, `server/routers/system.py`, `server/routers/tasks.py`
  - `server/routers/toc_importer.py`, `server/routers/translation.py`, `server/routers/ui.py`, `server/routers/url_config.py`
  - `server/routers/separators.py` (신규): 구분선 관리 라우터
  - `server/rule_classifier.py` (신규): 번역 품질 룰베이스 분류기
  - `server/utils.py` (신규): 자연 정렬 키 생성 등
- **웹 프론트엔드 UI**:
  - `server/static/admin.css`, `server/static/admin.js`, `server/templates/admin.html`
  - `server/static/library.css`, `server/static/library.js`, `server/templates/library.html`
  - `server/static/viewer.css`, `server/static/viewer.js`, `server/templates/viewer.html`
  - `server/static/service-worker.js`, `server/templates/db_editor.html`
- **크롬 확장 프로그램 (Chrome Extension)**:
  - `extension/content.css`, `extension/content.js`
  - `extension/history.html`, `extension/history.js`
- **테스트 코드**:
  - `tests/test_find_replace.py`, `tests/test_library_viewer_api.py`, `tests/test_verbatim_cleanup.py`, `tests/test_json_parsing.py`
