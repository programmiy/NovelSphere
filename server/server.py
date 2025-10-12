import sqlite3
import json
import requests
import time
import os
import asyncio
import re
from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from contextlib import asynccontextmanager 
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import StreamingResponse
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
from collections import defaultdict
from urllib.parse import unquote
from tenacity import retry, stop_after_attempt, wait_exponential, RetryError

DATABASE_FILE = "translations.db"
API_KEY_FILE = "api_key.txt"
script_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(script_dir, "server/static")
templates_dir = os.path.join(script_dir, "server/templates")
def get_api_key():
    """api_key.txt 파일에서 API 키를 읽어옵니다."""
    try:
        with open(API_KEY_FILE, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"{API_KEY_FILE} 파일을 찾을 수 없습니다. API 키를 파일에 저장해주세요.")

def init_db():
    """데이터베이스를 초기화하고 테이블을 생성합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS translations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        pid TEXT,
        original TEXT NOT NULL,
        translated TEXT,
        timestamp INTEGER NOT NULL,
        folderName TEXT,
        UNIQUE(url, pid, original) -- 중복 방지
    );
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_url ON translations (url);");
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_folderName ON translations (folderName);");

    cursor.execute("PRAGMA table_info(translations)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'title' not in columns:
        cursor.execute("ALTER TABLE translations ADD COLUMN title TEXT")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS excluded_sentences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        original TEXT NOT NULL,
        UNIQUE(url, original)
    );
    """
    )
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_excluded_url_original ON excluded_sentences (url, original);")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS pinned_books (
        folderName TEXT PRIMARY KEY
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS book_tags (
        book_folderName TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (book_folderName, tag_id),
        FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS book_activity (
        folderName TEXT PRIMARY KEY,
        last_read_timestamp INTEGER,
        last_read_pid TEXT,
        is_bookmarked INTEGER DEFAULT 0,
        notes TEXT
    );
    """
    )

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS applied_urls (
        url TEXT PRIMARY KEY
    );
    """
    )
    
    # Safely add new columns for summary
    cursor.execute("PRAGMA table_info(book_activity)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'summary' not in columns:
        cursor.execute("ALTER TABLE book_activity ADD COLUMN summary TEXT")
    if 'summary_source_url' not in columns:
        cursor.execute("ALTER TABLE book_activity ADD COLUMN summary_source_url TEXT")

    conn.commit()
    conn.close()

# 스크립트 디렉토리 기준 절대 경로 설정
script_dir = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(script_dir, "static")
templates_dir = os.path.join(script_dir, "templates")

# FastAPI 앱 생성
# app = FastAPI()
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 실행
    init_db()
    yield
    # 서버 종료 시 실행 (필요 시 코드 추가)

app = FastAPI(lifespan=lifespan)
# 정적 파일 및 템플릿 설정
app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)


# CORS 미들웨어 설정
# allow_credentials=True 일 때 allow_origins=["*"을 사용할 수 없으므로,
# 로컬 개발 환경과 브라우저 확장 프로그램의 출처를 명시적으로 허용합니다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:8001", "http://1227.0.0.1", "http://127.0.0.1:8001", "https://novel18.syosetu.com", "https://kakuyomu.jp"],
    allow_origin_regex="chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Web UI Endpoint --
@app.get("/book")
async def read_book_ui(request: Request):
    """책 UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("book_ui.html", {"request": request})

@app.get("/viewer")
async def read_viewer_ui(request: Request, book: Optional[str] = None):
    """로컬 뷰어 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("viewer.html", {"request": request, "book_name": book})


@app.get("/admin")
async def read_admin_ui(request: Request):
    """관리자 UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("admin.html", {"request": request})


@app.get("/library")
async def read_library_ui_alias(request: Request):
    """'서재' UI 웹페이지를 렌더링합니다. (루트의 별칭)"""
    return templates.TemplateResponse("library.html", {"request": request})


async def stream_translations(book: Optional[str] = None):
    """DB에서 번역 데이터를 스트리밍합니다. '미분류' 폴더를 지원합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    
    query = "SELECT * FROM translations"
    params = []
    if book:
        if book == "미분류":
            query += " WHERE folderName IS NULL"
        else:
            query += " WHERE folderName = ?"
            params.append(book)
    
    query += " ORDER BY timestamp ASC"
    
    cursor.execute(query, tuple(params))
    
    try:
        while True:
            record = cursor.fetchone()
            if not record:
                break
            
            yield f"data: {json.dumps(record)}\n\n"
            await asyncio.sleep(0.05)
    finally:
        conn.close()

@app.get("/stream")
async def stream(book: Optional[str] = None):
    """번역 데이터를 SSE로 스트리밍하는 엔드포인트입니다."""
    return StreamingResponse(stream_translations(book=book), media_type="text/event-stream")


class TranslationItemInput(BaseModel):
    id: str
    text: str

class TranslateRequest(BaseModel):
    items: List[TranslationItemInput]
    url: str


@retry(
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(5),
    reraise=True
)
def call_gemini_api_with_retry(api_url: str, prompt: str):
    """
    Calls the Gemini API with a retry mechanism.
    """
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "safetySettings": [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"}
        ]
    }
    response = requests.post(api_url, json=payload, timeout=180)
    response.raise_for_status()
    return response.json()

def process_repeated_chars(text: str) -> str:
    """4번 이상 반복되는 문자를 '(반복)'으로 대체합니다."""
    if not text:
        return text
    # (.)는 모든 문자와 일치, \1은 첫 번째 캡처 그룹(즉, 그 문자)을 참조, {3,}는 3번 이상 반복을 의미합니다.
    # 따라서 총 4번 이상 반복되는 문자를 찾습니다.
    return re.sub(r'(.)\1{3,}', '(반복)', text)

@app.post("/translate")
def translate_texts(req: TranslateRequest):
    """Gemini API를 호출하여 텍스트를 번역합니다. ID 기반 매칭과 재시도 로직으로 안정성을 높였습니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()

    cursor.execute("SELECT original FROM excluded_sentences WHERE url = ?", (req.url,))
    excluded_originals = {row[0] for row in cursor.fetchall()}
    conn.close()

    items_to_translate = [item for item in req.items if item.text not in excluded_originals]

    if not items_to_translate:
        return {"translations": [
            {"id": item.id, "original": item.text, "translated": item.text} for item in req.items
        ]}

    api_key = get_api_key()
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    api_input_json = json.dumps([{"id": item.id, "text": item.text} for item in items_to_translate], ensure_ascii=False)

    # 참고: 아래의 큰따옴표 이스케이프 관련 지시사항은 Gemini의 안전 필터에 의해
    # 'prohibited' 응답을 유발하는 것으로 확인되어 제거되었습니다.
    # 향후 유사 기능 구현 시 참고용으로 주석 처리하여 남겨둡니다.
    #
    # If the translated text itself contains double quotes ("), you MUST escape them
    # with a backslash (\). For example, a value should look like
    # "이것은 \"인용된\" 텍스트입니다."
    prompt = f"""You are a JSON-only translation API. You will receive a JSON array of objects, each with an 'id' and a 'text' field.
Your task is to translate the 'text' from Japanese to Korean.
Your response MUST be a single, valid JSON array of objects. Each object in your response must contain the original 'id' and the translated text in a 'translated' field.
Preserve the original quotation marks (like 「...」 and 『...』) in the translated text.
Do not add any other explanations, formatting, or markdown code fences. Your entire output must be only the JSON data.
Example response format: [{{"id": "p1", "translated": "번역된 텍스트"}}]
---START OF JSON DATA---
{api_input_json}
---END OF JSON DATA---
"""

    try:
        data = call_gemini_api_with_retry(api_url, prompt)

        # Explicitly check for top-level feedback block for content blocking
        feedback = data.get('promptFeedback')
        if feedback and feedback.get('blockReason'):
            error_detail = f"API가 콘텐츠를 차단했습니다. 이유: {feedback.get('blockReason')}"
            raise HTTPException(status_code=500, detail=error_detail)

        # Safely parse the API response for translated text
        raw_text = None
        if data.get('candidates') and isinstance(data['candidates'], list) and data['candidates']:
            candidate = data['candidates'][0]
            
            finish_reason = candidate.get('finishReason')
            if finish_reason and finish_reason != 'STOP':
                error_detail = f"API가 번역을 거부했습니다. 이유: {finish_reason}"
                raise HTTPException(status_code=500, detail=error_detail)

            if candidate.get('content') and candidate['content'].get('parts') and isinstance(candidate['content']['parts'], list) and candidate['content']['parts']:
                raw_text = candidate['content']['parts'][0].get('text')

        if raw_text is None:
            # Fallback for any other unexpected response structure
            error_detail = f"API 응답에서 번역된 텍스트를 추출할 수 없습니다. 응답: {data}"
            raise HTTPException(status_code=500, detail=error_detail)
        
        # Extract the clean JSON array from the raw text response
        start_index = raw_text.find('[')
        end_index = raw_text.rfind(']')
        
        if start_index != -1 and end_index != -1 and end_index > start_index:
            clean_json_text = raw_text[start_index:end_index+1]
        else:
            json_match = re.search(r'```(json)?(.*)```', raw_text, re.DOTALL)
            if json_match:
                clean_json_text = json_match.group(2).strip()
            else:
                clean_json_text = raw_text.strip()

        translated_map = {}
        object_strings = re.findall(r'\{[^\{\}]*\}', clean_json_text)

        for obj_str in object_strings:
            try:
                id_match = re.search(r'"id"\s*:\s*"(.*?)"', obj_str)
                if not id_match:
                    continue
                obj_id = id_match.group(1)

                trans_key_match = re.search(r'"translated"\s*:\s*"', obj_str)
                if not trans_key_match:
                    continue
                
                content_start_index = trans_key_match.end()
                content_end_index = obj_str.rfind('"', content_start_index)
                
                if content_end_index == -1:
                    continue

                translated_text = obj_str[content_start_index:content_end_index]
                translated_text = translated_text.replace('\\"', '"')

                translated_map[obj_id] = translated_text
            except Exception:
                continue

        final_translations = []
        for item in req.items:
            translated_text = translated_map.get(item.id)
            if translated_text is None:
                translated_text = item.text
            else:
                translated_text = process_repeated_chars(translated_text)

            final_translations.append({
                "id": item.id,
                "original": item.text,
                "translated": translated_text
            })

        return {"translations": final_translations}
    
    except RetryError as e:
        last_exception = e.last_attempt.exception()
        if isinstance(last_exception, requests.exceptions.HTTPError):
            if last_exception.response.status_code == 429:
                raise HTTPException(status_code=429, detail="API 요청 한도 초과. 잠시 후 다시 시도해주세요.")
        raise HTTPException(status_code=500, detail=f"Gemini API 요청 실패 (재시도 후): {last_exception}")

    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Gemini API 연결 실패: {e}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        error_detail = f"API 응답 처리 오류: {e}. Original response: '{data.get('candidates', 'N/A') if 'data' in locals() else 'Response not available'}'"
        raise HTTPException(status_code=500, detail=error_detail)


@app.post("/migrate")
def migrate_data():
    """migration_data.json 파일에서 데이터를 읽어 DB로 이전합니다."""
    try:
        with open("migration_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="migration_data.json 파일을 찾을 수 없습니다.")

    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    
    migrated_count = 0
    skipped_count = 0

    for record in data:
        try:
            # --- 날짜 변환 로직 수정 ---
            date_str = record['날짜']
            
            if '오후' in date_str:
                parts = date_str.split(' 오후 ')
                is_pm = True
            else:
                parts = date_str.split(' 오전 ')
                is_pm = False
            
            date_part_str = parts[0]
            time_part_str = parts[1]

            time_parts = time_part_str.split(':')
            hour = int(time_parts[0])
            minute = int(time_parts[1])
            second = int(time_parts[2])

            if is_pm and hour != 12:
                hour += 12
            if not is_pm and hour == 12: # 오전 12시 (자정)
                hour = 0

            date_parts = [p.strip() for p in date_part_str.replace('.', ' ').split()]
            year = int(date_parts[0])
            month = int(date_parts[1])
            day = int(date_parts[2])

            dt_object = datetime(year, month, day, hour, minute, second)
            ts = int(dt_object.timestamp())
            # --- 로직 수정 끝 ---

            cursor.execute("""
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                record['URL'],
                record['PID'],
                record['원문'],
                record['번역'],
                ts,
                record['폴더'] if record['폴더'] != '폴더 없음' else None
            ))
            migrated_count += 1
        except sqlite3.IntegrityError:
            skipped_count += 1
        except Exception as e:
            print(f"레코드 처리 중 오류 발생: {record}, 오류: {e}")
            skipped_count += 1

    conn.commit()
    conn.close()

    return {
        "message": "데이터 이전 완료",
        "total_records": len(data),
        "migrated_count": migrated_count,
        "skipped_count": skipped_count
    }


from fastapi.responses import JSONResponse

def dict_factory(cursor, row):
    """쿼리 결과를 사전 형태로 변환합니다."""
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

@app.get("/debug/urls_by_folder")
def debug_get_urls_by_folder(folder_name: str):
    """Temporary debug endpoint to get distinct URLs for a folder."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT url FROM translations WHERE folderName = ? LIMIT 10", (folder_name,))
    urls = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"folder_name": folder_name, "urls": urls}


@app.get("/translations")
def get_translations(skip: int = 0, limit: int = 100, folder: Optional[str] = None, search: Optional[str] = None, url: Optional[str] = None):
    """데이터베이스에서 번역 기록을 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.text_factory = str
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    # 기본 쿼리
    base_query = "FROM translations"
    count_query = "SELECT COUNT(*) as total_count " + base_query
    data_query = "SELECT * " + base_query

    # 조건절 및 파라미터
    conditions = []
    params = []

    if folder:
        if folder == '폴더 없음':
            conditions.append("folderName IS NULL")
        else:
            conditions.append("folderName = ?")
            params.append(folder)
    
    if search:
        conditions.append("(original LIKE ? OR translated LIKE ?)")
        params.extend([f'%{search}%', f'%{search}%'])
    
    if url:
        # Generate variations of the URL to handle http/https, www, and trailing slashes
        urls_to_check = set()
        
        # 1. Add original URL with and without slash
        urls_to_check.add(url.rstrip('/'))
        urls_to_check.add(url.rstrip('/') + '/')

        # 2. Strip protocol and add http/https variations
        no_protocol_url = re.sub(r'^https?://', '', url).rstrip('/')
        urls_to_check.add('http://' + no_protocol_url)
        urls_to_check.add('http://' + no_protocol_url + '/')
        urls_to_check.add('https://' + no_protocol_url)
        urls_to_check.add('https://' + no_protocol_url + '/')

        # 3. Handle www variations
        if no_protocol_url.startswith('www.'):
            no_www_url = no_protocol_url.replace('www.', '', 1)
            urls_to_check.add('http://' + no_www_url)
            urls_to_check.add('http://' + no_www_url + '/')
            urls_to_check.add('https://' + no_www_url)
            urls_to_check.add('https://' + no_www_url + '/')
        else:
            with_www_url = 'www.' + no_protocol_url
            urls_to_check.add('http://' + with_www_url)
            urls_to_check.add('http://' + with_www_url + '/')
            urls_to_check.add('https://' + with_www_url)
            urls_to_check.add('https://' + with_www_url + '/')

        url_list = list(urls_to_check)
        placeholders = ', '.join('?' * len(url_list))
        conditions.append(f"url IN ({placeholders})")
        params.extend(url_list)
    if conditions:
        where_clause = " WHERE " + " AND ".join(conditions)
        count_query += where_clause
        data_query += where_clause

    # 전체 개수 조회
    total_count = cursor.execute(count_query, tuple(params)).fetchone()['total_count']

    # 데이터 조회 (정렬 및 페이지네이션 포함)
    data_query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, skip])
    
    translations = cursor.execute(data_query, tuple(params)).fetchall()

    conn.close()

    return JSONResponse(content={
        "total_count": total_count,
        "translations": translations
    })

@app.get("/paged_translations")
def get_paged_translations(page: int = 1, per_page: int = 20):
    """페이지네이션을 지원하는 번역 기록 조회 엔드포인트입니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.text_factory = str
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    # 전체 항목 수 계산
    count_query = "SELECT COUNT(*) as total_count FROM translations"
    total_count = cursor.execute(count_query).fetchone()['total_count']

    # 현재 페이지 데이터 조회
    offset = (page - 1) * per_page
    data_query = "SELECT * FROM translations ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    translations = cursor.execute(data_query, (per_page, offset)).fetchall()

    conn.close()

    return {
        "total_count": total_count,
        "translations": translations
    }


class TranslationItem(BaseModel):
    url: str
    pid: Optional[str] = None
    original: str
    translated: str
    timestamp: int
    folderName: Optional[str] = None
    title: Optional[str] = None # Add title field

@app.post("/translations/upsert")
def upsert_translations(items: List[TranslationItem]):
    """번역 기록을 데이터베이스에 추가하거나 업데이트합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    
    updated_count = 0
    inserted_count = 0

    for item in items:
        # URL과 PID로 기존 레코드를 조회하여 ID와 폴더 이름을 가져옵니다.
        cursor.execute("SELECT id, folderName FROM translations WHERE url = ? AND pid = ?", (item.url, item.pid))
        result = cursor.fetchone()
        
        if result:
            # UPDATE: 기존 항목이 존재할 경우
            existing_id, existing_folder = result
            
            # 요청에 folderName이 명시적으로 제공되지 않았다면(null), 기존 폴더 값을 유지합니다.
            folder_name_to_use = item.folderName if item.folderName is not None else existing_folder
            
            # 제목 필드도 선택적으로 업데이트합니다.
            if item.title:
                cursor.execute("""
                UPDATE translations 
                SET translated = ?, timestamp = ?, folderName = ?, title = ?
                WHERE id = ?
                """, (item.translated, item.timestamp, folder_name_to_use, item.title, existing_id))
            else:
                cursor.execute("""
                UPDATE translations 
                SET translated = ?, timestamp = ?, folderName = ?
                WHERE id = ?
                """, (item.translated, item.timestamp, folder_name_to_use, existing_id))
            updated_count += 1
        else:
            # INSERT: 새 항목일 경우
            folder_name_to_use = item.folderName
            # 폴더 이름이 null이면, 동일 URL의 다른 항목에서 폴더를 상속받으려 시도합니다.
            if folder_name_to_use is None:
                cursor.execute("SELECT folderName FROM translations WHERE url = ? AND folderName IS NOT NULL LIMIT 1", (item.url,))
                existing_folder_res = cursor.fetchone()
                if existing_folder_res:
                    folder_name_to_use = existing_folder_res[0]

            cursor.execute("""
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (item.url, item.pid, item.original, item.translated, item.timestamp, folder_name_to_use, item.title))
            inserted_count += 1

    conn.commit()
    conn.close()
    return {"inserted": inserted_count, "updated": updated_count}

class MoveRequest(BaseModel):
    ids: List[int]
    folder_name: Optional[str]

class DeleteRequest(BaseModel):
    ids: List[int]

@app.put("/translations/move")
def move_translations(req: MoveRequest):
    """지정된 ID의 번역 기록들을 새 폴더로 이동합니다."""
    placeholders = ', '.join('?' * len(req.ids))
    query = f"UPDATE translations SET folderName = ? WHERE id IN ({placeholders})"
    params = [req.folder_name] + req.ids
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute(query, params)
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{updated_count}개의 항목이 이동되었습니다."}

@app.post("/translations/delete")
def delete_translations(req: DeleteRequest):
    """지정된 ID의 번역 기록들을 삭제합니다."""
    placeholders = ', '.join('?' * len(req.ids))
    query = f"DELETE FROM translations WHERE id IN ({placeholders})"
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute(query, req.ids)
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{deleted_count}개의 항목이 삭제되었습니다."}


class FindReplaceRequest(BaseModel):
    find_text: str
    replace_text: str

@app.post("/translations/find_replace")
def find_replace_all(req: FindReplaceRequest):
    """모든 번역 기록의 번역된 텍스트에 대해 찾아 바꾸기를 수행합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    query = "UPDATE translations SET translated = REPLACE(translated, ?, ?)"
    cursor.execute(query, (req.find_text, req.replace_text))
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"{updated_count}개의 항목에서 내용을 교체했습니다."}


@app.get("/excluded_sentences")
def get_excluded_sentences(url: str):
    """특정 URL에 대해 제외된 모든 원문 텍스트 목록을 반환합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT original FROM excluded_sentences WHERE url = ?", (url,))
    excluded_originals = [row[0] for row in cursor.fetchall()]
    conn.close()
    return {"excluded_texts": excluded_originals}


class ExcludeRequest(BaseModel):
    ids: List[int]

@app.post("/translations/exclude")
def exclude_translations(req: ExcludeRequest):
    """지정된 ID의 번역 기록을 제외 목록에 추가하고 원본을 삭제합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    excluded_count = 0
    for translation_id in req.ids:
        cursor.execute("SELECT url, original FROM translations WHERE id = ?", (translation_id,))
        result = cursor.fetchone()
        if result:
            url, original = result
            cursor.execute("INSERT OR IGNORE INTO excluded_sentences (url, original) VALUES (?, ?)", (url, original))
            cursor.execute("DELETE FROM translations WHERE id = ?", (translation_id,))
            excluded_count += 1
    conn.commit()
    conn.close()
    return {"message": f"{excluded_count}개의 항목이 제외 목록에 추가되었습니다."}


class UpdateTitleRequest(BaseModel):
    url: str
    title: str

@app.put("/translations/url_title")
def update_title_for_url(req: UpdateTitleRequest):
    """Updates the title for all entries with a given URL."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("UPDATE translations SET title = ? WHERE url = ?", (req.title, req.url))
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"Title updated for {updated_count} entries for URL {req.url}."}


class ApplyUrlRequest(BaseModel):
    url: str
    apply: bool

@app.post("/api/urls/apply")
def toggle_apply_url(req: ApplyUrlRequest):
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    clean_url = req.url.split('#')[0].rstrip('/')
    
    if req.apply:
        # To be safe, we can insert the version without slash, and the server-side matching logic will handle variations.
        cursor.execute("INSERT OR IGNORE INTO applied_urls (url) VALUES (?)", (clean_url,))
    else:
        # When deleting, we should remove all possible variations to be thorough.
        # This reuses the logic from get_translations to find all variants.
        urls_to_delete = set()
        urls_to_delete.add(clean_url)
        urls_to_delete.add(clean_url + '/')
        no_protocol_url = re.sub(r'^https?://', '', clean_url)
        urls_to_delete.add('http://' + no_protocol_url)
        urls_to_delete.add('https://' + no_protocol_url)
        urls_to_delete.add('http://' + no_protocol_url + '/')
        urls_to_delete.add('https://' + no_protocol_url + '/')
        
        placeholders = ', '.join('?' * len(urls_to_delete))
        cursor.execute(f"DELETE FROM applied_urls WHERE url IN ({placeholders})", list(urls_to_delete))

    conn.commit()
    conn.close()
    return {"message": f"Apply status for {req.url} set to {req.apply}"}


@app.get("/translations_by_folder")
def get_translations_by_folder():
    """데이터베이스에서 모든 번역 기록을 폴더와 URL별로 그룹화하여 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.text_factory = str
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    # Get all applied URLs first
    cursor.execute("SELECT url FROM applied_urls")
    applied_urls_set = {row['url'] for row in cursor.fetchall()}

    translations = cursor.execute("SELECT * FROM translations ORDER BY folderName, url").fetchall()
    conn.close()
    
    grouped_translations = defaultdict(lambda: defaultdict(list))
    for t in translations:
        folder_name = t.get("folderName") or "폴더 추가 대기 상태"
        url = t.get("url")
        if url:
            grouped_translations[folder_name][url].append(t)
            
    final_response = dict(grouped_translations)
    final_response["_applied_urls"] = list(applied_urls_set)

    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=final_response, headers=headers)


@app.get("/api/urls/apply_status")
def get_apply_status(url: str):
    """Checks if a URL is marked as 'applied' using robust matching."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()

    # Robust URL matching logic
    urls_to_check = set()
    clean_url = url.split('#')[0]
    urls_to_check.add(clean_url.rstrip('/'))
    urls_to_check.add(clean_url.rstrip('/') + '/')
    no_protocol_url = re.sub(r'^https?://', '', clean_url).rstrip('/')
    urls_to_check.add('http://' + no_protocol_url)
    urls_to_check.add('http://' + no_protocol_url + '/')
    urls_to_check.add('https://' + no_protocol_url)
    urls_to_check.add('https://' + no_protocol_url + '/')
    if no_protocol_url.startswith('www.'):
        no_www_url = no_protocol_url.replace('www.', '', 1)
        urls_to_check.add('http://' + no_www_url)
        urls_to_check.add('http://' + no_www_url + '/')
        urls_to_check.add('https://' + no_www_url)
        urls_to_check.add('https://' + no_www_url + '/')
    else:
        with_www_url = 'www.' + no_protocol_url
        urls_to_check.add('http://' + with_www_url)
        urls_to_check.add('http://' + with_www_url + '/')
        urls_to_check.add('https://' + with_www_url)
        urls_to_check.add('https://' + with_www_url + '/')
    if 'kakuyomu.jp/works/' in clean_url:
        match = re.match(r'(https?://kakuyomu.jp/works/\d+)', clean_url)
        if match:
            work_url = match.group(1)
            urls_to_check.add(work_url)
            urls_to_check.add(work_url + '/')

    url_list = list(urls_to_check)
    placeholders = ', '.join('?' * len(url_list))
    
    query = f"SELECT 1 FROM applied_urls WHERE url IN ({placeholders}) LIMIT 1"
    cursor.execute(query, url_list)
    
    is_applied = cursor.fetchone() is not None
    conn.close()
    return {"applied": is_applied}


def _fetch_and_update_title_worker(url: str):
    """Internal worker to fetch a single title. Returns True if title is valid and updated."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        with requests.Session() as s:
            s.headers.update(headers)
            if "novel18.syosetu.com" in url:
                s.cookies.set("over18", "yes", domain=".syosetu.com")
            response = s.get(url, timeout=10)
        response.raise_for_status()
        try:
            html_content = response.content.decode('utf-8')
        except UnicodeDecodeError:
            html_content = response.text
        title_match = re.search(r'<title>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
        if title_match:
            title = title_match.group(1).strip()
            invalid_titles = ["年齢確認", "Just a moment...", "Log in"]
            if not title or any(invalid in title for invalid in invalid_titles):
                print(f"Skipping invalid title for {url}: {title}")
                return False
            conn = sqlite3.connect(DATABASE_FILE, timeout=15)
            cursor = conn.cursor()
            cursor.execute("UPDATE translations SET title = ? WHERE url = ?", (title, url))
            conn.commit()
            conn.close()
            print(f"Updated title for {url}: {title}")
            return True
        else:
            print(f"Could not find title for {url}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"Failed to fetch {url}: {e}")
        return False
    except Exception as e:
        print(f"An error occurred while processing {url}: {e}")
        return False

def process_urls_in_background(urls: List[str]):
    """Loops through URLs with a delay and fetches titles."""
    print(f"Starting background task to process {len(urls)} URLs.")
    for i, url in enumerate(urls):
        print(f"Processing URL {i+1}/{len(urls)}: {url}")
        _fetch_and_update_title_worker(url)
        time.sleep(1)
    print("Finished background task for fetching titles.")


@app.post("/fetch_missing_titles")
async def fetch_missing_titles_endpoint(background_tasks: BackgroundTasks):
    """
    Fetches titles for all entries in the database that do not have a title yet.
    This is a long-running background task.
    """
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    invalid_titles_tuple = ('年齢確認', 'Just a moment...', 'Log in', '')
    placeholders = ', '.join('?' * len(invalid_titles_tuple))
    query = f"SELECT DISTINCT url FROM translations WHERE title IS NULL OR title IN ({placeholders})"
    urls_to_fetch = cursor.execute(query, invalid_titles_tuple).fetchall()
    conn.close()
    urls = [row[0] for row in urls_to_fetch]
    if not urls:
        return {"message": "No missing titles to fetch."}
    background_tasks.add_task(process_urls_in_background, urls)
    return {"message": f"Started fetching titles for {len(urls)} URLs in the background. This will take time."}

class PinRequest(BaseModel):
    folderName: str

@app.post("/api/books/pin")
def toggle_pin_book(req: PinRequest):
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT folderName FROM pinned_books WHERE folderName = ?", (req.folderName,))
    is_pinned = cursor.fetchone()
    if is_pinned:
        cursor.execute("DELETE FROM pinned_books WHERE folderName = ?", (req.folderName,))
        message = f"'{req.folderName}' 책 고정을 해제했습니다."
    else:
        cursor.execute("INSERT INTO pinned_books (folderName) VALUES (?)", (req.folderName,))
        message = f"'{req.folderName}' 책을 고정했습니다."
    conn.commit()
    conn.close()
    return {"message": message}

class FolderCreate(BaseModel):
    folder_name: str

@app.post("/api/folders")
def create_folder(req: FolderCreate):
    """새 폴더를 생성합니다. `book_activity` 테이블에 항목을 추가하여 폴더가 존재하도록 합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO book_activity (folderName) VALUES (?)", (req.folder_name,))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        # 폴더가 이미 존재하므로 오류가 아님
        return {"message": f"폴더 ''{req.folder_name}''가 이미 존재합니다."}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"데이터베이스 오류: {e}")
    finally:
        conn.close()
    return {"message": f"폴더 ''{req.folder_name}''가 생성되었습니다."}


class FolderUpdate(BaseModel):
    new_name: str

@app.put("/api/folders/{folder_name}")
def update_folder_name(folder_name: str, req: FolderUpdate):
    """폴더 이름을 변경합니다."""
    old_name = unquote(folder_name)
    new_name = req.new_name

    if not new_name or old_name == new_name:
        raise HTTPException(status_code=400, detail="잘못된 폴더 이름입니다.")

    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()

    try:
        # Check if new folder name already exists
        cursor.execute("SELECT 1 FROM translations WHERE folderName = ? LIMIT 1", (new_name,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail=f"폴더 '{new_name}'이(가) 이미 존재합니다.")
        cursor.execute("SELECT 1 FROM book_activity WHERE folderName = ? LIMIT 1", (new_name,))
        if cursor.fetchone():
            raise HTTPException(status_code=409, detail=f"폴더 '{new_name}'이(가) 이미 존재합니다.")

        # Update translations table
        cursor.execute("UPDATE translations SET folderName = ? WHERE folderName = ?", (new_name, old_name))
        
        # Update book_activity table
        cursor.execute("UPDATE book_activity SET folderName = ? WHERE folderName = ?", (new_name, old_name))

        conn.commit()
    except HTTPException:
        conn.rollback()
        raise # Re-raise the HTTP exception
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"데이터베이스 오류: {e}")
    finally:
        conn.close()

    return {"message": f"폴더 이름이 '{old_name}'에서 '{new_name}'(으)로 변경되었습니다."}



@app.get("/folders")
def get_folders():
    """
    데이터베이스에서 폴더 목록을 조회합니다.
    고정된 폴더, 그 다음 나머지 폴더 순으로 정렬하여 반환합니다.
    '미분류' 폴더도 지원하며, 각 폴더의 태그와 활동 정보를 포함합니다.
    """
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity")
    activity_map = {row['folderName']: row for row in cursor.fetchall()}
    cursor.execute("SELECT bt.book_folderName, t.id, t.name FROM book_tags bt JOIN tags t ON bt.tag_id = t.id")
    book_tags_map = defaultdict(list)
    for row in cursor.fetchall():
        book_tags_map[row['book_folderName']].append({'id': row['id'], 'name': row['name']})
    cursor.execute("SELECT folderName FROM pinned_books")
    pinned_set = {row['folderName'] for row in cursor.fetchall()}
    cursor.execute("SELECT DISTINCT folderName FROM translations WHERE folderName IS NOT NULL")
    translation_folders = {row['folderName'] for row in cursor.fetchall()}

    cursor.execute("SELECT DISTINCT folderName FROM book_activity WHERE folderName IS NOT NULL")
    activity_folders = {row['folderName'] for row in cursor.fetchall()}

    all_folders_set = translation_folders.union(activity_folders)

    cursor.execute("SELECT 1 FROM translations WHERE folderName IS NULL LIMIT 1")
    if cursor.fetchone():
        all_folders_set.add("폴더 추가 대기 상태")
    conn.close()
    folder_objects = [
        {
            'name': f,
            'pinned': f in pinned_set,
            'tags': book_tags_map.get(f, []),
            'activity': activity_map.get(f)
        } for f in all_folders_set
    ]
    sorted_folders = sorted(folder_objects, key=lambda x: (not x['pinned'], x['name']))
    
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    return JSONResponse(content=sorted_folders, headers=headers)


@app.get("/api/books")
def get_books():
    """/folders의 별칭으로, 책(폴더) 목록을 반환합니다."""
    return get_folders()


@app.get("/api/books/{folder_name}/urls")
def get_book_urls(folder_name: str):
    """Gets all URLs and their translation counts for a specific book/folder."""
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    query = "SELECT url, title, COUNT(*) as count FROM translations WHERE folderName = ? GROUP BY url, title ORDER BY MAX(timestamp) DESC"
    params = [decoded_folder_name]
    if decoded_folder_name == "미분류":
        query = "SELECT url, title, COUNT(*) as count FROM translations WHERE folderName IS NULL GROUP BY url, title ORDER BY MAX(timestamp) DESC"
        params = []

    cursor.execute(query, tuple(params))
    urls = cursor.fetchall()
    conn.close()
    return urls


# --- Tag Management APIs ---

class Tag(BaseModel):
    id: int
    name: str

class TagCreate(BaseModel):
    name: str

class BookTagUpdate(BaseModel):
    tag_ids: List[int]

@app.get("/api/tags", response_model=List[Tag])
def get_all_tags():
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    tags = cursor.execute("SELECT id, name FROM tags ORDER BY name").fetchall()
    conn.close()
    return tags

@app.post("/api/tags", response_model=Tag)
def create_tag(tag: TagCreate):
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO tags (name) VALUES (?)", (tag.name,))
        new_id = cursor.lastrowid
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Tag with this name already exists")
    conn.close()
    return {"id": new_id, "name": tag.name}

@app.put("/api/books/{folder_name}/tags")
def update_book_tags(folder_name: str, req: BookTagUpdate):
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM book_tags WHERE book_folderName = ?", (decoded_folder_name,))
        if req.tag_ids:
            values = [(decoded_folder_name, tag_id) for tag_id in req.tag_ids]
            cursor.executemany("INSERT INTO book_tags (book_folderName, tag_id) VALUES (?, ?)", values)
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        conn.close()
    return {"message": f"Tags for '{decoded_folder_name}' updated successfully."}


# --- Activity Management APIs ---

class BookActivityUpdate(BaseModel):
    last_read_timestamp: Optional[int] = None
    last_read_pid: Optional[str] = None
    is_bookmarked: Optional[bool] = None
    notes: Optional[str] = None
    summary: Optional[str] = None
    summary_source_url: Optional[str] = None

@app.put("/api/books/{folder_name}/activity")
def update_book_activity(folder_name: str, req: BookActivityUpdate):
    """책의 활동 정보를 업데이트합니다 (UPSERT)."""
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    activity = cursor.fetchone()
    if not activity:
        activity = {'folderName': decoded_folder_name}
    update_data = req.dict(exclude_unset=True)
    activity.update(update_data)
    is_bookmarked_int = 1 if activity.get('is_bookmarked') else 0
    cursor.execute("""
        INSERT OR REPLACE INTO book_activity 
        (folderName, last_read_timestamp, last_read_pid, is_bookmarked, notes, summary, summary_source_url)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        decoded_folder_name,
        activity.get('last_read_timestamp'),
        activity.get('last_read_pid'),
        is_bookmarked_int,
        activity.get('notes'),
        activity.get('summary'),
        activity.get('summary_source_url')
    ))
    conn.commit()
    conn.close()
    return {"message": f"Activity for '{decoded_folder_name}' updated."}


@app.get("/api/books/{folder_name}/activity")
def get_book_activity(folder_name: str):
    """Gets the activity data for a specific book."""
    decoded_folder_name = unquote(folder_name)
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    conn.row_factory = dict_factory
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    activity = cursor.fetchone()
    conn.close()
    if not activity:
        return {"folderName": decoded_folder_name, "last_read_pid": None}
    return activity

def _crawl_and_update_summary_worker(folder_name: str, url: str):
    """백그라운드에서 실행될 줄거리 크롤링 및 DB 업데이트 작업자 함수"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        with requests.Session() as s:
            s.headers.update(headers)
            if "novel18.syosetu.com" in url:
                s.cookies.set("over18", "yes", domain=".syosetu.com")
            response = s.get(url, timeout=15)
        response.raise_for_status()
        html_content = response.text

        summary = None
        # 1. Syosetu 패턴 시도
        summary_match = re.search(r'<div id="novel_ex">(.*?)</div>', html_content, re.DOTALL)
        if summary_match:
            summary_html = summary_match.group(1).strip()
            summary = summary_html.replace('<br />', '\n')
            summary = re.sub('<.*?>', '', summary) # 나머지 HTML 태그 제거
        
        # 2. 메타 설명 태그 시도
        if not summary:
            meta_match = re.search(r'<meta name="description" content="(.*?)">', html_content, re.IGNORECASE)
            if meta_match:
                summary = meta_match.group(1).strip()

        if summary:
            conn = sqlite3.connect(DATABASE_FILE, timeout=15)
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO book_activity (folderName, summary) VALUES (?, ?)
                ON CONFLICT(folderName) DO UPDATE SET summary = excluded.summary;
            """, (folder_name, summary))
            conn.commit()
            conn.close()
            print(f"Successfully updated summary for {folder_name}.")
            return True
        else:
            print(f"Could not find summary for URL: {url}")
            return False

    except Exception as e:
        print(f"Failed to crawl or update summary for {url}. Error: {e}")
        return False

@app.post("/api/books/{folder_name}/crawl-summary")
async def crawl_summary_endpoint(folder_name: str, background_tasks: BackgroundTasks):
    """줄거리 크롤링을 백그라운드 작업으로 시작하는 API 엔드포인트"""
    decoded_folder_name = unquote(folder_name)

    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT summary_source_url FROM book_activity WHERE folderName = ?", (decoded_folder_name,))
    result = cursor.fetchone()
    conn.close()

    if not result or not result[0]:
        raise HTTPException(status_code=404, detail="Summary source URL is not set for this book.")

    source_url = result[0]
    
    background_tasks.add_task(_crawl_and_update_summary_worker, decoded_folder_name, source_url)
    
    return {"message": "Summary crawling started in the background."}
# --- Root and Admin Endpoints ---
@app.get("/")
async def read_root(request: Request):
    """'서재' UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("library.html", {"request": request})

@app.post("/admin/cleanup_pids")
def cleanup_pids():
    """'la' 또는 'lp'로 시작하는 PID를 가진 기록을 제외 처리합니다."""
    conn = sqlite3.connect(DATABASE_FILE, timeout=15)
    cursor = conn.cursor()
    cursor.execute("SELECT id, url, original FROM translations WHERE lower(pid) GLOB 'la[0-9]*' OR lower(pid) GLOB 'lp[0-9]*'")
    records_to_exclude = cursor.fetchall()
    if not records_to_exclude:
        conn.close()
        return {"message": "제외할 'la' 또는 'lp' PID를 가진 기록이 없습니다."}
    excluded_count = 0
    for record_id, url, original in records_to_exclude:
        try:
            cursor.execute("INSERT OR IGNORE INTO excluded_sentences (url, original) VALUES (?, ?)", (url, original))
            excluded_count += cursor.rowcount
        except sqlite3.IntegrityError:
            pass
    ids_to_delete = [record[0] for record in records_to_exclude]
    placeholders = ', '.join('?' * len(ids_to_delete))
    cursor.execute(f"DELETE FROM translations WHERE id IN ({placeholders})", ids_to_delete)
    deleted_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"총 {deleted_count}개의 기록을 제외 처리했습니다. (새롭게 제외 목록에 추가된 항목: {excluded_count}개)"}

# uvicorn server:app --reload --port 8001
