# 모바일 앱 기능 개선 및 데이터 무결성 안전장치 탑재 보고서

- **작업 일자**: 2026-10-30
- **버전**: `lanovel_reader` `v1.7.1+2026103001`
- **대상 모듈**:
  - **모바일 UI/뷰어**: [reader_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_screen.dart), [toc_drawer.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/toc_drawer.dart)
  - **모바일 서재**: [library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart)
  - **모바일 동기화/DB**: [local_db_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/local_db_service.dart), [sync_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/sync_service.dart)
  - **모바일 배포/설정**: [pubspec.yaml](file:///c:/LANOVEL/mobile_app/pubspec.yaml), [release_notes.json](file:///c:/LANOVEL/mobile_app/release_notes.json)

---

## 1. 개요 및 목적
모바일 앱 전수조사 결과를 기반으로, 신규 기능 추가가 아닌 기존에 구현된 자원과 인프라를 극대화하는 방향으로 개선을 완료했습니다:
1. 뷰어 원문 툴팁(Tooltip) 모드 정상 연결 및 목차 드로어 현재 읽는 화 자동 추적/역순 정렬 탑재
2. 서재 화면의 기구현 4종 정렬 엔진(SQL) UI 연결 및 실시간 번역 배너의 리모컨 원클릭 연동
3. 동기화 시 서버 DB 문단 수가 모바일 DB 문단 수보다 적을 경우 동기화를 차단하는 데이터 무결성 방어벽 구축
4. 모바일 통계 탭(서버 분석 뷰 및 독서 잔디 시트) 정리 및 3탭(서재, 찾아바꾸기, 설정) 경량화

---

## 2. 주요 개선 내역

### 2-1. [뷰어] 원문 툴팁 모드 정상화 & 목차 드로어 고도화
1. **원문 표시 옵션 '툴팁(Tooltip)' 모드 연결 ([reader_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_screen.dart))**:
   - `PreferencesService.originalTextMode`가 `'tooltip'`일 때, 각 단락 우하단에 미니멀 `[原 원문 보기]` 배지 배치.
   - 배지 탭 시 플로팅 `Tooltip`으로 일본어 원문을 선택한 일본어 서체로 말풍선 팝업하여, 화면 레이아웃 간섭 없이 원문을 즉시 대조할 수 있도록 구현.
2. **목차 드로어 현재 읽는 화 자동 추적 & 정렬 전환 ([toc_drawer.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/toc_drawer.dart))**:
   - `TocDrawer`를 `StatefulWidget`으로 고도화하고 `ScrollController` 바인딩.
   - 드로어 오픈 시 현재 읽는 챕터 위치로 자동 스크롤하여 수백 화 장편 소설에서도 탐색 피로도 제거.
   - 상단 바에 `[📍 현재 제 N화]` 즉시 재점프 버튼 및 `[최신화부터 ⇄ 1화부터]` 정렬 전환 토글 탑재.

### 2-2. [서재] 4종 정렬 엔진 UI 연결 & 실시간 번역 배너 인터랙션
1. **4종 정렬 엔진 서재 UI 연동 ([library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart))**:
   - `LocalDbService.getBooks`에 기구현되어 있던 4가지 SQL 정렬(`recent`: 최근 읽은 순, `name`: 가나다 이름순, `chapters`: 회차 많은 순, `pinned`: 즐겨찾기 우선)을 서재 상단 독에 `PopupMenuButton`으로 연결.
2. **실시간 번역 진행 배너 리모컨 연동**:
   - `_buildLiveTranslationBanner`에 `InkWell` 탭 인터랙션을 연결하여, 터치 시 원격 제어 화면([RemoteControlScreen](file:///c:/LANOVEL/mobile_app/lib/ui/remote/remote_control_screen.dart))으로 즉시 라우팅.

### 2-3. [동기화] 서버 문단 수 역전 시 동기화 차단 안전장치
1. **문단 수 무결성 검증 엔진 ([local_db_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/local_db_service.dart), [sync_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/sync_service.dart))**:
   - `LocalDbService.getTotalSentenceCount()`를 신설하여 모바일 DB 내 총 번역 문단 수를 산출.
   - `SyncService.checkServerStatus()`를 통해 `/api/sync/ping`의 `total_translations`를 수신.
   - `downloadFullSeed` 및 `performIncrementalSync` 실행 전, `mobileTransCount > 0`이고 `serverTransCount < mobileTransCount`일 경우 동기화를 강제 차단하고 사용자에게 안전 경고 스낵바 출력.

### 2-4. [경량화] 모바일 통계 탭 정리
1. **모바일 통계 뷰 UI 정리 ([library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart))**:
   - 하단 플로팅 네비게이션 독을 3탭(서재, 찾아바꾸기, 설정)으로 간소화.
   - 헤더 허브의 통계 버튼 및 사용되지 않는 통계 뷰/시트 파일 정리 완료.

---

## 3. 검증 결과

1. **정적 분석 (`flutter analyze`)**:
   - **`No issues found!`** (오류 0건, 경고 0건)
2. **단위 테스트 (`flutter test`)**:
   - **22개 테스트 전체 100% PASS** (`All tests passed!`)
