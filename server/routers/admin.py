from typing import Optional
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


@router.get(
    "/admin/analytics",
    tags=["Admin"],
    summary="번역 활동 및 품질 심층 통계 분석 데이터 조회",
    description="작품별/전체 번역량, 일별 추이, 24시간 활동 프로필, 품질 건강도, 길이 분포, 규모 환산 데이터를 종합 산출합니다."
)
def get_admin_analytics(folder_name: Optional[str] = None):
    from typing import Optional
    import datetime

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    try:
        is_all = not folder_name or folder_name == "__all__"
        target_folder = None if is_all else folder_name

        where_clause = ""
        params = []
        if target_folder:
            where_clause = "WHERE folderName = ?"
            params = [target_folder]

        # 1. 종합 요약 (Summary)
        summary_query = f"""
        SELECT 
            COUNT(DISTINCT folderName) as total_books,
            COUNT(DISTINCT url) as total_episodes,
            COUNT(*) as total_paragraphs,
            COALESCE(SUM(LENGTH(translated)), 0) as total_kr_chars,
            COALESCE(SUM(LENGTH(original)), 0) as total_jp_chars
        FROM translations
        {where_clause}
        """
        cursor.execute(summary_query, params)
        sum_row = cursor.fetchone()
        total_books = sum_row[0] or 0
        total_episodes = sum_row[1] or 0
        total_paragraphs = sum_row[2] or 0
        total_kr_chars = sum_row[3] or 0
        total_jp_chars = sum_row[4] or 0

        avg_chars_per_para = round(total_kr_chars / total_paragraphs, 1) if total_paragraphs else 0.0
        avg_paras_per_ep = round(total_paragraphs / total_episodes, 1) if total_episodes else 0.0
        avg_chars_per_ep = round(total_kr_chars / total_episodes, 1) if total_episodes else 0.0
        expansion_ratio = round(total_kr_chars / total_jp_chars, 2) if total_jp_chars else 1.16

        # 2. 일별 활동 추이 (Daily Trends)
        daily_where = f"WHERE timestamp > 0 {'AND folderName = ?' if target_folder else ''}"
        daily_query = f"""
        SELECT 
            DATE(timestamp, 'unixepoch', 'localtime') as date_str,
            COUNT(*) as count,
            COALESCE(SUM(LENGTH(translated)), 0) as kr_chars,
            COALESCE(SUM(LENGTH(original)), 0) as jp_chars
        FROM translations
        {daily_where}
        GROUP BY date_str
        ORDER BY date_str ASC
        """
        cursor.execute(daily_query, params)
        daily_rows = cursor.fetchall()
        
        daily_trends = [
            {"date": r[0], "count": r[1], "kr_chars": r[2], "jp_chars": r[3]}
            for r in daily_rows if r[0]
        ]

        # KPI 산출
        peak_count = 0
        peak_date = "-"
        if daily_trends:
            peak_item = max(daily_trends, key=lambda x: x["count"])
            peak_count = peak_item["count"]
            peak_date = peak_item["date"]

        active_days_count = len(daily_trends)
        daily_avg_count = round(total_paragraphs / active_days_count) if active_days_count else 0
        daily_avg_chars = round(total_kr_chars / active_days_count) if active_days_count else 0

        # 최근 7일 생산량
        last_7_trends = daily_trends[-7:] if len(daily_trends) >= 7 else daily_trends
        last_7d_count = sum(d["count"] for d in last_7_trends)
        last_7d_chars = sum(d["kr_chars"] for d in last_7_trends)

        # 연속 번역일수 (Streak)
        streak_days = 0
        if daily_trends:
            dates_set = {d["date"] for d in daily_trends}
            check_date = datetime.date.today()
            # 오늘 번역이 없으면 어제부터 역산
            if check_date.isoformat() not in dates_set:
                check_date = check_date - datetime.timedelta(days=1)
            while check_date.isoformat() in dates_set:
                streak_days += 1
                check_date = check_date - datetime.timedelta(days=1)

        # 3. 24시간 시간대별 활동 프로필 (Hourly Distribution)
        hourly_query = f"""
        SELECT 
            CAST(STRFTIME('%H', timestamp, 'unixepoch', 'localtime') AS INTEGER) as hour_num,
            COUNT(*) as count
        FROM translations
        {daily_where}
        GROUP BY hour_num
        ORDER BY hour_num ASC
        """
        cursor.execute(hourly_query, params)
        hourly_rows = cursor.fetchall()
        hourly_map = {r[0]: r[1] for r in hourly_rows}
        hourly_distribution = [hourly_map.get(h, 0) for h in range(24)]
        
        peak_hour = 0
        peak_hour_count = 0
        if any(hourly_distribution):
            peak_hour = max(range(24), key=lambda h: hourly_distribution[h])
            peak_hour_count = hourly_distribution[peak_hour]

        # 4. 품질 & 데이터 건강도 (Quality & Health)
        empty_where = f"WHERE (translated IS NULL OR TRIM(translated) = '') {'AND folderName = ?' if target_folder else ''}"
        cursor.execute(f"SELECT COUNT(*) FROM translations {empty_where}", params)
        empty_count = cursor.fetchone()[0] or 0

        normal_count = max(0, total_paragraphs - empty_count)
        normal_rate = round((normal_count / total_paragraphs) * 100, 1) if total_paragraphs else 100.0
        empty_rate = round((empty_count / total_paragraphs) * 100, 1) if total_paragraphs else 0.0

        # 웹페이지 적용률
        cursor.execute("SELECT COUNT(DISTINCT url) FROM applied_urls")
        applied_urls_count = cursor.fetchone()[0] or 0
        applied_rate = round((applied_urls_count / max(total_episodes, 1)) * 100, 1)

        # 문단 길이 5구간 분포
        len_where = f"WHERE translated IS NOT NULL AND TRIM(translated) != '' {'AND folderName = ?' if target_folder else ''}"
        len_query = f"""
        SELECT 
            SUM(CASE WHEN LENGTH(translated) <= 30 THEN 1 ELSE 0 END),
            SUM(CASE WHEN LENGTH(translated) BETWEEN 31 AND 80 THEN 1 ELSE 0 END),
            SUM(CASE WHEN LENGTH(translated) BETWEEN 81 AND 150 THEN 1 ELSE 0 END),
            SUM(CASE WHEN LENGTH(translated) BETWEEN 151 AND 300 THEN 1 ELSE 0 END),
            SUM(CASE WHEN LENGTH(translated) > 300 THEN 1 ELSE 0 END)
        FROM translations
        {len_where}
        """
        cursor.execute(len_query, params)
        len_row = cursor.fetchone() or (0, 0, 0, 0, 0)
        c1, c2, c3, c4, c5 = len_row[0] or 0, len_row[1] or 0, len_row[2] or 0, len_row[3] or 0, len_row[4] or 0
        valid_paras = max(total_paragraphs, 1)
        length_distribution = [
            {"tier": 1, "label": "초단문 (0~30자)", "count": c1, "pct": round((c1 / valid_paras) * 100, 1), "desc": "짧은 감탄사, 외마디 대사"},
            {"tier": 2, "label": "단문 (31~80자)", "count": c2, "pct": round((c2 / valid_paras) * 100, 1), "desc": "일반 일상 대화문, 짧은 묘사"},
            {"tier": 3, "label": "표준 (81~150자)", "count": c3, "pct": round((c3 / valid_paras) * 100, 1), "desc": "웹소설 표준 서술 및 연속 대화"},
            {"tier": 4, "label": "장문 (151~300자)", "count": c4, "pct": round((c4 / valid_paras) * 100, 1), "desc": "상황/풍경 묘사, 독백 및 설명"},
            {"tier": 5, "label": "초장문 (301자 이상)", "count": c5, "pct": round((c5 / valid_paras) * 100, 1), "desc": "복합 서술 단락, 대형 지문"}
        ]

        # 데이터 위생 상태
        trash_where = f"WHERE folderName = ?" if target_folder else ""
        trash_params = [target_folder] if target_folder else []
        cursor.execute(f"SELECT COUNT(*) FROM translation_trash {trash_where}", trash_params)
        trash_count = cursor.fetchone()[0] or 0

        cursor.execute("SELECT COUNT(*) FROM excluded_sentences")
        whitelist_count = cursor.fetchone()[0] or 0

        cursor.execute("SELECT COUNT(*) FROM translations WHERE folderName IS NULL OR TRIM(folderName) = '' OR folderName = '미분류'")
        pending_folder_count = cursor.fetchone()[0] or 0

        abnormal_total_count = trash_count
        abnormal_rate = round((abnormal_total_count / max(total_paragraphs, 1)) * 100, 2)

        # 종합 데이터 건강도 점수 (100점 만점)
        health_score = int(max(0, min(100, round(100 - (empty_rate * 2.5) - (abnormal_rate * 5)))))

        # 5. 작품별 심층 랭킹 (Novels Ranking)
        novels_query = """
        SELECT 
            COALESCE(folderName, '미분류') as novel_name,
            COUNT(DISTINCT url) as ep_count,
            COUNT(*) as para_count,
            COALESCE(SUM(LENGTH(translated)), 0) as char_count
        FROM translations
        GROUP BY novel_name
        ORDER BY para_count DESC
        """
        cursor.execute(novels_query)
        novel_rows = cursor.fetchall()
        
        novels_ranking = []
        for rank, nr in enumerate(novel_rows, 1):
            n_name, n_eps, n_paras, n_chars = nr[0], nr[1], nr[2], nr[3]
            avg_p = round(n_paras / max(n_eps, 1), 1)
            share = round((n_paras / max(total_paragraphs, 1)) * 100, 1)
            novels_ranking.append({
                "rank": rank,
                "name": n_name,
                "episode_count": n_eps,
                "paragraph_count": n_paras,
                "total_chars": n_chars,
                "avg_paragraphs_per_ep": avg_p,
                "share_pct": share
            })

        # 6. 번역 규모 & 독서 환산 (Reading Scale)
        scale_books = round(total_kr_chars / 100000, 1)
        scale_manuscript = round(total_kr_chars / 200)
        reading_hours_fast = round(total_kr_chars / (800 * 60), 1)
        reading_hours_standard = round(total_kr_chars / (500 * 60), 1)
        reading_hours_slow = round(total_kr_chars / (350 * 60), 1)
        reading_days = round(reading_hours_standard / 24, 1)

        fit_badge = "최적 (3,000~4,500자 표준)"
        if avg_chars_per_ep < 2500:
            fit_badge = "가벼운 분량 (2,500자 미만)"
        elif avg_chars_per_ep > 5000:
            fit_badge = "밀도 높은 분량 (5,000자 초과)"

        return {
            "status": "success",
            "scope": target_folder or "전체",
            "summary": {
                "total_books": total_books,
                "total_episodes": total_episodes,
                "total_paragraphs": total_paragraphs,
                "total_kr_chars": total_kr_chars,
                "total_jp_chars": total_jp_chars,
                "avg_chars_per_paragraph": avg_chars_per_para,
                "avg_paragraphs_per_episode": avg_paras_per_ep,
                "avg_chars_per_episode": avg_chars_per_ep,
                "expansion_ratio": expansion_ratio
            },
            "activity": {
                "daily_avg_count": daily_avg_count,
                "daily_avg_chars": daily_avg_chars,
                "peak_count": peak_count,
                "peak_date": peak_date,
                "streak_days": streak_days,
                "last_7d_count": last_7d_count,
                "last_7d_chars": last_7d_chars,
                "daily_trends": daily_trends,
                "hourly_distribution": hourly_distribution,
                "peak_hour": peak_hour,
                "peak_hour_count": peak_hour_count
            },
            "quality": {
                "health_score": health_score,
                "normal_rate": normal_rate,
                "empty_count": empty_count,
                "empty_rate": empty_rate,
                "abnormal_rate": abnormal_rate,
                "applied_rate": applied_rate,
                "length_distribution": length_distribution,
                "abnormal_total_count": abnormal_total_count,
                "whitelist_count": whitelist_count,
                "trash_total_count": trash_count,
                "pending_folder_count": pending_folder_count
            },
            "novels": novels_ranking,
            "scale": {
                "kr_chars": total_kr_chars,
                "jp_chars": total_jp_chars,
                "books_count": scale_books,
                "manuscript_count": scale_manuscript,
                "reading_hours": reading_hours_standard,
                "reading_days": reading_days,
                "pace_fast_hours": reading_hours_fast,
                "pace_standard_hours": reading_hours_standard,
                "pace_slow_hours": reading_hours_slow,
                "avg_chars_per_chapter": avg_chars_per_ep,
                "avg_paragraphs_per_chapter": avg_paras_per_ep,
                "novel_fit_badge": fit_badge
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"통계 분석 산출 중 오류 발생: {e}")
    finally:
        conn.close()