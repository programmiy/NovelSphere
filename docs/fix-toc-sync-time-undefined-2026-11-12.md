# TOC 동기화 타임스탬프 오류(NameError: name 'time' is not defined) 방탄화 및 다중 폴백 적용

## 1. 개요 및 배경
- **현상**: 관리자 서재 및 모바일 서재에서 소설의 TOC(목차) 동기화 시도시 `TOC 동기화 실패: 데이터베이스 오류: name 'time' is not defined` 에러 발생.
- **원인 분석**:
  1. 소설 목차 동기화는 1단계 `POST /api/import-toc`(성인/검열 사이트 포함 목차 크롤링)와 2단계 `PUT /api/books/{folder_name}/urls`(목차 순서 및 updated_at 동기화)로 구성됨.
  2. 2단계의 백엔드 처리 함수인 `server.services.book_service.update_book_toc_order`에서 최근 동기화 파이프라인 연동(`updated_at`)을 위해 `now_ts = int(time.time())`를 사용하였으나, 이전 구동 중이던 서버 프로세스 및 일부 환경에서 `import time` 네임스페이스 누락 및 `server/routers/books.py`의 `import time` 부재로 인해 500 데이터베이스 예외 발생.
  3. 성인/검열 소설 여부와 관계없이 목차 순서 갱신 로직에서 발생한 오류임.

## 2. 해결 방안 및 구현 내용
1. **모듈 레벨 임포트 보강**:
   - `server/routers/books.py` 상단에 `import time`, `from datetime import datetime` 명시적 임포트 추가.
   - `server/routers/books.py` 내 `update_folder_name`의 타임스탬프 계산에도 예외 폴백 적용.
2. **`update_book_toc_order` 다중 시간 폴백(Multi-Tier Fallback) 아키텍처 구축**:
   - **Tier 1**: `time.time()` (정상 환경)
   - **Tier 2**: `datetime.utcnow().timestamp()` (time 모듈 언로드 또는 네임스페이스 훼손 환경)
   - **Tier 3**: SQLite 내장 `CAST(strftime('%s', 'now') AS INTEGER)` (파이썬 시간 모듈 완전 미사용 환경)
   - `time` 모듈이 정의되지 않거나 어떤 예외가 발생하더라도 `toc_sort_order`와 `title`을 포함한 목차 동기화가 100% 정상 완료되도록 방탄화.
3. **단위 테스트 검증 (`tests/test_book_toc_order.py`)**:
   - `test_update_book_toc_order_without_time_module`: `time.time` 호출 시 `NameError("name 'time' is not defined")`를 발생시켜도 Tier 2 폴백으로 목차 순서 및 updated_at 정상 갱신 검증.
   - `test_update_book_toc_order_sqlite_builtin_time_fallback`: `time`과 `datetime`이 모두 실패하더라도 Tier 3 SQLite 내장 strftime으로 정상 갱신 검증.
   - 3개 테스트 케이스 100% 통과 (총 0.12s).
