# Gemini API 연결/보안 최적화 및 폴더 조회 필터링 개선 (2026-09-13)

## 1. 개요
* 대용량 서비스 환경에서 반복적으로 발생하는 TCP/TLS 연결 오버헤드와 프로세스 스폰 비용을 제거하고, API 보안성 강화 및 대용량 데이터 로딩 효율성을 개선했습니다.
* 클라이언트 확장 프로그램의 코드 중복을 제거하고 프로젝트 루트와 서버 간 패키지 의존성 명세를 동기화했습니다.

## 2. 주요 변경 사항

### 2-1. Gemini API 지속 연결(Session) 및 헤더 인증 전환 (server/routers/translation.py)
* 모듈 레벨 
equests.Session() 인스턴스를 도입하여 Gemini API와의 HTTP Keep-Alive 지속 연결을 재사용, 요청당 100~300ms 수준의 TCP/TLS 핸드셰이크 지연을 제거.
* API 키 전달 방식을 URL 쿼리 파라미터(?key=...)에서 HTTP 헤더(x-goog-api-key) 방식으로 전환하여 서버 로그 및 네트워크 프록시 상의 민감 정보 노출을 근본 차단.

### 2-2. 폴더별 번역 기록 조회 필터링 지원 (server/routers/data_crud.py)
* /translations_by_folder 엔드포인트에 older: Optional[str] = None 매개변수를 추가.
* 특정 폴더나 미분류 상태만 조회 시 20만 건 전체를 인메모리에 로드하던 기존 구조 대신 DB 레벨 필터링(WHERE folderName = ? / IS NULL)을 수행하도록 최적화 (기존 전체 조회 하위 호환성 유지).

### 2-3. 서비스 워커 Git 커밋 해시 LRU 캐싱 (server/server.py)
* /service-worker.js 요청마다 git rev-parse --short HEAD 서브프로세스를 동기 실행하던 병목을 @lru_cache(maxsize=1) 데코레이터를 적용하여 메모리 캐싱으로 전환 (호출 오버헤드 0ms 달성).

### 2-4. 확장 프로그램 중복 코드 정리 (extension/content.js)
* 상단에 중복 정의되어 있던 getCleanUrl() 함수 선언(17~23행) 중 1개를 제거하여 코드 청결도 유지.

### 2-5. 루트 의존성 명세 동기화 (
equirements.txt)
* 2개 패키지만 기재되어 있던 루트 
equirements.txt에 server/requirements.txt의 전체 21개 패키지 목록을 동기화하여 개발 환경 구축 일관성 확보.

## 3. 검증 결과
* LRU 캐시 히트 및 Git 해시 정상 반환 확인 (CacheInfo(hits=1, misses=1)).
* 
equests.Session을 통한 헤더 기반 Gemini API 호출 및 URL 키 제거 검증 통과.
* 폴더 필터링 쿼리 동작(특정 폴더 단독 추출 및 _applied_urls 유지) 검증 통과.
* 전체 단위 테스트 스위트(pytest) 23개 항목 100% 통과 유지.