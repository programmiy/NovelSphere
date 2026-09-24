from fastapi import APIRouter, HTTPException
from server.database import get_sqlite_conn

router = APIRouter()

@router.post(
    "/admin/cleanup_urls",
    tags=["Admin"],
    summary="URL 조각 정리",
    description="모든 관련 테이블에서 URL 조각(예: #end)을 제거합니다."
)
def cleanup_url_fragments():
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    
    tables_to_clean = ['translations', 'url_metadata', 'applied_urls']
    total_updated = 0

    try:
        for table in tables_to_clean:
            cursor.execute(f"""UPDATE OR IGNORE {table} 
                               SET url = SUBSTR(url, 1, INSTR(url, '#') - 1) 
                               WHERE url LIKE '%#%';""")
            total_updated += cursor.rowcount
            # Clean up remaining records that could not be updated due to conflict
            cursor.execute(f"DELETE FROM {table} WHERE url LIKE '%#%';")
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"An error occurred: {e}")
    finally:
        conn.close()

    return {"message": f"URL cleanup complete. {total_updated} records were updated."}

@router.post(
    "/admin/cleanup_pids",
    tags=["Admin"],
    summary="PID 정리",
    description="'la' 또는 'lp'로 시작하는 PID를 가진 기록을 제외 처리합니다."
)
def cleanup_pids():
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    
    deleted_count = 0
    excluded_count = 0
    
    try:
        conn.execute("BEGIN")

        # 1. 일치하는 레코드를 excluded_sentences 테이블로 복사
        # 이 작업은 메모리에 데이터를 로드하지 않고 DB 내부에서 수행됩니다.
        insert_query = """
        INSERT OR IGNORE INTO excluded_sentences (url, original)
        SELECT url, original FROM translations 
        WHERE lower(pid) GLOB 'la[0-9]*' OR lower(pid) GLOB 'lp[0-9]*';
        """
        cursor.execute(insert_query)
        excluded_count = cursor.rowcount

        # 2. translations 테이블에서 해당 레코드 삭제
        delete_query = """
        DELETE FROM translations 
        WHERE lower(pid) GLOB 'la[0-9]*' OR lower(pid) GLOB 'lp[0-9]*';
        """
        cursor.execute(delete_query)
        deleted_count = cursor.rowcount

        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"An error occurred: {e}")
    finally:
        conn.close()

    if deleted_count == 0:
        return {"message": "제외할 'la' 또는 'lp' PID를 가진 기록이 없습니다."}
        
    return {"message": f"총 {deleted_count}개의 기록을 제외 처리했습니다. (새롭게 제외 목록에 추가된 항목: {excluded_count}개)"}

@router.post(
    "/admin/restore_brackets",
    tags=["Admin"],
    summary="원문 괄호(「%」) 룰베이스 일괄 복원",
    description="원문이 「%」로 둘러싸인 대사 문장 중 번역문에 괄호가 누락되거나 따옴표로 변형된 레코드를 스캔하여 일괄 복원합니다."
)
def admin_restore_brackets():
    from server.rule_classifier import batch_restore_brackets_in_db
    conn = get_sqlite_conn()
    try:
        scanned, updated = batch_restore_brackets_in_db(conn)
        return {
            "status": "success",
            "message": f"괄호 복원 완료: 대상 {scanned}건 검사 중 {updated}건의 번역문 괄호 복원 완료.",
            "scanned_count": scanned,
            "updated_count": updated
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"괄호 복원 중 오류 발생: {e}")
    finally:
        conn.close()