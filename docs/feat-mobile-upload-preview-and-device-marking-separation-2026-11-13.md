# 모바일 업로드 변경 내역 미리보기 & 바형 폰·태블릿 마킹 기능 분리

- **작성일**: 2026-11-13
- **작업 브랜치**: `extra`

---

## 1. 문제 원인 분석 (Root Cause)

### A. 바형 폰에 태블릿 전용 마킹 기능이 노출된 원인
기존 코드(`6ff0d08`, `feat-tablet-e-reader-and-marking-pipeline-2026-11-12.md`)에서는 `LibraryScreen._buildLibraryView()` **단 한 곳**에서만 `MediaQuery.of(context).size.shortestSide >= 600` 분기를 수행해 태블릿 3D 양장본 서재와 폰 서재를 나누고 있었습니다. 반면 실제 마킹 UI·액션은 폼팩터 체크 없이 공용 화면에 배치되어 바형 스마트폰에서도 그대로 노출되었습니다.

1. **`ReaderScreen` (`mobile_app/lib/ui/viewer/reader_screen.dart`)**
   - `_buildSentenceItem`: 모든 단말에서 앰버 하이라이트 배경, `수정 대기 마킹됨` 배지, 인라인 원문 헤더의 `[마킹]` / `[마킹됨]` 버튼을 렌더링.
   - `_showSentenceActionSheet`: 모든 단말에서 최상단 `수정 대기 하이라이트 콕 찍기` 액션 카드를 노출.
   - `_toggleHighlight`: 디바이스 판별 가드 없이 마킹 생성/해제 허용.
2. **`LibraryScreen` (`mobile_app/lib/ui/library/library_screen.dart`)**
   - Phone 전용 그리드(`_buildGridSliver`) 및 리스트(`_buildListSliver`) 카드에 `_highlightCounts` 기반 앰버 마킹 배지를 직접 렌더링.
   - 공용 책 롱프레스 메뉴(`_showBookActionSheet`)에서 단말 구분 없이 `수정 대기 마킹 목록` 타일 노출.

### B. 모바일 업로드 변경 내역 확인 부재 및 큐 중복 적재
- `동기화 스튜디오`(`_showSyncActionSheet`)와 `설정 > 수동 동기화 작업`에 단순 건수(`$unpushed건 대기`)만 표시되어 **무엇이 업로드될지** 미리 확인할 수 없었습니다.
- `LocalDbService.updateSentence`가 `before_translated`, `folderName`, `title`, `url`을 큐에 남기지 않아 수정 전후 대조가 불가능했습니다.
- `LocalDbService._enqueueChange`가 매 스크롤 진도 저장(`updateReadingProgress`)마다 동일 작품 `'activity'` 행을 무조건 `INSERT`하여 큐 건수가 과도하게 부풀어 올랐습니다.
- `SyncService.performManualUpload`가 `highlight_delete`를 서버로 전달하지 않고 큐에서만 비우는 누락도 존재했습니다.

---

## 2. 구현 변경 사항

### 1) 바형 폰(`shortestSide < 600`) vs 태블릿(`shortestSide >= 600`) 마킹 기능 완전 분리
- **`mobile_app/lib/services/device_utils.dart` (신규)**
  - `DeviceUtils.tabletShortestSideThreshold = 600.0`, `isTabletWidth(double)`, `isTablet(BuildContext)` 단일 판별 기준 정립.
  - 가로/세로 회전 시에도 짧은 변(`shortestSide`) 기준으로 일관되게 판별.
- **`mobile_app/lib/ui/viewer/reader_screen.dart`**
  - `_buildSentenceItem`: `isTablet && sentence.isHighlighted`인 경우에만 하이라이트 강조/배지 표시; 인라인 원문 헤더에서 `[마킹]`/`[마킹됨]` 버튼은 `if (isTablet)`일 때만 렌더링(바형 폰의 롱프레스 `日本語 原文` + `[⋯]` 토글 경험은 그대로 유지).
  - `_showSentenceActionSheet`: `수정 대기 하이라이트 콕 찍기` 버튼 및 앰버 아이콘 강조를 `isTablet` 전용으로 제한하고 안내 문구(`태블릿에서 콕 찍어두고 PC 관리자에서 바로 수정`) 정비.
  - `_toggleHighlight`: `if (!DeviceUtils.isTablet(context)) return;` 방어 가드 추가.
- **`mobile_app/lib/ui/library/library_screen.dart`**
  - `_buildGridSliver`, `_buildListSliver` (바형 폰 서재 카드)에서 마킹 배지 완전 제거.
  - `_showBookActionSheet`: `수정 대기 마킹 목록` 메뉴 항목을 `if (isTablet)`으로 게이트.
  - `_showBookHighlightsSheet`: `if (!DeviceUtils.isTablet(context)) return;` 방어 가드 추가.
  - `_buildTabletHeaderHub`: 태블릿 헤더에도 `_buildSyncStatusBadge(theme)` 적용해 `업로드 N건` 대기 상태를 동일하게 노출.

### 2) 업로드 변경 내역 확인 및 큐 정밀 통합
- **`mobile_app/lib/models/pending_upload.dart` (신규)**
  - `PendingUploadCategory` (`translationEdit`, `glossaryRule`, `activity`, `pin`, `highlight`), `PendingUploadItem`, `PendingUploadSummary` 순수 Dart 모델.
  - `PendingUploadSummary.fromQueueRows(...)`: 구버전 누적 중복 큐까지 안전하게 병합해 카테고리별 건수(`briefSummaryText`), 합쳐진 횟수(`mergedCount`), 문장 수정 `beforeText`→`afterText`, 찾아바꾸기 규칙, 진도/상태 사유(`change_reasons` 및 구버전 필드 추론) 제공.
- **`mobile_app/lib/services/local_db_service.dart`**
  - `pendingCountNotifier` 추가 및 큐 적재/해제/초기화/시드교체 시 실시간 카운트 갱신.
  - `updateSentence`: DB 갱신 직전 원/이전 번역문(`before_translated`), `folderName`, `title`, `url`을 확보해 `translation_edit` 페이로드 보강.
  - `toggleBookmarkBook`, `toggleCompleteBook`, `toggleVisibilityBook`, `updateReadingProgress`: `change_reasons` 태그 추가.
  - `removeSentenceHighlight`: `book_name`, `chapter_title` 메타데이터를 `highlight_delete` 페이로드에 보존.
  - `_enqueueChange`: `glossary_rule`은 순차 실행 보장을 위해 유지하고, `activity` / `pin` / `translation_edit`(최초 `before_translated` 보존) / `highlight_add`↔`highlight_delete`는 동일 `target_id` 기준으로 병합(Coalesce)하여 중복 행 폭증 차단.
- **`mobile_app/lib/services/sync_service.dart` & `server/routers/sync.py`**
  - `SyncService.unpushedCountNotifier`를 `LocalDbService.pendingCountNotifier`로 연결하고 `inspectPendingChanges()` 추가.
  - `performManualUpload`에서 UI 전용 필드(`before_translated`, `change_reasons`)를 서버 전송 직전 스트립하고, `highlight_add`↔`highlight_delete` 최종 상태를 정리해 `deleted_highlights` 전송 및 상세 결과 메시지(`문장 수정 N건, 찾아바꾸기 M건, 진도·상태 K건...`) 반환.
  - `server/routers/sync.py` `PushPayload` 및 `/api/sync/push`에 `deleted_highlights` 필드 처리 추가(해당 `(url, pid)` 레코드 `is_resolved = 1, updated_at = now` 반영).
- **`mobile_app/lib/ui/sync/pending_changes_sheet.dart` (신규)**
  - 카테고리 필터 칩(`전체`, `문장 수정`, `찾아바꾸기`, `진도·상태`, `상단 고정`, `마킹`), 이전→이후 Diff 박스, 통합 배지(`N회 통합`), 독서 잔디 안내, 조회 전용/업로드 확인(`confirmUpload: true`) 2가지 모드 지원.
- **`mobile_app/lib/ui/library/library_screen.dart` & `mobile_app/lib/ui/settings/settings_screen.dart`**
  - **동기화 스튜디오**: 상단 인라인 변경 요약 카드(`자세히 (N)`) 배치 + 업로드/양방향 동기화 클릭 시 변경사항 확인 바텀시트를 거쳐 실행; 오프라인 뱃지도 대기 건수 표시(`오프라인 · 대기 N건`) 및 탭 열기 지원.
  - **설정 > 수동 동기화 작업**: 미업로드 건수 배너 + `[내역 보기]` + `[모바일 변경사항 업로드 (내역 확인 ➔ PC)]` + 양방향 동기화 시 사전 확인 연동.

---

## 3. 검증 내역

- **Flutter 정적 분석**: `flutter analyze` → `No issues found!`
- **Flutter 테스트**: `flutter test` (`mobile_app/test/device_separation_and_upload_preview_test.dart` 포함) → 전체 `37 passed` (`All tests passed!`)
- **백엔드 테스트 (격리 DB)**: `.\venv\Scripts\python.exe -m pytest tests/test_sync_router.py tests/test_highlights.py tests/test_snapshot_sync.py` → `7 passed in 1.92s`
- **Python 린트**: `.\venv\Scripts\ruff.exe check server/routers/sync.py tests/test_sync_router.py` → `All checks passed!`
