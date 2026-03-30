# 기능: TOC URL을 이용한 챕터 순서 가져오기 (v1.0)

## 1. 목표 (Goal)

기존 URL 탭의 정렬 방식(기존 URL 기준, 첫 접근 시간 기준)이 가진 단점을 보완합니다.
사용자가 Kakuyomu 또는 Syosetu의 소설 목차(TOC) URL을 제공하면, 해당 페이지의 챕터 순서를 스크래핑(또는 API 조회)하여 현재 `book_ui`의 'title' 레이블 목록에 그대로 적용(덮어쓰기)합니다.

## 2. 대상 사이트 (Targets)

1. **Kakuyomu (カクヨム)**
2. **Syosetu (小説家になろう)**

## 3. 구현 계획 (Implementation Plan)

### 3.1. 백엔드 (Server - server.py)

1. **의존성 추가 (`server/requirements.txt`):**

   * `beautifulsoup4` 라이브러리를 추가합니다. (`requests`는 이미 존재해야 함)
2. **신규 API 엔드포인트 생성:**

   * **라우트:** `/api/import-toc`
   * **메서드:** `POST`
   * **요청 (Request Body):** `{ "toc_url": "..." }`
   * **응답 (Response Body):** `[{"title": "챕터 제목", "url": "챕터 URL"}, ...]` (순서 보장 JSON 리스트)
3. **파싱 로직 구현:**

   * 엔드포트는 `toc_url`을 받습니다.
   * **Kakuyomu (카쿠요무) 처리:**
     * `if "kakuyomu.jp" in toc_url:`
     * `requests.get(toc_url)`로 HTML을 가져옵니다.
     * `BeautifulSoup(response.text, 'html.parser')`로 파싱합니다.
     * CSS 선택자 `.widget-toc-main` 내부의 모든 `<a>` 태그를 찾습니다.
     * `a.text` (제목)와 `a.get('href')` (URL)를 순서대로 추출합니다.
   * **Syosetu (소설가가 되자) 처리:**
     * `if "syosetu.com" in toc_url:`
     * (권장) **나로우 소설 API**를 사용합니다.
     * URL에서 N-Code (예: `n7474hi`)를 추출합니다.
     * `https://api.syosetu.com/novelapi/api/?out=json&ncode=[NCODE]` 엔드포인트를 호출합니다.
     * 반환된 JSON(`response.json()`)을 파싱하여 챕터 제목과 URL을 순서대로 추출합니다.
     * (대체) API 사용이 어려울 경우, Kakuyomu와 마찬가지로 `requests` + `bs4`로 HTML을 스크래핑합니다.
   * 추출된 `[{"title": ..., "url": ...}]` 리스트를 JSON으로 반환합니다.

### 3.2. 프론트엔드 (Client - server/static/book_ui.js)

1. **UI 요소 추가 (`server/templates/book_ui.html`):**

   * URL 목록을 관리하는 패널(예: `url-tab-content`) 내부에 "TOC에서 가져오기 (Import from TOC)" 버튼을 추가합니다.
2. **이벤트 리스너 바인딩 (`book_ui.js`):**

   * 새로 추가된 버튼에 `click` 이벤트 리스너를 추가합니다.
3. **TOC 가져오기 로직:**

   * 버튼 클릭 시, `prompt("목차(TOC) URL을 입력하세요:")`를 사용하여 사용자에게 URL을 입력받습니다.
   * URL이 입력되면, `fetch('/api/import-toc', { ... })`를 사용하여 백엔드 API에 POST 요청을 보냅니다.
   * **성공 시 (Response OK):**
     1. 백엔드로부터 `[{"title": ..., "url": ...}]` 배열(예: `tocList`)을 받습니다.
     2. 현재 UI에 표시된 모든 'title' 레이블 DOM 요소를 `innerHTML = ''` 등을 사용하여 **모두 삭제**합니다.
     3. `tocList.forEach(item => { ... })` 루프를 실행합니다.
     4. 루프 내부에서, `item.title`과 `item.url`을 사용하여 새로운 'title' 레이블 DOM 요소를 생성하고, 이를 **순서대로** 부모 컨테이너에 `append`합니다. (기존 `createTitleLabel` 함수 재활용 가능)
