import requests
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from bs4 import BeautifulSoup
from urllib.parse import urljoin

router = APIRouter()

class TocUrl(BaseModel):
    toc_url: str

@router.post(
    "/api/import-toc",
    tags=["TOC Importer"],
    summary="목차 가져오기",
    description="Kakuyomu 또는 Syosetu URL에서 목차(Table of Contents)를 가져옵니다."
)
async def import_toc(item: TocUrl):
    toc_url = item.toc_url
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    }
    cookies = {}
    if "novel18.syosetu.com" in toc_url:
        cookies['over18'] = 'yes'

    try:
        response = requests.get(toc_url, headers=headers, cookies=cookies, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=400, detail=f"URL에서 콘텐츠를 가져오는 데 실패했습니다: {e}")

    if "kakuyomu.jp" in toc_url:
        return parse_kakuyomu(response.text, toc_url)
    elif "syosetu.com" in toc_url:
        return parse_syosetu(response.text, toc_url)
    else:
        raise HTTPException(status_code=400, detail="지원되지 않는 URL입니다. Kakuyomu 또는 Syosetu URL을 제공해주세요.")

def parse_kakuyomu(html_content: str, base_url: str):
    soup = BeautifulSoup(html_content, 'html.parser')
    next_data_script = soup.find('script', id='__NEXT_DATA__')
    
    if not next_data_script:
        raise HTTPException(status_code=404, detail="Kakuyomu 페이지에서 __NEXT_DATA__ 스크립트를 찾을 수 없습니다.")

    try:
        json_data = json.loads(next_data_script.string)
        apollo_state = json_data['props']['pageProps']['__APOLLO_STATE__']

        # Find the main work object reference
        work_key = next(key for key in apollo_state['ROOT_QUERY'] if key.startswith('work('))
        work_ref = apollo_state['ROOT_QUERY'][work_key]['__ref']
        work_id = work_ref.split(':')[1]

        # This list will hold the final, flattened list of all episodes in order
        all_episodes = []

        def get_episode_details(episode_ref):
            episode_data = apollo_state.get(episode_ref['__ref'])
            if not episode_data:
                return None
            episode_id = episode_data['id']
            title = episode_data['title']
            url = f"https://kakuyomu.jp/works/{work_id}/episodes/{episode_id}"
            return {"title": title, "url": url}

        # Recursive function to process chapters and their children
        def process_chapter(chapter_ref):
            chapter_data = apollo_state.get(chapter_ref['__ref'])
            if not chapter_data:
                return

            # Process episodes in the current chapter
            if chapter_data.get('episodeUnions'):
                for episode_ref in chapter_data['episodeUnions']:
                    episode_details = get_episode_details(episode_ref)
                    if episode_details:
                        all_episodes.append(episode_details)
            
            # Process child chapters recursively
            # Based on inspection, the field is named 'childChapterUnions'
            if chapter_data.get('childChapterUnions'):
                for child_chapter_ref in chapter_data['childChapterUnions']:
                    process_chapter(child_chapter_ref)

        # Start processing from the root chapters in the table of contents
        root_toc_refs = apollo_state[work_ref].get('tableOfContents', [])
        for toc_ref in root_toc_refs:
            process_chapter(toc_ref)

        if not all_episodes:
            raise HTTPException(status_code=404, detail="JSON 데이터에서 챕터 목록을 찾을 수 없습니다.")

        return all_episodes

    except (KeyError, json.JSONDecodeError, StopIteration) as e:
        raise HTTPException(status_code=500, detail=f"Kakuyomu JSON 데이터 파싱 중 오류 발생: {e}")

def parse_syosetu(html_content: str, base_url: str):
    soup = BeautifulSoup(html_content, 'html.parser')
    chapters = []

    # New layout (e.g., novel18) uses .p-eplist
    eplist = soup.find('div', class_='p-eplist')
    if eplist:
        links = eplist.find_all('a', class_='p-eplist__subtitle')
        for link in links:
            title = link.text.strip()
            relative_url = link.get('href')
            if title and relative_url:
                absolute_url = urljoin(base_url, relative_url.lstrip('/'))
                chapters.append({"title": title, "url": absolute_url})
        if chapters:
            return chapters

    # Standard series layout
    index_box = soup.find('div', class_='index_box')
    if index_box:
        chapter_links = index_box.find_all('dd', class_='subtitle')
        for chapter_dd in chapter_links:
            link = chapter_dd.find('a')
            if link:
                title = link.text.strip()
                relative_url = link.get('href')
                if title and relative_url:
                    absolute_url = urljoin(base_url, relative_url.lstrip('/'))
                    chapters.append({"title": title, "url": absolute_url})
        if chapters:
            return chapters

    # Fallback for alternate layouts
    chapter_list = soup.find('div', class_='chapter_list')
    if chapter_list:
        links = chapter_list.find_all('a')
        for link in links:
            title = link.text.strip()
            relative_url = link.get('href')
            if title and relative_url:
                absolute_url = urljoin(base_url, relative_url.lstrip('/'))
                chapters.append({"title": title, "url": absolute_url})
        if chapters:
            return chapters

    # If no chapters found by any method, raise error
    raise HTTPException(status_code=404, detail="Syosetu 목차를 찾을 수 없습니다. 지원되는 페이지 구조가 아닙니다.")