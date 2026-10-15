"""
LANOVEL 경량 하이브리드 태스크 매니저 (Hybrid Memory-SQLite Task Manager)
- 인메모리 캐싱을 통한 0ms 실시간 진행률 조회 및 취소 제어
- SQLite 락 경합 방지를 위한 지연 쓰로틀링 커밋 (20건 단위 또는 5초 주기)
- asyncio.to_thread 기반 비동기 스레드 풀 격리를 통한 FastAPI 이벤트 루프 보호
"""

import asyncio
import inspect
import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple

from server.database import SessionLocal
from server.models import SystemTask

logger = logging.getLogger(__name__)


@dataclass
class TaskJob:
    task_id: str
    task_type: str
    func: Callable
    args: Tuple[Any, ...]
    kwargs: Dict[str, Any]


class TaskManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._in_memory: Dict[str, Dict[str, Any]] = {}
        self._queue: Optional[asyncio.Queue] = None
        self._worker_task: Optional[asyncio.Task] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._stop_requested = False

    def _ensure_queue_and_worker(self):
        """현재 실행 중인 asyncio 루프에 큐 및 워커 코루틴을 바인딩합니다."""
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            return

        if self._queue is None or self._loop != current_loop:
            self._loop = current_loop
            self._queue = asyncio.Queue()
            self._stop_requested = False
            self._worker_task = current_loop.create_task(self._worker_loop())
            logger.info("[TaskManager] Initialized async queue and worker loop.")
        elif self._worker_task is None or self._worker_task.done():
            self._stop_requested = False
            self._worker_task = current_loop.create_task(self._worker_loop())
            logger.info("[TaskManager] Restarted async worker loop.")

    async def startup(self):
        """FastAPI lifespan startup 시 호출되어 워커를 시작하고 비정상 종료 작업을 복구합니다."""
        await asyncio.to_thread(self.recover_interrupted_tasks)
        self._ensure_queue_and_worker()

    async def shutdown(self):
        """FastAPI lifespan shutdown 시 워커를 우아하게 종료합니다."""
        self._stop_requested = True
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            try:
                await self._worker_task
            except (asyncio.CancelledError, Exception):
                pass
        logger.info("[TaskManager] Shutdown complete.")

    def recover_interrupted_tasks(self):
        """이전 서버 프로세스 비정상 종료 시 RUNNING/PENDING 상태로 남은 작업을 INTERRUPTED로 복구합니다."""
        try:
            db = SessionLocal()
            try:
                interrupted = (
                    db.query(SystemTask)
                    .filter(SystemTask.status.in_(["RUNNING", "PENDING"]))
                    .all()
                )
                for t in interrupted:
                    t.status = "INTERRUPTED"
                    t.error_message = (
                        "Process terminated or restarted while task was active."
                    )
                    t.updated_at = datetime.utcnow()
                if interrupted:
                    db.commit()
                    logger.info(
                        f"[TaskManager] Recovered {len(interrupted)} orphaned tasks to INTERRUPTED."
                    )
            finally:
                db.close()
        except Exception as e:
            logger.error(f"[TaskManager] Error recovering interrupted tasks: {e}")

    def enqueue(
        self,
        task_type: str,
        func: Callable,
        *args,
        total_items: int = 0,
        task_id: Optional[str] = None,
        pass_task_id: bool = False,
        **kwargs,
    ) -> str:
        """
        작업을 큐에 등록하고 SQLite에 PENDING 레코드를 영속화합니다.
        """
        if not task_id:
            task_id = f"task-{uuid.uuid4().hex[:12]}"

        now = time.time()
        with self._lock:
            self._in_memory[task_id] = {
                "id": task_id,
                "task_type": task_type,
                "status": "PENDING",
                "progress": 0,
                "current": 0,
                "total": total_items,
                "status_text": "Pending...",
                "cancel_requested": False,
                "created_at": datetime.utcnow(),
                "last_db_count": 0,
                "last_db_time": now,
                "result_data": None,
                "error_message": None,
            }

        # SQLite 초기 1회 커밋 (영속화)
        try:
            db = SessionLocal()
            try:
                st = SystemTask(
                    id=task_id,
                    task_type=task_type,
                    status="PENDING",
                    progress=0,
                    total_items=total_items,
                    processed_items=0,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
                db.add(st)
                db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.error(f"[TaskManager] Failed to persist initial task {task_id}: {e}")

        if pass_task_id:
            kwargs["task_id"] = task_id

        job = TaskJob(
            task_id=task_id,
            task_type=task_type,
            func=func,
            args=args,
            kwargs=kwargs,
        )

        self._ensure_queue_and_worker()
        if self._queue is not None:
            self._queue.put_nowait(job)
        else:
            logger.warning(
                f"[TaskManager] No event loop running; task {task_id} queued in memory only."
            )

        return task_id

    def report_progress(
        self,
        task_id: str,
        current: int,
        total: int,
        status_text: Optional[str] = None,
    ):
        """
        인메모리 딕셔너리를 즉시 업데이트(0ms 조회 지원)하고,
        20건 처리 단위 또는 5초 주기로만 SQLite 지연 쓰로틀링 커밋을 수행합니다.
        """
        now = time.time()
        should_commit = False
        pct = int((current / total) * 100) if total > 0 else 0

        with self._lock:
            info = self._in_memory.get(task_id)
            if not info:
                return

            info["current"] = current
            info["total"] = total
            info["progress"] = pct
            if status_text:
                info["status_text"] = status_text
            else:
                info["status_text"] = f"Processing {current}/{total}"

            last_db_count = info.get("last_db_count", 0)
            last_db_time = info.get("last_db_time", 0.0)

            # 완료 시점, 20건 누적 시점, 5초 경과 시점에만 DB 커밋
            if (
                (current >= total and total > 0)
                or (current - last_db_count >= 20)
                or (now - last_db_time >= 5.0)
            ):
                should_commit = True
                info["last_db_count"] = current
                info["last_db_time"] = now

        if should_commit:
            self._sync_task_progress_to_db(task_id, current, total, pct)

    def _sync_task_progress_to_db(
        self, task_id: str, current: int, total: int, percentage: int
    ):
        try:
            db = SessionLocal()
            try:
                task = db.query(SystemTask).filter(SystemTask.id == task_id).first()
                if task and task.status in ("PENDING", "RUNNING"):
                    task.processed_items = current
                    task.total_items = total
                    task.progress = percentage
                    task.updated_at = datetime.utcnow()
                    db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.warning(
                f"[TaskManager] Throttled DB commit failed for task {task_id}: {e}"
            )

    def cancel(self, task_id: str) -> bool:
        """태스크 취소를 요청합니다."""
        with self._lock:
            info = self._in_memory.get(task_id)
            if info:
                info["cancel_requested"] = True
                if info["status"] == "PENDING":
                    info["status"] = "CANCELLED"
                    info["status_text"] = "Cancelled"
                    self._update_task_status_in_db(task_id, "CANCELLED")
                    return True
                elif info["status"] == "RUNNING":
                    info["status_text"] = "Cancelling..."
                    return True

        # 인메모리에 없으면 DB 직접 갱신
        try:
            db = SessionLocal()
            try:
                task = db.query(SystemTask).filter(SystemTask.id == task_id).first()
                if task and task.status in ("PENDING", "RUNNING"):
                    task.status = "CANCELLED"
                    task.updated_at = datetime.utcnow()
                    db.commit()
                    return True
            finally:
                db.close()
        except Exception as e:
            logger.error(f"[TaskManager] DB cancel failed for {task_id}: {e}")
        return False

    def is_cancelled(self, task_id: str) -> bool:
        """워커 함수가 루프 중간에 취소 여부를 폴링합니다."""
        with self._lock:
            info = self._in_memory.get(task_id)
            if info:
                return info.get("cancel_requested", False)
        return False

    def mark_completed(self, task_id: str, result_data: Optional[Any] = None):
        """태스크 완료 상태를 기록합니다."""
        with self._lock:
            info = self._in_memory.get(task_id)
            if info:
                info["status"] = "DONE"
                info["progress"] = 100
                info["current"] = info.get("total", info.get("current", 0))
                info["status_text"] = "Completed"
                info["result_data"] = result_data
        self._finalize_task_in_db(task_id, "DONE", result_data=result_data)

    def mark_failed(self, task_id: str, error_message: str):
        """태스크 실패 상태를 기록합니다."""
        with self._lock:
            info = self._in_memory.get(task_id)
            if info:
                info["status"] = "FAILED"
                info["status_text"] = f"Failed: {error_message}"
                info["error_message"] = error_message
        self._finalize_task_in_db(task_id, "FAILED", error_message=error_message)

    def mark_cancelled(self, task_id: str):
        """태스크 취소 완료 상태를 기록합니다."""
        with self._lock:
            info = self._in_memory.get(task_id)
            if info:
                info["status"] = "CANCELLED"
                info["status_text"] = "Cancelled"
        self._finalize_task_in_db(task_id, "CANCELLED")

    def _update_task_status_in_db(self, task_id: str, status: str):
        try:
            db = SessionLocal()
            try:
                task = db.query(SystemTask).filter(SystemTask.id == task_id).first()
                if task:
                    task.status = status
                    task.updated_at = datetime.utcnow()
                    db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.warning(
                f"[TaskManager] Status update failed for task {task_id}: {e}"
            )

    def _finalize_task_in_db(
        self,
        task_id: str,
        status: str,
        result_data: Optional[Any] = None,
        error_message: Optional[str] = None,
    ):
        try:
            db = SessionLocal()
            try:
                task = db.query(SystemTask).filter(SystemTask.id == task_id).first()
                if task:
                    task.status = status
                    if status == "DONE":
                        task.progress = 100
                        if task.total_items > 0:
                            task.processed_items = task.total_items
                    if result_data is not None:
                        try:
                            task.result_data = (
                                json.dumps(result_data, ensure_ascii=False)
                                if not isinstance(result_data, str)
                                else result_data
                            )
                        except Exception:
                            task.result_data = str(result_data)
                    if error_message:
                        task.error_message = error_message
                    task.updated_at = datetime.utcnow()
                    db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.error(
                f"[TaskManager] Final DB commit failed for task {task_id}: {e}"
            )

    def get_status(self, task_id: str) -> Dict[str, Any]:
        """
        인메모리에서 0ms 즉시 응답을 반환합니다.
        메모리에 없는 과거 작업은 SQLite에서 조회합니다.
        응답 포맷은 library.js 및 Celery AsyncResult 호환 포맷을 유지합니다.
        """
        with self._lock:
            info = self._in_memory.get(task_id)
            if info:
                status = info.get("status", "PENDING")
                current = info.get("current", 0)
                total = info.get("total", 0)
                percentage = info.get("progress", 0)
                status_text = info.get("status_text", "Processing...")
                error_msg = info.get("error_message")

                # Celery / library.js 호환 state 매핑
                if status == "PENDING":
                    celery_state = "PENDING"
                elif status == "RUNNING":
                    celery_state = "PROGRESS"
                elif status == "DONE":
                    celery_state = "SUCCESS"
                else:
                    celery_state = "FAILURE"

                return {
                    "task_id": task_id,
                    "state": celery_state,
                    "status": error_msg if status == "FAILED" else status_text,
                    "meta": {
                        "percentage": percentage,
                        "current": current,
                        "total": total,
                        "status": status_text,
                        "task_type": info.get("task_type"),
                        "raw_status": status,
                    },
                }

        # DB 폴백 조회
        try:
            db = SessionLocal()
            try:
                task = db.query(SystemTask).filter(SystemTask.id == task_id).first()
                if task:
                    st = task.status
                    if st == "PENDING":
                        celery_state = "PENDING"
                        status_text = "Pending..."
                    elif st == "RUNNING":
                        celery_state = "PROGRESS"
                        status_text = f"Processing {task.processed_items}/{task.total_items}"
                    elif st == "DONE":
                        celery_state = "SUCCESS"
                        status_text = "Completed"
                    else:
                        celery_state = "FAILURE"
                        status_text = task.error_message or st

                    return {
                        "task_id": task_id,
                        "state": celery_state,
                        "status": status_text,
                        "meta": {
                            "percentage": task.progress,
                            "current": task.processed_items,
                            "total": task.total_items,
                            "status": status_text,
                            "task_type": task.task_type,
                            "raw_status": st,
                        },
                    }
            finally:
                db.close()
        except Exception as e:
            logger.error(f"[TaskManager] DB status query failed for {task_id}: {e}")

        return {
            "task_id": task_id,
            "state": "PENDING",
            "status": "Pending...",
            "meta": {
                "percentage": 0,
                "current": 0,
                "total": 0,
                "status": "Pending...",
            },
        }

    def list_tasks(self, limit: int = 50) -> List[Dict[str, Any]]:
        """최근 등록된 태스크 목록을 조회합니다."""
        try:
            db = SessionLocal()
            try:
                tasks = (
                    db.query(SystemTask)
                    .order_by(SystemTask.created_at.desc())
                    .limit(limit)
                    .all()
                )
                return [
                    {
                        "id": t.id,
                        "task_type": t.task_type,
                        "status": t.status,
                        "progress": t.progress,
                        "processed_items": t.processed_items,
                        "total_items": t.total_items,
                        "error_message": t.error_message,
                        "created_at": (
                            t.created_at.isoformat() if t.created_at else None
                        ),
                        "updated_at": (
                            t.updated_at.isoformat() if t.updated_at else None
                        ),
                    }
                    for t in tasks
                ]
            finally:
                db.close()
        except Exception as e:
            logger.error(f"[TaskManager] List tasks failed: {e}")
            return []

    async def _worker_loop(self):
        """비동기 큐에서 작업을 꺼내어 non-blocking 스레드 풀에서 실행합니다."""
        logger.info("[TaskManager] Async queue worker loop started.")
        while not self._stop_requested:
            try:
                if self._queue is None:
                    await asyncio.sleep(0.1)
                    continue

                job: TaskJob = await self._queue.get()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[TaskManager] Error popping from queue: {e}")
                await asyncio.sleep(0.5)
                continue

            task_id = job.task_id
            if self.is_cancelled(task_id):
                self.mark_cancelled(task_id)
                self._queue.task_done()
                continue

            with self._lock:
                if task_id in self._in_memory:
                    self._in_memory[task_id]["status"] = "RUNNING"
                    self._in_memory[task_id]["status_text"] = "Processing..."
            self._update_task_status_in_db(task_id, "RUNNING")

            try:
                logger.info(
                    f"[TaskManager] Executing task {task_id} ({job.task_type})"
                )
                if inspect.iscoroutinefunction(job.func):
                    res = await job.func(*job.args, **job.kwargs)
                else:
                    res = await asyncio.to_thread(
                        job.func, *job.args, **job.kwargs
                    )

                if self.is_cancelled(task_id):
                    self.mark_cancelled(task_id)
                    logger.info(f"[TaskManager] Task {task_id} was cancelled.")
                else:
                    self.mark_completed(task_id, result_data=res)
                    logger.info(
                        f"[TaskManager] Task {task_id} completed successfully."
                    )
            except Exception as e:
                logger.error(
                    f"[TaskManager] Error in task {task_id}: {e}", exc_info=True
                )
                self.mark_failed(task_id, str(e))
            finally:
                self._queue.task_done()


# 싱글톤 인스턴스
task_manager = TaskManager()
