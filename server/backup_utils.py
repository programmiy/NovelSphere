import os
import time
import sqlite3
import logging
from datetime import datetime
from typing import Optional, Tuple, Dict, Any

logger = logging.getLogger(__name__)


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


def rotate_backups(backup_dir: str, max_backups: int = 3):
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
            # Sort by file modification time (most recent first)
            backup_files_with_time = []
            for f in backup_files:
                full_path = os.path.join(backup_dir, f)
                try:
                    mtime = os.path.getmtime(full_path)
                except OSError:
                    mtime = 0.0
                backup_files_with_time.append((f, mtime))

            # Sort descending by mtime (newest first)
            backup_files_with_time.sort(key=lambda x: x[1], reverse=True)

            files_to_delete = backup_files_with_time[max_backups:]
            for file_name, _ in files_to_delete:
                file_path = os.path.join(backup_dir, file_name)
                try:
                    os.remove(file_path)
                    logger.info(f"[Backup Rotation] Deleted old backup: {file_name}")
                except Exception as del_err:
                    logger.warning(f"[Backup Rotation] Failed to delete old backup {file_name}: {del_err}")
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
    cooldown_days: float = 3.0,
    max_backups: int = 3
) -> Dict[str, Any]:
    """
    Creates a unified SQLite database backup with cooldown check and automatic rotation.

    - Uniform naming: translations_backup_YYYYMMDD_HHMMSS.db
    - Cooldown: Skips creation if the latest backup is younger than cooldown_days (default 3 days),
      unless force=True.
    - Rotation: Automatically keeps only the latest max_backups (default 3).

    Returns a dict with:
        created (bool): Whether a new backup was physically generated.
        backup_file (str): Filename of the newest or newly created backup.
        message (str): Explanatory status message.
    """
    os.makedirs(backup_dir, exist_ok=True)
    now = time.time()
    cooldown_seconds = cooldown_days * 86400.0

    latest_info = get_latest_backup_info(backup_dir)
    if not force and latest_info:
        latest_file, latest_mtime = latest_info
        elapsed = now - latest_mtime
        if elapsed < cooldown_seconds:
            days_left = (cooldown_seconds - elapsed) / 86400.0
            msg = f"최근 {cooldown_days:.1f}일 이내 백업({latest_file})이 존재하여 생성을 건너뜁니다. (약 {days_left:.1f}일 후 다음 자동 백업)"
            logger.info(f"[DB Backup] Cooldown active: {msg}")
            return {
                "created": False,
                "backup_file": latest_file,
                "message": msg
            }

    # Perform new backup
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"translations_backup_{timestamp}.db"
    backup_path = os.path.join(backup_dir, backup_filename)

    try:
        perform_sqlite_backup(src_db_path, backup_path)
        logger.info(f"[DB Backup] Successfully created unified backup at {backup_path}")
    except Exception as e:
        logger.error(f"[DB Backup] Backup creation failed: {e}")
        raise e

    # Apply rotation to keep max_backups
    rotate_backups(backup_dir, max_backups=max_backups)

    return {
        "created": True,
        "backup_file": backup_filename,
        "message": f"새 백업이 생성되었습니다: {backup_filename}"
    }
