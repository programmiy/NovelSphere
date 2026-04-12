# SQLite DB 성능 최적화 및 지연 시간 단축 (2026-04-12)

## 개요
- DB 상호작용 시 발생하는 지연(Lag)을 최소화하기 위해 SQLite 연결 설정을 최적화함.

## 수정 사항
### `server/database.py`
- **WAL (Write-Ahead Logging) 모드 활성화:** 읽기 작업과 쓰기 작업의 충돌을 방지하여 동시성 성능 대폭 개선.
- **PRAGMA synchronous=NORMAL:** 데이터 안전성과 쓰기 속도 간의 균형을 맞추어 디스크 I/O 대기 시간 단축.
- **cache_size=10000:** DB 캐시 메모리를 늘려 잦은 디스크 접근 방지.
- **busy_timeout=5000:** DB 잠금(Lock) 발생 시 대기 시간을 5초로 설정하여 오류 방지.

## 결과
- 대량의 번역 데이터 저장 및 조회 시 사용자 체감 지연 속도 개선.
- 동시 접속 시 발생할 수 있는 "Database is locked" 오류 확률 감소.
