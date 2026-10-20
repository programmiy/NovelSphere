# 미분류 소설 폴더 fallback 방어 및 원래 소설 폴더 자동 귀속 개선 보고서

- **작업 일자**: 2026-10-20
- **관련 파일**:
  - `scripts/stage_punct_fixes_to_special_batch.py`
  - `server/routers/special_batch.py`
  - `server/templates/special_batch.html`
  - `tests/test_special_batch.py`

---

## 1. 개요 및 배경
- 과거 문장 부호(`……`, `・・・・`, `――――` 등) 반복 오류를 일괄 보정한 수정본을 검수 대기열에 올렸던 배치 스크립트(`scripts/stage_punct_fixes_to_special_batch.py`)에서 `folder_name or "Unknown"` 로직으로 인해 미분류 문단에 임의로 `"Unknown"` 소설 폴더명이 부여되는 현상이 발생함.
- 이 수정본이 특별 적재 검수기(`/special_batch`)에서 승인되면서 본 DB(`translations`)에 `folderName = 'Unknown'`으로 적재되어 관리자 화면에 불필요한 "Unknown" 폴더가 생성되었음.
- **사용자 요구사항**:
  - "폴더네임이 비어있으면 원래 미분류보관함에 들어가야해 그게맞아 폴더네임 비어있다고 임의의 폴더를 만들지않아"
  - "이런 수정된 번역은 해당 소설폴더로 다시 가야하는데"

---

## 2. 세부 변경 사항

### 2.1. `scripts/stage_punct_fixes_to_special_batch.py`
- 문단 조회 시 동일한 URL(같은 회차)을 공유하는 다른 문단 중 이미 유효한 `folderName`이 있는 경우 이를 우선 상속받도록 `url_to_folder` 매핑 도입.
- 동일 회차 내에서도 폴더명을 알 수 없는 경우, `"Unknown"` 등 임의 가상 폴더를 절대 생성하지 않고 `None`으로 등록하여 시스템 고유의 **미분류 보관함(Unclassified Drawer)** 규격을 엄격히 준수.

### 2.2. `server/routers/special_batch.py`
- `resolve_clean_folder_name(db, clean_url, explicit_folder)` 방어 헬퍼 함수 추가:
  - 1순위: 명시적 폴더명이 유효하고 `"Unknown"`이 아니면 사용.
  - 2순위: 동일 URL의 기존 번역 레코드에서 유효한 `folderName`을 찾아 자동 상속(원래 소설 폴더로 복원 귀속).
  - 3순위: 어디에도 없으면 임의 폴더를 생성하지 않고 `None`(미분류)으로 반환.
- `approve_staged_item` (단일 승인):
  - 기존 번역의 `folderName`이 비어있거나 `"Unknown"`인 경우에만 `resolve_clean_folder_name`으로 안전하게 상속받고, 이미 지정된 정상 폴더명은 절대 훼손하지 않음.
  - 신규 번역 생성 시에도 `resolved_folder`를 적용하여 `folderName`이 `None`이면 미분류 보관함으로 등록.
- `batch_approve_staged` (일괄 승인):
  - 동일한 폴더명 상속 및 `None`(미분류) 보존 로직 전면 적용.
- `get_staged_novels`, `get_staged_chapters`, `get_staged_items`:
  - `folder_name`이 `None`이거나 `"Unknown"`, 빈 문자열인 경우 "미분류"로 안전하게 조회 및 그룹핑 지원.

### 2.3. `server/templates/special_batch.html`
- 소설 선택 드롭다운 렌더링 시 폴더명이 비어있거나 `"Unknown"`인 항목은 "미분류 (대기: X / 전체: Y)"로 명확히 표시.
- 카드 헤더(`cardNovelChapter`) 표시 시에도 폴더명이 없을 때 "미분류"로 깔끔하게 렌더링.

### 2.4. `tests/test_special_batch.py`
- 폴더명 상속, 임의 폴더 미생성(None 미분류 보존), 단일 승인 및 일괄 승인 시 안전 귀속 동작을 검증하는 4종 단위 테스트 구축.

---

## 3. 검증 결과
- 단위 테스트 4종 전원 통과.
- 미분류 문단 수정 시 임의 가상 폴더가 일체 생성되지 않으며, 동일 회차 소설 폴더가 있을 경우 정상 상속되고, 없는 경우 미분류 보관함으로 정확히 격리됨을 확인함.
