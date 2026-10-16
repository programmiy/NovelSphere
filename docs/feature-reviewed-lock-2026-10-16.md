# 검수완료 (Review Completed / Lock) 기능 레퍼런스 (2026-10-16)

## 1. 개요 및 목적
- **검수완료 정의**: 번역된 소설 및 개별 회차의 원문 및 번역문 수정을 절대적으로 잠금(Lock)하여 고품질의 완성 데이터를 보존하고, 추후 TTS 및 데이터 파이프라인 활용에 최적화하는 토글형 상태 관리 기능.
- **보안 및 DB 보호 원칙**: 운영 SQLite DB(`translations.db`)에 대한 `ALTER TABLE`이나 스키마 변경, 파일 훼손 위험을 원천 방지하기 위해 독립적인 `server/reviewed_registry.json` 안전 레지스트리를 채택함.

---

## 2. 주요 규칙 및 상속 로직 (Inheritance & Safety)
1. **도서 전체 검수완료 ON**: 해당 소설 및 하위 모든 회차 URL이 일괄 검수완료 잠금 상태로 등록됨.
2. **도서 전체 검수완료 OFF**: 해당 소설 및 하위 모든 회차 URL의 잠금이 해제됨.
3. **회차 단위 잠금 해제**: 검수 완료된 소설의 단 한 회차라도 잠금을 해제하면, 소설 전체의 검수완료 상태도 자동으로 해제되어 상태 불일치를 방지함.
4. **회차 단위 자동 승격**: 소설의 모든 회차가 검수 완료되면 도서 전체도 자동으로 '검수완료' 상태로 승격됨.

---

## 3. 백엔드 아키텍처 및 보안 가드

### 3.1 레지스트리 서비스 (`server/services/reviewed_service.py`)
- `ReviewedRegistryService` 싱글톤
- 원자적 파일 교체(`os.replace`) 기법으로 프로세스 충돌 및 손상 방지
- 도서명 및 URL 단위(후행 슬래시 정규화 포함) 상태 조회 및 저장

### 3.2 신규 API 엔드포인트 (`server/routers/books.py`)
- `PUT /api/books/{folder_name}/review`: 도서 전체 검수완료 상태 토글 및 하위 모든 회차 동기화
- `PUT /api/chapters/review`: 개별 회차 검수완료 상태 토글 및 자동 승격 연산
- `GET /api/books`: 각 도서 객체에 `is_reviewed: bool` 주입
- `GET /api/books/{folder_name}/urls`: 각 회차 객체에 `is_reviewed: bool` 주입
- `GET /api/books/{folder_name}/chapter`: 각 번역 단락 객체에 `is_reviewed: bool` 주입

### 3.3 쓰기/수정/삭제 차단 보안 가드 (HTTP 403 Forbidden)
- `server/routers/data_crud.py` (`POST /translations/upsert`): 검수완료된 회차/도서 단락 번역문 생성 및 수정 차단
- `server/routers/data_crud.py` (`POST /translations/delete`): 검수완료된 회차/도서 단락 삭제 차단
- `server/routers/translation.py` (`POST /translations/find_replace`): 검수완료된 도서 범위 지정 시 차단, 전체 범위 치환 시 검수완료 도서/회차는 자동 제외 및 보호
- `server/routers/db_editor.py` (`POST /api/db_editor/approve_single`, `approve_batch`): 검수완료된 문장 일괄/단일 승인 수정 차단

---

## 4. 프론트엔드 UI/UX

### 4.1 서재 메인 (`library.html`, `library.js`, `library.css`)
- **초록색 검수 뱃지 (`✅ 검수완료`)**:
  - 도서 그리드 3D 톰 카드 우측 상단 배지 바에 표시
  - 콤팩트 리스트 행 상태 칸에 표시
  - 3D 톰 모달 배지에 표시
- **서재 상단 필터 바**:
  - `[✅ 검수완료]` 필터 탭 추가 및 실시간 수량 카운트 연동
- **도서 설정 모달 (`tag-editor-modal`)**:
  - `[상태 & 서재]` 탭에 `[검수 완료 지정 (수정 잠금)]` 에메랄드 토글 스위치 및 실시간 상태 뱃지(`✅ 검수완료` / `⏳ 검수대기`) 제공
- **왕립 차분기관 회차 색인 대장 (`url-list-modal`)**:
  - 상단 대장 통계에 `[ 총 X화 • ✅ 검수 Y화 (Z%) ]` 실시간 진행률 표기
  - 각 회차 행마다 `[✅ 검수완료]` / `[⏳ 검수대기]` 원클릭 토글 칩 버튼 제공 (클릭 시 0ms 즉시 토글 및 전체 승격 축하 토스트 알림)

### 4.2 로컬 뷰어 (`viewer.html`, `viewer.js`, `viewer.css`)
- **상단 헤더 뱃지 버튼 (`#viewer-review-toggle-btn`)**:
  - 검수완료 회차 열람 시 상단 헤더 타이틀 우측에 `[✅ 검수완료]` 에메랄드 알약 뱃지 표시
  - 클릭 시 즉시 검수 상태를 해제하거나 재지정할 수 있는 인터랙티브 토글 제공
- **수정 잠금 UX**:
  - 검수완료된 회차에서는 단락 마우스 호버 시 수정 버튼(`.paragraph-edit-btn`)이 자동 미노출됨
  - 더블클릭 또는 모바일 롱프레스 시도 시: `🔒 검수 완료된 회차입니다. 수정을 원하시면 상단 검수완료 뱃지를 눌러 해제해주세요.` 안내 토스트 출력 및 인라인 에디터 진입 원천 차단
- **목차 사이드바**:
  - 검수완료된 회차 옆에 `✅ 검수완료` 배지 표시
