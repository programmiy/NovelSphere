# 대용량 데이터 전문 검색(FTS5) 및 뷰어 쿼리 인덱싱 최적화 (2026-09-13)

## 1. 개요
* 20만 건 이상의 대용량 번역 데이터셋에서 발생하는 본문 검색(`LIKE %검색어%`) 풀 테이블 스캔 병목을 해소하기 위해 SQLite FTS5(Full-Text Search) 가상 테이블 및 실시간 동기화 트리거를 구축하고, 뷰어 챕터 조회를 위한 복합 인덱스를 추가했습니다.

## 2. 주요 변경 사항

### 2-1. SQLite FTS5 전문 검색 가상 테이블 및 동기화 트리거 (`server/server.py`)
* `translations_fts` 외부 콘텐츠 가상 테이블(`content='translations'`, `tokenize='unicode61'`) 생성:
  * 본문 데이터를 중복 저장하지 않고 색인(Index)만 관리하여 디스크 낭비 최소화.
* `translations` 테이블에 대한 `INSERT`, `UPDATE`, `DELETE` 트리거 3종을 등록하여 데이터 변경 시 FTS 색인이 실시간 자동 동기화되도록 구현.
* 서버 기동 시 색인이 비어 있을 경우 전체 데이터 자동 재색인(`rebuild`) 로직 탑재 (20만 7천여 건 색인 완료).

### 2-2. 검색 API의 FTS5 고속 색인 검색 및 하위 호환 (`server/routers/data_crud.py`)
* `/translations` 엔드포인트의 `search` 필터링에서 FTS5 `MATCH` 구문 검색을 우선 적용하여 검색 시간을 수 초 대에서 수 밀리초 대로 단축.
* 구문 에러 또는 특수 환경 대비 기존 `LIKE` 검색으로의 안전한 자동 Fallback 보장.

### 2-3. 뷰어 챕터 조회를 위한 복합 인덱스 추가 (`server/models.py`, `server/server.py`)
* `Index('ix_folder_title', 'folderName', 'title')` 복합 인덱스를 생성하여, 뷰어에서 챕터 목록 및 챕터 본문 조회 시 특정 책/챕터에 속한 문장들을 인덱스로 즉시 좁혀 풀스캔과 정렬 지연을 방지.

## 3. 검증 결과
* 기존 207,239건 번역 데이터 전체에 대한 FTS5 색인 빌드 및 정상 검색 동작 검증 완료.
* 복합 인덱스 `ix_folder_title` 정상 등록 확인.
* 전체 단위 테스트 스위트(`pytest`) 23개 항목 100% 통과 (소요 시간 6.82s).
