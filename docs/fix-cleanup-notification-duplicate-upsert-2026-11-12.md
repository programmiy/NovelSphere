# 원문 복제·변형 정리 알림 중복 생성 방지 및 단일 회차 UPSERT 통합 (2026-11-12)

## 1. 문제 배경 및 증상
- **증상**: 동일한 소설 페이지(회차)에서 재번역이나 분할 재시도(Split Retry)가 발동할 때, 알림 및 복원 센터의 [삭제 알림 & 회차 링크] 목록에 동일 회차가 2번, 3번, 심할 때는 8번 이상씩 중복되어 표시되는 현상 발생.
- **추가 증상**: 동일한 회차임에도 한 행은 `미분류`, 다른 행은 실제 소설명(`정조 역전 세계에서 딜도 하렘 생활`)으로 갈라져 표시됨.

## 2. 근본 원인 분석
1. **활성 알림 병합(UPSERT) 부재 및 무조건 INSERT**:
   - `handle_verbatim_cleanup_items()`에서 원문 복제/변형 감지 시, 해당 회차(`url`)에 이미 처리되지 않은 활성 알림(`is_dismissed == 0`)이 존재하는지 확인하지 않고, 매 호출마다 신규 타임스탬프(`verbatim_auto_{timestamp}`)로 `CleanupNotification` 레코드를 무조건 `db.add` 하였음.
2. **분할 재시도(Split Retry) 및 단일 재번역에 의한 다중 호출**:
   - Gemini API 번역 실패 시 크롬 확장 프로그램이 문장을 2분할, 4분할, 또는 1문장 단위로 쪼개어 연쇄적으로 재시도(`POST /translate`)함.
   - 이때마다 원문 복제 감지 로직이 실행되어 단일 세션 안에서도 5~8회 이상 알림 레코드가 개별적으로 생성됨.
3. **초기 번역 시점의 소설명 부재로 인한 '미분류' 등록**:
   - `POST /translate` 호출 시 URL만 전달되므로 백엔드가 DB의 기존 번역 레코드에서 소설명을 역조회함.
   - 최초 번역 당시에는 DB에 해당 소설 레코드가 없어 `미분류`로 생성되었고, 이후 정상 번역이 저장된 뒤 발생한 재번역 트리거에서는 정상 소설명으로 생성되어 두 레코드가 공존하게 됨.

## 3. 구현 및 변경 내역

### 1) 알림 생성 시 동일 회차 기존 활성 알림 UPSERT 및 소설명 자동 승격
- **파일**: `server/services/translation_recovery.py` (`handle_verbatim_cleanup_items`)
- **동작**:
  - `clean_url` 기준 활성 알림(`is_dismissed == 0`)이 이미 존재하는지 검사.
  - 존재할 경우:
    - `batch_id` 최신화 및 `created_at` 최신 시각 갱신.
    - 소설명이 없거나 `미분류`였던 경우, 유효한 소설명이 들어오면 최신 소설명으로 자동 승격/갱신.
    - 회차명도 유효한 명칭으로 갱신.
    - `deleted_count`는 해당 회차의 실제 휴지통(`TranslationTrash`) 건수로 정확하게 동기화 (SSOT).
    - 동일 URL에 과거 생성되었던 다른 중복 활성 알림들이 있다면 대표 1건을 제외하고 모두 `is_dismissed = 1`로 자동 병합 정리.
    - 해당 회차의 기존 `TranslationTrash` 항목들의 `cleanup_batch_id`도 최신 `batch_id`로 동기화.
  - 소설명 탐색 시 동일 URL 외에도 동일 소설 prefix(`/works/{id}`, `/{ncode}/` 등)를 역조회하여 최초 회차 번역 시에도 `미분류` 누락 방지.

### 2) 알림 목록 조회 시 과거 중복 알림 자동 통합 및 정돈 (Deduplication)
- **파일**: `server/services/cleanup_trash_service.py` (`get_cleanup_notifications_data`)
- **동작**:
  - 과거 DB에 이미 누적되어 있던 동일 회차(`url`)의 다중 활성 알림들을 URL 기준으로 그룹화.
  - 유효 소설명을 가진 최신 알림을 대표(Master)로 지정하고, 구버전 중복 알림들은 `is_dismissed = 1` 처리하여 DB에서도 자동 정돈.
  - 화면에는 항상 회차당 단 1건의 대표 알림만 반환되어 즉시 중복 해결.

### 3) 검수 대상 단락 누락 방지 포괄 조회
- **파일**: `server/services/cleanup_trash_service.py` (`get_cleanup_review_targets_data`)
- **동작**:
  - 분할 재시도로 서로 다른 `cleanup_batch_id`를 가졌던 단락들도 누락 없이 해당 회차의 최근 7일 내 삭제 단락 전체를 포괄 조회하도록 개선.

## 4. 검증 결과
- `tests/test_verbatim_cleanup.py` 내 신규 단위 테스트 추가 및 전체 19개 테스트 100% 통과:
  - `test_handle_verbatim_cleanup_upsert_prevents_duplicate_notifications` (3회 연속 트리거 시 단 1건 유지, 미분류 자동 승격, 건수 동기화 검증)
  - `test_get_cleanup_notifications_data_deduplicates_legacy_rows` (과거 중복 알림 조회 시 자동 통합 및 DB 정리 검증)
- `tests/test_data_crud.py` 및 `tests/test_censorship_hdtrans_fallback.py` 21개 테스트 100% 통과.
