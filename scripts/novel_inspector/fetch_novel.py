"""
Novel Inspector - 웹소설 메타데이터 추출기 (틀/템플릿)
카쿠요무, 소설가가 되자(나로우/노벨18), 하멜른 등의 소설 URL에서
제목, 작가, 캐치프레이즈, 줄거리, 태그를 자동으로 추출합니다.

[사용법]
1. 직접 URL 입력 실행:
   .\\venv\\Scripts\\python.exe scripts\\novel_inspector\\fetch_novel.py "https://kakuyomu.jp/works/..."
2. 또는 target_url.txt 파일에 URL을 넣고 그냥 실행:
   .\\venv\\Scripts\\python.exe scripts\\novel_inspector\\fetch_novel.py
"""

import sys
import os
import re
import json
import urllib.request
import urllib.error
from pathlib import Path
from selectolax.lexbor import LexborHTMLParser

# Windows 콘솔 인코딩 대응
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

CURRENT_DIR = Path(__file__).parent.resolve()
OUTPUT_DIR = CURRENT_DIR / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TARGET_URL_FILE = CURRENT_DIR / "target_url.txt"

# [설정] 코드에서 직접 URL을 바꾸고 싶다면 여기에 입력하세요.
MANUAL_URL = ""

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

def fetch_html(url_or_path: str) -> str:
    """URL 또는 로컬 파일에서 HTML 문자열을 가져옵니다."""
    if os.path.exists(url_or_path):
        with open(url_or_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()

    req = urllib.request.Request(
        url_or_path,
        headers={"User-Agent": USER_AGENT, "Cookie": "over18=yes"}
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        charset = res.headers.get_content_charset() or 'utf-8'
        return res.read().decode(charset, errors='replace')

def parse_kakuyomu(html: str, url: str) -> dict:
    """카쿠요무 페이지 파싱 (__NEXT_DATA__ Apollo State 활용)"""
    info = {
        "site": "Kakuyomu",
        "url": url,
        "title": "",
        "author": "",
        "catchphrase": "",
        "introduction": "",
        "tags": [],
        "genre": "",
        "episodes_count": 0
    }

    # 1. Next.js 데이터 파싱
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html)
    if m:
        try:
            data = json.loads(m.group(1))
            apollo = data.get('props', {}).get('pageProps', {}).get('__APOLLO_STATE__', {})
            
            # URL에서 workId 추출
            work_id_m = re.search(r'works/(\d+)', url)
            target_key = f"Work:{work_id_m.group(1)}" if work_id_m else None

            work = None
            if target_key and target_key in apollo:
                work = apollo[target_key]
            else:
                for k, v in apollo.items():
                    if k.startswith("Work:") and "title" in v and "introduction" in v:
                        work = v
                        break

            if work:
                info["title"] = work.get("title", "")
                info["catchphrase"] = work.get("catchphrase", "")
                info["introduction"] = work.get("introduction", "")
                info["genre"] = work.get("genre", "")
                info["episodes_count"] = work.get("totalEpisodeCount", 0)
                
                # 작가
                author_ref = work.get("author", {})
                if isinstance(author_ref, dict) and "__ref" in author_ref:
                    user_data = apollo.get(author_ref["__ref"], {})
                    info["author"] = user_data.get("activityName", user_data.get("name", ""))
                
                # 태그
                tags = work.get("tagLabels", [])
                if tags:
                    info["tags"] = tags
                return info
        except Exception:
            pass

    # 2. HTML Fallback 파싱
    parser = LexborHTMLParser(html)
    t_tag = parser.css_first('h1, title')
    if t_tag:
        info["title"] = t_tag.text(deep=True).strip()
    
    intro_el = parser.css_first('div[class*="CollapseTextWithKakuyomuLinks_collapseText"]')
    if intro_el:
        info["introduction"] = intro_el.text(deep=True).strip()

    catch_el = parser.css_first('div[class*="EyeCatch_catchphrase"]')
    if catch_el:
        info["catchphrase"] = catch_el.text(deep=True).strip()

    return info

def parse_syosetu(html: str, url: str) -> dict:
    """소설가가 되자 / 노벨18 파싱"""
    info = {
        "site": "Syosetu",
        "url": url,
        "title": "",
        "author": "",
        "catchphrase": "",
        "introduction": "",
        "tags": [],
        "genre": "",
        "episodes_count": 0
    }
    parser = LexborHTMLParser(html)
    
    title_el = parser.css_first('p.novel_title, h1.p-novel__title')
    if title_el:
        info["title"] = title_el.text(deep=True).strip()
    else:
        title_tag = parser.css_first('title')
        if title_tag:
            info["title"] = title_tag.text(deep=True).strip()

    writer_el = parser.css_first('div.novel_writername, div.p-novel__author')
    if writer_el:
        info["author"] = writer_el.text(deep=True).strip()

    ex_el = parser.css_first('#novel_ex, div.p-novel__summary')
    if ex_el:
        info["introduction"] = ex_el.text(deep=True).strip()

    return info

def parse_generic(html: str, url: str) -> dict:
    """일반 사이트 Fallback 파싱"""
    parser = LexborHTMLParser(html)
    title_tag = parser.css_first('title')
    info = {
        "site": "Generic",
        "url": url,
        "title": title_tag.text(deep=True).strip() if title_tag else "",
        "author": "",
        "catchphrase": "",
        "introduction": "",
        "tags": []
    }
    desc = parser.css_first('meta[name="description"], meta[property="og:description"]')
    if desc and desc.attributes.get('content'):
        info["introduction"] = desc.attributes.get('content', '').strip()
    return info

def extract_novel_info(url_or_path: str) -> dict:
    html = fetch_html(url_or_path)
    if "kakuyomu.jp" in url_or_path:
        data = parse_kakuyomu(html, url_or_path)
    elif "syosetu.com" in url_or_path:
        data = parse_syosetu(html, url_or_path)
    else:
        # 내용 기반 판별
        if "kakuyomu" in html:
            data = parse_kakuyomu(html, url_or_path)
        elif "syosetu" in html:
            data = parse_syosetu(html, url_or_path)
        else:
            data = parse_generic(html, url_or_path)
    return data

def main():
    target = ""
    if len(sys.argv) > 1:
        target = sys.argv[1].strip()
    elif MANUAL_URL.strip():
        target = MANUAL_URL.strip()
    elif TARGET_URL_FILE.exists():
        lines = [line.strip() for line in TARGET_URL_FILE.read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#')]
        if lines:
            target = lines[0]

    if not target:
        print("[!] 타겟 URL이 없습니다. target_url.txt를 수정하거나 인자로 URL을 전달하세요.")
        print("예시: python scripts\\novel_inspector\\fetch_novel.py \"https://kakuyomu.jp/works/...\"")
        return

    print(f"[*] 소설 정보 분석 중: {target}")
    try:
        info = extract_novel_info(target)
    except Exception as e:
        print(f"[!] 추출 실패: {e}")
        return

    # 화면 출력
    divider = "=" * 60
    print(f"\n{divider}")
    print(f"📌 [사이트] {info.get('site', 'Unknown')}")
    print(f"📖 [제목]   {info.get('title', '')}")
    if info.get('author'):
        print(f"✍️ [작가]   {info.get('author', '')}")
    if info.get('catchphrase'):
        print(f"💬 [캐치]   {info.get('catchphrase', '')}")
    if info.get('genre'):
        print(f"🏷️ [장르]   {info.get('genre', '')}")
    if info.get('tags'):
        print(f"🏷️ [태그]   {', '.join(info.get('tags', []))}")
    print(f"{divider}")
    print(f"📝 [줄거리]\n{info.get('introduction', '(줄거리 없음)')}")
    print(f"{divider}\n")

    # 결과 파일 저장
    json_path = OUTPUT_DIR / "last_novel.json"
    txt_path = OUTPUT_DIR / "last_summary.txt"

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(info, f, ensure_ascii=False, indent=2)

    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write(f"Title: {info.get('title')}\n")
        f.write(f"Author: {info.get('author')}\n")
        f.write(f"Catchphrase: {info.get('catchphrase')}\n")
        f.write(f"URL: {info.get('url')}\n\n")
        f.write(f"Introduction:\n{info.get('introduction')}\n")

    print("[*] 결과 저장 완료:")
    print(f"  - {json_path}")
    print(f"  - {txt_path}")

if __name__ == "__main__":
    main()
