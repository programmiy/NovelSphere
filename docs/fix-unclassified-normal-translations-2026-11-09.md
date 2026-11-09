# 정상 번역 미분류 보관함 유입 복원 및 검열 소설 격리 분리 보고서

- **작업 일자**: 2026-11-09
- **관련 파일**:
  - `extension/src/core/page_translator.ts`
  - `extension/src/core/row_actions.ts`
  - `extension/content.js` (빌드 결과물)
  - `server/routers/unclassified.py`
  - `server/static/admin/admin-drawer.js`
  - `docs/codebase-functional-reference-2026-11-09.md`

---

## 1. 문제 현상 및 인과관계

### 1.1. 현상
1. 사용자가 웹에서 정상 번역을 수 시간 동안 연속 수행했으나, 관리자 페이지의 미분류 보관함 숫자가 **5,472**에서 단 1개도 증가하지 않고 그대로 고정되는 현상 발생.
2. 미분류 보관함 드로어 목록에 기존 소설이 소설명이 아닌 **`ログイン`**이라는 왜곡된 제목으로 표출되고, 검색창에 소설명을 검색해도 필터링되어 카드가 보이지 않던 문제 발생.

### 1.2. 인과관계 규명
1. 직전 커밋(`0767073`)에서 복원센터에서 문단 수정 시 미분류로 빠지는 현상을 막기 위해 크롬 확장의 저장 로직(`saveAllTranslations`, `saveSingleTranslation`)에 `folderName: novelFolder`를 주입하도록 수정됨.
2. 이로 인해 브라우저 확장에서 새로 번역하는 모든 정상 소설 회차가 소설 폴더명을 강제로 달고 서버로 전송되어 **미분류 보관함(`folderName IS NULL`)을 완전히 건너뛰고 서재 폴더로 직행**하게 됨.
3. 그 결과 오늘 번역된 131개 회차(14,062문단)가 미분류 보관함으로 들어오지 않고 5,472에서 숫자가 멈추는 현상이 발생함.
4. 소설가가 되자 웹 타이틀 크롤링 시 로그인 안내 태그가 긁혀와 `novel_works`에 `ログイン`으로 캐시되었고, `admin-drawer.js` 검색 필터가 `matched_existing_folder`를 검색하지 않아 카드가 완전히 숨겨졌음.

---

## 2. 해결 및 구현 내용

### 2.1. 정상 번역 미분류 보관함 유입 복원 (확장 프로그램)
- **`extension/src/core/page_translator.ts`**:
  - `saveAllTranslations`에서 신규 번역 저장 시 `folderName: null`로 원상 복구.
- **`extension/src/core/row_actions.ts`**:
  - `saveSingleTranslation`에서 단건 번역 저장 시 `folderName: null`로 원상 복구.
- **`extension/content.js`**:
  - `npm run build`를 통해 확장 프로그램 빌드 및 번들 최신화.
- **결과**:
  - 웹소설을 확장 프로그램으로 번역하는 모든 일반 번역은 정상적으로 `folderName: null`로 저장되어 **미분류 보관함으로 실시간 유입 및 카운트 증가**.
  - 원문 수집기(`/raw_collector`)를 통한 검열 소설(`ManualTranslationNovel`)은 수집기 자체 폴더명으로 저장되고 확장이 차단되므로 **미분류 보관함에 절대 들어가지 않도록 완벽히 분리**.

### 2.2. 미분류 보관함 5,472 $\rightarrow$ 19,534 정상화 (데이터 정돈)
- 오늘 번역되었던 131개 회차(14,062문단)를 서버 공식 API(`PUT /translations/move`)를 통해 안전하게 미분류(`folderName = NULL`) 상태로 전환.
- 기존 5,472문단(10~58화)과 오늘 번역분 14,062문단(59~187화)이 합쳐져 **미분류 보관함에 총 180개 회차, 19,534문단이 정상적으로 통합 모음**.

### 2.3. 미분류 보관함 UI 및 검색 필터 개선
- **`server/routers/unclassified.py`**:
  - `novel_title`이 `ログイン`, `エラー`, `Error` 등 가짜 제목인 경우, 스마트 매칭된 기존 폴더명(`matched_existing_folder`)으로 자동 대체하여 반환하도록 보강.
- **`server/static/admin/admin-drawer.js`**:
  - 검색 필터에 `n.matched_existing_folder`와 `n.custom_folder_name`을 추가하여 '교내 최고' 등 한국어 폴더명으로도 즉시 검색 가능하도록 개선.
  - 카드 제목 표출 시 `ログイン` 등 왜곡 제목을 배제하고 유효한 매칭 폴더명을 우선 표기.

---

## 3. 검증 결과

1. **테스트 스위트 검증**:
   - 관련 31개 테스트 및 전체 289개 테스트 전건 통과 (`289 passed in 15.36s`).
2. **API 응답 검증**:
   - `GET /api/unclassified_novels` 호출 결과:
     - `total_unclassified_paragraphs`: **19,534**
     - `total_unclassified_novels`: **1**
     - `novel_title`: **교내 최고 미소녀는 사실 칭찬에 약한 허접 오나홀**
     - `matched_existing_folder`: **교내 최고 미소녀는 사실 칭찬에 약한 허접 오나홀**
