# ntfy 푸시 알림 시스템 구축 및 모바일 전용 서재 뷰어 도입

- **작성 일자**: 2026-09-24
- **관련 모듈**: `server/notifications.py`, `server/routers/notifications.py`, `server/routers/ui.py`, `server/settings.py`, `server/static/library_mobile.*`, `server/templates/library_mobile.html`, `server/static/admin.*`, `server/templates/admin.html`, `extension/background.js`

---

## 1. 개요 및 도입 배경

1. **ntfy 기반 원격 실시간 푸시 알림 (`server/notifications.py`)**:
   - 번역 작업 완료, 백그라운드 태스크(누락 제목 수집 등) 완료 및 시스템 이상 발생 시, 데스크톱 앞에 있지 않아도 스마트폰(Android/iOS)이나 스마트워치로 실시간 알림을 수신할 수 있도록 HTTP pub-sub 기반 오픈소스 푸시 서비스인 `ntfy`(`ntfy.sh` 또는 셀프호스팅)를 통합했습니다.
   - 메인 스레드나 작업 흐름을 차단하지 않도록 데몬 스레드 비동기 전송을 기본 지원하며, 설정(`server/settings.json`)을 동적으로 저장/로드할 수 있습니다.

2. **모바일 전용 반응형 서재 UI (`server/templates/library_mobile.html`, `/m`)**:
   - 스마트폰 브라우저에서 `/library` 접속 시 모바일 환경(User-Agent)을 자동 감지하여 모바일 전용 뷰(`library_mobile.html`)를 서빙합니다.
   - 쿠키(`lanovel_view_mode`) 및 쿼리 파라미터(`?view=mobile`, `?view=pc`)를 통해 언제든지 PC 뷰와 모바일 뷰를 상호 전환할 수 있습니다.
   - 터치 제스처에 최적화된 카드 그리드, 직관적인 검색/필터링 인터페이스를 제공합니다.

3. **관리자 대시보드 UI 연동 및 확장 프로그램 정규화**:
   - 관리자 대시보드(`/admin`)에 ntfy 푸시 알림 설정 모달 및 테스트 알림 발송 기능을 연동했습니다.
   - 크롬 확장 프로그램(`background.js`)에서 번역 요청 전송 시 URL의 프래그먼트(`#...`)를 사전에 제거하여 DB 정규화 일관성을 보장했습니다.

---

## 2. 주요 구현 상세

### 2-1. ntfy 알림 매니저 (`server/notifications.py` & `server/routers/notifications.py`)
- **주요 함수**:
  - `send_ntfy(title, message, priority, tags, click_url, actions, topic, server, synchronous)`: ntfy 서버로 JSON 페이로드 발송 (논블로킹 스레드 지원).
  - `notify_translation_progress(...)`: 번역 진행률 및 완료 알림.
  - `notify_task_event(task_name, message)`: 백그라운드 작업 완료 알림.
- **REST API 엔드포인트**:
  - `GET /api/notifications/settings`: 현재 ntfy 설정 조회.
  - `POST /api/notifications/settings`: ntfy 설정 동적 갱신 및 `settings.json` 영속화.
  - `POST /api/notifications/test`: 테스트 알림 즉시 발송.

### 2-2. 모바일 서재 라우팅 및 전용 뷰 (`server/routers/ui.py`)
- `is_mobile_request(request)`: 쿼리 파라미터 -> 쿠키 -> User-Agent 정규식 순서로 모바일 환경 판별.
- `serve_library_view(request)`: 환경에 따라 `library_mobile.html` 또는 `library.html` 동적 선택 및 쿠키 보존.
- `GET /m`: 모바일 전용 엔드포인트 제공.

### 2-3. 확장 프로그램 백그라운드 안정화 (`extension/background.js`)
- `handleBatchTranslate` 및 메시지 리스너에서 탭 URL의 앵커 해시(`rawUrl.split('#')[0].trim()`)를 사전에 정규화하여 전송.

---

## 3. 검증 결과

- `tests/test_notifications.py`: ntfy 설정 조회, 저장, 테스트 발송 및 비활성화 상태 동작 검증 완료 (7개 테스트 통과).
- `tests/test_library_viewer_api.py`: 모바일 환경 감지, 쿠키 보존, PC/모바일 전환 및 뷰 서빙 검증 완료 (5개 테스트 통과).
- 전체 pytest 71개 테스트 통과.
