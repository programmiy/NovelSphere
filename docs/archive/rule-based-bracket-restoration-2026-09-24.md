# 룰베이스 대사 괄호(「%」) 자동 복원 및 주기적 정비 시스템

> **작업 일자**: 2026-09-24  
> **관련 모듈**: `server/rule_classifier.py`, `server/routers/translation.py`, `server/routers/data_crud.py`, `server/routers/admin.py`, `server/server.py`, `tests/test_restore_brackets.py`

---

## 1. 배경 및 목적

- 일본 웹소설(카쿠요무, 소설가가 되자 등)의 대사는 대부분 `「...」` 괄호로 둘러싸여 있습니다.
- LLM(Gemini API) 번역 과정에서 다음과 같은 현상으로 번역문에 괄호가 누락되거나 변형되는 문제가 발생했습니다:
  1. **괄호 완전 누락 (일반 텍스트화)**: `「눈물은 멈췄지만...」` -> `눈물은 멈췄지만...` (338건)
  2. **서구식 따옴표로 치환**: `「...」` -> `"..."`, `'...'`, `“...”`, `‘...’`, `«...»` (299건)
  3. **한쪽 괄호 누락**: `「...` 또는 `...」` (25건)
- 본 작업은 사용자의 명시적 규칙에 따라 **원문의 처음과 끝부분이 `「%」`인 대사 문장에 한정하여**, 100% 결정론적인 정규식/유니코드 룰베이스로 괄호를 자동 복원하고, 기존 DB 정비 및 실시간 번역, 주기적 백그라운드 태스크로 이를 자동화합니다.

---

## 2. 주요 변경 사항

### 2.1 룰베이스 복원 엔진 (`server/rule_classifier.py`)
- `restore_brackets(original: Optional[str], translated: Optional[str]) -> Optional[str]`:
  1. **원문 자격 검증**: `original.strip()`이 반드시 `「`로 시작하고 `」`로 끝나는지 확인. `min(leading_open, trailing_close)`를 통해 `「「...」」` 등 다중 괄호 개수도 정확히 보존.
  2. **완전 충족 바이패스**: 이미 번역문이 `「...」`로 둘러싸여 있거나, 화자 접두어(예: `쿄코「...」`), 후행 구두점(`「...」.`)이 있는 경우 원형 보존.
  3. **HTML 태그 보호**: `<span>...</span>` 등 태그로 감싸진 경우 내부 텍스트에 재귀 적용 후 태그 재결합.
  4. **외곽 따옴표 치환**: 번역문이 `"..."`, `'...'`, `“...”`, `‘...’`, `«...»` 등 외곽 따옴표로 둘러싸인 경우 해당 따옴표를 제거하고 `「`와 `」`로 치환.
  5. **단면 누락 복구**: `「...` 형태는 닫는 괄호 `」` 추가, `...」` 형태는 여는 괄호 `「` 추가.
  6. **완전 누락 복구**: 괄호나 따옴표가 전혀 없는 일반 텍스트인 경우 `「`와 `」`로 감싸기.
- `batch_restore_brackets_in_db(db_conn) -> Tuple[int, int]`:
  - `WHERE original LIKE '「%」' AND (translated NOT LIKE '「%」' OR translated IS NULL)` 고속 쿼리로 불필요한 전체 순회를 방지하고, 누락 레코드만 선별하여 `executemany`로 일괄 업데이트.

### 2.2 실시간 번역 파이프라인 연동 (`server/routers/translation.py`)
- `POST /translate` 응답 처리부(일반 번역 및 검열 분할 번역 루프)에서 `process_repeated_chars` 직후 `restore_brackets`를 호출.
- 클라이언트로 전송되기 전에 대사 괄호가 즉시 복원되어 브라우저 확장 프로그램 및 뷰어에 온전한 괄호 형태로 표시됨.

### 2.3 DB 적재 파이프라인 연동 (`server/routers/data_crud.py`)
- `POST /translations/upsert` 처리 시 `item.translated`에 `restore_brackets`를 통과시킨 후 무결성 검증 및 DB INSERT/UPDATE 수행.
- 향후 어떤 경로로 번역 데이터가 수신되더라도 DB 적재 시 괄호 누락이 원천 차단됨.

### 2.4 관리자 온디맨드 복원 API (`server/routers/admin.py`)
- `POST /admin/restore_brackets`:
  - 관리자가 필요할 때 즉시 DB 전체를 스캔하여 괄호 복원을 수행할 수 있는 엔드포인트 제공.

### 2.5 주기적 백그라운드 태스크 (`server/server.py`)
- `periodic_bracket_restoration_task(interval_seconds=1800)`:
  - 서버 시작 10초 후 1차 즉시 검사 실행.
  - 이후 30분(1800초)마다 비동기 스레드(`asyncio.to_thread`)로 DB를 점검하여 누락된 대사 괄호를 자동 복구하고 로그에 기록.
  - 서버 종료 시 우아한 종료(Graceful shutdown) 지원.

---

## 3. 기존 DB 정비 결과

1. **사전 안전 백업**:
   - `server/backups/translations_backup_before_bracket_restore_20260924_104543.db` 생성 완료 (334MB).
2. **복원 실행**:
   - 대상 `original LIKE '「%」'` 문장 약 9.4만 건 중 누락/변형된 **649건** 일괄 복원 완료.
3. **무결성 및 FTS5 검증**:
   - 복원된 649건 전체에 대해 여는 괄호(`「`)와 닫는 괄호(`」`) 개수 불균형(`o_open != o_close`) 검사 결과 **0건** (100% 정상 매칭).
   - SQLite 트리거(`translations_au`)를 통해 `translations_fts` 가상 테이블 전문 검색 인덱스 자동 동기화 확인.

---

## 4. 단위 테스트 및 검증

- `tests/test_restore_brackets.py` 신규 작성 (총 10개 테스트 케이스):
  - 일반 텍스트 괄호 추가 검증
  - 큰따옴표, 작은따옴표, 유니코드 곡선따옴표, 기요메 치환 검증
  - 단면 괄호 누락 복구 검증
  - 화자 접두어 및 내부 서술문 보존 검증
  - 다중 괄호(`「「...」」`) 보존 검증
  - HTML 태그 내부 텍스트 괄호 복원 검증
  - 비대상 문장(본문 중간 괄호, 일반 문장, 전각 괄호 독백) 불변성 검증
  - 인메모리 DB 일괄 복원 함수 검증
  - `POST /admin/restore_brackets` API 엔드포인트 검증
  - `POST /translations/upsert` 격리 세션 자동 복원 검증
- **전체 테스트 결과**: 71 passed (100% 통과).
