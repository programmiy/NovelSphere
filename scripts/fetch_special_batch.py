#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LANOVEL Special Batch Fetcher
다중 소설 목차(TOC) 큐로부터 미번역 회차(1화부터 순차)를 자동 감지하여
본문 문단들을 30~50문단 단위의 배치로 추출하는 스크립트.
"""

import sys
import os
import json
import time
import argparse
import re
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

# Windows 콘솔 인코딩 대응
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from server.database import SessionLocal
from server.models import Translation, SpecialBatchQueue

STAGING_DIR = os.path.join(APP_ROOT, 'scripts', 'special_staging')
TARGETS_FILE = os.path.join(APP_ROOT, 'scripts', 'novel_targets.txt')
STATE_FILE = os.path.join(STAGING_DIR, 'staging_state.json')
PENDING_FILE = os.path.join(STAGING_DIR, 'pending_batch.json')

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8,ko;q=0.7",
}

COOKIES = {
    "over18": "yes"
}

def load_targets(file_path=TARGETS_FILE) -> list:
    if not os.path.exists(file_path):
        return []
    urls = []
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                urls.append(line)
    return urls

def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"current_novel_index": 0, "current_chapter_url": None, "current_offset": 0}

def save_state(state: dict):
    os.makedirs(STAGING_DIR, exist_ok=True)
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

def fetch_html(url: str) -> str:
    cookies = dict(COOKIES)
    resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=25)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding
    return resp.text

def parse_novel_toc(toc_url: str) -> tuple:
    """소설 목차에서 (소설 제목, 회차 리스트 [{'title': ..., 'url': ...}]) 반환"""
    html = fetch_html(toc_url)
    soup = BeautifulSoup(html, 'html.parser')
    
    novel_title = ""
    episodes = []

    # 1. Kakuyomu
    if "kakuyomu.jp" in toc_url:
        next_data_script = soup.find('script', id='__NEXT_DATA__')
        if next_data_script and next_data_script.string:
            json_data = json.loads(next_data_script.string)
            apollo = json_data['props']['pageProps']['__APOLLO_STATE__']
            work_ref = next((k for k in apollo.keys() if k.startswith('Work:')), None)
            if work_ref and work_ref in apollo:
                novel_title = apollo[work_ref].get('title', '')
                work_id = work_ref.split(':')[1]
                
                # 에피소드 추출
                for k, v in apollo.items():
                    if k.startswith('Episode:') and isinstance(v, dict):
                        ep_id = v.get('id')
                        ep_title = v.get('title', '')
                        if ep_id and ep_title:
                            episodes.append({
                                "title": ep_title,
                                "url": f"https://kakuyomu.jp/works/{work_id}/episodes/{ep_id}"
                            })
        if not novel_title:
            t_el = soup.find('h1') or soup.find('title')
            novel_title = t_el.text.strip() if t_el else "카쿠요무 소설"

    # 2. Syosetu / Novel18
    elif "syosetu.com" in toc_url:
        # 소설 제목
        title_el = soup.find('p', class_='novel_title') or soup.find('h1', class_='p-novel__title') or soup.find('title')
        novel_title = title_el.text.strip() if title_el else "쇼세츠 소설"
        novel_title = re.sub(r'\s*-\s*(小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ).*$', '', novel_title).strip()

        # 회차 목록
        current_url = toc_url
        page = 1
        while current_url and page <= 50:
            if page > 1:
                html = fetch_html(current_url)
                soup = BeautifulSoup(html, 'html.parser')
            
            page_episodes = []
            # 신형 .p-eplist
            eplist = soup.find('div', class_='p-eplist')
            if eplist:
                for a in eplist.find_all('a', class_='p-eplist__subtitle'):
                    t = a.text.strip()
                    href = a.get('href')
                    if t and href:
                        page_episodes.append({"title": t, "url": urljoin(current_url, href)})
            # 구형 .index_box
            if not page_episodes:
                index_box = soup.find('div', class_='index_box')
                if index_box:
                    for dd in index_box.find_all('dd', class_='subtitle'):
                        a = dd.find('a')
                        if a and a.get('href'):
                            page_episodes.append({"title": a.text.strip(), "url": urljoin(current_url, a.get('href'))})

            if not page_episodes:
                break
            episodes.extend(page_episodes)

            # 다음 페이지 목차
            next_link = soup.find('a', class_='c-pager__item--next') or soup.find('a', rel='next')
            if next_link and next_link.get('href'):
                current_url = urljoin(current_url, next_link.get('href'))
                page += 1
            else:
                break

    # 3. Hameln
    elif "syosetu.org" in toc_url or "hameln" in toc_url:
        title_el = soup.find('span', itemprop='name') or soup.find('title')
        novel_title = title_el.text.strip() if title_el else "하멜른 소설"
        for a in soup.find_all('a'):
            href = a.get('href', '')
            if re.search(r'/\d+\.html$', href) or re.search(r'/novel/\d+/\d+\.html', href):
                episodes.append({"title": a.text.strip(), "url": urljoin(toc_url, href)})

    # Fallback
    if not episodes:
        for a in soup.find_all('a'):
            href = a.get('href', '')
            if href and any(p in href for p in ['/episode/', '/novel/', '/story/']) and a.text.strip():
                episodes.append({"title": a.text.strip(), "url": urljoin(toc_url, href)})

    # 중복 제거
    unique_episodes = []
    seen = set()
    for ep in episodes:
        clean_u = ep['url'].split('#')[0].rstrip('/')
        if clean_u not in seen:
            seen.add(clean_u)
            unique_episodes.append(ep)

    return novel_title, unique_episodes

def extract_chapter_paragraphs(chapter_url: str) -> list:
    """회차 본문 HTML에서 번역 대상 문단 [{'id': pid, 'text': text}] 추출"""
    html = fetch_html(chapter_url)
    soup = BeautifulSoup(html, 'html.parser')

    container = (
        soup.find('div', id='novel_honbun') or
        soup.find('div', class_='p-novel__body') or
        soup.find('div', class_='widget-episodeBody') or
        soup.find('div', id='honbun') or
        soup.find('div', id='episode_content') or
        soup
    )

    paragraphs = []
    pid_regex = re.compile(r'^[a-zA-Z][a-zA-Z0-9]*$')
    p_tags = container.find_all('p')

    for idx, p in enumerate(p_tags):
        pid = p.get('id')
        if not pid or not pid_regex.match(pid):
            pid = f"L{idx+1}"
        
        # class="blank" 제거
        classes = p.get('class', [])
        if 'blank' in classes:
            continue

        raw_text = p.get_text()
        text = raw_text.strip()
        if not text:
            continue

        paragraphs.append({"id": pid, "text": text})

    return paragraphs

def check_untranslated_episodes(episodes: list, db) -> list:
    """DB에 등록되지 않은(미번역 및 미적재) 회차만 필터링"""
    if not episodes:
        return []
    
    # URL 정규화 목록
    urls = [ep['url'].split('#')[0].rstrip('/') for ep in episodes]

    # 1. 본 DB(translations)에 이미 존재하는 URL
    existing_trans_urls = set()
    if urls:
        rows = db.query(Translation.url).filter(Translation.url.in_(urls)).distinct().all()
        for r in rows:
            existing_trans_urls.add(r[0].split('#')[0].rstrip('/'))

    # 2. 스테이징 큐(special_batch_queue)에 이미 적재된 URL
    staged_urls = set()
    if urls:
        rows = db.query(SpecialBatchQueue.url).filter(SpecialBatchQueue.url.in_(urls)).distinct().all()
        for r in rows:
            staged_urls.add(r[0].split('#')[0].rstrip('/'))

    untranslated = []
    for idx, ep in enumerate(episodes):
        clean_u = ep['url'].split('#')[0].rstrip('/')
        if clean_u not in existing_trans_urls and clean_u not in staged_urls:
            ep_copy = dict(ep)
            ep_copy['index'] = idx + 1
            untranslated.append(ep_copy)

    return untranslated

def get_next_batch(batch_size=40, toc_url_arg=None):
    db = SessionLocal()
    try:
        targets = [toc_url_arg] if toc_url_arg else load_targets()
        if not targets:
            print("❌ 소설 목차 URL이 지정되지 않았습니다.")
            print("   사용법 1: python scripts/fetch_special_batch.py --toc-url <URL>")
            print("   사용법 2: scripts/novel_targets.txt 파일에 소설 목차 URL들을 추가하세요.")
            sys.exit(1)

        state = load_state()
        novel_idx = state.get("current_novel_index", 0)

        # 현재 소설부터 순서대로 미번역 회차 탐색
        while novel_idx < len(targets):
            current_toc_url = targets[novel_idx]
            print(f"📖 [{novel_idx+1}/{len(targets)}] 소설 목차 확인 중: {current_toc_url}")
            
            try:
                novel_title, all_episodes = parse_novel_toc(current_toc_url)
            except Exception as e:
                print(f"⚠️ 목차 파싱 실패 ({e}), 다음 소설로 넘어갑니다.")
                novel_idx += 1
                state["current_novel_index"] = novel_idx
                state["current_chapter_url"] = None
                state["current_offset"] = 0
                save_state(state)
                continue

            print(f"   -> 작품명: '{novel_title}' (총 {len(all_episodes)}개 회차 감지)")
            
            untranslated = check_untranslated_episodes(all_episodes, db)
            print(f"   -> 미번역/미적재 잔여 회차: {len(untranslated)}개")

            if not untranslated:
                print(f"🎉 '{novel_title}'의 모든 회차가 이미 번역/적재 완료되었습니다! 다음 소설로 전이합니다.")
                novel_idx += 1
                state["current_novel_index"] = novel_idx
                state["current_chapter_url"] = None
                state["current_offset"] = 0
                save_state(state)
                continue

            # 미번역 회차 중 첫 번째(1화 또는 가장 빠른 미번역화) 선택
            target_ep = untranslated[0]
            chapter_url = target_ep['url']
            chapter_title = target_ep['title']
            chapter_index = target_ep['index']

            # 오프셋 체크
            offset = 0
            if state.get("current_chapter_url") == chapter_url:
                offset = state.get("current_offset", 0)

            print(f"\n⚡ [대상 회차 선정 완료]")
            print(f"   * 소설명 : {novel_title}")
            print(f"   * 회차   : 제 {chapter_index}화 - '{chapter_title}'")
            print(f"   * URL    : {chapter_url}")
            print(f"   * 오프셋 : {offset}문단부터 추출")

            # 본문 문단 추출
            paragraphs = extract_chapter_paragraphs(chapter_url)
            total_paragraphs = len(paragraphs)
            print(f"   * 전체 본문 문단: {total_paragraphs}개")

            if offset >= total_paragraphs:
                # 이미 해당 회차 본문이 모두 소화된 경우 다음 회차로
                state["current_chapter_url"] = None
                state["current_offset"] = 0
                save_state(state)
                continue

            chunk_items = paragraphs[offset:offset + batch_size]
            next_offset = offset + len(chunk_items)
            is_chapter_finished = (next_offset >= total_paragraphs)

            # 배치 ID 생성
            batch_id = f"batch_{int(time.time())}_{chapter_index}_{offset//batch_size + 1}"

            batch_data = {
                "batch_id": batch_id,
                "novel_title": novel_title,
                "folder_name": novel_title,
                "toc_url": current_toc_url,
                "chapter_title": chapter_title,
                "chapter_url": chapter_url,
                "chapter_index": chapter_index,
                "offset": offset,
                "next_offset": 0 if is_chapter_finished else next_offset,
                "total_paragraphs": total_paragraphs,
                "is_chapter_finished": is_chapter_finished,
                "items": chunk_items
            }

            # 파일 저장
            os.makedirs(STAGING_DIR, exist_ok=True)
            with open(PENDING_FILE, 'w', encoding='utf-8') as f:
                json.dump(batch_data, f, ensure_ascii=False, indent=2)

            # 상태 저장 (임시 오프셋)
            state["current_novel_index"] = novel_idx
            state["current_chapter_url"] = chapter_url
            state["current_offset"] = offset
            state["pending_batch_id"] = batch_id
            save_state(state)

            return batch_data

        print("\n🏆 축하합니다! 모든 소설 목록의 모든 회차가 번역/적재 완료되었습니다.")
        return None

    finally:
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="LANOVEL 특별 적재 미번역 문단 배치 추출기")
    parser.add_argument("--toc-url", type=str, default="", help="특정 소설 목차 URL 직접 지정")
    parser.add_argument("--batch-size", type=int, default=40, help="1회 배치당 문단 수 (기본값: 40)")
    args = parser.parse_args()

    batch = get_next_batch(batch_size=args.batch_size, toc_url_arg=args.toc_url)
    if batch:
        print("\n" + "=" * 65)
        print(f"🚀 [배치 추출 완료] BATCH_ID: {batch['batch_id']}")
        print(f" * 소설    : {batch['novel_title']}")
        print(f" * 회차    : 제 {batch['chapter_index']}화 - {batch['chapter_title']}")
        print(f" * 문단 수 : {len(batch['items'])}문단 ({batch['offset']+1} ~ {batch['offset']+len(batch['items'])} / 전체 {batch['total_paragraphs']})")
        print(f" * 완료 여부: {'이 회차 완결' if batch['is_chapter_finished'] else '이후 문단 잔여'}")
        print("=" * 65)
        print("\n📋 [어시스턴트 번역 입력 JSON]:")
        input_for_agent = [{"id": it["id"], "text": it["text"]} for it in batch["items"]]
        print(json.dumps(input_for_agent, ensure_ascii=False, indent=2))
        print("\n💡 어시스턴트는 위 JSON 배열을 TRANSLATION_SYSTEM_INSTRUCTION 규칙에 따라 번역하여 JSON으로 응답한 후 insert_special_batch.py를 실행하세요.")
