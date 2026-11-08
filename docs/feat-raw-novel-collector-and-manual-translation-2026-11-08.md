# 검열 회피용 원문 전용 소설 수집기 및 수동 번역 스튜디오 구축

> **작업 일자**: 2026-11-08  
> **관련 모듈**: `server/models.py`, `server/services/collector_service.py`, `server/routers/collector.py`, `server/routers/data_crud.py`, `server/services/cleanup_trash_service.py`, `server/templates/raw_collector.html`, `server/templates/library.html`, `server/templates/library_mobile.html`, `tests/test_raw_collector.py`

---

## 1. 구현 배경 및 목적

- **검열 위험 회피**: 성인물(R18/녹턴/문라이트)이나 고수위 표현 등 Gemini API 검열 필터링 및 계정 차단 위험이 높은 특정 소설에 대해, API 번역을 일절 거치지 않고 **오직 원문만 초고속 수집**하여 DB에 번역문 빈칸(`translated=""`) 상태로 보관할 수 있는 체계 구축.
- **프로젝트 내 빈칸 감지기 및 복원센터 무력화**:
  - 기존 백엔드 `upsert_translations`는 `translated`가 빈 문자열이면 레코드를 삭제하거나 스킵했으나, 수동 번역 소설에 한해 빈칸 레코드 보존 허용.
  - 복원 센터(휴지통 감지기) `get_cleanup_queue_data` 및 `cleanup_trash_items`에서 빈 번역(`translated = ''`)을 이상치(원문 그대로 반환)로 분류해 휴지통으로 이동시키는 감지 대상에서 수동 번역 소설을 원천 제외.
- **모바일 리모컨 방식 연속 수집 워크플로**:
  - 회차당 2.5초 간격 초고속 수집.
  - 12화 연속 수집 완료 시 사이트 차단 방지를 위한 **120초(2분) 안전 쿨다운 휴식** 적용.
  - 기저장 회차 0초 자동 스킵.
- **수동 번역 스튜디오 & 미분류 격리 방지 & 서재 검수완료 연동**:
  - 전용 웹 UI(`/raw_collector`)에서 원문 문장을 보며 직접 번역문 입력/수정 지원.
  - 저장 시 지정된 `folderName`을 확실히 유지하여 미분류(None) 보관함 유입을 원천 차단.
  - 수동 번역 저장 시 서재의 `reviewed_service`를 연동하여 해당 회차 및 전체 소설에 **`✅ 검수완료` 상태를 자동 승격 및 적용**.

---

## 2. 세부 변경 사항

### 2.1 ORM 모델 추가 (`server/models.py`)
- `ManualTranslationNovel`:
  - `folderName` (Text, unique, index): 수동 번역/검열 회피 소설 폴더명
  - `source_url` (Text): 원본 목차 URL
  - `created_at` (BigInteger): 등록 일시
  - `is_completed` (Integer): 수집/번역 완료 상태

### 2.2 원문 전용 수집기 서비스 (`server/services/collector_service.py`)
- `fetch_toc_and_title(raw_url)`:
  - Syosetu, Nocturne(성인 인증 쿠키 `over18=yes` 포함), Kakuyomu(Apollo State), NovelUp+, Hameln, Alphapolis, 일반 웹페이지 목차 및 단편 파싱.
- `fetch_episode_paragraphs(ep_url)`:
  - 사이트별 본문 셀렉터 매칭 및 pid/원문 텍스트 추출.
- `RawCollectorRunner`:
  - 백그라운드 수집 스레드 및 상태 관리 (`status`: idle, running, resting, completed, stopped, error).
  - 12화마다 120초 카운트다운 휴식 및 회차 간 2.5초 지연.
  - 기수집 회차 0초 스킵.
  - 수집 시작 시 `ManualTranslationNovel` 레지스트리에 소설 자동 등록.
  - SSE 실시간 이벤트 스트림 브로드캐스트.

### 2.3 라우터 및 API (`server/routers/collector.py`, `server/server.py`)
- `GET /raw_collector`: 원문 수집기 & 수동 번역 스튜디오 웹 UI 렌더링.
- `POST /api/collector/prepare`: 목차 분석 및 전체/기수집/신규 회차 수 사전 조회.
- `POST /api/collector/start`: 백그라운드 수집 시작.
- `POST /api/collector/stop`: 수집 안전 중지.
- `GET /api/collector/status`: 현재 수집기 상태 조회.
- `GET /api/collector/stream`: SSE 이벤트 스트림.
- `GET /api/collector/manual_novels`: 수동 번역 소설 목록 및 통계.
- `GET /api/collector/episodes`: 특정 소설의 회차 목록 및 검수완료 여부.
- `GET /api/collector/episode_content`: 특정 회차의 원문 및 번역 문단 조회.
- `POST /api/collector/save_manual_translations`: 수동 번역 문장 저장, `folderName` 영구 귀속(미분류 방어), `reviewed_service.set_chapter_reviewed` 호출로 **서재 검수완료(✅ 검수완료) 자동 승격**.

### 2.4 빈칸 감지기 및 복원센터 예외 가드
- `server/routers/data_crud.py` (`upsert_translations`):
  - `ManualTranslationNovel`에 등록된 소설은 번역문이 빈 문자열(`""`)이어도 delete/continue 하지 않고 빈 레코드로 정상 보존.
- `server/services/cleanup_trash_service.py` (`get_cleanup_queue_data`, `delete_cleanup_queue_items`):
  - 수동 번역 소설 폴더는 복원센터 이상치/빈 번역 감지 쿼리 및 삭제 대상에서 원천 제외 (`folderName not in manual_folders`).

### 2.5 서재 UI 연동 (`server/templates/library.html`, `server/templates/library_mobile.html`)
- PC 및 모바일 서재 헤더 액션 메뉴에 **[📥 원문 수집기]** 버튼 배치 (`href="/raw_collector"`).

---


### 2.6 서비스 워커 206 에러 방어 및 수집기 UI 안정화 (`server/static/service-worker.js`, `server/templates/raw_collector.html`)
- **서비스 워커 206 Partial Content 에러 방어**: 오디오/폰트 등 Range 헤더 요청 시 206 부분 응답을 `cache.put` 하려다 발생하던 `TypeError: Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported` 결함을 원천 방어 (오직 완전한 200 OK 응답만 캐시하도록 가드 적용).
- **실시간 SSE 스트림 캐싱 완전 우회**: `/api/collector/stream` 및 스트리밍 엔드포인트는 서비스 워커가 fetch를 가로채거나 캐싱하지 않고 브라우저 네이티브 네트워크로 직접 연결되도록 바이패스 처리.
- **수집기 대기 상태(`idle`) 버튼 토글 수정**: 초기 대기 상태에서 [수집 시작] 버튼이 숨겨지고 [중지] 버튼이 노출되던 UI 분기 오류를 해결하여 정상적으로 [수집 시작]이 동작하도록 수정. URL 인풋 및 폴더명 인풋에 엔터(Enter) 키 즉시 실행 리스너 바인딩.

### 2.7 회차 목록 집계 500 에러 해결 (`server/routers/collector.py`)
- **SQLAlchemy case 구문 문법 수정**: `list_novel_episodes`(`/api/collector/episodes`)에서 `func.case(..., else_=0)`로 잘못 호출되어 발생하던 `TypeError: Function.__init__() got an unexpected keyword argument 'else_'`를 해결. `from sqlalchemy import case` 임포트 후 `case((condition, 1), else_=0)` 형태로 표준화하여 500 에러를 원천 차단하고 번역 완료 문단 집계가 정상 동작하도록 수정.

## 3. 검증 결과
- `tests/test_raw_collector.py` 6종 단위/통합 테스트 전건 통과:
  1. `test_models_manual_translation_novel_crud`: PASS
  2. `test_upsert_translations_preserves_empty_for_manual_novel`: PASS (수동 소설 빈칸 번역 보존 검증)
  3. `test_cleanup_trash_service_excludes_manual_novel`: PASS (복원센터 빈칸 감지 제외 검증)
  4. `test_save_manual_translations_with_review_completion`: PASS (수동 번역 저장 시 미분류 방어 및 서재 검수완료 승격 검증)
  5. `test_collector_api_endpoints`: PASS (웹 UI 및 상태/목록 API 검증)
  6. `test_syosetu_toc_and_paragraph_scraper`: PASS (목차 및 본문 파싱 검증)
- 기존 핵심 회귀 테스트(`test_data_crud.py`, `test_reviewed_service.py`, `test_unclassified.py`) 19건 전건 통과.
