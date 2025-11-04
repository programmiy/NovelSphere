# 프로젝트 고도화 로드맵

## 작업 참고
- 각 항목의 개발 및 로컬 커밋 완료 후, 원격 저장소로의 푸시는 사용자가 직접 관리합니다.

## 1. 코드 구조 리팩토링 (중기)

- **내용:** `server.py`에 집중된 로직을 FastAPI의 `APIRouter`를 사용해 기능별 파일로 분리.
- **기대 효과:** 모듈성, 가독성, 유지보수성 향상.
- **진행 상황:**
    - [x] `server/routers/` 디렉토리 생성
    - [x] `system.py`: 시스템 관련 엔드포인트 (health, settings, 등) 분리 완료.
    - [x] `tasks.py`: 백그라운드 작업 엔드포인트 (`fetch_missing_titles`) 분리 완료.
    - [x] `translation.py`: 번역 관련 엔드포인트 (`excluded_sentences`, `find_replace` 등) 분리 완료.
    - [x] `data_crud.py`: 데이터 CRUD 엔드포인트 (`paged_translations`, `translations_by_folder`, `stream`, `migrate` 등) 분리 완료.
    - [ ] `server.py`에 남은 엔드포인트들 추가 분리 작업 진행 예정.

## 2. 테스트 자동화 도입 (단기 - 최우선)

- **내용:** `pytest`와 `TestClient`를 도입하여 핵심 API 및 기능에 대한 단위/통합 테스트 작성.
- **기대 효과:** 코드 변경에 대한 안정성 확보 및 버그 사전 방지.

## 3. 데이터베이스 관리 고도화 (장기)

- **내용:** `SQLAlchemy`(ORM)와 `Alembic`(마이그레이션)을 도입하여 DB 관리 체계화.
- **기대 효과:** 생산성, 안정성 향상 및 스키마 변경 이력 관리.

## 4. 비동기 작업 처리 개선 (장기)

- **내용:** `Celery`와 `Redis`를 도입하여 무거운 백그라운드 작업(번역, 크롤링)을 안정적으로 처리.
- **기대 효과:** 애플리케이션 응답성 및 확장성 개선.