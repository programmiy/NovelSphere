# 데이터베이스 다중 방어 시스템 & 스마트 스킵 음수 역전 백업 구현

**작업일자**: 2026-10-15
**관련 모듈**: `server/database.py`, `server/backup_utils.py`, `server/server.py`, `server/routers/data_crud.py`, `server/routers/unclassified.py`, `server/routers/translation.py`, `mobile_app/`, `GEMINI.md`

---

## 1. 개요 및 배경
- AI 터보모드 자율 실행 중 스크래치 테스트 스크립트(`Base.metadata.drop_all()`) 및 자의적 백업 덮어쓰기(`Copy-Item`)로 인한 운영 DB 훼손 및 데이터 유실 사고를 원천 방지하기 위해 4중 방어선을 구축함.
- 모바일 앱에 캐시된 유실 챕터 3건(299문장)을 복원 완료한 후, 향후 동일 사고가 물리적으로 불가능하도록 다중 보안 체계를 적용함.

---

## 2. 세부 구현 내역

### 1) SQLite C-API Authorizer 기반 DROP TABLE 영구 봉쇄 (`server/database.py`)
- `_sqlite_authorizer` 함수를 구현하여 SQLite 연결 시 `set_authorizer` 등록.
- 핵심 테이블(`translations`, `applied_urls`, `glossary`, `trash_translations`, `book_tags` 등)에 대한 `DROP TABLE` 시도 시 엔진 레벨에서 `SQLITE_DENY`를 반환하여 즉각 거부(`sqlite3.DatabaseError: not authorized`).

### 2) SQLAlchemy 이벤트 기반 전건 무조건 DELETE 원천 차단 (`server/database.py`)
- `@event.listens_for(engine, "before_cursor_execute")` 리스너를 등록.
- `DELETE FROM translations` 쿼리 중 `WHERE` 절이 없거나, `WHERE 1=1` / `WHERE TRUE`와 같은 무력화 조건절을 포함할 경우 `PermissionError`를 발생시켜 실행을 사전 차단.
- 단, 정상적인 조건부 삭제(`WHERE id = ?`, `WHERE folderName = ?`)는 100% 정상 허용.

### 3) 비서버 스크립트 라이브 DB 쓰기 격리 (`PRAGMA query_only = ON`)
- `is_prod_db_write_allowed()` 판별기를 통해, 환경변수 `ALLOW_PROD_DB_WRITE=1` 또는 `uvicorn` 서버 프로세스가 아닌 임의의 파이썬 스크립트가 `translations.db`에 연결할 경우 `PRAGMA query_only = ON`을 강제.
- 스크립트가 임의로 `PRAGMA query_only = OFF`로 해제 시도 시에도 SQLite Authorizer가 `SQLITE_DENY`로 해제를 차단.

### 4) 스마트 스킵 & 음수 역전 감지(Negative Diff) 스마트 백업 (`server/backup_utils.py`, `server/server.py`)
- 백업 주기 1시간(cooldown_hours=1.0) 자동 점검.
- **스마트 스킵 (Smart Skip)**: 이전 백업과 현재 DB의 `(행 수, max_id, max_timestamp)`가 동일하면 불필요한 백업 생성 및 디스크 회전을 건너뜀.
- **정상 삭제 장부 (Legitimate Deletion Ledger)**: 사용자가 UI/API를 통해 정상 삭제한 건수를 `record_legitimate_deletion`으로 기록.
- **음수 역전 감지 (Negative Diff Anomaly)**: 현재 DB 행 수가 이전 백업보다 적고, 정상 기록 삭제 건수를 초과하여 감소한 경우:
  1. 즉시 신규 백업 중단 (`aborted: True`)
  2. 과거 백업 파일 삭제/회전을 100% 동결 보존
  3. 모바일 앱 및 웹 SSE로 비상 경보(`db_alert`) 실시간 전송.

### 5) 모바일 앱 v1.5.3 업데이트 (`mobile_app/`)
- SSE 스트림에서 `db_alert` 또는 `urgent` 우선순위 이벤트 수신 시 상단바 시스템 푸시 알림(`LocalNotificationService.showNotification`) 즉시 팝업.
- 알림 센터 시트(`notification_center_sheet.dart`)에 `db_alert` 전용 붉은색 경보 아이콘 및 스타일 적용.
- 버전 `1.5.3+2026101503` 릴리즈 APK 빌드 및 `server/static/lanovel-reader-release.apk` 배포 완료.

### 6) `GEMINI.md` 절대 안전 규칙 각인
- AI 에이전트의 운영 DB 파괴 조작 금지, 테스트 격리 원칙, 복구 사전 승인 필수 원칙 명문화.

---

## 3. 검증 결과
- `tests/test_db_safety_guards.py`: 5개 신규 보안 테스트 전체 통과 (DROP 차단, 전건 DELETE 차단, 정상 CRUD 통과, 정상 삭제 장부, 스마트 스킵 및 음수 역전 차단).
- 기존 테스트 스위트(`test_data_crud.py`, `test_rescue_from_mobile.py`, `test_exclude_restore.py`, `test_unclassified.py`, `test_app_release.py` 등): 100% 정상 통과.
- 모바일 OTA 배포 브로드캐스트 성공 (`1.5.3.2026101503`).
