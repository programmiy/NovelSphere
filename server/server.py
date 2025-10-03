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

@app.post("/translate")
def translate_texts(req: TranslateRequest):
    """Gemini API를 호출하여 텍스트를 번역합니다."""
    api_key = get_api_key()
    api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    
    # 단순화된 프롬프트: 각 텍스트를 새 줄에 번역하도록 요청
    prompt = (
        "You are an expert translator. Translate the following Japanese texts to Korean. "
        "Each text is on a new line. Maintain the same order in your response, with each translation on a new line. "
        "Do not add any extra explanations or formatting. Just the translated texts, one per line.\n"
        "---START OF TEXTS---\n"
        + "\n".join(req.texts) +
        "\n---END OF TEXTS---"
    )

    try:
        response = requests.post(api_url, json={
            "contents": [{"parts": [{"text": prompt}]}]
        })
        response.raise_for_status() # HTTP 오류 발생 시 예외 발생
        data = response.json()
        
        # 모델의 응답 텍스트를 줄 단위로 분리
        raw_text = data['candidates'][0]['content']['parts'][0]['text']
        translated_parts = raw_text.strip().split('\n')
        
        # 입력과 출력의 개수가 일치하는지 기본적인 검증
        if len(translated_parts) != len(req.texts):
            # 불일치 시, 원본 텍스트 수만큼 빈 문자열로 채워 반환 (부분적 실패 처리)
            # 또는 에러를 발생시킬 수 있습니다. 여기서는 안전하게 빈 문자열로 채웁니다.
            print(f"Warning: Translation count mismatch. Expected {len(req.texts)}, got {len(translated_parts)}.")
            # 가장 가능성 있는 시나리오는 모델이 빈 문자열 하나를 반환하는 경우입니다.
            if len(translated_parts) == 1 and translated_parts[0] == '':
                translated_parts = ['' for _ in req.texts]
            else: # 다른 경우, 일단 받은대로 두고 클라이언트에서 처리하도록 함
                 pass

        return {"translations": translated_parts}
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
        # Check if record exists
        cursor.execute("SELECT id FROM translations WHERE url = ? AND pid = ? AND original = ?", (item.url, item.pid, item.original))
        result = cursor.fetchone()
        
        if result:
            # Update existing record
            # Only update title if it's not null, to avoid overwriting existing titles with null
            if item.title:
                cursor.execute("""
                UPDATE translations 
                SET translated = ?, timestamp = ?, folderName = ?, title = ?
                WHERE id = ?
                """, (item.translated, item.timestamp, item.folderName, item.title, result[0]))
            else:
                cursor.execute("""
                UPDATE translations 
                SET translated = ?, timestamp = ?, folderName = ?
                WHERE id = ?
                """, (item.translated, item.timestamp, item.folderName, result[0]))
            updated_count += 1
        else:
            # Insert new record
            cursor.execute("""
            INSERT INTO translations (url, pid, original, translated, timestamp, folderName, title)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (item.url, item.pid, item.original, item.translated, item.timestamp, item.folderName, item.title))
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
    translations = cursor.execute("SELECT * FROM translations ORDER BY folderName, url, timestamp DESC").fetchall()
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

# uvicorn server:app --reload --port 8001
