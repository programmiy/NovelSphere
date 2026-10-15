# 📋 [작업 계획서] Celery 제거 및 인메모리-스마트 쓰로틀링 기반 SQLite 경량 큐 전환

> **문서 버전**: 2.0.0 (SQLite 락 경합 방지 인메모리 캐싱 & asyncio.to_thread 블로킹 차단 & ai_review 번역 태스크 통합)  
> **작성 일자**: 2026-10-15  
> **대상 디렉토리 및 파일**:  
> - 백그라운드 코어: [`server/celery_app.py`](file:///C:/LANOVEL/server/celery_app.py), `server/services/task_manager.py` (신설)  
> - 태스크 이관 대상: [`server/routers/tasks.py`](file:///C:/LANOVEL/server/routers/tasks.py), [`server/routers/ai_review.py`](file:///C:/LANOVEL/server/routers/ai_review.py)  
> - 정리 파일: [`requirements.txt`](file:///C:/LANOVEL/requirements.txt), [`server/requirements.txt`](file:///C:/LANOVEL/server/requirements.txt), [`server/settings.py`](file:///C:/LANOVEL/server/settings.py), [`server/notifications.py`](file:///C:/LANOVEL/server/notifications.py), `docker-compose*.yml`  
> **목적**: 무거운 Celery 및 Redis 의존성을 전면 제거하고, 메인 번역 DB 쓰기 락 충돌과 이벤트 루프 블로킹이 없는 **인메모리 캐싱 + 비동기 스레드 풀 기반 SQLite 경량 태스크 큐**를 구축합니다.

---

## 1. 아키텍처 핵심 보완 및 주의사항 (Critical Constraints)

1. **진행률(Progress) DB 커밋 쓰로틀링 (SQLite Lock 경합 원천 차단)**:
   * **문제**: 수백 개 URL 제목 수집이나 대량 재번역 시 매 아이템(1건)마다 `UPDATE system_tasks`를 커밋하면, 크롬 확장의 실시간 번역 저장(`/translations/upsert`)과 SQLite 쓰기 락 충돌(BusyTimeout)이 발생합니다.
   * **해결책**:
     * 실시간 진행률(`progress`, `processed_items`)은 `TaskManager`의 **인메모리 딕셔너리(`self.in_memory_progress`)**에 기록.
     * 클라이언트의 진행률 조회(`GET /tasks/{task_id}`)는 메모리에서 **0ms 즉시 응답**.
     * SQLite DB 커밋은 **상태 전이 시(PENDING ➔ RUNNING ➔ DONE/FAILED)** 또는 **20건 처리 단위(혹은 5초 주기)**로만 지연 쓰로틀링 커밋.
2. **`asyncio.to_thread`를 통한 이벤트 루프 블로킹 차단**:
   * **문제**: `requests.get()`, `time.sleep()`, 동기 SQLAlchemy `SessionLocal`을 `async def` 코루틴 워커 안에서 직접 실행하면, 작업이 끝날 때까지 FastAPI 이벤트 루프 전체가 멈춰(Freeze) 뷰어 및 확장 프로그램 API가 먹통이 됩니다.
   * **해결책**: 워커 루프에서 무거운 동기 함수를 실행할 때는 반드시 `await asyncio.to_thread(sync_worker_fn, ...)`로 감싸서 표준 비동기 스레드 풀에서 실행하고, 지연은 `await asyncio.sleep()`을 사용.
3. **가장 무거운 백그라운드 작업인 `ai_review.py` 통합**:
   * `tasks.py`(URL 제목 수집)뿐만 아니라, 현재 진행률 조회 및 취소가 불가능한 [`server/routers/ai_review.py`](file:///C:/LANOVEL/server/routers/ai_review.py)의 **초벌 번역(`process_initial_translation_bg`)** 및 **배치 재재번역(`process_batch_reretranslation_bg`)**을 `TaskManager`로 전격 이관.
4. **저장소 전체 Celery/Redis 잔재 파일 일괄 정리**:
   * 루트 [`requirements.txt`](file:///C:/LANOVEL/requirements.txt)뿐만 아니라 [`server/requirements.txt`](file:///C:/LANOVEL/server/requirements.txt)와 `docker-compose.yml` 내 미사용 Redis/Celery 컨테이너 정의까지 함께 삭제.

---

## 2. 목표 아키텍처 (Hybrid Memory-SQLite Task Queue)

```
[ 클라이언트 (확장 / 웹 / 모바일) ]
       │ POST /api/ai_review/reretranslate_batch
       ▼
[ TaskManager (싱글톤) ]
       │ 1. SQLite 'system_tasks'에 PENDING 레코드 1회 커밋 (영속화)
       │ 2. in_memory_progress[task_id] 초기화
       │ 3. asyncio.Queue에 Task Job 푸시
       ▼
[ Async Queue Worker (FastAPI 백그라운드) ]
       │
       ├───▶ [ await asyncio.to_thread(worker_fn) ]  <-- 스레드 풀에서 동기 로직 안전 실행
       │         │ (I/O, requests, SessionLocal, Gemini Fallback)
       │         ▼
       │     진행률 보고: task_manager.report_progress(task_id, current, total)
       │         │
       │         ├── 1) 메모리 dict 즉시 업데이트 (GET /tasks/{id}가 0ms로 폴링)
       │         └── 2) 쓰로틀러 (20건마다 또는 5초 주기로만 SQLite 커밋)
       │
       ▼
[ 작업 완료/실패 시 ]
       └── SQLite 'system_tasks' 상태 -> DONE/FAILED 최종 커밋 & SSE 알림 브로드캐스트
```

---

## 3. 새 세션 실행 단계별 체크리스트 (Step-by-Step Tasks)

### [Task 1] 영속 모델 `SystemTask` 생성 ([`server/models.py`](file:///C:/LANOVEL/server/models.py))
* [ ] 작업 영속성 테이블 선언:
  ```python
  class SystemTask(Base):
      __tablename__ = "system_tasks"
      
      id = Column(String, primary_key=True)       # UUID
      task_type = Column(String, nullable=False)  # 'fetch_titles', 'reretranslate_batch', etc.
      status = Column(String, default="PENDING")  # PENDING, RUNNING, DONE, FAILED, CANCELLED
      progress = Column(Integer, default=0)       # 0 ~ 100%
      total_items = Column(Integer, default=0)
      processed_items = Column(Integer, default=0)
      result_data = Column(Text, nullable=True)   # JSON 결과
      error_message = Column(Text, nullable=True)
      created_at = Column(DateTime, default=datetime.utcnow)
      updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
  ```

### [Task 2] 하이브리드 `TaskManager` 서비스 구현 (`server/services/task_manager.py`)
* [ ] 싱글톤 `TaskManager` 클래스 작성:
  * `self._queue = asyncio.Queue()`: 작업 대기열.
  * `self._in_memory = {}`: 실시간 진행률 딕셔너리 (`{task_id: {"status": ..., "current": ..., "total": ..., "last_db_sync": ...}}`).
  * `report_progress(task_id, current, total)`:
    * 메모리 즉시 갱신.
    * `if current == total or (current - last_db_count >= 20) or (now - last_sync_time >= 5.0):` 조건에서만 DB 비동기 커밋.
  * `cancel(task_id)`: 취소 플래그 설정.
  * 워커 실행 루프:
    ```python
    async def _worker_loop(self):
        while True:
            job = await self._queue.get()
            # 메인 이벤트 루프 블로킹 방지를 위한 to_thread 사용
            await asyncio.to_thread(job.sync_run, job.task_id, self.report_progress)
            self._queue.task_done()
    ```

### [Task 3] `tasks.py` 및 `ai_review.py` 백그라운드 태스크 이관
* [ ] [`server/routers/tasks.py`](file:///C:/LANOVEL/server/routers/tasks.py):
  * Celery 의존성 전면 제거.
  * `fetch_missing_titles_endpoint`가 `task_manager.enqueue('fetch_titles', ...)`를 호출하도록 수정.
  * `GET /tasks/{task_id}`가 `task_manager.get_status(task_id)`를 우선 반환하도록 수정.
* [ ] [`server/routers/ai_review.py`](file:///C:/LANOVEL/server/routers/ai_review.py):
  * 기존 `BackgroundTasks`로 격리 없이 실행되던 `process_initial_translation_bg` 및 `process_batch_reretranslation_bg`를 `TaskManager` 작업으로 등록.
  * 프론트엔드 검수 화면에서 번역 진행률 및 취소 버튼이 실시간 연동되도록 바인딩.

### [Task 4] Celery & Redis 완전 제거 및 의존성 정리
* [ ] [`server/celery_app.py`](file:///C:/LANOVEL/server/celery_app.py) 파일 삭제.
* [ ] [`server/settings.py`](file:///C:/LANOVEL/server/settings.py)에서 `celery_always_eager` 및 Celery 관련 필드 제거.
* [ ] [`server/notifications.py`](file:///C:/LANOVEL/server/notifications.py)의 Celery 알림 핸들러 정리.
* [ ] 의존성 파일 정리:
  * [`requirements.txt`](file:///C:/LANOVEL/requirements.txt): `celery` 삭제.
  * [`server/requirements.txt`](file:///C:/LANOVEL/server/requirements.txt): `celery` 삭제.
  * `docker-compose.yml`, `docker-compose.override.yml`: `redis` 서비스 및 `celery_worker` 컨테이너 섹션 삭제 (파일 존재 시).

---

## 4. 검증 및 테스트 방법 (Verification)

1. **DB 락 충돌 방지 스트레스 테스트**:
   * 대량 URL 제목 수집(100+ 건)을 실행하여 백그라운드 태스크가 도는 도중에:
   * 크롬 확장 프로그램 또는 테스트 스크립트로 `POST /translations/upsert` 10회 연속 호출.
   * `database is locked (500 Internal Server Error)` 없이 두 요청 모두 정상 처리되는지 확인.
2. **이벤트 루프 넌블로킹(Non-blocking) 검증**:
   * `ai_review`의 배치 재재번역 태스크를 실행한 상태에서:
   * 브라우저로 `/library`, `/viewer` 접속 시 지연(Lag) 없이 50ms 내외로 즉시 응답하는지 확인.
3. **서버 비정상 종료 후 복구 확인**:
   * 태스크 실행 중 서버 강제 종료(Ctrl+C) 후 재기동 시:
   * `system_tasks` 테이블에 남아있는 `RUNNING` 작업이 `INTERRUPTED`로 올바르게 표시되는지 확인.
4. **Pytest 단위 테스트**:
   ```bash
   pytest tests/test_tasks.py
   pytest tests/test_ai_review.py
   ```

---

## 5. 롤백 및 안전장치 (Safety & Rollback)

* `system_tasks` 테이블은 메인 `translations` 테이블과 외래키(Foreign Key) 제약 없이 독립적으로 운영되므로 소설 번역 원본 데이터 손상 위험이 0%입니다.
* 비상 시 `task_manager.py`를 비활성화하고 기존의 단순 `BackgroundTasks` 호출로 언제든 즉시 회귀할 수 있도록 파라미터 호환성을 유지합니다.
