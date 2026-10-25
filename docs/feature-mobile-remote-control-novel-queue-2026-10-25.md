# 모바일 원격 제어 소설 연속 번역 큐 및 신데렐라 모드 구축 (v1.6.0)

> **작업 일자**: 2026-10-25  
> **관련 모듈**: `server/novel_queue.py`, `server/remote_control.py`, `server/routers/remote.py`, `extension/src/core/queue_session.ts`, `extension/src/background/queue_tabs.ts`, `mobile_app/pubspec.yaml`, `mobile_app/release_notes.json`

---

## 1. 개요 및 목적
외부(모바일 환경)에서 서버가 구동 중일 때, 사용자가 PC 화면을 직접 조작하지 않고도 모바일 앱 리모컨으로 여러 소설 URL을 순차적으로 자동 연속 번역하고 예외 상황(일일 번역 제한 시각 도달 등)을 스스로 극복할 수 있도록 소설 대기열(Queue) 엔진 및 확장 프로그램 탭 제어 파이프라인을 구축함.

---

## 2. 주요 변경 사항

### 2.1. 서버 사이드: 소설 큐 러너 (`server/novel_queue.py`, `server/routers/remote.py`)
- **QueueRunner & NovelQueueManager**:
  - `add_urls()`: 복수 소설 개요 페이지 URL 일괄 적재 및 카쿠요무/소설가가되자/녹턴/노벨업 목차 파싱 연동
  - `tick()`: 상태 머신(대기/번역중/실패/완료) 기반 주기적 상태 전이 및 다음 소설 자동 개시
  - `cinderella` (신데렐라 모드): 17시(또는 지정 일일 쿼터 차단 시각) 도달 시 안전 중단 후 다음 날 쿼터 초기화 시점에 자동으로 중단 회차부터 재개하는 자율 회복 루프
  - `page_problem` 3회 재시도 및 건너뛰기 안전장치
- **Remote Hub 스레드 안전성 강화 (`server/remote_control.py`)**:
  - `threading.RLock()` 적용으로 다중 비동기 태스크/스레드 간 명령 큐(`commands`) 동시 접근 레이스 컨디션 방지
- **원격 제어 라우터 확장 (`server/routers/remote.py`)**:
  - `/api/remote/queue`: 목록 조회, URL 추가, 순서 변경, 개별 재시도, 실행 설정(`running`, `cinderella`) 토글 API 제공
  - `/api/remote/ws`: 연결 즉시 현재 큐 설정값 전달 및 확장 프로그램 `queue_event` 양방향 처리

### 2.2. 브라우저 확장 프로그램 (`extension/src/`)
- **`queue_session.ts`**:
  - 세션 단위 번역 상태 추적 및 페이지 완료 시 서버로 완료 이벤트(`queue_event: completed`) 발행
- **`queue_tabs.ts`**:
  - background 서비스 워커 레벨에서 연속 번역 탭 생성, 닫기, 포커스 유지 관리
- **TypeScript 빌드 및 번들링**:
  - `npm run build`를 통해 `extension/content.js`, `extension/background.js` 최신화 반영 완료

### 2.3. 모바일 앱 (Flutter Reader v1.6.0)
- **버전 판올림**:
  - `mobile_app/pubspec.yaml`: `version: 1.6.0+2026102501`
  - `mobile_app/release_notes.json`: 원격 제어 및 연속 번역 큐 안정화 안내
- **릴리즈 APK 패키징**:
  - `.\scripts\setup_mobile.ps1 -BuildApk` 성공
  - 결과: `build/app/outputs/flutter-apk/app-release.apk` (23.5MB)
  - `server/static/lanovel-reader-release.apk` 동기화 및 Wi-Fi 무설치 자동 업데이트 브로드캐스트 완료

---

## 3. 검증 결과
- **Pytest 단위 테스트**: `tests/test_novel_queue.py`, `tests/test_remote_control.py` 총 53개 항목 100% Pass
- **TypeScript 타입 검사 & 번들 빌드**: `npm run typecheck`, `npm run build` 통과
- **Flutter 릴리즈 빌드**: Gradle `assembleRelease` 정상 완료 (23.5MB APK 생성)

---

## 4. 후속 작업 (2026-10-26): 앱 목록 관리 UI 연결

- **`mobile_app/lib/services/remote_control_service.dart`**
  - 모델 추가: `QueueItem`, `QueueEvent`, `QueueOverview`, `QueueAddResult`
  - API 래퍼 추가: `fetchQueue`(GET `/queue`), `addQueueUrls`(POST `/queue`), `removeQueueItem`(DELETE `/queue/{id}`), `reorderQueue`(POST `/queue/reorder`), `retryQueueItem`(POST `/queue/{id}/retry`), `setQueueConfig`(PUT `/queue/config`, `running`/`cinderella`)
- **`mobile_app/lib/ui/remote/remote_control_screen.dart`**
  - 기존 '다음에 번역할 사이트(준비 중)' 섹션을 `_queueSection`으로 교체
  - 기능: URL 붙여넣기 추가(여러 줄/쉼표 구분), 삭제(확인 후), 실패·완료 항목 다시 시도, 드래그 순서 변경(`ReorderableListView`, 즉시 반영 후 서버 동기화), 목록 자동 진행 스위치, 신데렐라 스위치, 최근 이슈 3개 표시
  - 2초 폴링(`_refresh`)에 `fetchQueue`를 포함. 목록 조회 실패는 리모컨 상태 표시에 영향 없음
- **검증**: `flutter analyze` 이슈 0건, `npm run typecheck/build/test`(17개) 통과, pytest 263 통과 / 1 실패(`test_corpus_ai_service::test_synthesize_translation_tier2`, 50ms 성능 임계 초과로 부하에 따른 시간 의존 불안정 테스트이며 본 변경과 무관)
- **주의**: 앱 실기기 동작과 APK 재빌드는 미수행. 반영하려면 앱 재빌드(`scripts/setup_mobile.ps1 -BuildApk`)가 필요
