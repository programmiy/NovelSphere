# 기능: 목차(TOC) 기반 정렬 기능 개선 및 버그 수정

## 개요
이번 업데이트는 사용자가 Kakuyomu 또는 Syosetu의 목차(TOC) URL을 가져와 기존 소설의 챕터 순서를 동기화하는 기능을 구현하고, 그 과정에서 발견된 여러 버그를 수정한 내역을 포함합니다.

## 주요 변경 사항

### 1. 목차(TOC) 파싱 로직 개선
- **다중 레벨 목차 지원 (Kakuyomu):** Kakuyomu의 목차가 여러 계층으로 구성된 경우, 최상위 레벨만 가져오는 문제를 해결했습니다. 재귀적 파싱 로직을 도입하여 모든 하위 챕터를 포함한 전체 목차를 정확하게 가져오도록 수정했습니다.
- **URL 정규화:** 목차 파싱 시 URL에 포함될 수 있는 프래그먼트 (`#...`)를 제거하여 데이터 일관성을 확보했습니다.

### 2. 정렬 로직 통일 및 버그 수정
- **정렬 기준 통일:** `library.html`의 URL 목록과 `admin.html`의 관리 페이지 모두 `toc_sort_order`를 기준으로 URL 그룹이 정렬되도록 로직을 수정하고 통일했습니다.
- **SQLAlchemy 모델 업데이트:** `translations` 테이블에 `toc_sort_order` 컬럼이 추가되었음에도 `Translation` 모델에 해당 속성이 누락되어 발생하던 `AttributeError`를 수정했습니다. (`models.py` 수정)
- **데이터베이스 조회 로직 개선:** `GROUP BY` 사용 시 정렬 순서가 보장되지 않는 문제를 해결하기 위해, `MIN(toc_sort_order)`를 명시적으로 조회하여 정렬 기준으로 사용하도록 SQL 쿼리를 수정했습니다.

### 3. URL 정규화 (Canonicalization) 문제 해결
- **URL 프래그먼트 (`#end`) 문제 해결:** 데이터베이스에 URL이 `#end` 프래그먼트를 포함하여 저장되어, 번역 기록 조회 및 목차 순서 할당이 실패하는 근본적인 문제를 해결했습니다.
- **데이터 저장 로직 수정:** 번역 데이터를 저장/업데이트할 때 URL 프래그먼트를 자동으로 제거하도록 `upsert_translations` 로직을 수정했습니다.
- **데이터베이스 정리 기능 추가:** 기존에 잘못 저장된 URL들을 정리하기 위해, `translations`, `url_metadata`, `applied_urls` 테이블의 모든 URL에서 프래그먼트를 제거하는 API 엔드포인트 (`/admin/cleanup_urls`)를 추가했습니다.

### 4. 디버깅 기능 추가
- 문제의 원인 파악을 위해, URL, 제목, 원문 내용으로 번역 기록을 검색할 수 있는 디버깅용 API 엔드포인트 (`/api/debug/find_translation`)를 추가했습니다.

## 영향 범위
- `server/routers/toc_importer.py`: Kakuyomu 파싱 로직 수정
- `server/routers/books.py`: URL 목록 조회 및 업데이트 로직 수정
- `server/routers/data_crud.py`: 관리자 페이지 데이터 조회 로직 및 데이터 저장 로직 수정
- `server/routers/admin.py`: 데이터베이스 정리 기능 추가
- `server/models.py`: `Translation` 모델에 `toc_sort_order` 컬럼 추가
