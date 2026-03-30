# 비동기 작업 처리 개선: Celery 및 Redis 도입

## 1. 개요

- **작업:** 로드맵의 "4. 비동기 작업 처리 개선 (장기)" 항목을 구현했습니다.
- **목표:** 기존 FastAPI의 `BackgroundTasks`로 처리되던 무거운 백그라운드 작업을 `Celery`와 `Redis`를 사용하는 아키텍처로 전환하여 안정성과 확장성을 개선합니다.
- **주요 변경 사항:** '누락된 제목 가져오기' 기능을 Celery 태스크로 리팩토링하고, 프론트엔드에 진행률 표시 기능을 구현했습니다.

## 2. 기술 스택 변경

- **추가된 라이브러리:**
  - `celery`: 분산 태스크 큐 라이브러리.
  - `redis`: Celery의 메시지 브로커 및 결과 백엔드로 사용.

## 3. 상세 변경 내역

### 3.1. 백엔드

- **Celery 앱 설정 (`server/celery_app.py`):**
  - `Celery` 인스턴스를 생성하고 `Redis`를 브로커와 백엔드로 사용하도록 설정했습니다.
  - 태스크가 위치한 모듈(`server.routers.tasks`)을 자동으로 탐지하도록 `include` 설정을 추가했습니다.

- **태스크 리팩토링 (`server/routers/tasks.py`):**
  - 기존 `BackgroundTasks`를 사용하던 `process_urls_in_background` 함수를 `@celery_app.task` 데코레이터를 사용한 `process_urls_in_background_task`로 교체했습니다.
  - 태스크 진행 상태를 클라이언트에 전달하기 위해 `self.update_state`를 사용하여 현재 진행 상황(current, total, percentage)을 메타데이터로 업데이트하도록 구현했습니다.
  - `/fetch_missing_titles` 엔드포인트가 Celery 태스크를 비동기적으로 실행(`apply_async`)하고 `task_id`를 반환하도록 수정했습니다.
  - 태스크의 상태를 조회할 수 있는 `/task_status/{task_id}` 엔드포인트를 추가했습니다.

- **서버 및 애플리케이션 실행 로직 수정:**
  - **`server/server.py`:** 더 이상 사용되지 않는 `PROGRESS_STATUS` 전역 변수를 제거했습니다.
  - **`main.py`:**
    - FastAPI 서버(`uvicorn`)와 함께 `Celery worker`를 별도의 서브프로세스로 시작하는 `start_celery_worker` 함수를 추가했습니다.
    - 애플리케이션 종료 시 Celery 워커 프로세스가 정상적으로 종료되도록 처리했습니다.
    - 기존의 작동하지 않는 진행률 표시 로직(`update_progress_bar`)을 주석 처리하고, 새로운 프론트엔드 기반 로직으로 대체했습니다.

### 3.2. 프론트엔드

- **UI 요소 추가 (`server/templates/library.html`):**
  - '누락된 제목 가져오기' 기능을 실행할 수 있는 버튼(`fetch-missing-titles-btn`)을 추가했습니다.
  - 태스크 진행률을 시각적으로 표시할 프로그레스 바와 텍스트 영역을 추가했습니다.

- **스타일 추가 (`server/static/library.css`):**
  - 프로그레스 바와 관련된 CSS 스타일을 추가하여 시각적 완성도를 높였습니다.

- **클라이언트 로직 구현 (`server/static/library.js`):**
  - '누락된 제목 가져오기' 버튼에 클릭 이벤트 리스너를 추가했습니다.
  - 버튼 클릭 시, `/fetch_missing_titles` API를 호출하여 백그라운드 작업을 시작하고 `task_id`를 받아옵니다.
  - `setInterval`을 사용하여 `pollTaskStatus` 함수를 주기적으로 실행, `/task_status/{task_id}` 엔드포인트를 폴링하여 태스크 상태를 가져옵니다.
  - 폴링 응답을 바탕으로 프로그레스 바의 너비와 텍스트를 동적으로 업데이트하여 사용자에게 진행 상황을 실시간으로 보여줍니다.
  - 태스크가 성공적으로 완료되거나 실패하면 폴링을 중지하고 사용자에게 최종 상태를 알립니다.

## 4. 기대 효과

- 무거운 작업을 별도의 워커 프로세스에서 처리함으로써 FastAPI 서버의 응답성이 향상됩니다.
- `Redis`를 메시지 큐로 사용하여 작업의 유실 가능성을 줄이고, 시스템 장애 발생 시에도 안정적으로 작업을 관리할 수 있습니다.
- 향후 다른 종류의 백그라운드 작업을 추가할 때 쉽게 확장할 수 있는 기반을 마련했습니다.
- 사용자에게 백그라운드 작업의 진행 상황을 명확하게 피드백하여 UX를 개선했습니다.
