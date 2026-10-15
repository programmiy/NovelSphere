import os
import sqlite3
import pytest
from sqlalchemy import create_engine, text
from server.database import (
    _sqlite_authorizer,
    attach_engine_safety_guards,
    PROTECTED_TABLES,
    SessionLocal
)
from server.models import Translation
from server.backup_utils import (
    create_unified_backup,
    record_legitimate_deletion,
    get_legitimate_deletions_since
)

def test_drop_table_blocked_on_protected_tables():
    """핵심 테이블에 대한 DROP TABLE 명령이 SQLite Authorizer에 의해 원천 거부되는지 검증."""
    conn = sqlite3.connect(":memory:")
    # 모든 보호 대상 테이블 생성
    for tbl in ("translations", "applied_urls", "glossary", "trash_translations"):
        conn.execute(f"CREATE TABLE {tbl} (id INT, text TEXT)")
    conn.execute("CREATE TABLE temp_scratch (id INT)")

    conn.set_authorizer(_sqlite_authorizer)

    # 비보호 임시 테이블은 정상 드롭 가능해야 함
    conn.execute("DROP TABLE temp_scratch")

    # 보호 대상 테이블 드롭 시도 시 반드시 'not authorized' 예외 발생해야 함
    for tbl in ("translations", "applied_urls", "glossary", "trash_translations"):
        with pytest.raises(sqlite3.DatabaseError) as exc_info:
            conn.execute(f"DROP TABLE {tbl}")
        assert "not authorized" in str(exc_info.value).lower()

    conn.close()

def test_mass_delete_without_where_blocked():
    """translations 테이블 대상 WHERE 절 없는 전건 DELETE가 SQLAlchemy 이벤트에서 차단되는지 검증."""
    test_eng = create_engine("sqlite:///:memory:")
    attach_engine_safety_guards(test_eng)

    with test_eng.begin() as conn:
        conn.execute(text("CREATE TABLE translations (id INT, original TEXT, translated TEXT)"))

    # 1. WHERE 없는 전건 삭제 시도 -> PermissionError 발생 확인
    with pytest.raises(PermissionError) as exc_info:
        with test_eng.begin() as conn:
            conn.execute(text("DELETE FROM translations"))
    assert "without WHERE is strictly forbidden" in str(exc_info.value)

    # 2. WHERE 1=1 무력화 시도 -> PermissionError 발생 확인
    with pytest.raises(PermissionError) as exc_info2:
        with test_eng.begin() as conn:
            conn.execute(text("DELETE FROM translations WHERE 1=1"))
    assert "Trivial WHERE condition" in str(exc_info2.value)

    # 3. 안전한 조건부 DELETE (WHERE id = 999) -> 정상 통과 확인
    with test_eng.begin() as conn:
        result = conn.execute(text("DELETE FROM translations WHERE id = 999"))
        assert result.rowcount == 0

def test_legitimate_crud_operations_work_normally():
    """기존 서비스들의 정상적인 INSERT, UPDATE, 조건부 DELETE 처리가 정상 동작하는지 검증."""
    db = SessionLocal()
    try:
        # 1. INSERT (번역 저장)
        item = Translation(
            url="http://test-safety-guard.com/1",
            pid="p1",
            original="テスト本文_안전검증",
            translated="테스트 본문_안전검증",
            timestamp=12345678,
            folderName="테스트소설",
            title="제1화"
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        assert item.id is not None
        test_id = item.id

        # 2. UPDATE (수정)
        item.translated = "수정된 안전검증 본문"
        db.commit()

        queried = db.query(Translation).filter(Translation.id == test_id).first()
        assert queried is not None
        assert queried.translated == "수정된 안전검증 본문"

        # 3. Targeted DELETE (특정 항목 삭제)
        db.delete(queried)
        db.commit()

        deleted = db.query(Translation).filter(Translation.id == test_id).first()
        assert deleted is None
    finally:
        db.close()

def test_legitimate_deletion_ledger():
    """정상 삭제 기록 장부(Ledger)가 정상 작동하는지 검증."""
    start_time = 1000.0
    record_legitimate_deletion(5, reason="test_delete_1")
    record_legitimate_deletion(10, reason="test_delete_2")

    total = get_legitimate_deletions_since(start_time)
    assert total >= 15

def test_smart_skip_and_negative_diff_backup(tmp_path):
    """백업 시스템의 스마트 스킵 및 음수 역전 감지(Negative Diff)가 정상 동작하는지 검증."""
    db_file = tmp_path / "translations.db"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()

    # 1. 초기 DB 생성 (10개 행)
    conn = sqlite3.connect(db_file)
    conn.execute("CREATE TABLE translations (id INTEGER PRIMARY KEY, timestamp INT, original TEXT)")
    for i in range(1, 11):
        conn.execute("INSERT INTO translations (id, timestamp, original) VALUES (?, ?, ?)", (i, 1000 + i, f"text_{i}"))
    conn.commit()
    conn.close()

    # 첫 백업 생성
    res1 = create_unified_backup(str(db_file), str(backup_dir), force=True)
    assert res1["created"] is True
    assert res1["curr_rows"] == 10

    # 2. 내용 변경 없이 두 번째 백업 시도 -> 스마트 스킵 확인!
    res2 = create_unified_backup(str(db_file), str(backup_dir), force=False, cooldown_hours=0.0)
    assert res2["created"] is False
    assert res2.get("skipped") is True
    assert "Smart Skip" in res2["message"] or "스마트 스킵" in res2["message"]

    # 3. DB에서 3개 행 임의 삭제 (10 -> 7개로 감소) 후 비정상 음수 역전 감지 확인!
    conn = sqlite3.connect(db_file)
    conn.execute("DELETE FROM translations WHERE id IN (8, 9, 10)")
    conn.commit()
    conn.close()

    res3 = create_unified_backup(str(db_file), str(backup_dir), force=False, cooldown_hours=0.0)
    assert res3["created"] is False
    assert res3.get("aborted") is True
    assert res3.get("reason") == "negative_diff_anomaly"
    assert res3["unaccounted"] == 3
