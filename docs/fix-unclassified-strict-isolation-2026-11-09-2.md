# 검열 소설 제외 전원 미분류 보관함 강제 격리 및 당일 번역 전건 미분류 전환

> **작업 일자**: 2026-11-09 (2차)  
> **관련 모듈**: `server/routers/data_crud.py`, `server/routers/unclassified.py`, `tests/test_unclassified_strict_policy.py`, `tests/test_restore_folder_inheritance.py`

---

## 1. 문제 배경 및 사용자의 핵심 요구사항

1. **사용자 핵심 문제 제기**:
   - 신규 번역을 수행했음에도 웹페이지의 일본어 원제목(`風間君の嘘は彼女達にはバレバレです...`)으로 폴더가 생성되거나, 기존 소설(`교내 최고 미소녀...`)의 후속 회차가 기존 폴더로 직접 귀속되어 **미분류 보관함에 잡히지 않음**.
   - 사용자의 확고한 워크플로우: **"검열된 소설 일괄저장(`ManualTranslationNovel`)할 때를 제외하고는 정상 번역은 100% 미분류 보관함에 쌓여야 함 (오늘치 얼마나 했는지 쌓아놓는 재미)."**

2. **발생 원인**:
   - `server/routers/data_crud.py`의 `upsert_translations`에서 신규 번역 삽입 시 `item.folderName`이나 동일 URL 기존 레코드로부터 `inherited_folder`를 찾아 `new_folder`에 자동 주입하고 있었음.
   - 또한 동일 URL 내 미분류 레코드를 유효 폴더명으로 일괄 동기화하는 로직이 일반 소설에도 무차별 작동하여 미분류 상태를 덮어쓰고 있었음.
   - `server/routers/unclassified.py`의 웹 제목 스크랩에서 Syosetu 사이트 개편으로 인해 `.c-announce a`(로그인 링크)를 소설 제목(`ログイン`)으로 오인식하던 결함 존재.

---

## 2. 해결 및 구현 내용

### 2-1. `server/routers/data_crud.py` 엄격한 미분류 격리 정책 확립
1. **신규 번역 삽입 시**:
   - `is_manual_novel`(검열 회피/수동 번역 소설, `ManualTranslationNovel`)일 때만 `folderName` 지정을 허용.
   - 그 외의 모든 정상 번역은 **무조건 100% `new_folder = None` (미분류 보관함)**으로 강제 적재.
2. **기존 번역 레코드 수정 시**:
   - 일반 소설은 기존 `folderName`을 불변 유지(미분류는 계속 미분류, 서재 폴더는 서재 폴더 유지).
3. **동일 URL 미분류 레코드 동기화 차단**:
   - 오직 `manual_folders`에 속한 검열 소설일 때만 동기화하며, 일반 소설은 미분류 레코드를 절대로 기존 폴더로 덮어쓰지 않음.

### 2-2. `server/routers/unclassified.py` Syosetu 웹 제목 셀렉터 최신화
- Syosetu 최신 리뉴얼 클래스인 `.p-novel__title` 및 `h1.p-novel__title`을 1순위로 지원.
- 오염 유발 로그인 셀렉터인 `.c-announce a`를 영구 제거하여 웹 원제목 정상 표출 보장.

### 2-3. 당일 17:00 API 초기화 이후 번역분 전건(9,070문단) 미분류 보관함 전환
- 카자마 군 소설(`n8023gv`, 1~105화, 5,805문단)
- 교내 최고 미소녀 소설(`n0672fo`, 191~216화, 3,265문단)
- 총 9,070문단(131개 회차)을 `folderName = NULL`로 전환 완료하여 미분류 보관함에 100% 실시간 집계.

---

## 3. 검증 결과

1. **단위 테스트 (`tests/test_unclassified_strict_policy.py`, `tests/test_restore_folder_inheritance.py`, `tests/test_unclassified.py`)**:
   - 10개 테스트 100% 통과 (일반 번역 미분류 강제, 기존 폴더 미상속, 검열 소설 폴더 보존, 휴지통 복원 정상성).
2. **미분류 보관함 API (`get_unclassified_novels()`)**:
   - 2작품, 9,070문단 (131화) 정상 집계 확인.
