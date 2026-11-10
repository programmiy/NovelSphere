"""
collector_service.py: 검열 회피 및 수동 번역용 원문 전용 소설 수집 서비스.

Gemini API 호출 없이 원문(original)만 웹소설 사이트에서 초고속 크롤링하여
translations 테이블에 번역문(translated="") 빈칸 상태로 안전하게 저장합니다.
- 지원 사이트: 소설가가 되자/녹턴(성인인증 쿠키 포함), 카쿠요무, 노벨업, 하멜른, 알파폴리스 등
- 12화마다 120초(2분) 안전 쿨다운 적용으로 웹사이트 IP 차단 원천 방지
- 기저장 회차 0초 스킵 (A안)
- 수집된 소설은 ManualTranslationNovel 레지스트리에 자동 등록되어 빈칸 감지기 및 복원센터 예외 처리
- SSE 실시간 이벤트 스트림으로 진행률, 로그, 쿨다운 타이머 브로드캐스트
"""

import asyncio
import json
import logging
import re
import threading
import time
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

import server.database as sdb
from server.models import ManualTranslationNovel, Translation
from server.security import is_safe_external_url

logger = logging.getLogger(__name__)

# 기본 HTTP 헤더
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8,ko;q=0.7",
}

# 18금 성인 인증 쿠키 (녹턴, 문라이트, 미드나이트 등)
ADULT_COOKIES = {
    "over18": "yes"
}


# ---------------------------------------------------------------------------
# 목차 파서 (Table of Contents Parsers)
# ---------------------------------------------------------------------------

def fetch_toc_and_title(raw_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """
    소설 목차 URL에서 소설 제목과 전체 회차 목록([{title, url, sort_order}])을 파싱합니다.
    """
    url = raw_url.strip()
    if not is_safe_external_url(url):
        raise ValueError("안전하지 않은 외부 URL입니다.")

    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()

    if "kakuyomu.jp" in host:
        return _parse_kakuyomu_toc(url)
    elif "syosetu.com" in host:
        return _parse_syosetu_toc(url)
    elif "novelup.plus" in host:
        return _parse_novelup_toc(url)
    elif "syosetu.org" in host:
        return _parse_hameln_toc(url)
    elif "alphapolis.co.jp" in host:
        return _parse_alphapolis_toc(url)
    else:
        return _parse_generic_toc(url)


def _get_request_cookies(url: str) -> Dict[str, str]:
    if any(h in url for h in ["novel18.syosetu.com", "noc.syosetu.com", "mid.syosetu.com"]):
        return ADULT_COOKIES
    return {}


def _parse_syosetu_toc(toc_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """소설가가 되자 / 녹턴 100화 단위 페이징 목차 수집"""
    cookies = _get_request_cookies(toc_url)
    episodes: List[Dict[str, Any]] = []
    novel_title = ""

    clean_url = toc_url.split("?")[0].rstrip("/")
    # 본문 회차 URL인 경우(/1/, /2/) 목차 URL(/)로 정규화
    clean_url = re.sub(r'/\d+/?$', '', clean_url)
    if not clean_url.endswith('/'):
        clean_url += '/'

    current_page = 1
    sort_order = 1

    while True:
        page_url = f"{clean_url}?p={current_page}" if current_page > 1 else clean_url
        try:
            resp = requests.get(page_url, headers=DEFAULT_HEADERS, cookies=cookies, timeout=20)
            # 2페이지 이상에서 404가 발생하면 목차의 끝(마지막 페이지 초과)에 도달한 것이므로 정상 완료 처리
            if current_page > 1 and resp.status_code == 404:
                break
            resp.raise_for_status()
        except requests.exceptions.HTTPError as he:
            if current_page > 1 and getattr(he.response, "status_code", None) == 404:
                break
            raise he

        resp.encoding = resp.apparent_encoding

        soup = BeautifulSoup(resp.text, 'html.parser')

        # 소설 제목 추출
        if not novel_title:
            title_el = (
                soup.select_one('.p-novel__title') or
                soup.select_one('.novel_title') or
                soup.select_one('a.p-novel__series-link')
            )
            if title_el and title_el.text.strip():
                novel_title = title_el.text.strip()
            elif soup.title and soup.title.text.strip():
                parts = soup.title.text.strip().split(' - ')
                novel_title = parts[0].strip()

        # 회차 링크 추출 (.p-eplist__sublist a 또는 .index_box a)
        chapter_links = soup.select('.p-eplist__sublist a, .index_box a')
        if not chapter_links:
            # 단편 소설이거나 목차가 없는 경우 본문 확인
            if soup.select_one('.p-novel__body, #novel_honbun'):
                ep_title = novel_title or "단편"
                ep_title_el = soup.select_one('.p-novel__title, .novel_subtitle')
                if ep_title_el and ep_title_el.text.strip():
                    ep_title = ep_title_el.text.strip()
                return novel_title or "소설", [{"title": ep_title, "url": clean_url, "sort_order": 1}]
            break

        for link in chapter_links:
            href = link.get('href')
            title = link.text.strip()
            if href:
                full_url = urljoin(page_url, href)
                # # 뒤 앵커 제거
                full_url = full_url.split('#')[0]
                episodes.append({
                    "title": title or f"제 {sort_order}화",
                    "url": full_url,
                    "sort_order": sort_order
                })
                sort_order += 1

        # 다음 목차 페이지 존재 여부 확인 (a 태그 및 href 필수, is-disabled 제외)
        pager_next = soup.select_one('a.c-pager__item--next[href], a.novelview_pager-next[href]')
        if not pager_next:
            break
        classes = pager_next.get('class', [])
        if 'is-disabled' in classes or not pager_next.get('href'):
            break

        current_page += 1

    return novel_title or "소설", episodes


def _parse_kakuyomu_toc(toc_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """카쿠요무 Apollo State 목차 수집"""
    resp = requests.get(toc_url, headers=DEFAULT_HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding

    soup = BeautifulSoup(resp.text, 'html.parser')
    script = soup.find('script', id='__NEXT_DATA__')
    if not script or not script.string:
        raise ValueError("카쿠요무 __NEXT_DATA__ 메타데이터를 찾을 수 없습니다.")

    data = json.loads(script.string)
    apollo = data.get('props', {}).get('pageProps', {}).get('__APOLLO_STATE__', {})

    root_query = apollo.get('ROOT_QUERY', {})
    work_key = next((k for k in root_query if k.startswith('work(')), None)
    if work_key and '__ref' in root_query[work_key]:
        work_ref = root_query[work_key]['__ref']
    else:
        work_ref = next((k for k in apollo if k.startswith('Work:')), None)

    if not work_ref or work_ref not in apollo:
        raise ValueError("카쿠요무 작품(Work) 객체를 찾을 수 없습니다.")

    work_obj = apollo[work_ref]
    work_id = work_ref.split(':')[1] if ':' in work_ref else work_ref
    novel_title = work_obj.get('title') or "카쿠요무 소설"

    episodes: List[Dict[str, Any]] = []
    sort_order = 1

    def extract_ep(ref_val):
        nonlocal sort_order
        r = ref_val.get('__ref') if isinstance(ref_val, dict) else ref_val
        edata = apollo.get(r)
        if edata and edata.get('id'):
            ep_id = edata.get('id')
            title = edata.get('title') or f"제 {sort_order}화"
            episodes.append({
                "title": title,
                "url": f"https://kakuyomu.jp/works/{work_id}/episodes/{ep_id}",
                "sort_order": sort_order
            })
            sort_order += 1

    def process_chapter(ch_ref):
        cr = ch_ref.get('__ref') if isinstance(ch_ref, dict) else ch_ref
        cdata = apollo.get(cr)
        if not cdata:
            return
        for e in cdata.get('episodeUnions') or []:
            extract_ep(e)
        for sub in cdata.get('chapters') or []:
            process_chapter(sub)

    table_of_contents = work_obj.get('tableOfContents') or []
    for item in table_of_contents:
        item_type = item.get('__typename') if isinstance(item, dict) else ''
        if item_type == 'Chapter':
            process_chapter(item)
        elif item_type == 'Episode':
            extract_ep(item)

    return novel_title, episodes


def _parse_novelup_toc(toc_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """NovelUp+ 목차 수집"""
    clean_url = toc_url.split("?")[0].rstrip("/")
    resp = requests.get(clean_url, headers=DEFAULT_HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding

    soup = BeautifulSoup(resp.text, 'html.parser')
    novel_title = ""
    title_el = soup.select_one('.novel_title, h1.title')
    if title_el and title_el.text.strip():
        novel_title = title_el.text.strip()
    elif soup.title and soup.title.text.strip():
        novel_title = soup.title.text.strip().split('|')[0].strip()

    episodes: List[Dict[str, Any]] = []
    sort_order = 1

    for a in soup.select('.episode_title a, .chapter_title a, a[href*="/story/"]'):
        href = a.get('href')
        txt = a.text.strip()
        if href and re.search(r'/story/\d+/\d+', href):
            full = urljoin(clean_url, href).split('#')[0]
            if not any(e['url'] == full for e in episodes):
                episodes.append({
                    "title": txt or f"제 {sort_order}화",
                    "url": full,
                    "sort_order": sort_order
                })
                sort_order += 1

    return novel_title or "노벨업 소설", episodes


def _parse_hameln_toc(toc_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """하멜른(syosetu.org) 목차 수집"""
    clean_url = toc_url.split("?")[0].rstrip("/")
    resp = requests.get(clean_url, headers=DEFAULT_HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding

    soup = BeautifulSoup(resp.text, 'html.parser')
    novel_title = ""
    title_el = soup.select_one('span.novel_title a, a[href*="/novel/"][style*="font-weight:bold"]')
    if title_el and title_el.text.strip():
        novel_title = title_el.text.strip()
    elif soup.title and soup.title.text.strip():
        novel_title = soup.title.text.strip().split(' - ')[-1].strip()

    episodes: List[Dict[str, Any]] = []
    sort_order = 1

    for a in soup.select('table a[href*="/novel/"]'):
        href = a.get('href')
        txt = a.text.strip()
        if href and (href.endswith('.html') or re.search(r'/\d+\.html', href)):
            full = urljoin(clean_url, href).split('#')[0]
            if not any(e['url'] == full for e in episodes):
                episodes.append({
                    "title": txt or f"제 {sort_order}화",
                    "url": full,
                    "sort_order": sort_order
                })
                sort_order += 1

    # 단편일 경우
    if not episodes and soup.select_one('#honbun'):
        episodes.append({
            "title": novel_title or "단편",
            "url": clean_url,
            "sort_order": 1
        })

    return novel_title or "하멜른 소설", episodes


def _parse_alphapolis_toc(toc_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """알파폴리스(alphapolis.co.jp) 목차 수집"""
    clean_url = toc_url.split("?")[0].rstrip("/")
    resp = requests.get(clean_url, headers=DEFAULT_HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding

    soup = BeautifulSoup(resp.text, 'html.parser')
    novel_title = ""
    title_el = soup.select_one('.title a, .novel-title, h1.title')
    if title_el and title_el.text.strip():
        novel_title = title_el.text.strip()
    elif soup.title and soup.title.text.strip():
        novel_title = soup.title.text.strip().split(' | ')[0].strip()

    episodes: List[Dict[str, Any]] = []
    sort_order = 1

    for a in soup.select('.episode-list a, .episodes a, .content-statuses a, a[href*="/episode/"]'):
        href = a.get('href')
        txt = a.text.strip()
        if href and ('/episode/' in href or re.search(r'/novel/\d+/\d+/\d+', href)):
            full = urljoin(clean_url, href).split('#')[0]
            if not any(e['url'] == full for e in episodes):
                episodes.append({
                    "title": txt or f"제 {sort_order}화",
                    "url": full,
                    "sort_order": sort_order
                })
                sort_order += 1

    return novel_title or "알파폴리스 소설", episodes


def _parse_generic_toc(toc_url: str) -> Tuple[str, List[Dict[str, Any]]]:
    """기타 일반 웹페이지/단편 소설"""
    resp = requests.get(toc_url, headers=DEFAULT_HEADERS, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding

    soup = BeautifulSoup(resp.text, 'html.parser')
    novel_title = soup.title.text.strip() if soup.title else "웹소설"
    return novel_title, [{"title": novel_title, "url": toc_url, "sort_order": 1}]


# ---------------------------------------------------------------------------
# 본문 문단 추출기 (Episode Content Scraper)
# ---------------------------------------------------------------------------

def fetch_episode_paragraphs(ep_url: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    회차 웹페이지에서 회차 제목 및 문단 목록([{pid, text}])을 추출합니다.
    """
    cookies = _get_request_cookies(ep_url)
    resp = requests.get(ep_url, headers=DEFAULT_HEADERS, cookies=cookies, timeout=20)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding

    soup = BeautifulSoup(resp.text, 'html.parser')

    # 회차 제목 추출
    ep_title = ""
    title_el = soup.select_one(
        '.p-novel__title, .novel_subtitle, [class*="novel__title"], '
        '.widget-episodeTitle, .episode_title, h2.title, span[style*="font-size:120%"]'
    )
    if title_el and title_el.text.strip():
        ep_title = title_el.text.strip()
    elif soup.title and soup.title.text.strip():
        ep_title = soup.title.text.strip().split(' - ')[0].split(' | ')[0].strip()

    # 본문 컨테이너 및 문단 셀렉터 매칭
    paragraphs: List[Dict[str, str]] = []

    # 1. 사이트별 특화 셀렉터
    p_elements = soup.select(
        '.p-novel__body p, #novel_honbun p, .p-novel__text p, '
        '.widget-episodeBody p, #novel_content p, .novel_body p, #honbun p, '
        '#novelBoby p, #novelBody p'
    )

    if not p_elements:
        # 2. 줄바꿈(<br>) 기반 본문 분할 (Hameln, Alphapolis fallback)
        honbun_el = soup.select_one('#honbun, #novelBoby, #novelBody, .novel-body')
        if honbun_el:
            raw_text = honbun_el.get_text('\n')
            lines = [l.strip() for l in raw_text.split('\n') if l.strip()]
            for idx, line in enumerate(lines, 1):
                paragraphs.append({
                    "pid": f"L{idx}",
                    "text": line
                })
            return ep_title, paragraphs

    if not p_elements:
        # 3. 범용 article / main / body p
        p_elements = soup.select('article p, main p, .content p')

    pid_counter = 1
    for el in p_elements:
        # Ruby 태그 내부 텍스트 정리 (루비 발음 주석 포함 순수 텍스트)
        text = el.get_text().strip()
        if not text:
            continue
        pid = el.get('id') or f"p{pid_counter}"
        paragraphs.append({
            "pid": str(pid),
            "text": text
        })
        pid_counter += 1

    return ep_title, paragraphs


# ---------------------------------------------------------------------------
# 비동기 수집 러너 및 SSE 브로드캐스터 (Collector Runner)
# ---------------------------------------------------------------------------

class RawCollectorRunner:
    """
    원문 전용 수집기 백그라운드 엔진.
    - 단일 인스턴스로 동작하여 동시 충돌 방지
    - 회차당 2.5초 지연
    - 12화마다 120초(2분) 안전 쿨다운 휴식
    - 이미 저장된 회차 0초 스킵 (A안)
    - ManualTranslationNovel 자동 등록
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.status = "idle"  # idle, running, resting, completed, stopped, error
        self.current_novel_url = ""
        self.folder_name = ""
        self.total_episodes = 0
        self.completed_episodes = 0
        self.skipped_episodes = 0
        self.saved_paragraphs_count = 0
        self.current_episode_title = ""
        self.rest_remaining_seconds = 0
        self.stop_requested = False
        self.logs: List[str] = []
        self._thread: Optional[threading.Thread] = None

        # SSE 리스너 큐
        self._listeners: List[asyncio.Queue] = []

    def get_state(self) -> Dict[str, Any]:
        with self.lock:
            return {
                "status": self.status,
                "novel_url": self.current_novel_url,
                "folder_name": self.folder_name,
                "total_episodes": self.total_episodes,
                "completed_episodes": self.completed_episodes,
                "skipped_episodes": self.skipped_episodes,
                "saved_paragraphs_count": self.saved_paragraphs_count,
                "current_episode_title": self.current_episode_title,
                "rest_remaining_seconds": self.rest_remaining_seconds,
                "progress_percent": round(
                    ((self.completed_episodes + self.skipped_episodes) / self.total_episodes * 100)
                    if self.total_episodes > 0 else 0, 1
                ),
                "recent_logs": self.logs[-20:]
            }

    def _log(self, msg: str):
        with self.lock:
            timestamp = time.strftime("[%H:%M:%S]")
            entry = f"{timestamp} {msg}"
            self.logs.append(entry)
            if len(self.logs) > 300:
                self.logs.pop(0)
        logger.info(f"[RawCollector] {msg}")

    def add_listener(self, queue: asyncio.Queue):
        with self.lock:
            self._listeners.append(queue)

    def remove_listener(self, queue: asyncio.Queue):
        with self.lock:
            if queue in self._listeners:
                self._listeners.remove(queue)

    def _broadcast(self, event_type: str, data: Dict[str, Any]):
        state = self.get_state()
        state["event"] = event_type
        state["type"] = "status"
        state["data"] = self.get_state()
        state.update(data)
        payload = f"data: {json.dumps(state, ensure_ascii=False)}\n\n"

        # 이벤트 루프의 큐들에 안전하게 전달
        for q in list(self._listeners):
            try:
                q.put_nowait(payload)
            except Exception:
                pass

    def stop(self):
        with self.lock:
            if self.status in ("running", "resting"):
                self.stop_requested = True
                self._log("⏹️ 사용자에 의해 수집 중지가 요청되었습니다. 현재 회차 완료 후 안전하게 멈춥니다.")

    def start_collection(
        self,
        novel_url: str,
        custom_folder_name: Optional[str] = None,
        delay_sec: float = 2.5,
        batch_size: int = 12,
        rest_sec: int = 120,
        skip_existing: bool = True
    ) -> Dict[str, Any]:
        """백그라운드 스레드에서 수집 작업을 시작합니다."""
        with self.lock:
            if self.status in ("running", "resting"):
                raise RuntimeError("이미 다른 소설의 원문 수집 작업이 진행 중입니다.")

            self.status = "running"
            self.stop_requested = False
            self.current_novel_url = novel_url
            self.completed_episodes = 0
            self.skipped_episodes = 0
            self.saved_paragraphs_count = 0
            self.current_episode_title = ""
            self.rest_remaining_seconds = 0
            self.logs.clear()

        self._thread = threading.Thread(
            target=self._run_collection_worker,
            args=(novel_url, custom_folder_name, delay_sec, batch_size, rest_sec, skip_existing),
            daemon=True
        )
        self._thread.start()
        return {"success": True, "message": "원문 수집 작업이 백그라운드에서 시작되었습니다."}

    def _run_collection_worker(
        self,
        novel_url: str,
        custom_folder_name: Optional[str],
        delay_sec: float,
        batch_size: int,
        rest_sec: int,
        skip_existing: bool
    ):
        db = sdb.SessionLocal()
        try:
            self._log(f"🔍 소설 목차 분석 시작: {novel_url}")
            self._broadcast("start", {"message": "목차 분석 중..."})

            novel_title, episodes = fetch_toc_and_title(novel_url)
            folder_name = (custom_folder_name or "").strip() or novel_title

            with self.lock:
                self.folder_name = folder_name
                self.total_episodes = len(episodes)

            self._log(f"📖 소설 확인: '{novel_title}' (폴더명: '{folder_name}', 총 {len(episodes)}화)")

            # 1. ManualTranslationNovel 레지스트리에 소설 자동 등록 (빈칸 감지기 및 복원센터 예외 대상)
            existing_reg = db.query(ManualTranslationNovel).filter_by(folderName=folder_name).first()
            if not existing_reg:
                new_reg = ManualTranslationNovel(
                    folderName=folder_name,
                    source_url=novel_url,
                    created_at=int(time.time()),
                    is_completed=0
                )
                db.add(new_reg)
                db.commit()
                self._log(f"🛡️ '{folder_name}' 소설을 수동 번역 및 검열 회피 레지스트리에 등록 완료했습니다.")
            else:
                existing_reg.source_url = novel_url
                db.commit()

            # 2. DB에 이미 존재하는 회차 URL 사전 조회 (A안 스킵 대상)
            all_urls = [e["url"] for e in episodes]
            existing_urls: Set[str] = set()
            if skip_existing:
                chunk_size = 500
                for i in range(0, len(all_urls), chunk_size):
                    chunk = all_urls[i:i + chunk_size]
                    rows = db.query(Translation.url).filter(Translation.url.in_(chunk)).distinct().all()
                    for r in rows:
                        existing_urls.add(r[0])
                        existing_urls.add(r[0].rstrip('/'))

            self._log(f"📊 전체 {len(episodes)}화 중 기수집 회차: {len(existing_urls)}화 / 신규 수집 대상: {len(episodes) - len(existing_urls)}화")

            consecutive_collected = 0

            # 3. 순차 회차 수집 루프
            for idx, ep in enumerate(episodes, 1):
                if self.stop_requested:
                    with self.lock:
                        self.status = "stopped"
                    self._log("⏹️ 원문 수집 작업이 안전하게 중지되었습니다.")
                    self._broadcast("stopped", {"message": "수집 중지됨"})
                    return

                ep_url = ep["url"]
                ep_title = ep["title"]

                # A안: 이미 존재하는 회차는 0초 스킵
                if skip_existing and (ep_url in existing_urls or ep_url.rstrip('/') in existing_urls):
                    with self.lock:
                        self.skipped_episodes += 1
                    self._broadcast("skip", {"message": f"제 {idx}화 건너뜀 (이미 저장됨)"})
                    continue

                with self.lock:
                    self.current_episode_title = ep_title

                self._log(f"📥 [{idx}/{len(episodes)}] 제 {idx}화 '{ep_title}' 원문 수집 중...")
                self._broadcast("fetching", {"current_index": idx, "episode_title": ep_title})

                try:
                    scraped_title, paragraphs = fetch_episode_paragraphs(ep_url)
                    save_title = scraped_title or ep_title

                    # translations 테이블에 원문 저장 및 번역문 빈칸("")으로 일괄 적재
                    now = int(time.time())
                    # 기존 레코드 제거 후 신규 적재 (단락 순서 정돈)
                    db.query(Translation).filter_by(url=ep_url).delete()

                    for p_item in paragraphs:
                        rec = Translation(
                            url=ep_url,
                            pid=p_item["pid"],
                            original=p_item["text"],
                            translated="",  # 사용자 지정 빈칸 유지!
                            timestamp=0,  # 검열 소설 원문은 통계(오늘 번역 등)에서 영구 제외
                            folderName=folder_name,
                            title=save_title,
                            toc_sort_order=ep["sort_order"]
                        )
                        db.add(rec)

                    db.commit()

                    with self.lock:
                        self.completed_episodes += 1
                        self.saved_paragraphs_count += len(paragraphs)
                        consecutive_collected += 1

                    self._log(f"✅ 제 {idx}화 저장 완료 ({len(paragraphs)}문단, 번역문 빈칸 유지)")
                    self._broadcast("saved", {"current_index": idx, "paragraphs": len(paragraphs)})

                except Exception as ex:
                    db.rollback()
                    self._log(f"⚠️ 제 {idx}화 수집 오류 ({ep_url}): {ex}")
                    self._broadcast("error_item", {"current_index": idx, "error": str(ex)})

                # 4. 12화 수집 시 120초(2분) 안전 쿨다운 휴식 부여
                if consecutive_collected > 0 and consecutive_collected % batch_size == 0:
                    with self.lock:
                        self.status = "resting"
                    self._log(f"☕ [안전 쿨다운] {batch_size}개 회차 수집 완료. 사이트 차단 방지를 위해 {rest_sec}초간 휴식합니다...")

                    for remaining in range(rest_sec, 0, -1):
                        if self.stop_requested:
                            break
                        with self.lock:
                            self.rest_remaining_seconds = remaining
                        self._broadcast("resting", {"remaining_sec": remaining})
                        time.sleep(1)

                    with self.lock:
                        self.rest_remaining_seconds = 0
                        self.status = "running"

                    if self.stop_requested:
                        with self.lock:
                            self.status = "stopped"
                        self._log("⏹️ 쿨다운 중 사용자에 의해 수집이 중지되었습니다.")
                        self._broadcast("stopped", {"message": "수집 중지됨"})
                        return

                    self._log("⚡ 쿨다운 종료. 원문 수집을 재개합니다.")
                else:
                    # 일반 회차 간 2.5초 지연
                    time.sleep(delay_sec)

            with self.lock:
                self.status = "completed"
            self._log(f"🎉 '{folder_name}' 소설 전체 원문 수집 완료! (총 {self.completed_episodes}화 저장, {self.skipped_episodes}화 스킵, {self.saved_paragraphs_count}문단)")
            self._broadcast("completed", {"message": "전체 수집 완료"})

        except Exception as e:
            logger.error(f"[RawCollector] Error: {e}", exc_info=True)
            with self.lock:
                self.status = "error"
            self._log(f"❌ 수집 중단 오류: {e}")
            self._broadcast("error", {"error": str(e)})
        finally:
            db.close()


# 싱글톤 인스턴스
raw_collector = RawCollectorRunner()
