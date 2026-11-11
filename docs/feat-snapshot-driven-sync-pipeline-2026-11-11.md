# 안전 스냅샷 기반 무음 자동 다운로드 & 명시적 수동 업로드 동기화 파이프라인 (2026-11-11)

## 1. 개요 및 배경
- **문제점:**
  1. 94만 문장을 초과하는 대규모 데이터셋 환경에서, 모바일 DB 초기화 시마다 1만 문장 분할 다운로드(`limit=10000`)로 인해 94회 이상의 HTTP 왕복과 심각한 시간 소모가 발생함.
  2. PC에서 미분류 소설을 폴더에 저장(`assign_folder`)하거나 번역을 수정해도, 오늘 번역 실적 왜곡 방지를 위한 과거 `timestamp` 보존 정책 때문에 모바일 증분 동기화(`WHERE timestamp > since`)에서 전혀 감지되지 않아 폰 서재에 최신화되지 않는 치명적 결함 존재.
  3. PC에서 불량 번역이나 소설을 삭제하면 `serverTransCount < mobileTransCount`가 되어 모바일 동기화가 영구 차단(Lock)되거나, 삭제 내역이 폰에 반영되지 않아 유령 챕터가 잔류함.
  4. 폴더 이동/미분류 귀속 시 모바일 로컬 DB에 이전 폴더명의 챕터 찌꺼기가 남아 중복 회차가 생성됨.
- **해결 목표:**
  - 통계용 `timestamp`와 동기화용 `updated_at`을 분리하여 오늘 실적 왜곡 없이 폴더 저장/수정 즉시 모바일 반영 보장.
  - PC 삭제 장부(`deleted_records` Tombstone) 구축으로 폰에서도 소설/회차 자동 삭제 연동.
  - URL 기준 구 챕터 삭제로 폴더 이동 시 중복 회차 원천 차단.
  - PC 스마트 백업 완료(무결성 및 음수 역전 검증 통과) 시점에만 SSE 신호를 발송하여 폰이 안전하게 **무음 자동 다운로드(Zero-Touch Download)** 수행.
  - 폰에서 수정한 내용(단어장, 진도 등)만 사용자가 원할 때 1-터치 **명시적 수동 업로드(Push)** 수행하여 충돌 및 덮어쓰기 원천 방지.
  - 서재 화면 실시간 무새로고침 갱신 및 뷰어 열람 중인 챕터 보호(Active Reading Guard).

---

## 2. 주요 변경 사항 및 기술 명세

### 1) 백엔드 데이터 모델 및 스키마 (`server/models.py`, `server/server.py`)
- `translations.updated_at` (INTEGER) 컬럼 및 복합 인덱스(`ix_translations_updated_at`) 추가.
  - 서버 startup 시 자동 스키마 마이그레이션 (`ALTER TABLE translations ADD COLUMN updated_at INTEGER;`).
- `deleted_records` (Tombstone) 모델 신설:
  - `id` (PK), `entity_type` ('chapter', 'novel', 'translation'), `entity_id` (URL/소설명), `parent_scope` (소설 폴더명), `deleted_at` (INTEGER).
  - Authorizer 영구 보호 테이블(`PROTECTED_TABLES`)에 `deleted_records` 등록.

### 2) 삭제 장부 및 수정 갱신 로직
- `server/backup_utils.py`:
  - `record_tombstone(entity_type, entity_id, parent_scope=None)` 도우미 함수 구축.
- `server/routers/unclassified.py`:
  - `assign_unclassified_novel_folder`: `folderName` 변경 및 `toc_sort_order` 부여 시 `updated_at = int(time.time())` 갱신.
  - `delete_unclassified_novel`: 삭제 전 대상 URL들을 수집하여 `record_tombstone("chapter", url)` 기록.
- `server/routers/data_crud.py`:
  - `upsert_translations`: 신규 번역 생성 및 기존 번역 수정 시 `updated_at = int(time.time())` 갱신 (원본 `timestamp`는 그대로 보존하여 오늘 통계 무결성 유지).
  - `assign_folder_batch`: 폴더 일괄 이동 시 `updated_at` 갱신.
  - `delete_translations`: 삭제 대상 URL 수집 후 `record_tombstone("chapter", url, parent_scope=folderName)` 기록.
- `server/routers/books.py` & `server/services/book_service.py`:
  - 소설 폴더명 변경 시 `updated_at` 갱신.
  - 목차 순서 정렬(`update_book_toc_order`) 시 `updated_at` 갱신.

### 3) 동기화 엔드포인트 개편 (`server/routers/sync.py`)
- `GET /api/sync/pull`:
  - `COALESCE(updated_at, timestamp)`를 기준으로 증분 Keyset Pagination 수행하여 폴더 저장/수정 내역 100% 감지.
  - 첫 번째 배치(`last_id == 0`) 시 `deleted_records`에서 `deleted_at > since`인 삭제 항목들(`deletions`)을 payload에 동봉하여 전송.

### 4) 스마트 백업 연동 SSE 알림 (`server/server.py`)
- `backup_check_task`:
  - `create_unified_backup` 성공 시(`result.get("created") == True`) SSE 알림(`backup_sync_ready`)을 모바일로 즉시 브로드캐스트.

### 5) 모바일 앱 파이프라인 개편 (`mobile_app/lib/services/sync_service.dart`)
- **다운로드 / 업로드 비대칭 분리:**
  - `performIncrementalDownload`: PC -> 폰 다운로드 전용.
    - `deletions` 수신 시 로컬 DB의 `chapters` 및 `books` 일괄 삭제.
    - **URL 기준 구 챕터 삭제**: `batch.delete('chapters', where: 'url = ?', whereArgs: [cUrl]);` 적용으로 이전 폴더 잔류 찌꺼기 100% 제거.
    - 문장 수 역전 가드 정상화: PC 서버가 50% 이상 급감한 재난 상태가 아닌 한 정상 삭제를 수용하여 동기화 락 현상 원천 해결.
    - 완료 시 `libraryRefreshNotifier.value++`로 서재 화면 즉시 자동 리프레시.
  - `performManualUpload`: 폰 -> PC 업로드 전용.
    - 폰에서 오프라인 수정한 큐(`offline_change_queue`)만 전송 후 성공 시 비우기.
    - `unpushedCountNotifier` 갱신.
  - `triggerSilentDownloadIfAllowed`: 신뢰 Wi-Fi 환경에서 백업 완료 SSE 신호 수신 시 무음 자동 다운로드 가동.
- **Active Reading Guard:**
  - `SyncService.activeReadingUrl`: 뷰어(`reader_screen.dart`)에서 현재 읽고 있는 회차 URL을 추적하여 다운로드 도중 화면 깜빡임/스크롤 튐 방어.
- **동기화 스튜디오 UI (`library_screen.dart`):**
  - 상단 뱃지에 `[☁️ 업로드 N건]` 표시.
  - 탭 시 '동기화 스튜디오' 바텀시트 표출:
    - `[📥 최신 번역 다운로드 (PC ➔ 폰)]`
    - `[☁️ 모바일 변경사항 업로드 (폰 ➔ PC)]`
    - `[🔄 양방향 일괄 동기화]`
    - `[🚨 비상용: 30초 전체 서재 재구축 (시드팩)]`

---

## 3. 검증 결과
- **백엔드 단위 테스트:**
  - `tests/test_snapshot_sync.py`: 100% 통과 (updated_at 감지, tombstone 삭제 전송 검증).
  - `tests/test_sync_router.py`, `tests/test_unclassified.py`, `tests/test_data_crud.py`, `tests/test_exclude_restore.py`, `tests/test_quota_logic.py`: 28개 테스트 전건 통과.
- **모바일 앱 정적 분석 및 테스트:**
  - `dart analyze`: No issues found!
  - `flutter test`: 26개 테스트 전건 통과.
