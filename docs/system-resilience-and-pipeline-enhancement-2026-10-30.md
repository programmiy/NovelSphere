# 시스템 안정성 무결성 및 파이프라인 기능 확장 (2026-10-30)

## 1. 개요 및 배경
- **목적**: 시스템 전수조사를 통해 도출된 핵심 잠재 결함(목차 순서 소실, 모바일 동기화 불일치, 연속 번역 큐 플랫폼 제약, 백엔드 RPM 피드백 단절)을 해결하고, 기존에 구축된 기능들을 상호 유기적으로 연계하여 유용성을 대폭 확장했습니다.
- **원칙 준수**: 새로운 기능의 임의 추가가 아닌 기존 기구현 컴포넌트(NovelUp+ 파서, RPM 매니저, 플로팅 HUD, 검수완료 가드, 스마트 백업 등)의 기능적 완결성을 높이는 확장 작업을 수행했습니다.

---

## 2. 주요 개선 및 확장 사항

### 2.1. 목차 정렬 순서(`toc_sort_order`) 상속 및 무결성 보장 (`server/routers/data_crud.py`)
- `TranslationItem` Pydantic 모델에 `toc_sort_order: Optional[int] = None` 필드 추가.
- `upsert_translations` 함수 내에 `url_to_toc_order` 상속 맵 구축:
  - 기존 번역 레코드 및 배치 아이템에서 `toc_sort_order`를 수집하여 신규 레코드 삽입 시 자동 상속.
  - 동일 URL을 공유하는 모든 단락에 대해 최신 `title`과 `toc_sort_order`를 원자적으로 일괄 동기화하여 회차 내 단락 추가/부분 재번역 시에도 목차 순서가 영구 보존되도록 개선.

### 2.2. 모바일 시드 DB 챕터 정렬 일치화 및 검수완료 잠금 가드 (`server/routers/sync.py`)
- `_build_mobile_optimized_db`:
  - 챕터 추출 쿼리에 `MIN(t1.id) as min_id` 추가.
  - `natural_sort_key`를 활용하여 PC `books.py`와 100% 동일한 자연 정렬(`folderName -> sort_order -> min_id -> url -> title`)을 적용, `toc_sort_order`가 없는 소설도 모바일 앱에서 순서가 꼬이지 않도록 보장.
- `push_changes_from_mobile`:
  - 모바일 번역 편집본 업로드 시 기존 챕터 검수완료 가드에 더해 `is_book_reviewed(chk_folder)` 도서 전체 검수완료 가드를 추가하여 잠긴 데이터 보호.

### 2.3. 관리자 PID 정리 시 백업 시스템 신뢰 연동 (`server/routers/admin.py`)
- `cleanup_pids` 엔드포인트에서 비정상 PID(`la/lp`) 레코드 삭제 후 `record_legitimate_deletion(deleted_count, reason="admin_cleanup_pids")`를 호출하여, 스마트 백업 엔진이 비정상 데이터 유실로 오탐하고 `db_alert`를 발령하는 잠재 리스크를 원천 해소.

### 2.4. 소설 연속 번역 대기열 NovelUp+ 플랫폼 바인딩 (`server/novel_queue.py`)
- `normalize_overview_url`에 `novelup.plus` 개요 URL(`https://novelup.plus/story/{story_id}`) 화이트리스트 지원 추가.
- 기구현된 `fetch_all_novelup_chapters`와 즉시 연동되어 모바일 리모컨 및 연속 번역 큐에서 NovelUp+ 작품을 등록/자동 진행 가능하도록 확장.

### 2.5. 백엔드 RPM Zone 피드백 및 크롬 확장 플로팅 HUD 연계
- **백엔드 (`server/routers/translation.py`)**:
  - `POST /translate` 응답에 `rpm_status` (`current_rpm`, `zone: green/yellow/red`, `recommended_turbo_delay`) 동봉 반환.
  - `find_replace_all`의 `target_ids` 검증을 `SELECT DISTINCT url, folderName` 집합 쿼리로 1회 축약 검증하도록 최적화.
- **크롬 확장 (`extension/src/background/index.ts`, `extension/src/core/`)**:
  - `handleBatchTranslate` 및 메시지 응답에 `rpm_status` 전달.
  - `state.ts`에 `lastServerRpmStatus` 등록.
  - `page_translator.ts`에서 서버 Red/Yellow Zone 진입 시 사이드바 경고 안내 및 다음 묶음 카운트다운 타이머(`startLanovelCountdownHud`)에 서버 과열 방어 대기 시간 자동 연장.
  - `adaptive_throttle.ts`의 하드코딩된 로컬 포트 URL을 상대 경로(`/api/translation_session_count?...`)로 정돈.

---

## 3. 검증 결과
- **Python 테스트 스위트**: 269개 테스트 100% 정상 통과 (`tests/test_novel_queue.py`, `tests/test_data_crud.py`, `tests/test_sync_router.py`, `tests/test_find_replace.py` 등 포함).
- **TypeScript 타입 검사 (`npm --prefix extension run typecheck`)**: 100% 통과 (0 errors).
- **확장 프로그램 번들링 (`npm --prefix extension run build`)**: 71ms 빌드 성공.
