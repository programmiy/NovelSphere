# 복원센터 수정 단락 미분류 보관함 격리 차단 및 번역 미수행 쿼터·오늘 번역 오집계 원천 방어 보고서

- **작업 일자**: 2026-11-08
- **관련 파일**:
  - `server/quota.py`
  - `server/routers/data_crud.py`
  - `server/services/cleanup_trash_service.py`
  - `extension/src/core/row_actions.ts`
  - `extension/src/core/page_translator.ts`
  - `extension/content.js` (빌드 결과물)
  - `server/static/admin/admin-tree.js`
  - `tests/test_restore_folder_inheritance.py`

---

## 1. 문제 현상 및 인과관계 규명

### 1.1. 현상 1: 복원센터에서 수정한 문단이 미분류 보관함으로 들어가는 현상
1. 원문 복제·변형 정리(또는 이상번역 정리)로 인해 삭제된 단락은 `translations` 테이블에서 DELETE되고 `translation_trash`에 보관됨.
2. 사용자가 복원센터의 `[🔍 검수 회차 열기]`를 통해 소설 회차 웹페이지로 이동한 후, 브라우저 확장 프로그램에서 해당 단락을 직접 수정(`saveSingleTranslation`)하거나 재번역함.
3. 확장 프로그램은 `folderName: null`로 서버에 전송함.
4. 서버의 `upsert_translations`는 해당 단락이 DB에 없으므로 신규 INSERT 분기를 탔으나, 동일 URL(회차)의 다른 문단들이 가진 유효한 `folderName`을 상속받는 로직이 누락되어 있어 `folderName = None`으로 DB에 삽입됨.
5. 시스템 규격상 `folderName IS NULL`인 레코드는 **미분류 소설 보관함(Unclassified Drawer)**으로 자동 분류되어 소설 폴더에서 이탈하는 현상 발생.

### 1.2. 현상 2: 오늘 실제 번역을 안 했는데 상단 HUD 카드에 "오늘 번역 9화 (23문단)", "API 쿼터 1 / 500"으로 카운팅되는 현상
1. 사용자가 과거 번역된 문장을 교정/수정(`save-item-btn` 또는 `upsert_translations`)할 때, 기존 레코드의 `timestamp`가 현재 시각(`Date.now()`)으로 덮어씌워짐.
2. 신규 단락으로 재검수/복원 적재되는 경우에도 동일 회차의 과거 시각이 아닌 현재 시각(`Date.now()`)으로 찍힘.
3. 이로 인해 23개 수정 문단(9개 회차)의 `timestamp`가 오늘 쿼터 윈도우(17시 이후)로 설정되어 `get_today_translations_count()`(23문단) 및 `get_today_episodes_count()`(9화)에 허위 합산됨.
4. 더 나아가, 관리자 화면 진입 시 `get_today_api_call_count()`가 호출될 때 오늘 실제 API 호출이 없어 `count == 0`이었으나, 레거시 마이그레이션 함수인 `_seed_calls_from_translations_if_needed`가 발동함.
5. 이 함수가 `translations`의 오늘자 문단 timestamp를 감지하고 가짜 `ApiCallLog(timestamp=ts, model="gemini-default", status_code=200)`를 DB에 강제 생성하여 **API 쿼터가 1 / 500 (0.2%)으로 왜곡 표시**됨.

---

## 2. 해결 및 세부 구현 내용 (다층 방어 체계)

### 2.1. 백엔드 폴더명 자동 상속 및 귀속 보정
- **`server/routers/data_crud.py` (`upsert_translations`)**:
  - `urls_in_batch`에 대해 동일 URL의 유효한 폴더명을 수집하는 `url_to_folder` 매핑 구축 (DB 레벨 1회 일괄 조회 포함).
  - 신규 번역 레코드 삽입 시 `item.folderName`이 없거나 `'Unknown'`/`'미분류'`인 경우, 동일 URL의 소설 폴더명을 자동 상속받아 `new_folder`로 안전하게 적재.
  - 기존 번역 레코드 수정 시 기존 폴더가 비어있거나 미분류였던 경우 유효한 상속 폴더로 자동 보정.
  - 배치 완료 후 동일 URL 내의 미분류 단락들을 유효한 소설 폴더명으로 일괄 원자적 동기화.

### 2.2. 휴지통 복원 엔진 상속 보강
- **`server/services/cleanup_trash_service.py` (`restore_trash_items`)**:
  - 휴지통 복원 대상 URL들의 유효 소설 폴더명을 사전 조회하여 `url_to_folder` 구성.
  - `TranslationTrash.folderName`이 비어있거나 `'미분류'`였더라도 동일 URL의 기존 소설 폴더명을 자동 상속받아 복원되도록 보정.

### 2.3. 재검수/복원/미분류 수정 시 타임스탬프 상속 (저장 시점 오염 방어)
- **`server/routers/data_crud.py` (`upsert_translations`)**:
  - **기존 번역 레코드 수정 시**: 최초 번역 시점의 `existing_translation.timestamp`를 영구 보존.
  - **신규 단락 삽입 시**: 동일 회차(`url`)의 기존 번역 레코드들로부터 원래 번역 일시(`url_to_base_timestamp`) 및 휴지통 원본 일시(`trash_ts_map`)를 자동 상속.
  - 과거에 이미 번역된 회차의 단락을 재검수/복원하거나 미분류 보관함에서 수정하더라도, 해당 단락의 `timestamp`가 오늘 시각으로 찍히지 않고 원래 회차 번역 시점으로 안전 귀속됨.

### 2.4. 과거 회차 수정 단락의 오늘 실적 집계 원천 배제 (조회 시점 필터링)
- **`server/quota.py` (`get_today_translations_count`, `get_today_episodes_count`)**:
  - 오늘 번역 문단/회차 실적 산출 시, 오늘 timestamp를 가진 회차 중 **과거(오늘 17시 이전)에 이미 번역 이력이 존재하는 회차(재검수/수정/복원된 회차)는 신규 번역 실적에서 원천 제외**.
  - 오직 오늘 처음으로 번역된 순수 신규 회차(`pure_today_urls`)의 문단만 실적으로 집계.
  - 수동 DB 마이그레이션 없이도 과거 회차 수정 단락이 상단 HUD 오늘 번역(문단/회차)에 절대 뜨지 않으며, 현재 상단 표시도 즉시 **0화 (0문단)**으로 완전 정상화.

### 2.5. 가짜 API 쿼터 시드(Seed) 영구 제거
- **`server/quota.py` (`get_today_api_call_count`)**:
  - `_seed_calls_from_translations_if_needed` 호출 전면 제거.
  - `ApiCallLog.model != "gemini-default"` 필터를 적용하여 실제 Gemini API 호출 기록만 순수하게 집계하도록 단일 책임화 (실제 호출 0회 시 정확히 0 / 500 표출).

### 2.6. 확장 프로그램 및 관리자 프론트엔드 연동
- **`extension/src/core/row_actions.ts` (`saveSingleTranslation`)**:
  - `folderName: null` 하드코딩 제거 $\rightarrow$ `state.currentNovelTitle` 유효값 전달.
- **`extension/src/core/page_translator.ts` (`saveAllTranslations`)**:
  - `folderName: null` 하드코딩 제거 $\rightarrow$ `state.currentNovelTitle` 유효값 전달.
- **`extension/content.js`**: `npm run build`를 통해 빌드 최신화 (40ms 반영).
- **`server/static/admin/admin-tree.js`**:
  - 인라인 번역 저장 시 DOM 컨텍스트 기반 폴더명 보완 및 원래 `originalItem.timestamp` 보존 전달.

---

## 3. 검증 결과

1. **단위 테스트 구축 (`tests/test_restore_folder_inheritance.py`)**:
   - `test_upsert_inherits_folder_name_when_client_sends_null`: `folderName=None` 단락 저장 시 동일 회차 소설 폴더 자동 상속 통과.
   - `test_upsert_preserves_timestamp_on_text_update`: 기존 번역 텍스트 수정 시 최초 번역 timestamp 보존 통과.
   - `test_upsert_inherits_timestamp_for_new_items_in_existing_episode`: 과거 회차의 재검수/복원 신규 단락 삽입 시 기존 회차 timestamp 자동 상속 통과.
   - `test_restore_trash_inherits_folder_name`: 휴지통 복원 시 소설 폴더 자동 상속 통과.
   - `test_quota_tracker_does_not_seed_fake_calls`: 번역 미수행 시 가짜 API 호출 미생성 검증 통과.
2. **전체 테스트 스위트 회귀 검증**:
   - `278 passed in 12.05s` (기존 273개 + 신규 5개 전체 통과).
3. **실시간 쿼터 및 실적 검증**:
   - `get_quota_summary()` 호출 결과: `api_calls_today: 0` (0/500, 0.0%), `today_translations_count: 0`, `today_episodes_count: 0` 확인.
