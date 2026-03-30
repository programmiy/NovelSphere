import sqlite3
import os
from fastapi import APIRouter, HTTPException
from urllib.parse import urlparse
from server.settings import settings

router = APIRouter()

def get_db_path():
    parsed_url = urlparse(settings.database_url)
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

@router.post(
    "/admin/cleanup_urls",
    tags=["Admin"],
    summary="URL 조각 정리",
    description="모든 관련 테이블에서 URL 조각(예: #end)을 제거합니다."
)
def cleanup_url_fragments():
    conn = sqlite3.connect(get_db_path(), timeout=15)
    cursor = conn.cursor()
    
    tables_to_clean = ['translations', 'url_metadata', 'applied_urls']
    total_updated = 0

    try:
        for table in tables_to_clean:
            query = f"""UPDATE {table} 
                       SET url = SUBSTR(url, 1, INSTR(url, '#') - 1) 
                       WHERE url LIKE '%#%';"""
            cursor.execute(query)
            total_updated += cursor.rowcount
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
    conn = sqlite3.connect(get_db_path(), timeout=15)
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