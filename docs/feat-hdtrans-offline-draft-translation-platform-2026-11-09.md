# hdTrans 오프라인 초벌 번역 플랫폼 구축 및 연동

> **작업 일자**: 2026-11-09  
> **관련 모듈**: `server/services/hdtrans_service.py`, `server/routers/collector.py`, `server/templates/raw_collector.html`, `tools/hdtrans/`, `tests/test_hdtrans_service.py`, `tests/test_raw_collector.py`

---

## 1. 구현 배경 및 목적

- **오프라인 규칙 기반 초벌 번역 엔진(`sokcuri/hdTrans`) 도입**:
  - Gemini API 호출 및 검열 위험 없이, 오프라인 규칙 기반 엔진(`hdTrans` v0.9.4)을 로컬에 배치하여 순수 원문으로 수집된 소설의 문단들을 초고속으로 초벌 번역.
- **수동 번역 스튜디오의 초벌 번역 플랫폼화**:
  - 기존 번역관리 페이지(`/admin`)에 이미 강력한 인라인 편집, 저장, 삭제, 제외, 찾기/바꾸기 기능이 완비되어 있으므로, 수동 입력 전용 UI 대신 소설 전체 또는 단건 회차를 원클릭으로 초벌 번역하는 전용 플랫폼으로 전면 개편.
- **번역 관리 페이지(`/admin`) 및 서재 검수완료 연동**:
  - 초벌 번역 현황 통계(총 회차/문단, 번역 완료, 미번역 문단)를 한눈에 확인하고, 번역 관리 페이지로 즉시 이동할 수 있는 바로가기 제공.

---

## 2. 세부 변경 사항

### 2.1 hdTrans 엔진 로컬 배치 (`tools/hdtrans/`)
- `sokcuri/hdTrans` v0.9.4 윈도우 네이티브 바이너리 배치 (`hdtrans.exe`, `hdtrans-data/`).
- `--each` 모드와 개행 토큰(`<!BR!>`) 보호 기법을 결합하여 문단 내 줄바꿈 구조 및 1:1 순서 완벽 유지.

### 2.2 초벌 번역 서비스 (`server/services/hdtrans_service.py`)
- `is_hdtrans_available()`: 실행 바이너리 존재 여부 검증.
- `translate_paragraphs(paragraphs: List[str])`: 원문 문단 리스트를 네이티브 서브프로세스로 일괄 고속 번역.
- `translate_episode_in_db(db, folder_name, url, overwrite)`: 특정 회차 단건 초벌 번역 및 DB 업데이트.
- `HdTransRunner`:
  - 소설 전체를 회차별로 순회하며 초벌 번역을 수행하는 백그라운드 워커 스레드.
  - 진행률(%), 현재 처리 회차, 번역 완료 문단 수 실시간 추적 및 로그 관리, 안전 중지 지원.

### 2.3 라우터 및 엔드포인트 (`server/routers/collector.py`)
- `POST /api/collector/hdtrans/episode`: 특정 회차 단건 초벌 번역 실행.
- `POST /api/collector/hdtrans/start`: 소설 전체 백그라운드 초벌 번역 작업 가동.
- `POST /api/collector/hdtrans/stop`: 진행 중인 초벌 번역 작업 안전 중지.
- `GET /api/collector/hdtrans/status`: 현재 초벌 번역 진행 상태 및 통계 조회.

### 2.4 UI 전면 개편 (`server/templates/raw_collector.html`)
- 상단 탭 2를 **[⚡ hdTrans 초벌 번역기]**로 전면 전환.
- 소설 선택 드롭다운 및 `[📖 번역관리(/admin)에서 편집]` 원클릭 바로가기 버튼 배치.
- 4종 통계 HUD 카드 (총 회차 수, 총 문단 수, 초벌 완료 문단, 미번역 문단).
- 소설 전체 일괄 초벌 번역 시작/중지 컨트롤 및 옵션(빈칸만 번역 / 강제 덮어쓰기).
- 실시간 프로그레스 바 및 처리 터미널 로그.
- 회차 목록 테이블: 회차별 초벌 진행률, `[⚡ 단건 초벌]` 버튼, `[📖 편집]` 링크 제공.

---

## 3. 검증 결과
- `tests/test_hdtrans_service.py` 3종 단위 테스트 전건 통과:
  1. 바이너리 가용성 검증: PASS
  2. 실제 다중 문단 및 개행 보존 번역 검증: PASS
  3. 인메모리 격리 DB 에피소드 초벌 번역 및 덮어쓰기 옵션 검증: PASS
- `tests/test_raw_collector.py` 6종 단위/통합 테스트 전건 통과.
- 통합 회귀 테스트(`test_data_crud.py`, `test_reviewed_service.py`) 포함 총 26건 전건 통과.
