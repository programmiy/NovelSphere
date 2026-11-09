# 모바일앱 찾아바꾸기 탭 대규모 전면 개편 (Find & Replace Studio)

> **작업 일자**: 2026-11-09  
> **관련 모듈**: `mobile_app/lib/ui/glossary/glossary_screen.dart`, `mobile_app/lib/models/find_replace_item.dart`, `mobile_app/lib/models/glossary_rule.dart`, `mobile_app/lib/services/local_db_service.dart`, `mobile_app/test/find_replace_test.dart`

---

## 1. 개편 배경 및 문제점 분석

기존 모바일 앱의 2번째 하단 탭인 '용어 및 찾아바꾸기'(`GlossaryScreen`)는 아래와 같은 심각한 UX/기능적 결함을 가지고 있었습니다:
1. **주객전도 레이아웃**: 상단에 찾아바꾸기와 무관한 거대한 배너 2개(AI 번역 검수 스튜디오, 인명 교정기)가 화면의 절반 이상을 가로막아, 정작 본 기능인 찾아바꾸기를 쓰려면 매번 스크롤을 한참 내려야 했습니다.
2. **블라인드 치환의 공포**: 찾을 단어를 입력해도 몇 개가 일치하는지, 어떤 회차/문단인지, 치환 시 어떻게 바뀌는지(Before & After Diff)를 전혀 볼 수 없어 '전체 교체'를 누르기 전까지 극심한 불안감이 있었습니다.
3. **선택적 치환 불가**: 일치하는 결과 중 특정 문맥(동음이의어 등)을 제외할 수 없고 '전부 바꾸거나 아예 안 바꾸거나'만 가능했습니다.
4. **원문 조건 필터 부재**: PC 웹 관리자에는 지원되는 `condition_text` (일본어 원문에 특정 단어가 포함된 경우만 치환) 기능이 모바일에 없어 정밀한 오독 분기 치환이 불가능했습니다.
5. **되돌리기(Undo / Rollback) 전무**: 실수로 치환했을 때 이를 역치환하여 원복하는 기능이 없었습니다.
6. **소설 선택 불편함**: 기본 `DropdownButton`을 사용하여 소설이 많을 때 검색이 불가능하고 긴 제목이 잘리는 문제가 있었습니다.

---

## 2. 주요 개편 및 신규 기능

### ① 헤더 및 스튜디오 퀵 툴바 (Studio Quick Hub)
- 거대한 배너 카드를 걷어내고 상단에 슬림한 **듀얼 퀵 칩**(`[✨ 인명·고유명사 교정기]`, `[🃏 AI 번역 검수 스튜디오]`)을 배치하여 작업 공간을 100% 확보하고 전문 스튜디오로 원터치 진입 지원.
- 듀얼 탭 세그먼트 구성:
  - `[⚡ 실시간 찾아바꾸기]`
  - `[📚 규칙 & 이력 (N)]`

### ② 실시간 인스펙터 & 인라인 Diff 미리보기 (Live Preview Inspector)
- **실시간 디바운스 검색**: 찾을 단어 입력 시 380ms 디바운스로 로컬 DB 챕터들의 압축 문단을 고속 인덱싱/스캔.
- **매치 카운트 & 선택 HUD**: `🎯 총 N개 문단 일치 (M개 소설)` 네온 배지 및 `[전체 선택 / 전체 해제]` 체크박스.
- **인라인 Diff 카드 리스트**:
  - 소설명 및 회차 제목 태그, 문단 식별자(PID).
  - 일본어 원문(Original) 텍스트 표기.
  - 번역문 전/후를 `TextDiffHelper.buildDiffSpans`로 렌더링 (빨간 취소선 $\rightarrow$ 초록 볼드 하이라이트).
  - 문단별 개별 체크박스 토글.
  - 우측 하단 `[이 문단만 치환]` 원터치 퀵 버튼.

### ③ 원문 조건 필터 (Original Condition Filter)
- `[원문 조건 필터]` 토글 시 슬라이딩 인풋창 노출.
- 일본어 원문에 특정 단어(예: `魔王`)가 포함된 문단만 골라서 치환할 수 있어 동음이의어 오독 치환을 완벽 방지.

### ④ 검색 가능한 도서 선택 바텀시트 (Novel Picker Sheet)
- 기존의 좁은 드롭다운을 폐지하고, 터치 시 부드럽게 열리는 모달 바텀시트 탑재.
- 실시간 소설 제목 초성/키워드 검색, 책별 챕터 수 표기, `[전체 소설 (서재 내 모든 책)]` 옵션 제공.

### ⑤ 듀얼 실행 액션 바 (Dual Execution Dock)
- 하단 플로팅 글래스 독 바로 위에 안착하는 플로팅 액션 바:
  - `[선택 항목 교체 (N개)]` (Primary)
  - `[전체 치환 (M개)]` (Outline)
- 안전 확인 다이얼로그(변경 내역 요약) 및 치환 직후 `[되돌리기]` 스낵바 제공.

### ⑥ 규칙 보관함 및 1-터치 되돌리기 (Undo / Rollback Engine)
- 적용된 모든 찾아바꾸기 룰의 상세 메타데이터(소설 범위, 정규식, 대소문자, 원문 조건, 치환 개수, 적용 일시) 카드 표출.
- **`[↩️ 되돌리기 (Undo)]`**: 바꿀 단어 $\rightarrow$ 원래 단어로 역치환을 실행하여 원클릭 롤백 지원.
- **`[🔄 재적용]`**: 신규 챕터 추가 시 기존 룰을 다시 일괄 적용.
- **`[🗑️ 삭제]`**: 불필요한 규칙 정리.

---

## 3. 핵심 코드 및 아키텍처 변경 내역

| 파일 경로 | 변경 내용 |
| :--- | :--- |
| `mobile_app/lib/models/find_replace_item.dart` | **신규 모델**: 문단 단위 검색 결과(`chapterId`, `bookName`, `chapterTitle`, `sentenceId`, `pid`, `original`, `beforeText`, `afterText`, `diff`, `uniqueKey`) 정의 |
| `mobile_app/lib/models/glossary_rule.dart` | `conditionText`, `replacedCount`, `isFavorite` 필드 추가 및 DB 직렬화 하위 호환성 유지 |
| `mobile_app/lib/services/local_db_service.dart` | `onOpen` 컬럼 마이그레이션 가드 추가, `previewFindReplace` (DB 수정 없는 고속 Diff 인덱서), `applyFindReplaceItems` (선택 문단 정밀 치환), `rollbackGlossaryRule` (1-터치 역치환 롤백), `deleteGlossaryRule` 탑재 |
| `mobile_app/lib/ui/glossary/glossary_screen.dart` | **전면 재건축**: HyperAesthetic 글래스모피즘 듀얼 탭 스튜디오, 인스펙터 리스트, 원문 필터, 바텀시트 도서 선택기, 듀얼 실행 바 탑재 |
| `mobile_app/test/find_replace_test.dart` | **신규 단위 테스트**: 모델 직렬화, diff 연동, uniqueKey, 대소문자/정규식 매칭 테스트 완비 |

---

## 4. 검증 결과

- `flutter analyze mobile_app`: **No issues found!** (경고 0건, 에러 0건)
- `flutter test`: **25개 테스트 전건 통과 (All tests passed!)**
