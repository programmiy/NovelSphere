import os
import io
import gzip
import zlib
import json
import time
import sqlite3
import logging
from collections import defaultdict
from typing import List, Optional, Dict, Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Depends, Request, Response, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from server.settings import settings
from server.database import get_db, get_sqlite_conn, dict_factory, get_db_path
from server.models import Translation, BookActivity, PinnedBook, Tag, BookTag
from server.routers.translation import FindReplaceRequest, find_replace_all

router = APIRouter(prefix="/api/sync", tags=["Mobile Sync"])
logger = logging.getLogger(__name__)

# 임시 생성된 시드 파일 경로 추적 (다운로드 완료 후 삭제용)
_ACTIVE_TEMP_PACKS: Dict[str, str] = {}

class LocalChangeItem(BaseModel):
    id: Optional[int] = None
    url: Optional[str] = None
    pid: Optional[str] = None
    original: Optional[str] = None
    translated: str
    timestamp: int
    title: Optional[str] = None
    folderName: Optional[str] = None

class ActivitySyncItem(BaseModel):
    folderName: str
    last_read_timestamp: Optional[int] = None
    last_read_pid: Optional[str] = None
    last_read_chapter_title: Optional[str] = None
    is_completed: Optional[int] = 0
    is_visible: Optional[int] = 1
    is_bookmarked: Optional[int] = 0
    notes: Optional[str] = None
    summary: Optional[str] = None

class ReadingLogItem(BaseModel):
    date: str # YYYY-MM-DD
    read_seconds: int
    pages_count: int
    book_title: Optional[str] = None
    chapter_title: Optional[str] = None

class PushPayload(BaseModel):
    client_id: Optional[str] = None
    push_timestamp: int
    modified_translations: Optional[List[LocalChangeItem]] = []
    activities: Optional[List[ActivitySyncItem]] = []
    reading_logs: Optional[List[ReadingLogItem]] = []
    glossary_rules: Optional[List[Dict[str, Any]]] = []

@router.get("/ping")
def ping_sync_server():
    """
    모바일 앱이 지정된 Wi-Fi 환경에서 PC 서버와의 통신 가능 여부를 0.05초 만에 확인하는 핑 엔드포인트
    """
    conn = get_sqlite_conn()
    cursor = conn.cursor()
    cursor.execute("SELECT MAX(timestamp) FROM translations")
    latest_trans_ts = cursor.fetchone()[0] or int(time.time())
    cursor.execute("SELECT COUNT(*) FROM translations")
    total_count = cursor.fetchone()[0]
    conn.close()

    return {
        "status": "online",
        "app_name": "LANOVEL",
        "server_time": int(time.time()),
        "latest_translation_ts": latest_trans_ts,
        "total_translations": total_count,
        "version": "mobile-sync-v1"
    }

def _build_mobile_optimized_db(temp_db_path: str):
    """
    PC의 340MB DB에서 불필요한 테이블/컬럼을 제거하고,
    챕터 단위로 본문을 zlib 압축한 초경량 하이브리드 SQLite DB를 생성합니다.
    (모바일 내에서 약 35MB 크기로 보관되며 챕터 오픈 시 1ms 이내 초고속 압축 해제 가능)
    """
    if os.path.exists(temp_db_path):
        try:
            os.remove(temp_db_path)
        except Exception:
            pass

    src_conn = sqlite3.connect(get_db_path(), timeout=30)
    src_conn.row_factory = dict_factory
    dst_conn = sqlite3.connect(temp_db_path)

    # 1. 모바일 최적화 스키마 구축
    dst_conn.executescript("""
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = WAL;

        -- 책 메타데이터 테이블 (비압축 인덱스, 0ms 즉시 로딩)
        CREATE TABLE books (
            folder_name TEXT PRIMARY KEY,
            total_chapters INTEGER DEFAULT 0,
            last_read_chapter_title TEXT,
            last_read_pid TEXT,
            last_read_timestamp INTEGER,
            is_completed INTEGER DEFAULT 0,
            is_visible INTEGER DEFAULT 1,
            is_bookmarked INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            notes TEXT,
            summary TEXT,
            tags TEXT
        );
        CREATE INDEX ix_books_pinned ON books(is_pinned);
        CREATE INDEX ix_books_visible ON books(is_visible);
        CREATE INDEX ix_books_last_read ON books(last_read_timestamp);

        -- 챕터 목록 및 본문 압축 BLOB 테이블
        CREATE TABLE chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_name TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            sentence_count INTEGER DEFAULT 0,
            compressed_content BLOB NOT NULL
        );
        CREATE INDEX ix_chapters_book ON chapters(book_name);
        CREATE INDEX ix_chapters_book_sort ON chapters(book_name, sort_order);

        -- 독서 통계 및 캘린더 히트맵 테이블
        CREATE TABLE reading_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            read_seconds INTEGER DEFAULT 0,
            pages_count INTEGER DEFAULT 0,
            book_title TEXT,
            chapter_title TEXT,
            created_at INTEGER
        );
        CREATE INDEX ix_reading_logs_date ON reading_logs(date);

        -- 오프라인 일괄 찾아바꾸기 (용어 사전) 규칙 테이블
        CREATE TABLE local_glossary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_scope TEXT DEFAULT '__all__',
            find_text TEXT NOT NULL,
            replace_text TEXT NOT NULL,
            use_regex INTEGER DEFAULT 0,
            case_sensitive INTEGER DEFAULT 0,
            applied_at INTEGER
        );

        -- 오프라인 로컬 변경사항 큐 (서버 연결 시 업로드 후 비워짐)
        CREATE TABLE offline_change_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            change_type TEXT NOT NULL,
            target_id TEXT,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    """)

    src_cursor = src_conn.cursor()
    dst_cursor = dst_conn.cursor()

    # 2. 책 목록 & 북마크 & 태그 정보 통합 추출
    src_cursor.execute("SELECT folderName FROM pinned_books")
    pinned_set = {row['folderName'] for row in src_cursor.fetchall()}

    src_cursor.execute("SELECT * FROM book_activity")
    activity_map = {row['folderName']: row for row in src_cursor.fetchall()}

    src_cursor.execute("SELECT bt.book_folderName, t.name FROM book_tags bt JOIN tags t ON bt.tag_id = t.id")
    tags_map = {}
    for row in src_cursor.fetchall():
        tags_map.setdefault(row['book_folderName'], []).append(row['name'])

    # 책별 챕터 수 및 책 목록 취합 (URL 고유 개수 기준)
    src_cursor.execute("""
        SELECT folderName, COUNT(DISTINCT url) as chap_count 
        FROM translations 
        WHERE folderName IS NOT NULL AND url IS NOT NULL AND url != ''
        GROUP BY folderName
    """)
    book_chap_counts = {row['folderName']: row['chap_count'] for row in src_cursor.fetchall()}

    all_books_set = set(book_chap_counts.keys()).union(set(activity_map.keys()))

    book_rows = []
    for f in all_books_set:
        act = activity_map.get(f, {})
        tag_list = tags_map.get(f, [])
        book_rows.append((
            f,
            book_chap_counts.get(f, 0),
            act.get('last_read_chapter_title'),
            act.get('last_read_pid'),
            act.get('last_read_timestamp'),
            act.get('is_completed', 0),
            act.get('is_visible', 1),
            act.get('is_bookmarked', 0),
            1 if f in pinned_set else 0,
            act.get('notes'),
            act.get('summary'),
            json.dumps(tag_list, ensure_ascii=False)
        ))

    dst_cursor.executemany("""
        INSERT INTO books VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    """, book_rows)

    # 3. 챕터별 문장 추출 및 Zlib BLOB 압축 패킹
    # URL(회차) 기준으로 그룹화하여 압축 (회차 분리 및 단락 실종 원천 차단)
    src_cursor.execute("""
        SELECT 
            t1.folderName, 
            t1.url,
            COALESCE(
                (SELECT t2.title FROM translations t2 
                 WHERE t2.url = t1.url AND t2.folderName = t1.folderName AND t2.title IS NOT NULL AND t2.title != ''
                 ORDER BY t2.timestamp DESC LIMIT 1),
                t1.title,
                t1.url
            ) as title,
            MIN(COALESCE(t1.toc_sort_order, 999999)) as sort_order
        FROM translations t1
        WHERE t1.folderName IS NOT NULL AND t1.url IS NOT NULL AND t1.url != ''
        GROUP BY t1.folderName, t1.url
        ORDER BY t1.folderName, sort_order ASC
    """)
    chapters_meta = src_cursor.fetchall()

    # 4. 단 1회의 Bulk 쿼리로 모든 회차 문장 일괄 로드 (N+1 쿼리 폭포 완전 제거)
    src_cursor.execute("""
        SELECT folderName, url, id, pid, original, translated, timestamp
        FROM translations
        WHERE folderName IS NOT NULL AND url IS NOT NULL AND url != ''
        ORDER BY folderName, url,
                 CASE WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%' 
                      THEN CAST(SUBSTR(pid, 2) AS INTEGER) 
                      ELSE 999999 END ASC, timestamp ASC
    """)

    sentences_by_chap = defaultdict(list)
    for row in src_cursor:
        sentences_by_chap[(row['folderName'], row['url'])].append({
            'id': row['id'],
            'pid': row['pid'],
            'original': row['original'],
            'translated': row['translated'],
            'timestamp': row['timestamp']
        })

    # 5. 챕터 순서(sort_order ASC)를 완벽히 유지하며 zlib 압축 및 배치 executemany 일괄 적재
    chapter_rows = []
    for chap in chapters_meta:
        b_name = chap['folderName']
        c_title = chap['title']
        c_url = chap['url']
        s_order = chap['sort_order']

        sentences = sentences_by_chap.get((b_name, c_url), [])
        raw_json = json.dumps(sentences, ensure_ascii=False).encode('utf-8')
        compressed_blob = zlib.compress(raw_json, level=6)

        chapter_rows.append((b_name, c_title, c_url, s_order, len(sentences), compressed_blob))
        if len(chapter_rows) >= 300:
            dst_cursor.executemany("""
                INSERT INTO chapters (book_name, title, url, sort_order, sentence_count, compressed_content)
                VALUES (?, ?, ?, ?, ?, ?)
            """, chapter_rows)
            chapter_rows.clear()

    if chapter_rows:
        dst_cursor.executemany("""
            INSERT INTO chapters (book_name, title, url, sort_order, sentence_count, compressed_content)
            VALUES (?, ?, ?, ?, ?, ?)
        """, chapter_rows)
        chapter_rows.clear()

    del sentences_by_chap

    dst_conn.commit()
    dst_conn.execute("VACUUM")

    src_conn.close()
    dst_conn.close()
    logger.info(f"Built mobile seed DB at {temp_db_path}, size: {os.path.getsize(temp_db_path) / (1024*1024):.2f} MB")


def _get_temp_sync_dir() -> str:
    base_dir = getattr(settings, 'data_dir', None)
    if not base_dir:
        base_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
    temp_dir = os.path.join(base_dir, "temp_sync")
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


@router.get("/full-pack")
async def download_full_mobile_pack(background_tasks: BackgroundTasks):
    """
    모바일 앱 최초 설치 시 1회 호출되는 전체 압축 패키지 다운로드 엔드포인트.
    사용자의 요청대로, 전송 후 클라이언트의 확인 요청 또는 전송 스트림 완료 시 임시 파일을 안전하게 삭제합니다.
    """
    temp_dir = _get_temp_sync_dir()

    pack_id = f"mobile_seed_{int(time.time())}_{os.getpid()}"
    temp_db_path = os.path.join(temp_dir, f"{pack_id}.db")
    temp_gz_path = os.path.join(temp_dir, f"{pack_id}.db.gz")

    try:
        # 1. 모바일 최적화 하이브리드 DB 빌드
        _build_mobile_optimized_db(temp_db_path)

        # 2. 네트워크 전송량 극소화를 위한 Gzip 압축 (150MB -> 약 26MB)
        with open(temp_db_path, 'rb') as f_in:
            with gzip.open(temp_gz_path, 'wb', compresslevel=6) as f_out:
                while chunk := f_in.read(1024 * 1024):
                    f_out.write(chunk)

        # DB 원본 임시파일은 gz 생성 즉시 삭제
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)

        _ACTIVE_TEMP_PACKS[pack_id] = temp_gz_path

        def iterfile():
            try:
                with open(temp_gz_path, mode="rb") as file_like:
                    while chunk := file_like.read(256 * 1024):
                        yield chunk
            finally:
                # 스트리밍 완료 후 파일 자동 삭제 태스크
                def cleanup():
                    try:
                        if os.path.exists(temp_gz_path):
                            os.remove(temp_gz_path)
                            logger.info(f"Cleaned up temp sync pack: {temp_gz_path}")
                        _ACTIVE_TEMP_PACKS.pop(pack_id, None)
                    except Exception as e:
                        logger.error(f"Error cleaning up sync pack: {e}")
                background_tasks.add_task(cleanup)

        file_size = os.path.getsize(temp_gz_path)
        headers = {
            'Content-Disposition': f'attachment; filename="lanovel_seed_{pack_id}.db.gz"',
            'Content-Length': str(file_size),
            'X-Pack-Id': pack_id,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
        return StreamingResponse(iterfile(), media_type="application/gzip", headers=headers)

    except Exception as e:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
        if os.path.exists(temp_gz_path):
            os.remove(temp_gz_path)
        _ACTIVE_TEMP_PACKS.pop(pack_id, None)
        logger.error(f"Failed to generate mobile sync pack: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"시드 패키지 생성 실패: {e}")


@router.delete("/full-pack/{pack_id}")
def cleanup_temp_pack(pack_id: str):
    """
    모바일 앱에서 다운로드 및 로컬 DB 압축 해제 무결성 확인 후 호출하여
    PC 서버 상의 임시 압축 파일을 즉시 완전히 제거합니다. (사용자 코멘트 반영)
    """
    file_path = _ACTIVE_TEMP_PACKS.pop(pack_id, None)
    if not file_path:
        temp_dir = _get_temp_sync_dir()
        potential_path = os.path.join(temp_dir, f"{pack_id}.db.gz")
        if os.path.exists(potential_path):
            file_path = potential_path

    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
            return {"message": f"패키지 {pack_id} 정리 완료", "status": "deleted"}
        except Exception as e:
            return {"message": f"삭제 오류: {e}", "status": "error"}

    return {"message": "정리할 파일이 이미 없거나 삭제되었습니다.", "status": "not_found"}


@router.get("/pull")
def pull_changes_from_pc(since: int = 0):
    """
    [PC -> 모바일] 증분 동기화:
    지정된 `since` 타임스탬프 이후에 PC에서 신규 추가되거나 변경된 번역문 및 책 활동 정보를 Gzip 압축 JSON으로 반환합니다.
    """
    conn = get_sqlite_conn(as_dict=True)
    cursor = conn.cursor()

    # 1. since 이후 신규/수정된 번역문
    cursor.execute("""
        SELECT id, url, pid, original, translated, timestamp, folderName, title, toc_sort_order
        FROM translations
        WHERE timestamp > ?
        ORDER BY timestamp ASC
        LIMIT 5000
    """, (since,))
    new_translations = cursor.fetchall()

    # 2. since 이후 신규/수정된 회차들의 완전한 챕터 BLOB 패킹 (증분 동기화 시 모바일 챕터 본문 자동 갱신)
    import base64
    updated_url_tuples = list({(t['folderName'], t['url']) for t in new_translations if t.get('folderName') and t.get('url')})
    updated_chapters = []
    for f_name, c_url in updated_url_tuples:
        cursor.execute("""
            SELECT 
                COALESCE(
                    (SELECT t2.title FROM translations t2 
                     WHERE t2.url = ? AND t2.folderName = ? AND t2.title IS NOT NULL AND t2.title != ''
                     ORDER BY t2.timestamp DESC LIMIT 1),
                    MIN(title),
                    ?
                ) as title,
                MIN(COALESCE(toc_sort_order, 999999)) as sort_order
            FROM translations
            WHERE folderName = ? AND url = ?
        """, (c_url, f_name, c_url, f_name, c_url))
        meta = cursor.fetchone()
        if not meta or not meta['title']:
            continue
        c_title = meta['title']
        s_order = meta['sort_order']

        cursor.execute("""
            SELECT id, pid, original, translated, timestamp
            FROM translations
            WHERE folderName = ? AND url = ?
            ORDER BY CASE WHEN lower(pid) LIKE 'p%' OR lower(pid) LIKE 'l%' 
                          THEN CAST(SUBSTR(pid, 2) AS INTEGER) 
                          ELSE 999999 END ASC, timestamp ASC
        """, (f_name, c_url))
        sentences = cursor.fetchall()

        raw_json = json.dumps(sentences, ensure_ascii=False).encode('utf-8')
        compressed_blob = zlib.compress(raw_json, level=6)
        updated_chapters.append({
            "book_name": f_name,
            "title": c_title,
            "url": c_url,
            "sort_order": s_order,
            "sentence_count": len(sentences),
            "compressed_content": base64.b64encode(compressed_blob).decode('ascii')
        })

    # 3. 책 활동 정보 (마지막 읽은 곳, 북마크, 완료 여부 등)
    cursor.execute("SELECT * FROM book_activity WHERE last_read_timestamp > ? OR 1=1", (since,))
    activities = cursor.fetchall()

    # 4. 고정된 책 및 태그
    cursor.execute("SELECT folderName FROM pinned_books")
    pinned = [row['folderName'] for row in cursor.fetchall()]

    cursor.execute("SELECT bt.book_folderName, t.name FROM book_tags bt JOIN tags t ON bt.tag_id = t.id")
    book_tags = defaultdict(list)
    for row in cursor.fetchall():
        book_tags[row['book_folderName']].append(row['name'])

    conn.close()

    payload = {
        "sync_time": int(time.time()),
        "since": since,
        "translations_count": len(new_translations),
        "translations": new_translations,
        "updated_chapters": updated_chapters,
        "activities": activities,
        "pinned_books": pinned,
        "book_tags": dict(book_tags)
    }

    # 압축 전송
    compressed_bytes = gzip.compress(json.dumps(payload, ensure_ascii=False).encode('utf-8'))
    return Response(content=compressed_bytes, media_type="application/gzip")


@router.post("/push")
async def push_changes_to_pc(request: Request, db: Session = Depends(get_db)):
    """
    [모바일 -> PC] 증분 동기화:
    앱에서 오프라인 중 수정한 번역문, 읽은 진도(book_activity), 독서 통계(reading_logs),
    그리고 모바일 '전체 찾아바꾸기' 룰을 압축 수신하여 PC의 SQLite DB에 일괄 Upsert 반영합니다.
    """
    try:
        # 클라이언트가 gzip으로 보낸 경우 자동 압축 해제
        body_bytes = await request.body()
        content_encoding = request.headers.get("content-encoding", "").lower()
        if content_encoding == "gzip" or body_bytes[:2] == b'\x1f\x8b':
            decompressed = gzip.decompress(body_bytes)
            data_dict = json.loads(decompressed.decode('utf-8'))
        else:
            data_dict = json.loads(body_bytes.decode('utf-8'))

        payload = PushPayload(**data_dict)
    except Exception as e:
        logger.error(f"Push sync invalid payload: {e}")
        raise HTTPException(status_code=400, detail=f"데이터 포맷 오류: {e}")

    conn = get_sqlite_conn()
    cursor = conn.cursor()
    updated_trans_count = 0
    updated_act_count = 0

    try:
        # 1. 모바일에서 편집한 번역문 Upsert
        if payload.modified_translations:
            for item in payload.modified_translations:
                if item.id:
                    cursor.execute("""
                        UPDATE translations 
                        SET translated = ?, timestamp = ? 
                        WHERE id = ?
                    """, (item.translated, item.timestamp, item.id))
                    if cursor.rowcount > 0:
                        updated_trans_count += 1
                elif item.url and item.pid:
                    cursor.execute("""
                        UPDATE translations 
                        SET translated = ?, timestamp = ? 
                        WHERE url = ? AND pid = ?
                    """, (item.translated, item.timestamp, item.url, item.pid))
                    if cursor.rowcount > 0:
                        updated_trans_count += 1

        # 2. 독서 활동 정보 동기화 (앱에서 읽은 최신 위치/진도/북마크 우선 반영)
        if payload.activities:
            for act in payload.activities:
                cursor.execute("""
                    INSERT INTO book_activity (
                        folderName, last_read_timestamp, last_read_pid, last_read_chapter_title,
                        is_completed, is_visible, is_bookmarked, notes, summary
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(folderName) DO UPDATE SET
                        last_read_timestamp = COALESCE(excluded.last_read_timestamp, book_activity.last_read_timestamp),
                        last_read_pid = COALESCE(excluded.last_read_pid, book_activity.last_read_pid),
                        last_read_chapter_title = COALESCE(excluded.last_read_chapter_title, book_activity.last_read_chapter_title),
                        is_completed = COALESCE(excluded.is_completed, book_activity.is_completed),
                        is_visible = COALESCE(excluded.is_visible, book_activity.is_visible),
                        is_bookmarked = COALESCE(excluded.is_bookmarked, book_activity.is_bookmarked),
                        notes = COALESCE(excluded.notes, book_activity.notes);
                """, (
                    act.folderName, act.last_read_timestamp, act.last_read_pid, act.last_read_chapter_title,
                    act.is_completed, act.is_visible, act.is_bookmarked, act.notes, act.summary
                ))
                updated_act_count += 1

        conn.commit()

        # 3. 모바일에서 실행한 일괄 찾아바꾸기 룰이 있다면 PC 서버 DB에도 동일하게 적용 (사용자 코멘트 반영)
        applied_rules_count = 0
        if payload.glossary_rules:
            for rule in payload.glossary_rules:
                find_txt = rule.get("find_text")
                repl_txt = rule.get("replace_text", "")
                scope = rule.get("folder_scope")
                if not find_txt:
                    continue

                if scope and scope != '__all__':
                    cursor.execute("""
                        UPDATE translations 
                        SET translated = replace(translated, ?, ?) 
                        WHERE folderName = ? AND instr(translated, ?) > 0
                    """, (find_txt, repl_txt, scope, find_txt))
                else:
                    cursor.execute("""
                        UPDATE translations 
                        SET translated = replace(translated, ?, ?) 
                        WHERE instr(translated, ?) > 0
                    """, (find_txt, repl_txt, find_txt))
                applied_rules_count += 1
            conn.commit()

        logger.info(f"[Sync Push Success] Translations: {updated_trans_count}, Activities: {updated_act_count}, Rules: {applied_rules_count}")
        return {
            "status": "success",
            "server_ack_time": int(time.time()),
            "updated_translations": updated_trans_count,
            "updated_activities": updated_act_count,
            "applied_glossary_rules": applied_rules_count
        }

    except Exception as e:
        conn.rollback()
        logger.error(f"Error executing push sync: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"서버 동기화 반영 중 오류: {e}")
    finally:
        conn.close()


@router.get("/tts-pack")
def get_chapter_tts_audio(book: str, chapter: str):
    """
    [PC -> 모바일 TTS 전송] (사용자 코멘트 반영)
    PC에서 고품질로 생성된 챕터별 TTS 오디오 파일이 보관된 디렉토리에서
    해당 챕터의 오디오(예: mp3/opus)를 압축/스트리밍하여 모바일 앱으로 전송합니다.
    """
    decoded_book = unquote(book)
    decoded_chapter = unquote(chapter)

    # PC 서버 내 TTS 오디오 저장 디렉토리 (기본값: server/tts_cache/)
    base_data = getattr(settings, 'data_dir', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"))
    tts_dir = os.path.join(base_data, "tts_cache", decoded_book)
    safe_filename = "".join(c for c in decoded_chapter if c.isalnum() or c in (' ', '_', '-')).rstrip()
    
    # mp3, m4a, ogg 탐색
    found_path = None
    for ext in [".mp3", ".m4a", ".ogg", ".opus"]:
        candidate = os.path.join(tts_dir, f"{safe_filename}{ext}")
        if os.path.exists(candidate):
            found_path = candidate
            break

    if not found_path:
        raise HTTPException(status_code=404, detail=f"TTS audio not found for book: {decoded_book}, chapter: {decoded_chapter}")

    def iterfile():
        with open(found_path, "rb") as f:
            while chunk := f.read(64 * 1024):
                yield chunk

    media_type = "audio/mpeg" if found_path.endswith(".mp3") else "audio/ogg"
    headers = {
        'Content-Disposition': f'inline; filename="{os.path.basename(found_path)}"',
        'Content-Length': str(os.path.getsize(found_path)),
        'Cache-Control': 'public, max-age=86400'
    }
    return StreamingResponse(iterfile(), media_type=media_type, headers=headers)
