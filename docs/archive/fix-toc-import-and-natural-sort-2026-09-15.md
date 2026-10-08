# 목차(TOC) 가져오기 및 자연 정렬(Natural Sort) 버그 수정

- **작업 일시**: 2026-09-15
- **관련 브랜치**: extra

---

## 1. 배경 및 작업 목적
1. **재번역 모델 업데이트**: 고성능 재번역 모델을 `gemini-3.8-flash`로 지정.
2. **UI 피드백 반영**: 소설 웹페이지(익스텐션 사이드바)의 행별 🔄 버튼을 제거하고, **관리자 페이지(`admin.js`)에만** 고성능 재번역(🔄) 버튼을 배치.
3. **정렬 버그 해결**: 챕터 목록 및 URL이 사전식 문자열 정렬로 인해 `001` 다음에 `002`가 아닌 `010`, `100`, `101` 순으로 정렬되던 문제 해결.
4. **TOC 가져오기 기능 정상화**:
   - 카쿠요무(Kakuyomu): `tableOfContentsV2` 및 `episodeUnions`/`childChapterUnions` 재귀 탐색 미지원으로 인한 404 오류 수정.
   - 쇼세츠(Syosetu): `urljoin` 시 `.lstrip('/')`로 인해 URL에 ncode가 중복(`.../n4913gc/n4913gc/1/`)되어 DB와 0개 매칭되던 버그 수정 및 다중 페이지(페이징) 크롤링 지원.

---

## 2. 주요 변경 사항

### 2.1. 자연 정렬(Natural Sort) 도입 (`server/utils.py`, `books.py`, `data_crud.py`)
- **`natural_sort_key` 구현**:
  - `unicodedata.normalize('NFKC')`를 통해 전각 숫자(`００１`, `００２`)를 반각(`001`, `002`)으로 변환.
  - 정규식 `re.split(r'(\d+)', text)`로 숫자 블록을 `int`로 변환하여 자연 정렬 키 생성.
  - `001 -> 002 -> 003 -> ... -> 010 -> ... -> 100 -> 101` 순서 보장.
- **뷰어 챕터 목록 (`/api/books/{folder_name}/chapters`)**:
  - `toc_sort_order`가 있는 경우 해당 순서 우선.
  - `toc_sort_order`가 없거나 동일할 경우 URL 및 제목의 자연 정렬(`natural_sort_key`)을 적용하여 항상 올바른 화수 순서로 제공.
- **서재 URL 목록 (`/api/books/{folder_name}/urls`)**:
  - `toc_sort_order` 우선, 없을 경우 자연 정렬 적용.
- **관리자 페이지 데이터 (`/translations_by_folder`)**:
  - URL 그룹 정렬에 자연 정렬 폴백 적용.

### 2.2. TOC 파서 완전 개편 (`server/routers/toc_importer.py`)
- **카쿠요무(Kakuyomu)**:
  - Apollo State의 `tableOfContentsV2` 구조 지원 (`TableOfContentsChapter` 노드 탐색).
  - `episodeUnions` 및 `childChapterUnions`를 재귀 순회하여 전체 회차를 정확한 순서로 수집.
  - 단편 소설 및 레거시 `tableOfContents` 폴백 완비.
- **쇼세츠(Syosetu)**:
  - `.lstrip('/')` 제거 -> `urljoin(current_url, relative_url)`로 정확한 단일 URL 생성.
  - 다중 페이지 페이징 루프(`c-pager__item--next` 및 `?p=...` 탐색) 구현으로 100화 초과 장편 소설 전 회차 자동 수집.

### 2.3. DB 순서 업데이트 및 서재 피드백 (`books.py`, `library.js`)
- `update_book_urls_order`:
  - 트레일링 슬래시 유무(`RTRIM(url, '/') = ? OR url = ?`)에 유연하게 매칭.
  - `url_metadata` 테이블에도 `sort_order`와 `title` 동기화.
  - '미분류' 폴더 지원.
- `library.js`:
  - `handleImportToc`에서 가져온 목차 개수 및 DB 일치 결과 메시지(`총 X개 중 Y개 일치`)를 사용자에게 팝업으로 명확히 안내.

### 2.4. 모델 이원화 및 UI 정리
- `server/settings.py`: `gemini_retranslation_model` 기본값을 `gemini-3.8-flash`로 설정.
- `extension/content.js`: 사이드바 각 행의 🔄 버튼 및 관련 이벤트 제거 (소설 감상 페이지 단순화).
- `server/static/admin.js`: 관리자 페이지에서 각 번역 행 🔄 클릭 시 `gemini-3.8-flash`로 재번역 및 DB 즉시 저장 지원.

---

## 3. 검증 결과
- **자연 정렬 테스트**: `001, 002, 010, 100, 101` 및 `/1/, /2/, /10/, /100/` 순서 정렬 100% 통과.
- **재번역 모델 검증**: `is_retranslation=True` 요청 시 `gemini-3.8-flash` API 엔드포인트 호출 확인.
- **TOC 파서 테스트**:
  - 카쿠요무 작품: 99개 에피소드 파싱 성공.
  - 쇼세츠 '감금왕': 5페이지 걸쳐 총 448개 챕터 전 회차 수집 성공.
- **순서 업데이트 테스트**: '감금왕' 대상 TOC 업데이트 실행 시 DB의 118개 챕터와 100% 일치하여 `001 -> 002 -> 003...` 정렬 완료.
- **전체 단위 테스트**: `pytest tests/` 33개 항목 전원 PASS.