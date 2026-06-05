# DB 성능 개선 및 뷰어 지연 해결 (2026-06-05)

## 1. 수정 배경
* 뷰어에서 목록을 불러오거나 정렬할 때 심각한 지연(Lag)이 발생하는 문제를 해결하고자 합니다.
* 원인: 대용량 본문 텍스트 데이터의 과도한 메모리 로드, 인덱스 부재로 인한 전체 스캔, 그리고 정렬 시 무거운 SQL 정렬 연산.

## 2. 변경 사항

### [작업 1] DB 인덱스 추가 및 적용
* [models.py](file:///C:/LANOVEL/server/models.py#L25)의 `translations` 테이블 정의에 `ix_title` 인덱스를 추가했습니다.
  ```python
  Index('ix_title', 'title')
  ```
* [server.py](file:///C:/LANOVEL/server/server.py#L113-L118)의 lifespan 시작 시점에 `CREATE INDEX IF NOT EXISTS ix_title ON translations (title)` SQL DDL 구문을 명시적으로 실행하여 기존 데이터베이스 파일에도 인덱스가 자동 구성되도록 안전장치를 마련했습니다.

### [작업 2] 목록 조회 API 경량화
* [data_crud.py](file:///C:/LANOVEL/server/routers/data_crud.py#L264-L288)의 `/translations_by_folder` API (`get_translations_by_folder` 함수)가 쿼리 시 본문(`original`, `translated`) 컬럼을 제외하고 메타데이터만 조회하도록 수정했습니다.
* 사용되지 않던 `UrlMetadata` 대량 조회 쿼리를 제거하여 데이터 조회의 불필요한 메모리 소모를 추가적으로 최적화했습니다.

### [작업 3] 쿼리 정렬 최적화
* [books.py](file:///C:/LANOVEL/server/routers/books.py#L286)의 `/api/books/{folder_name}/chapters` API (`get_book_chapters` 함수)에서 복잡한 문자열 자르기 및 타입 변환(`SUBSTR`, `CAST`)을 수반하던 기존 `ORDER BY` 절을 정리했습니다.
* 대신, 이미 구축되어 있는 정렬 순서 필드인 `toc_sort_order`를 활용하여 `ORDER BY MIN(COALESCE(toc_sort_order, 999999)) ASC, MIN(url) ASC`로 쿼리를 대폭 단순화했습니다.

## 3. 결과 검증
* 소스 코드 리팩토링 후 `pytest` 검증을 진행하였으며, 변경된 API들로 인해 기존 정상 테스트 케이스가 손상되지 않았음을 확인했습니다.
