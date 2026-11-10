# 인명·용어 교정기 잔여 수정/규칙 기준 스마트 소설 우선 추천 및 첫 화면 자동 노출

> **작업 일자**: 2026-11-10  
> **관련 모듈**: `server/routers/db_editor.py`, `server/templates/db_editor.html`, `mobile_app/lib/services/character_fixer_service.dart`, `mobile_app/lib/ui/glossary/character_fixer_screen.dart`, `tests/test_character_fixer.py`, `mobile_app/test/character_fixer_test.dart`

---

## 1. 개요 및 목적

1. **기존 문제점**:
   - PC 웹 인명·용어 교정기(`/db_editor`)에 진입 시, 특정 소설(`누나가 마 니 선생이라고 느그 좋아하면 안되나?`, 잔여 1,172건)이 하드코딩되어 고정 노출되었습니다.
   - 모바일 앱 인명교정기(`CharacterFixerScreen`)에서는 폴더 목록의 단순 가나다순 첫 번째 소설(규칙이 없는 소설 포함)이 기본 선택되어, 사용자가 작업하려는 소설을 매번 수동으로 찾아야 했습니다.
2. **개선 목적**:
   - 인명용어교정기 진입 시, **규칙이 저장되어 있고 수정 대상 문제 문장이 가장 적게 남아있는 소설(우선순위 오름차순)**을 PC와 모바일 모두에서 자동으로 1순위 추천하여 첫 화면으로 즉시 띄우고 자동 스캔하도록 개선했습니다.
   - 드롭다운 및 선택 인터페이스에서도 소설별 규칙 개수 및 잔여 수정 건수를 시각적으로 직관적이게 표기하여 검수 편의성을 극대화했습니다.

---

## 2. 세부 구현 아키텍처

### ① 서버 백엔드 (`server/routers/db_editor.py`)
- **잔여 수정 건수 초고속 카운트 (`count_novel_pending_issues`)**:
  - 규칙이 등록된 소설들에 대해 제안문 생성 없이 SQL 인덱스/불변 조건 기반 후보 필터링과 `check_rule_missing_status`만을 순수 검증하여 소설당 0.04초 내 잔여 건수 계측.
- **스마트 소설 우선순위 정렬 및 추천 엔진 (`get_novels_with_fix_status`)**:
  - **Tier 1 (최우선)**: 활성화된 규칙이 있고, 잔여 수정 대상 문장(`pending_count > 0`)이 있는 소설들을 **잔여 건수 적은 순(오름차순 `pending_count ASC`)**으로 정렬.
    - 예: `감금왕`(264건) > `누나가 마 니 선생이라고 느그 좋아하면 안되나?`(1,172건) > `오잉 메이드...`(2,365건)
  - **Tier 2 (차선)**: 규칙이 등록되어 있으나 모든 교정이 완료된 소설(`pending_count == 0`) (최근 저장 순, 규칙 수 내림차순).
  - **Tier 3 (기본)**: 규칙이 아직 등록되지 않은 소설 (가나다순).
  - `recommended_folder`: 정렬된 폴더 목록의 첫 번째 소설을 추천 폴더로 도출.
- **최근 규칙 저장 소설 메타 추적 (`RULES_META_FILE_PATH`)**:
  - `POST /api/db_editor/rules`로 규칙을 저장할 때 `set_last_saved_folder(folderName)`를 호출하여 사용자가 최근 규칙을 수정한 소설의 메타데이터를 유지 및 가중치 지원.
- **엔드포인트 일원화**:
  - `GET /db_editor`: URL 파라미터가 없으면 `recommended_folder`를 `current_folder`로 자동 지정하고, 템플릿에 `pending_count`가 포함된 정렬된 목록 전달.
  - `GET /api/db_editor/folders`: `recommended_folder` 및 `has_rules`, `rules_count`, `pending_count`, `total_sentences`를 포함한 JSON 응답 반환.
  - `GET /api/db_editor/novels`: 동일하게 정렬된 목록 반환.

### ② PC 웹 UI (`server/templates/db_editor.html`)
- 상단 소설 선택 드롭다운에 `has_rules` 및 `pending_count` 배지 텍스트 출력:
  - 예: `감금왕 (잔여 264건 · 규칙 5개 · 53,824문단)`
- 페이지 로드(`DOMContentLoaded`) 시 추천 소설로 0초 만에 자동 정밀 스캔 시작.

### ③ 모바일 앱 (`mobile_app`)
- **서비스 확장 (`CharacterFixerService`)**:
  - `fetchFoldersWithRecommendation()` 레코드 타입 지원: `folders` 리스트와 `recommendedFolder`를 동시 추출.
  - 기존 `fetchFolders()`도 동일 순서 보장으로 100% 하위 호환.
- **화면 UI 및 초기화 (`CharacterFixerScreen`)**:
  - 진입 시 `widget.initialFolderName ?? recommendedFolder ?? folders.first['folderName']`을 선택하여 가장 적게 남아있는 소설을 첫 화면으로 즉시 로드 및 스캔.
  - 드롭다운 메뉴 아이템에 `'$name (잔여 $pending건 · $count)'` 형태로 잔여 건수 직관 표기.

---

## 3. 검증 결과

1. **Python 백엔드 단위 테스트**:
   - `tests/test_character_fixer.py`: **16개 테스트 전건 통과 (100% PASS)**
   - 신규 테스트 `test_novel_recommendation_least_pending_priority` 통과.
2. **Flutter 모바일 정적 분석 및 테스트**:
   - `flutter analyze`: **No issues found! (0건 이슈)**
   - `flutter test`: **26개 테스트 전건 통과 (All tests passed!)**
