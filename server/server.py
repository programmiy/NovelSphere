import sqlite3
import json
import requests
from fastapi import FastAPI, HTTPException, BackgroundTasks
import re
import time
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional

DATABASE_FILE = "translations.db"
API_KEY_FILE = "api_key.txt"

def get_api_key():
    """api_key.txt 파일에서 API 키를 읽어옵니다."""
    try:
        with open(API_KEY_FILE, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"{API_KEY_FILE} 파일을 찾을 수 없습니다. API 키를 파일에 저장해주세요.")

def init_db():
    """데이터베이스를 초기화하고 테이블을 생성합니다."""
    conn = sqlite3.connect(DATABASE_FILE)
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
    """)
    # 인덱스 추가로 검색 성능 향상
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_url ON translations (url);");
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_folderName ON translations (folderName);");

    # Add title column if it doesn't exist for storing page titles
    cursor.execute("PRAGMA table_info(translations)")
    columns = [column[1] for column in cursor.fetchall()]
    if 'title' not in columns:
        cursor.execute("ALTER TABLE translations ADD COLUMN title TEXT")

    # Create excluded_sentences table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS excluded_sentences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        original TEXT NOT NULL,
        UNIQUE(url, original)
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_excluded_url_original ON excluded_sentences (url, original);")

    conn.commit()
    conn.close()

# FastAPI 앱 생성
app = FastAPI()

@app.on_event("startup")
async def startup_event():
    """서버 시작 시 데이터베이스를 초기화합니다."""
    init_db()

# CORS 미들웨어 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TranslateRequest(BaseModel):
    texts: List[str]
    url: str

@app.post("/translate")
def translate_texts(req: TranslateRequest):
    """Gemini API를 호출하여 텍스트를 번역합니다. 제외된 텍스트는 건너뜁니다."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # URL에 대해 제외된 문장 목록을 가져옵니다.
    cursor.execute("SELECT original FROM excluded_sentences WHERE url = ?", (req.url,))
    excluded_originals = {row[0] for row in cursor.fetchall()}
    conn.close()

    # 번역할 텍스트와 제외된 텍스트를 분리합니다.
    texts_to_translate = []
    original_indices = {}
    for i, text in enumerate(req.texts):
        if text not in excluded_originals:
            original_indices[len(texts_to_translate)] = i
            texts_to_translate.append(text)

    # 번역할 텍스트가 없으면 빈 결과를 반환합니다.
    if not texts_to_translate:
        return {"translations": ["" for _ in req.texts]}

    # Gemini API 호출
    api_key = get_api_key()
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    prompt = (
        "You are an expert translator specializing in Japanese to Korean. "
        "Translate the following Japanese texts to Korean. "
        "Each text is on a new line. Maintain the same order in your response, with each translation on a new line. "
        "Crucially, you MUST preserve the original quotation marks (like 「...」 and 『...』) in the translated text. "
        "Do not add any other extra explanations or formatting. Just the translated texts, one per line.\n"
        "---START OF TEXTS---\n"
        + "\n".join(texts_to_translate) +
        "\n---END OF TEXTS---"
    )

    try:
        response = requests.post(api_url, json={
            "contents": [{"parts": [{"text": prompt}]}]
        })
        response.raise_for_status()
        data = response.json()
        
        raw_text = data['candidates'][0]['content']['parts'][0]['text']
        translated_parts = raw_text.strip().split('\n')
        
        # 최종 결과 리스트를 생성합니다.
        final_translations = ["" for _ in req.texts]
        for i, translated_text in enumerate(translated_parts):
            if i in original_indices:
                final_translations[original_indices[i]] = translated_text

        return {"translations": final_translations}
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Gemini API 요청 실패: {e}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Gemini API 응답 처리 실패: {e}")

@app.post("/migrate")
def migrate_data():
    """migration_data.json 파일에서 데이터를 읽어 DB로 이전합니다."""
    try:
        with open("migration_data.json", "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="migration_data.json 파일을 찾을 수 없습니다.")

    conn = sqlite3.connect(DATABASE_FILE)
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
from typing import Optional

def dict_factory(cursor, row):
    """쿼리 결과를 사전 형태로 변환합니다."""
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

@app.get("/translations")
def get_translations(skip: int = 0, limit: int = 100, folder: Optional[str] = None, search: Optional[str] = None, url: Optional[str] = None):
    """데이터베이스에서 번역 기록을 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE)
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
        # Handle trailing slashes for more robust matching
        url_with_slash = url if url.endswith('/') else url + '/'
        url_without_slash = url.rstrip('/')
        conditions.append("(url = ? OR url = ?)")
        params.extend([url_with_slash, url_without_slash])
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

from pydantic import BaseModel
from typing import List, Optional

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
    conn = sqlite3.connect(DATABASE_FILE)
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
    # SQL IN 절을 위해 플레이스홀더 문자열 생성 (?, ?, ...)
    placeholders = ', '.join('?' * len(req.ids))
    query = f"UPDATE translations SET folderName = ? WHERE id IN ({placeholders})"
    
    # 파라미터 순서: [folder_name, id1, id2, ...]
    params = [req.folder_name] + req.ids

    conn = sqlite3.connect(DATABASE_FILE)
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
    
    conn = sqlite3.connect(DATABASE_FILE)
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
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # SQLite의 replace 함수를 사용하여 모든 항목을 업데이트합니다.
    query = "UPDATE translations SET translated = REPLACE(translated, ?, ?)"
    cursor.execute(query, (req.find_text, req.replace_text))
    updated_count = cursor.rowcount
    
    conn.commit()
    conn.close()

    return {"message": f"{updated_count}개의 항목에서 내용을 교체했습니다."}


@app.get("/excluded_sentences")
def get_excluded_sentences(url: str):
    """특정 URL에 대해 제외된 모든 원문 텍스트 목록을 반환합니다."""
    conn = sqlite3.connect(DATABASE_FILE)
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
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    
    excluded_count = 0
    for translation_id in req.ids:
        # 1. ID를 기반으로 url과 original 텍스트를 가져옵니다.
        cursor.execute("SELECT url, original FROM translations WHERE id = ?", (translation_id,))
        result = cursor.fetchone()
        
        if result:
            url, original = result
            
            # 2. excluded_sentences 테이블에 추가합니다. (중복 시 무시)
            cursor.execute("INSERT OR IGNORE INTO excluded_sentences (url, original) VALUES (?, ?)", (url, original))
            
            # 3. translations 테이블에서 원본 항목을 삭제합니다.
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
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE translations SET title = ? WHERE url = ?", (req.title, req.url))
    updated_count = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"Title updated for {updated_count} entries for URL {req.url}."}


from collections import defaultdict

@app.get("/translations_by_folder")
def get_translations_by_folder():
    """데이터베이스에서 모든 번역 기록을 폴더와 URL별로 그룹화하여 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.text_factory = str
    conn.row_factory = dict_factory
    cursor = conn.cursor()

    # Order by URL as well for logical grouping
    translations = cursor.execute("SELECT * FROM translations ORDER BY folderName, url").fetchall()
    conn.close()

    # Use a nested defaultdict
    grouped_translations = defaultdict(lambda: defaultdict(list))
    for t in translations:
        folder_name = t.get("folderName") or "폴더 없음"
        url = t.get("url")
        if url: # Ensure there is a URL to group by
            grouped_translations[folder_name][url].append(t)

    return grouped_translations


def _fetch_and_update_title_worker(url: str):
    """Internal worker to fetch a single title. Returns True if title is valid and updated."""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        with requests.Session() as s:
            s.headers.update(headers)
            # For novel18, we might need to handle the age check.
            # A simple way is to set the over18 cookie.
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
            
            # Blocklist for invalid titles
            invalid_titles = ["年齢確認", "Just a moment...", "Log in"]
            if not title or any(invalid in title for invalid in invalid_titles):
                print(f"Skipping invalid title for {url}: {title}")
                return False

            conn = sqlite3.connect(DATABASE_FILE)
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
        time.sleep(1) # Wait 1 second between requests
    print("Finished background task for fetching titles.")


@app.post("/fetch_missing_titles")
async def fetch_missing_titles_endpoint(background_tasks: BackgroundTasks):
    """
    Fetches titles for all entries in the database that do not have a title yet.
    This is a long-running background task.
    """
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    
    # Get all unique URLs that have at least one entry with a missing or invalid title
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

@app.get("/folders")
def get_folders():
    """데이터베이스에서 모든 고유 폴더 목록을 조회합니다."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.text_factory = str
    cursor = conn.cursor()
    folders = cursor.execute("SELECT DISTINCT folderName FROM translations WHERE folderName IS NOT NULL ORDER BY folderName").fetchall()
    conn.close()
    return [folder[0] for folder in folders]


# 루트 엔드포인트
@app.get("/")
def read_root():
    """서버가 실행 중인지 확인하는 기본 엔드포인트입니다."""
    return {"message": "번역 기록 관리 서버가 실행 중입니다."}


@app.post("/admin/cleanup_pids")
def cleanup_pids():
    """'la' 또는 'lp'로 시작하는 PID를 가진 기록을 제외 처리합니다."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # 1. 대상 선정: 'la' 또는 'lp'로 시작하는 PID를 가진 항목들을 선택합니다.
    cursor.execute("SELECT id, url, original FROM translations WHERE lower(pid) GLOB 'la[0-9]*' OR lower(pid) GLOB 'lp[0-9]*'")
    records_to_exclude = cursor.fetchall()
    
    if not records_to_exclude:
        conn.close()
        return {"message": "제외할 'la' 또는 'lp' PID를 가진 기록이 없습니다."}

    # 2. 제외 목록에 추가: 각 항목을 excluded_sentences 테이블에 삽입합니다.
    excluded_count = 0
    for record_id, url, original in records_to_exclude:
        try:
            cursor.execute("INSERT OR IGNORE INTO excluded_sentences (url, original) VALUES (?, ?)", (url, original))
            excluded_count += cursor.rowcount
        except sqlite3.IntegrityError:
            # 이미 제외 목록에 있는 경우, 무시하고 계속 진행합니다.
            pass

    # 3. 원본 테이블에서 삭제: 처리된 항목들의 ID 목록을 사용하여 삭제합니다.
    ids_to_delete = [record[0] for record in records_to_exclude]
    placeholders = ', '.join('?' * len(ids_to_delete))
    cursor.execute(f"DELETE FROM translations WHERE id IN ({placeholders})", ids_to_delete)
    deleted_count = cursor.rowcount

    conn.commit()
    conn.close()

    return {"message": f"총 {deleted_count}개의 기록을 제외 처리했습니다. (새롭게 제외 목록에 추가된 항목: {excluded_count}개)"}

# uvicorn server:app --reload --port 8001
