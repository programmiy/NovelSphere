import re
import requests
import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from bs4 import BeautifulSoup
from urllib.parse import urljoin

router = APIRouter()
logger = logging.getLogger(__name__)

class TocUrl(BaseModel):
    toc_url: str

@router.post(
    "/api/import-toc",
    tags=["TOC Importer"],
    summary="목차 가져오기",
    description="Kakuyomu, Syosetu 또는 NovelUp URL에서 목차(Table of Contents)를 가져옵니다."
)
async def import_toc(item: TocUrl):
    toc_url = item.toc_url.strip()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    cookies = {}
    if "novel18.syosetu.com" in toc_url:
        cookies['over18'] = 'yes'

    if "kakuyomu.jp" in toc_url:
        try:
            response = requests.get(toc_url, headers=headers, cookies=cookies, timeout=20)
            response.raise_for_status()
            response.encoding = response.apparent_encoding
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=400, detail=f"Kakuyomu 페이지를 가져오는 데 실패했습니다: {e}")
        return parse_kakuyomu(response.text, toc_url)

    elif "syosetu.com" in toc_url:
        return fetch_all_syosetu_chapters(toc_url, headers, cookies)

    elif "novelup.plus" in toc_url:
        return fetch_all_novelup_chapters(toc_url, headers)

    else:
        raise HTTPException(status_code=400, detail="지원되지 않는 URL입니다. Kakuyomu, Syosetu 또는 NovelUp URL을 제공해주세요.")

def parse_kakuyomu(html_content: str, base_url: str):
    soup = BeautifulSoup(html_content, 'html.parser')
    next_data_script = soup.find('script', id='__NEXT_DATA__')
    
    if not next_data_script:
        raise HTTPException(status_code=404, detail="Kakuyomu 페이지에서 __NEXT_DATA__ 스크립트를 찾을 수 없습니다.")

    try:
        json_data = json.loads(next_data_script.string)
        apollo_state = json_data['props']['pageProps']['__APOLLO_STATE__']

        # Find the main work object reference
        root_query = apollo_state.get('ROOT_QUERY', {})
        work_key = next((k for k in root_query if k.startswith('work(')), None)
        if work_key and '__ref' in root_query[work_key]:
            work_ref = root_query[work_key]['__ref']
            work_id = work_ref.split(':')[1] if ':' in work_ref else work_ref
        else:
            work_ref = next((k for k in apollo_state if k.startswith('Work:')), None)
            if not work_ref:
                raise HTTPException(status_code=404, detail="작품 메타데이터(Work)를 찾을 수 없습니다.")
            work_id = work_ref.split(':')[1]

        work_obj = apollo_state.get(work_ref, {})
        all_episodes = []

        def get_episode_details(episode_ref):
            ref_key = episode_ref.get('__ref') if isinstance(episode_ref, dict) else episode_ref
            episode_data = apollo_state.get(ref_key)
            if not episode_data:
                return None
            episode_id = episode_data.get('id')
            title = episode_data.get('title')
            if episode_id and title:
                url = f"https://kakuyomu.jp/works/{work_id}/episodes/{episode_id}"
                return {"title": title, "url": url}
            return None

        # Recursive function to process chapters and their children
        def process_chapter(chapter_ref):
            ref_key = chapter_ref.get('__ref') if isinstance(chapter_ref, dict) else chapter_ref
            chapter_data = apollo_state.get(ref_key)
            if not chapter_data:
                return

            # Process episodes in the current chapter
            episodes = chapter_data.get('episodeUnions') or []
            for ep_ref in episodes:
                episode_details = get_episode_details(ep_ref)
                if episode_details:
                    all_episodes.append(episode_details)
            
            # Process child chapters recursively
            children = chapter_data.get('childChapterUnions') or []
            for child_ref in children:
                process_chapter(child_ref)

        # Support both tableOfContentsV2 (new) and tableOfContents (legacy)
        root_toc_refs = work_obj.get('tableOfContentsV2') or work_obj.get('tableOfContents') or []
        for toc_ref in root_toc_refs:
            process_chapter(toc_ref)

        # Fallback for short stories or direct episodes
        if not all_episodes and work_obj.get('episodeUnions'):
            for ep_ref in work_obj['episodeUnions']:
                ep_details = get_episode_details(ep_ref)
                if ep_details:
                    all_episodes.append(ep_details)

        if not all_episodes:
            raise HTTPException(status_code=404, detail="JSON 데이터에서 챕터 목록을 찾을 수 없습니다.")

        return all_episodes

    except HTTPException:
        raise
    except (KeyError, json.JSONDecodeError, StopIteration) as e:
        raise HTTPException(status_code=500, detail=f"Kakuyomu JSON 데이터 파싱 중 오류 발생: {e}")

def fetch_all_syosetu_chapters(start_url: str, headers: dict, cookies: dict):
    chapters = []
    current_url = start_url
    page = 1
    max_pages = 100  # safety cap for very long web novels

    while current_url and page <= max_pages:
        try:
            response = requests.get(current_url, headers=headers, cookies=cookies, timeout=20)
            response.raise_for_status()
            response.encoding = response.apparent_encoding
        except requests.exceptions.RequestException as e:
            if page > 1 and chapters:
                # If subsequent pages fail, return what we collected so far
                logger.warning(f"쇼세츠 페이지 {page} 가져오기 실패 ({e}), 지금까지 수집된 {len(chapters)}개 챕터를 반환합니다.")
                break
            raise HTTPException(status_code=400, detail=f"Syosetu 페이지를 가져오는 데 실패했습니다: {e}")

        soup = BeautifulSoup(response.text, 'html.parser')
        page_chapters = []

        # 1. New layout (e.g., novel18) uses .p-eplist
        eplist = soup.find('div', class_='p-eplist')
        if eplist:
            links = eplist.find_all('a', class_='p-eplist__subtitle')
            for link in links:
                title = link.text.strip()
                relative_url = link.get('href')
                if title and relative_url:
                    # NOTE: Do NOT use .lstrip('/') on relative_url! urljoin handles leading '/' properly.
                    absolute_url = urljoin(current_url, relative_url)
                    page_chapters.append({"title": title, "url": absolute_url})

        # 2. Standard series layout: .index_box
        if not page_chapters:
            index_box = soup.find('div', class_='index_box')
            if index_box:
                chapter_links = index_box.find_all('dd', class_='subtitle')
                for chapter_dd in chapter_links:
                    link = chapter_dd.find('a')
                    if link:
                        title = link.text.strip()
                        relative_url = link.get('href')
                        if title and relative_url:
                            absolute_url = urljoin(current_url, relative_url)
                            page_chapters.append({"title": title, "url": absolute_url})

        # 3. Fallback: .chapter_list
        if not page_chapters:
            chapter_list = soup.find('div', class_='chapter_list')
            if chapter_list:
                links = chapter_list.find_all('a')
                for link in links:
                    title = link.text.strip()
                    relative_url = link.get('href')
                    if title and relative_url:
                        absolute_url = urljoin(current_url, relative_url)
                        page_chapters.append({"title": title, "url": absolute_url})

        if not page_chapters:
            if page == 1:
                raise HTTPException(status_code=404, detail="Syosetu 목차를 찾을 수 없습니다. 지원되는 페이지 구조가 아닙니다.")
            break

        chapters.extend(page_chapters)

        # Check for next page link in pagination
        next_link = (
            soup.find('a', class_='c-pager__item--next')
            or soup.find('a', rel='next')
            or soup.select_one('.c-pager__pager a[href*="?p="]:has(span:-soup-contains("次")), a:-soup-contains("次へ")')
        )

        if next_link and next_link.get('href'):
            next_url = urljoin(current_url, next_link.get('href'))
            if next_url == current_url:
                break
            current_url = next_url
            page += 1
        else:
            break

    return chapters


def fetch_all_novelup_chapters(start_url: str, headers: dict):
    match = re.search(r'https?://novelup\.plus/story/(\d+)', start_url)
    if not match:
        raise HTTPException(status_code=400, detail="유효한 NovelUp 작품 URL이 아닙니다. (예: https://novelup.plus/story/...)")
    
    story_id = match.group(1)
    base_story_url = f"https://novelup.plus/story/{story_id}"
    
    chapters = []
    page = 1
    max_pages = 100

    while page <= max_pages:
        url = base_story_url if page == 1 else f"{base_story_url}?p={page}"
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding
        except requests.exceptions.RequestException as e:
            if page > 1 and chapters:
                logger.warning(f"NovelUp 페이지 {page} 가져오기 실패 ({e}), 지금까지 수집된 {len(chapters)}개 챕터를 반환합니다.")
                break
            raise HTTPException(status_code=400, detail=f"NovelUp 페이지를 가져오는 데 실패했습니다: {e}")

        soup = BeautifulSoup(resp.text, 'html.parser')

        ep_links = soup.select('.episodeListItem a.episodeTitle, #section_episode a.episodeTitle')
        if not ep_links:
            ep_links = [
                a for a in soup.select(f'a[href*="/story/{story_id}/"]')
                if re.search(rf'/story/{story_id}/\d+$', a.get('href', ''))
            ]

        page_chapters = []
        for a in ep_links:
            title = a.get_text(strip=True)
            href = a.get('href')
            if title and href:
                full_url = urljoin(base_story_url, href)
                if not any(c['url'] == full_url for c in chapters) and not any(c['url'] == full_url for c in page_chapters):
                    page_chapters.append({"title": title, "url": full_url})

        if not page_chapters:
            if page == 1:
                raise HTTPException(status_code=404, detail="NovelUp 목차를 찾을 수 없습니다. 지원되는 페이지 구조가 아닙니다.")
            break

        chapters.extend(page_chapters)

        has_next_page = False
        pagination_links = soup.select('.pagination a, .section_pagination a')
        for plink in pagination_links:
            phref = plink.get('href', '')
            if f'p={page + 1}' in phref:
                has_next_page = True
                break

        if not has_next_page:
            break

        page += 1

    return chapters