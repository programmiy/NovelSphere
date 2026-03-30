# feat: translation.py DB 의존성 주입 리팩토링

## 변경 내용

`server/routers/translation.py` 파일 내 데이터베이스 연결 및 관리 방식을 FastAPI의 의존성 주입(Dependency Injection) 패턴을 사용하도록 리팩토링했습니다.

- `sqlite3` 라이브러리의 직접적인 연결(connect/cursor/execute/commit/close) 방식이 제거되었습니다.
- 불필요해진 `get_db_path()` 헬퍼 함수가 제거되었습니다.
- `_get_excluded_sentences_for_url` 함수를 포함한 모든 API 엔드포인트( `/translate`, `/excluded_sentences`, `/translations/exclude`, `/translations/find_replace`, `/translations/url_title`)가 `FastAPI.Depends(get_db)`를 통해 DB 세션을 주입받도록 변경되었습니다.
- 모든 데이터베이스 관련 로직이 SQLAlchemy ORM을 사용하여 구현되도록 전환되었습니다.
- `Session` (sqlalchemy.orm), `Depends` (fastapi), `get_db` (server.database), `Translation`, `ExcludedSentence` (server.models) 등 필요한 모듈들이 import 되었습니다.

## 기대 효과

- **DB 연결 및 세션 관리 효율성 증대:** 매 요청마다 DB 연결을 새로 생성하고 종료하는 비효율이 제거되고, 중앙에서 세션이 관리되어 자원 사용이 최적화됩니다.
- **동시성 문제 감소:** SQLite 파일 기반 DB의 'database is locked' 에러 발생 가능성이 줄어들고, FastAPI의 비동기 및 DI 패턴과 더 잘 통합됩니다.
- **테스트 용이성 극대화:** DB 세션이 주입되므로, 테스트 시 실제 DB 대신 가짜(Mock) DB 세션을 쉽게 주입하여 단위/통합 테스트를 효율적으로 수행할 수 있습니다.
- **코드 가독성 및 유지보수성 향상:** DB 로직이 ORM 기반으로 통일되어 가독성이 높아지고, 추상화된 방식으로 데이터베이스와 상호작용하므로 유지보수가 용이해집니다.
