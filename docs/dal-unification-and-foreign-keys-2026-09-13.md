# 데이터 접근 계층(DAL) 일원화 및 외래키 정합성 확보 (2026-09-13)

## 1. 개요
* 프로젝트 내 6개 라우터 모듈에 파편화되어 있던 Raw SQLite 연결 코드와 중복 헬퍼 함수(`get_db_path`, `dict_factory`)를 `server/database.py`로 일원화하고, SQLite 레벨의 외래키 제약조건(`PRAGMA foreign_keys = ON;`)을 상시 활성화하여 데이터 무결성을 확보했습니다.

## 2. 주요 변경 사항

### 2-1. 통합 커넥션 헬퍼 및 PRAGMA 설정 (`server/database.py`)
* **외래키 강제 (`foreign_keys = ON`):** SQLAlchemy 연결 이벤트 및 Raw SQLite 연결 시 항상 외래키 제약조건 검사를 수행하도록 설정.
* **통합 커넥션 헬퍼 (`get_sqlite_conn` / `db_connection`):**
  * `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000` 최적화 프래그마와 커스텀 `REGEXP` 함수를 자동으로 탑재한 표준 연결 팩토리 제공.
  * `as_dict=True` 옵션 지정 시 `dict_factory`가 자동 바인딩되어 각 라우터에서 개별 `row_factory`를 세팅할 필요 제거.
* **공통 헬퍼 단일화:** `get_db_path()`, `dict_factory()`를 `database.py` 한 곳에서만 관리.

### 2-2. 라우터 전수 리팩토링
다음 6개 라우터에서 중복 함수 선언을 제거하고 `get_sqlite_conn`을 사용하도록 통합:
* `server/routers/admin.py`: URL 정리 및 PID 정리 엔드포인트 커넥션 일원화
* `server/routers/system.py`: 디버그 엔드포인트 커넥션 일원화
* `server/routers/tasks.py`: 제목 백그라운드 크롤러 및 누락 제목 조회 커넥션 일원화
* `server/routers/url_config.py`: URL 적용/메타데이터 관리 엔드포인트 커넥션 일원화 및 `executemany` 일괄 쿼리 최적화
* `server/routers/data_crud.py`: 번역 조회, 이동, 삭제, 페이지네이션, 스트리밍, 마이그레이션 커넥션 일원화
* `server/routers/books.py`: 책/폴더/챕터/태그/활동정보 조회 및 수정 엔드포인트 14곳의 커넥션 일원화

## 3. 검증 결과
* Raw SQLite 및 SQLAlchemy 양쪽 연결 모두 `foreign_keys=1`, `journal_mode=wal`, `busy_timeout=5000`, `REGEXP` 정상 등록 확인.
* 전체 단위 테스트 스위트(`pytest`) 23개 항목 100% 통과 (소요 시간 6.60s).
