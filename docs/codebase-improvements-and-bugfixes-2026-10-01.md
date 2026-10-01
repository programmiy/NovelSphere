# LANOVEL 코드베이스 개선 및 잠재적 버그 수정 보고서 (2026-10-01)

## 1. 개요
본 문서는 LANOVEL 시스템의 백엔드, 프론트엔드, 데스크톱 래퍼 전반을 심층 분석하여 도출된 14개 개선 영역 중, 고비용/비공개 키 관련 항목(11번, 14번)을 제외한 12개 항목의 코드 수정 및 테스트 검증 내역을 기록한 작업 보고서입니다.

---

## 2. 작업 내역 및 수정 상세

### 🔴 안정성 및 잠재적 결함 개선
1. **번역 후처리 중복 로직 함수화 (`server/routers/translation.py`)**
   - **문제점**: 검열 분할 경로와 일반 번역 경로에서 화살표(`->`, `=>`) 분리, 반복 문자 처리, 괄호 복원, 품질 분류 로직이 30줄 이상 완전히 중복되어 있어 유지보수 시 한쪽 누락 위험 존재.
   - **조치**: `_post_process_translated_text(item_text, raw_trans)` 공통 헬퍼 함수로 추출하여 일원화.
2. **2차 Verbatim 복구 시 API 호출 쿼터 집계 누락 보완 (`server/services/translation_recovery.py`)**
   - **문제점**: 2차 순수 텍스트 복구 호출 시 `gemini_session.post()`를 직접 호출하면서 `record_api_call()` 집계가 누락되어 일일 API 호출 통계에 오차 발생.
   - **조치**: 호출 직후 `record_api_call(model=model_name, status_code=res.status_code)`를 호출하도록 보완.
3. **스키마 마이그레이션 예외 처리 개선 (`server/server.py`)**
   - **문제점**: `ALTER TABLE` 시 `except Exception: pass`로 인해 디스크 풀, DB 파일 손상 등의 치명적 예외까지 은폐될 위험.
   - **조치**: `duplicate column name` 및 `already exists` 오류만 정상 통과시키고 기타 예외는 `logger.error`로 기록하도록 수정.
4. **VBS 자동실행 경로 이스케이프 경고 수정 (`main.py`)**
   - **문제점**: `os.path.join` 인자에 `Microsoft\Windows\Start Menu...` 형태의 일반 문자열을 사용하여 `\W`, `\S` 이스케이프 시퀀스 경고 발생.
   - **조치**: 원시 문자열(`r"..."`)로 변경하여 안정성 확보.

### 🟡 구조 및 코드 품질 개선
5. **쿼터 안전 중단 상태 캡슐화 (`server/routers/translation.py`)**
   - **문제점**: 전역 불리언 변수(`process_started_before_cutoff`)를 멀티스레드 환경에서 안전하지 않게 읽고 쓸 수 있는 구조.
   - **조치**: `_QuotaStopState` 클래스로 락과 상태를 완벽히 캡슐화하여 `check_and_update(now, cutoff_hour)` 메서드를 통해서만 상태 갱신/판정이 이루어지도록 리팩터링.
6. **RPM 매니저 지연 임포트 오버헤드 제거 (`server/services/rpm_manager.py`)**
   - **문제점**: `proactive_rpm_rest()` 내부에서 매번 `from server.notifications import update_translation_status`를 중복 호출.
   - **조치**: 모듈 레벨에서 `_update_status`로 선택적 임포트하고 함수 내에서는 캐시된 함수 참조를 호출하도록 개선.
7. **URL 정규화 및 변형 생성 공통화 (`server/utils.py`, `server/routers/data_crud.py`)**
   - **문제점**: http/https, www, trailing slash 등 8~16개 URL 변형을 만드는 하드코딩된 로직이 모듈별로 산재.
   - **조치**: `server/utils.py`에 `get_url_variants(url)` 유틸 함수를 추가하고 `data_crud.py`에서 이를 호출하도록 통일.
8. **DB 대사 괄호 자동 복원 쿼리 TRIM 보완 (`server/rule_classifier.py`)**
   - **문제점**: `LIKE '「%」'` 검색 시 앞뒤 공백이 포함된 원문이 누락되는 한계.
   - **조치**: `TRIM(original) LIKE '「%」'` 및 `(translated IS NULL OR TRIM(translated) NOT LIKE '「%」')`로 쿼리 조건 정밀화.
9. **`sys.modules` 런타임 강제 패치 제거 (`server/services/rpm_manager.py`)**
   - **문제점**: `recycle_gemini_session()`에서 다른 라우터의 모듈 딕셔너리를 직접 `setattr`하던 취약한 패턴 존재.
   - **조치**: `translation.py`의 모듈 레벨 alias를 제거하고 항상 `get_gemini_session()`을 통해 최신 세션을 조회하도록 개선. 연관 테스트(`test_rpm_breather.py`, `test_services_modularization.py`) 동기화.

### 🟢 프론트엔드 및 프로젝트 정리
10. **관리자 이상번역 탭 미번역 가나 키워드 칩 UI 연동 (`server/static/admin.js`, `server/static/admin.css`)**
    - **문제점**: 백엔드의 `untranslated_keywords` 배열 추출 기능은 구현되어 있으나 UI에서 렌더링되지 않던 미구현 항목.
    - **조치**:
      - `renderItem()`에서 `partial_untranslated` 카테고리 항목에 대해 미번역 키워드 칩(`<button class="keyword-chip">`) 렌더링.
      - 칩 클릭 시 전역 찾아바꾸기 모달(`openFindReplaceModal()`)이 즉시 열리며 검색어와 폴더 범위가 자동 주입되고 실시간 카운트가 트리거되는 스마트 인터랙션 구현.
11. **임시 DB 및 불필요 파일 무시 규칙 추가 (`.gitignore`)**
    - `server/temp_*.db`, `LANOVEL.db` 명시적 제외 추가.

---

## 3. 검증 결과
- **테스트 도구**: pytest (Python 3.11.2)
- **실행 결과**: `127 passed in 7.85s` (기존 회귀 없이 127개 전체 단위/통합 테스트 100% 통과)
