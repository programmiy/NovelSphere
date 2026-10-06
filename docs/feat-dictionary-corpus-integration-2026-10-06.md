# feat-dictionary-corpus-integration-2026-10-06

## 1. 개요 및 배경
- **요청 사항**: 지금까지 누적된 방대한 번역 데이터베이스(34만+ 문장)를 기반으로 주요 일본어 사전과 연동하여, 수동으로 번역을 교정할 때 참고하거나 일본어 공부용으로 활용할 수 있는 시스템 구현 (AI 미사용, 100% 룰베이스 및 SQLite 코퍼스 쿼리).
- **해결 접근법**:
  1. **백엔드 코퍼스 & 사전 연동 서비스 (`server/services/dictionary_service.py`, `server/routers/dictionary.py`)**:
     - 34만 개 이상의 누적 번역 레코드에서 특정 단어/표현이 사용된 실제 원문 및 번역문을 0.1초 만에 추출하는 코퍼스 검색 엔진 구축.
     - 주요 온라인 사전(네이버 일본어사전, Weblio 국어사전, Jisho 한자/요미가나 사전, Goo 사전) 다이렉트 검색 링크 생성.
     - 누적 DB 내 단어 등장 빈도수(Total Occurrences), 관련 소설 수, 학습 빈도 난이도 등급(High/Medium/Low), 번역문 통계적 주요 대응 어휘(Candidate Terms) 자동 추출 (No-AI).
  2. **웹 뷰어 전용 사전 & 용례 학습 패널 (`viewer.html`, `viewer.js`, `viewer.css`)**:
     - 상단 헤더 `[📖 사전 / 공부]` 버튼 및 단축키 `Shift+D` / `W` 지원.
     - 슬라이드인 사이드 패널에서 사전 링크 바(네이버/Weblio/Jisho ↗) 및 실제 소설 예문 대조.
     - **단락 수동 교정 모드(`enableEditing`)**: 편집창 내 `[📖 사전·용례]` 버튼을 누르면 원문 키워드를 사전에서 조회하고, 패널의 예문 카드에서 `[이 표현 반영]` 원클릭으로 수정창에 자동 삽입/치환.
     - **독서/공부 중 단어 선택 플로팅 툴팁**: 본문(원문/번역문) 텍스트를 마우스/터치로 드래그하면 즉시 `[📖 사전·용례 ('단어')]` 미니 툴팁 플로팅 및 클릭 시 원터치 사전 패널 오픈.
  3. **모바일 독립 앱 사전 연동 (`similar_translations_panel.dart`, `sentence_edit_page.dart`)**:
     - `SimilarTranslationsPanel`: 상단에 `[네이버 ↗]`, `[Weblio ↗]`, `[Jisho ↗]` 칩 추가 및 시스템 브라우저 원터치 인텐트 연동.
     - `SentenceEditPage`: 원문 상단 `[사전 연동 & 용례]` 버튼 및 텍스트 선택 툴바 `[📖 사전 연동]` 지원. 로컬 DB 0ms 예문 대조 및 `[이 표현 적용]` 지원.
  4. **관리자 대시보드 (`admin.html`, `admin.js`)**:
     - 이상 번역 검수 및 추천 패널 상단에 네이버, Weblio, Jisho 사전 바로가기 링크 추가.

---

## 2. 세부 변경 사항

### 2-1. 백엔드 서비스 & 라우터
- **`server/services/dictionary_service.py`**:
  - `get_dictionary_links(keyword)`: 네이버, Weblio, Jisho, Goo URL 생성.
  - `extract_korean_candidate_terms(examples, keyword)`: 번역문 속 빈출 명사 통계 추출 (No-AI).
  - `search_dictionary_corpus(keyword, folder, exclude_id, limit, db)`: 현재 소설 우선 예문 조회, 전체 COUNT 및 빈도 등급 산출.
- **`server/routers/dictionary.py`**:
  - `GET /api/dictionary/lookup`: 키워드, 소설명 기반 사전 링크 + 코퍼스 예문 + 통계 반환.
  - `GET /api/dictionary/links`: 사전 바로가기 링크 세트 반환.
- **`server/server.py`**:
  - `dictionary.router` 포함 (`app.include_router(dictionary.router)`).

### 2-2. 웹 뷰어 (`server/templates/viewer.html`, `server/static/viewer.js`, `server/static/viewer.css`)
- **UI 및 반응형 레이아웃**:
  - `#dict-sidebar`: 다크/페이퍼 테마 일치 글래스모피즘 사이드 패널.
  - `#dict-selection-pill`: 텍스트 드래그 시 마우스 위치 상단에 실시간 추적 툴팁 표시.
  - 단락 수정 액션 바에 `[📖 사전·용례]` 버튼 추가.
  - 단축키 `Shift+D` 또는 `W` 토글, `Esc` 닫기 지원.

### 2-3. 모바일 앱 (`mobile_app/`)
- **`MainActivity.kt`**: MethodChannel `com.lanovel.lanovel_reader/app_installer`에 `openUrl` 인텐트 액션 핸들러 추가.
- **`similar_translations_panel.dart`**: 사전 연동 버튼 바 (`_buildDictLinksBar`) 및 외부 브라우저 런처 탑재.
- **`sentence_edit_page.dart`**: 원문 상단 버튼 및 드래그 툴바 연동, 바텀시트에서 사전 링크 및 `[이 표현 적용]` 액션 지원.

### 2-4. 관리자 페이지 (`server/templates/admin.html`, `server/static/admin.js`)
- `renderSimilarRecommendations` 상단에 네이버/Weblio/Jisho 사전 링크 연동.

---

## 3. 검증 결과
- **백엔드 단위 테스트**:
  - `tests/test_dictionary_service.py`: 5개 테스트 전체 통과 (0.19s).
  - `tests/test_data_crud_modularization.py`: 3개 테스트 전체 통과 (0.52s).
- **모바일 앱 정적 분석 및 테스트**:
  - `flutter analyze mobile_app`: 린트 이슈 0건 (No issues found).
  - `flutter test mobile_app`: 11개 단위/위젯 테스트 100% 통과.
