import os
import time
import sqlite3
import logging
import threading
from datetime import datetime
from typing import Optional, Tuple, Dict, Any, List

logger = logging.getLogger(__name__)

# 정상 승인된 삭제 작업 기록부 (메모리 링버퍼: timestamp, count, reason)
_LEGITIMATE_DELETIONS: List[Tuple[float, int, str]] = []
_DELETION_LOCK = threading.Lock()

def record_legitimate_deletion(count: int, reason: str = ""):
    """
    정상적인 서비스 로직(소설 삭제, 선택 항목 삭제, 휴지통 이동 등)에 의해
    의도적으로 translations 테이블에서 행이 삭제되었음을 기록합니다.
    """
    if count <= 0:
        return
    with _DELETION_LOCK:
        _LEGITIMATE_DELETIONS.append((time.time(), count, reason))
        # 최근 100건만 유지
        if len(_LEGITIMATE_DELETIONS) > 100:
            del _LEGITIMATE_DELETIONS[:-100]
    logger.info(f"[DB Deletion Ledger] 정상 삭제 기록: {count}건 (사유: {reason or '미지정'})")

def get_legitimate_deletions_since(timestamp: float) -> int:
    """주어진 timestamp 이후 정상적으로 기록된 총 삭제 건수 합계 반환."""
    with _DELETION_LOCK:
        return sum(cnt for ts, cnt, _ in _LEGITIMATE_DELETIONS if ts >= timestamp)

def get_db_metrics(db_path: str) -> Optional[Tuple[int, int, int]]:
    """
    지정된 SQLite DB 파일의 translations 테이블 통계 (행 수, max_id, max_timestamp)를 반환합니다.
    테이블이 없거나 파일이 열리지 않으면 None을 반환합니다.
    """
    if not os.path.exists(db_path):
        return None
    try:
        # 안전한 읽기 전용 모드로 조회
        abs_path = os.path.abspath(db_path)
        conn = sqlite3.connect(f"file:{abs_path}?mode=ro", uri=True, timeout=10)
        cur = conn.cursor()
        cur.execute("SELECT count(*), max(id), max(timestamp) FROM translations")
        row = cur.fetchone()
        conn.close()
        if row and row[0] is not None:
            return (int(row[0]), int(row[1] or 0), int(row[2] or 0))
    except Exception as e:
        logger.warning(f"[DB Metrics] 메트릭 조회 실패 ({db_path}): {e}")
    return None

def perform_sqlite_backup(src_path: str, dst_path: str):
    """Safely backs up a SQLite database (including WAL mode) using the online backup API."""
    src_conn = sqlite3.connect(src_path, timeout=30)
    try:
        dst_conn = sqlite3.connect(dst_path, timeout=30)
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
    finally:
        src_conn.close()

def rotate_backups(backup_dir: str, max_backups: int = 5):
    """
    Keep only the latest max_backups backup files and delete older ones.
    Matches all translations_backup_*.db files (unified and legacy).
    """
    try:
        if not os.path.exists(backup_dir):
            return

        backup_files = [
            f for f in os.listdir(backup_dir)
            if f.startswith("translations_backup_") and f.endswith(".db")
        ]

        if len(backup_files) > max_backups:
            backup_files_with_time = []
            for f in backup_files:
                full_path = os.path.join(backup_dir, f)
                try:
                    mtime = os.path.getmtime(full_path)
                except OSError:
                    mtime = 0.0
                backup_files_with_time.append((f, mtime))

            backup_files_with_time.sort(key=lambda x: x[1], reverse=True)

            files_to_delete = backup_files_with_time[max_backups:]
            for file_name, _ in files_to_delete:
                file_path = os.path.join(backup_dir, file_name)
                for suffix in ("", "-shm", "-wal"):
                    target_file = file_path + suffix
                    if os.path.exists(target_file):
                        try:
                            os.remove(target_file)
                        except Exception as del_err:
                            logger.warning(f"[Backup Rotation] Failed to delete {target_file}: {del_err}")
                logger.info(f"[Backup Rotation] Deleted old backup: {file_name}")

        # 잔여 임시 파일(.tmp, .tmp-shm, .tmp-wal) 자동 정리
        for f in os.listdir(backup_dir):
            if ".tmp" in f:
                try:
                    os.remove(os.path.join(backup_dir, f))
                except Exception:
                    pass
    except Exception as e:
        logger.error(f"[Backup Rotation] Error during backup rotation: {e}")

def get_latest_backup_info(backup_dir: str) -> Optional[Tuple[str, float]]:
    """
    Returns (filename, mtime) of the newest backup file if one exists, otherwise None.
    """
    if not os.path.exists(backup_dir):
        return None

    backup_files = [
        f for f in os.listdir(backup_dir)
        if f.startswith("translations_backup_") and f.endswith(".db")
    ]
    if not backup_files:
        return None

    newest_file = None
    newest_mtime = -1.0
    for f in backup_files:
        full_path = os.path.join(backup_dir, f)
        try:
            mtime = os.path.getmtime(full_path)
            if mtime > newest_mtime:
                newest_mtime = mtime
                newest_file = f
        except OSError:
            continue

    if newest_file:
        return (newest_file, newest_mtime)
    return None

def create_unified_backup(
    src_db_path: str,
    backup_dir: str,
    force: bool = False,
    cooldown_hours: float = 1.0,
    cooldown_days: Optional[float] = None,
    max_backups: int = 5
) -> Dict[str, Any]:
    """
    스마트 스킵 및 비정상 음수 역전 감지(Negative Diff Anomaly) 기능이 적용된 통합 DB 백업 함수.

    1. Cooldown 검사: 기본 1시간 (cooldown_hours=1.0) 이내면 건너뜀 (force=True 시 무시)
    2. Smart Skip 검사: 이전 최신 백업과 현재 DB의 행 수, max_id, max_timestamp가 동일하면 회전 없이 건너뜀
    3. Negative Diff Anomaly 검사: 현재 DB 행 수가 이전 백업보다 적은 경우,
       정상 승인된 삭제 건수를 제외하고도 유실이 의심되면:
       🛑 백업을 즉각 중단하고, 과거 백업본을 100% 동결 보존하며, 모바일 앱으로 비상 경보 발송!
    4. 임시 파일 백업 후 무결성 검사(PRAGMA integrity_check) 검증 완료 후 원자적 교체
    5. 검증 완료된 새 백업이 생성된 경우에만 안전하게 이전 백업 회전(최신 5개 보존)
    """
    os.makedirs(backup_dir, exist_ok=True)
    now = time.time()

    if cooldown_days is not None:
        cooldown_seconds = cooldown_days * 86400.0
    else:
        cooldown_seconds = cooldown_hours * 3600.0

    latest_info = get_latest_backup_info(backup_dir)

    # 1. 쿨다운 검사
    if not force and latest_info:
        latest_file, latest_mtime = latest_info
        elapsed = now - latest_mtime
        if elapsed < cooldown_seconds:
            mins_left = (cooldown_seconds - elapsed) / 60.0
            msg = f"최근 백업({latest_file}) 후 쿨다운 대기 중입니다. (약 {mins_left:.0f}분 후 다음 자동 점검)"
            logger.debug(f"[DB Backup] Cooldown active: {msg}")
            return {
                "created": False,
                "backup_file": latest_file,
                "message": msg
            }

    # 현재 DB 메트릭 조회
    curr_metrics = get_db_metrics(src_db_path)
    if not curr_metrics:
        logger.error(f"[DB Backup] 현재 DB 메트릭을 읽을 수 없습니다: {src_db_path}")
        return {
            "created": False,
            "error": "cannot_read_source_metrics",
            "message": "현재 DB 메트릭을 읽을 수 없어 백업을 중단합니다."
        }

    curr_rows, curr_max_id, curr_max_ts = curr_metrics

    # 2. 직전 백업 메트릭과의 비교 (스마트 스킵 & 음수 역전 감지)
    if latest_info:
        latest_file, latest_mtime = latest_info
        latest_path = os.path.join(backup_dir, latest_file)
        prev_metrics = get_db_metrics(latest_path)

        if prev_metrics:
            prev_rows, prev_max_id, prev_max_ts = prev_metrics

            # (A) 스마트 스킵: 변동 사항이 전혀 없는 경우
            if not force and (curr_rows, curr_max_id, curr_max_ts) == (prev_rows, prev_max_id, prev_max_ts):
                skip_msg = f"[Smart Skip] DB 내용 변동 없음 (총 {curr_rows:,}건, max_id={curr_max_id}). 불필요한 백업 회전 스킵."
                logger.info(skip_msg)
                return {
                    "created": False,
                    "skipped": True,
                    "backup_file": latest_file,
                    "message": skip_msg
                }

            # (B) 음수 역전 감지 (Negative Diff Anomaly)
            if curr_rows < prev_rows:
                decrease = prev_rows - curr_rows
                legit_deletions = get_legitimate_deletions_since(latest_mtime)
                unaccounted = decrease - legit_deletions

                if unaccounted > 0:
                    alert_title = "🚨 [DB 긴급 경보] 데이터 비정상 감소 감지!"
                    alert_msg = (
                        f"현재 DB({curr_rows:,}건)가 이전 백업({prev_rows:,}건) 대비 {unaccounted:,}건 "
                        f"미확인 감소(유실 의심)되었습니다. 백업을 즉각 중단하고 기존 백업본을 동결 보존합니다."
                    )
                    logger.critical(
                        f"[CRITICAL DB BACKUP ABORT] {alert_msg} "
                        f"(총 감소: {decrease:,}건, 정상 기록 삭제: {legit_deletions:,}건)"
                    )

                    # 모바일 앱 / 웹 SSE 긴급 알림 브로드캐스트
                    try:
                        from server.notifications import record_notification
                        record_notification(
                            title=alert_title,
                            message=alert_msg,
                            event_type="db_alert",
                            priority="urgent"
                        )
                    except Exception as ne:
                        logger.error(f"[DB Backup] 긴급 경보 알림 발송 실패: {ne}")

                    return {
                        "created": False,
                        "aborted": True,
                        "reason": "negative_diff_anomaly",
                        "curr_rows": curr_rows,
                        "prev_rows": prev_rows,
                        "unaccounted": unaccounted,
                        "message": alert_msg
                    }

    # 3. 신규 백업 수행 (임시 파일에 먼저 기록 후 무결성 검증)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"translations_backup_{timestamp}.db"
    backup_path = os.path.join(backup_dir, backup_filename)
    temp_backup_path = f"{backup_path}.tmp"

    try:
        if os.path.exists(temp_backup_path):
            os.remove(temp_backup_path)

        perform_sqlite_backup(src_db_path, temp_backup_path)

        # 무결성 검사
        chk_conn = sqlite3.connect(f"file:{os.path.abspath(temp_backup_path)}?mode=ro", uri=True, timeout=15)
        chk_cur = chk_conn.cursor()
        chk_cur.execute("PRAGMA integrity_check")
        chk_res = chk_cur.fetchone()[0]
        chk_conn.close()

        if chk_res != "ok":
            if os.path.exists(temp_backup_path):
                os.remove(temp_backup_path)
            raise ValueError(f"신규 백업본 무결성 검사 실패: {chk_res}")

        # 원자적 파일 교체
        os.replace(temp_backup_path, backup_path)
        logger.info(f"[DB Backup] 안전 검증 완료된 신규 백업 생성 성공: {backup_filename} ({curr_rows:,}건)")
    except Exception as e:
        logger.error(f"[DB Backup] 백업 생성 실패: {e}")
        if os.path.exists(temp_backup_path):
            try:
                os.remove(temp_backup_path)
            except Exception:
                pass
        raise e

    # 4. 검증 완료된 경우에만 안전하게 이전 백업 회전
    rotate_backups(backup_dir, max_backups=max_backups)

    return {
        "created": True,
        "backup_file": backup_filename,
        "curr_rows": curr_rows,
        "message": f"새 백업이 안전하게 생성되었습니다: {backup_filename} ({curr_rows:,}건)"
    }
