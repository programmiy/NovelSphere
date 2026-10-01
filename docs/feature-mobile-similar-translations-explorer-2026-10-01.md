# feature-mobile-similar-translations-explorer-2026-10-01

## 1. 개요 및 배경
- **배경**: LANOVEL 모바일 리더에서 소설을 감상하거나 번역문을 교정할 때, 번역이 어색하거나 모호한 일본어 단어/표현이 다른 회차나 다른 소설에서는 어떻게 번역되었는지 눈으로 직접 대조하고 참고할 수 있는 기능의 필요성 대두.
- 자동 텍스트 주입 대신 **시각적 대조와 꼬리를 무는 연쇄 탐색(Chained Context Exploration)**을 중심으로, 독서 몰입을 방해하지 않는 **화면 하단 슬라이딩 미니 패널** 구조를 구현.

## 2. 세부 구현 사항

### 2-1. 모바일 로컬 SQLite 유사 번역 용례 검색 (`mobile_app/lib/services/local_db_service.dart`)
- `LocalDbService.searchSimilarTranslations`:
  - `chapters` 테이블의 zlib 압축 문장(`compressed_content`)을 고속 순회/디코딩.
  - 현재 읽고 있는 소설(`book_name`)의 챕터들을 우선 탐색하고, 부족할 경우 다른 소설의 최신 챕터까지 확장 탐색.
  - 원문(`original`) 또는 번역문(`translated`)에 키워드가 포함된 문장들을 중복 없이 추출하여 반환 (오프라인 상태에서도 0ms 즉시 응답).

### 2-2. 유사 번역 용례 탐색기 패널 (`mobile_app/lib/ui/viewer/similar_translations_panel.dart`)
- **하단 슬라이딩 미니 패널 UI**:
  - 반투명 다크 글래스모피즘 테마 (`Colors.black.withOpacity(0.88)`), 위아래로 가볍게 접기(56px) 및 펼치기(280px) 가능.
  - 상단 헤더: `[← 이전 검색어]` 히스토리 버튼, 현재 검색어 배지 (`'魔導士' 유사 번역 (N건)`), 접기/펼치기 토글, 닫기 버튼.
- **단락 수정 링크 및 독립 교정 화면 연결**:
  - 각 유사 번역 사례 카드 헤더에 `[이 단락 수정]` 링크 버튼 배치.
  - 터치 시 독립된 `SentenceEditPage`로 즉시 내비게이션 진입.
- **꼬리를 무는 연쇄 탐색 (Chained Context Exploration)**:
  - 사례 카드의 원문/번역문 텍스트 내에서 특정 단어를 드래그(선택)하면 `AdaptiveTextSelectionToolbar`에 `[🔍 연쇄 유사번역 조회]` 버튼 제공.
  - 터치 즉시 해당 단어로 새로운 유사 번역 사례들을 꼬리를 물고 탐색하며, 상단 `[←]` 버튼으로 원래 보던 단어로 손쉽게 복귀 가능.
- **로컬 우선 + 서버 하이브리드 확장**:
  - 1차로 로컬 SQLite DB에서 0ms 즉시 검색.
  - 2차로 PC 서버와 Wi-Fi 통신 가능 시 `/translations/similar_examples` API를 비동기 호출하여 방대한 PC 전체 번역 DB 결과까지 중복 없이 병합.

### 2-3. 단락 독립 교정 화면 및 읽던 페이지 복귀 (`sentence_edit_page.dart`)
- **`SentenceEditPage` 신규 구현**:
  - 별도의 풀스크린 Scaffold 화면으로 전환되어 시각적 집중도 향상.
  - 상단 앱바의 뒤로가기(`←`) 버튼(`Navigator.pop`)을 누르면 **언제든 읽던 뷰어 페이지로 원위치 복귀**.
  - 원문(`original`)을 읽기 전용 대조 박스로 제공하고, 수정할 한국어 번역문 텍스트필드 및 `[저장]` 액션 제공.
  - 저장 시 `LocalDbService.updateSentenceByContext`를 호출하여 해당 소설/회차의 zlib 압축 문장을 찾아 교정하고 동기화 큐에 등록한 뒤, 수정된 번역문을 넘겨받아 이전 카드의 표시 내용도 즉시 최신화.

### 2-4. 뷰어 화면 및 즉시 교정 다이얼로그 연동 (`reader_screen.dart`, `quick_edit_dialog.dart`)
- **`QuickEditDialog` 연동**:
  - 원문 영역을 `SelectableText`로 확장하여, 일본어 단어 드래그 시 `[🔍 유사 번역 대조]` 툴바 제공.
  - 원문 헤더 우측에도 `[🔍 유사 번역 대조]` 탭 버튼 추가.
- **`ReaderScreen` 상단 앱바 연동**:
  - 상단 툴바에 `Icons.manage_search_rounded` 아이콘 추가 (`_promptSimilarSearch`), 독서 중 언제든 원하는 키워드로 하단 유사 번역 패널 호출 가능.
  - `Stack` 하단에 `SimilarTranslationsPanel` 오버레이 탑재.

### 2-5. 릴리즈 APK 패키징 및 OTA 업데이트 배포
- 버전 범프: `1.3.3+2026100101` (`mobile_app/pubspec.yaml`, `release_notes.json`).
- `flutter build apk --release` 빌드 성공 (23.0MB), `server/static/lanovel-reader-release.apk` 동기화 완료.

## 3. 검증 결과
- `flutter analyze mobile_app`: 린트 이슈 0건 (No issues found).
- `flutter test mobile_app`: 전체 테스트 100% 통과 (4 passed).
- `flutter build apk --release`: 안드로이드 릴리즈 APK 빌드 성공 (23.0MB).

