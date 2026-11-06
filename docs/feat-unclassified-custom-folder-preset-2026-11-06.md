# 미분류 소설 폴더명 예약 저장 및 원클릭 일괄 등록 시스템

- **작업 일자**: 2026-11-06
- **관련 파일**:
  - `server/routers/unclassified.py`
  - `server/templates/admin.html`
  - `server/static/admin.css`
  - `server/static/admin/admin-drawer.js`
  - `tests/test_unclassified.py`

---

## 1. 개요 및 배경
- 기존 미분류 보관함(`/api/unclassified_novels`, 관리자 드로어 UI)에서는 새 폴더로 일괄 등록 시, 매번 소설 카드를 선택한 뒤 새 폴더 입력창에 이름을 직접 입력하고 `[📁 새 폴더로 등록]` 버튼을 즉시 눌러야만 했습니다.
- 지금 당장 등록하지 않고 원하는 폴더명(한국어 정발명, 사용자 선호 폴더명 등)을 미리 지정해두고 싶어도, 드로어를 닫거나 다른 소설 카드를 클릭하면 입력값이 유실되어 매번 다시 입력해야 하는 불편함이 있었습니다.
- **사용자 요구사항**:
  > "②새 폴더로 일괄 등록 상태를 꼭, 이름을 입력하고 버튼을 눌러둬야하는데, 이름을 저장해두고 나중에 버튼만 누르는 시스템으로 확장해 줄 수 있어?"

---

## 2. 주요 아키텍처 및 구현 내용

### 2.1. 데이터베이스 스키마 확장 (`novel_works`)
- [`novel_works`](file:///c:/LANOVEL/server/routers/unclassified.py#L18-L36) 테이블에 `custom_folder_name TEXT` 컬럼을 안전하게 추가 (`ALTER TABLE novel_works ADD COLUMN custom_folder_name TEXT`).
- `ensure_novel_works_table()`을 통해 기존 테이블이 존재해도 하위 호환성을 유지하며 컬럼을 자동 마이그레이션.

### 2.2. 백엔드 API 신설 및 확장 (`server/routers/unclassified.py`)
1. **`POST /api/unclassified_novels/save_custom_folder` 신규 엔드포인트**:
   - `SaveCustomFolderRequest(work_id, custom_folder_name, work_url)` 수신.
   - 입력된 폴더명을 `novel_works.custom_folder_name`에 영구 저장.
   - 빈 문자열 전송 시 예약된 폴더명을 `NULL`로 안전하게 해제.
2. **`GET /api/unclassified_novels` 확장**:
   - 반환되는 각 소설 객체에 `custom_folder_name` 필드를 포함하여 반환.
3. **`POST /api/unclassified_novels/assign_folder` 후속 처리**:
   - 폴더 등록 완료 시 `custom_folder_name = NULL`로 초기화하고 `matched_folder`를 갱신.

### 2.3. 프론트엔드 UI/UX 혁신 (`admin.html`, `admin-drawer.js`, `admin.css`)
1. **입력 래퍼 및 저장/해제 버튼 추가**:
   - 새 폴더 입력창 옆에 `[💾 저장]` 버튼과 `[✕]` (저장 해제) 버튼 배치.
   - `Enter` 키 입력 시 즉시 저장되도록 키 이벤트 바인딩.
2. **예약 상태 실시간 시각화**:
   - 예약된 폴더명이 있을 경우, 입력창 하단에 `[🔖 예약 저장된 폴더명: ○○○]` 배지 노출.
   - 등록 버튼이 `[📁 '○○○' 즉시 등록]`으로 변경되며, 네온 하이라이트(`.has-preset`)가 적용되어 **이름을 재입력할 필요 없이 버튼 클릭 한 번으로 일괄 등록 완료**.
3. **좌측 Master 소설 카드 목록 연동**:
   - 예약 저장된 이름이 존재하는 소설 카드의 경우, 상단 헤더에 `[🏷️ ○○○]` 배지(`.card-custom-badge`)를 부착하여 목록에서부터 예약 여부를 한눈에 식별 가능.

---

## 3. 단위 테스트 및 검증 (`tests/test_unclassified.py`)
- `test_save_custom_folder_and_one_click_assignment`:
  - `POST /api/unclassified_novels/save_custom_folder` 호출을 통한 폴더명 저장 및 DB 반영 검증.
  - `GET /api/unclassified_novels`에서 `custom_folder_name` 반환 검증.
  - 저장된 폴더명을 대상으로 `POST /api/unclassified_novels/assign_folder` 원클릭 등록 수행 및 `translations` 일괄 귀속, `novel_works` 정리 검증.
- 기존 단위 테스트(`test_unclassified_sorting_and_assignment` 및 `test_special_batch.py`) 포함 전원 패스 (100%).
