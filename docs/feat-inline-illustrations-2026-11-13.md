# 소설 본문 인라인 삽화 엔드-투-엔드 시스템 구현 (Inline Novel Illustrations)

> **작업 일자**: 2026-11-13
> **대상 브랜치**: `extra`
> **핵심 목적**: LANOVEL PC/모바일 웹 서재·뷰어 및 Flutter 모바일/태블릿 앱 본문에 삽화 이미지를 PID(`TOP` / `L10` / `p15` / `END`) 기준으로 인라인 삽입하고, 오프라인 캐시·동기화·서재 책 설정 모달 관리·`novel-illustration` 스킬 자동 등록(`register-illustration`)까지 통합 제공

---

## 1. 핵심 설계 결정 (요구사항 정렬)

1. **지원 플랫폼**: **Web 서재/뷰어(PC + 모바일 웹)** 및 **Flutter 모바일/태블릿 앱(`mobile_app/`)** 양쪽 모두 구현.
2. **서재 표지 보존**: Web `.tome-card-3d` 및 Flutter 태블릿/모바일 서재 책 카드 외관(`_buildTabletBookCard`)은 기존 3D 양장본 디자인을 그대로 유지하고, 삽화는 **회차 본문 인라인 삽입 전용**으로 동작.
3. **업로드/보안/성능 규격**:
   - `python-multipart` 미설치 환경에서도 동작하도록 JSON `image_base64` 업로드와 루프백(`127.0.0.1`, `::1`, `localhost`) 전용 `source_path` 임포트를 모두 지원.
   - Pillow(`Image.open` + `verify()`) 기반 PNG/JPEG/WEBP 무결성 검증 및 20MB 용량 상한 적용, `resolve_illustration_abs_path` 경로 탈출 차단.
   - 대소문자 무관(`L10` == `l10`, `TOP`/`END`) PID 매칭 및 미일치 PID `END` 폴백으로 누락 방지.
   - Web(`aspect-ratio` + `max-height: 58vh`) 및 Flutter(`paginateReaderFlowItems` 가중치 기반 페이지 슬라이싱 + `InteractiveViewer` 풀스크린 라이트박스)로 페이지 계산 왜곡 방지.

---

## 2. 변경 내역 상세

### A. 백엔드 (`server/`)
| 파일 | 주요 변경 내용 |
| :--- | :--- |
| [server/models.py](file:///c:/LANOVEL/server/models.py) | `NovelIllustration` ORM 모델(`novel_illustrations` 테이블, 복합 인덱스 `ix_novel_illu_book_url`) 추가 |
| [server/database.py](file:///c:/LANOVEL/server/database.py) | `PROTECTED_TABLES`에 `"novel_illustrations"` 등록 |
| [server/services/illustration_service.py](file:///c:/LANOVEL/server/services/illustration_service.py) | 신규 생성. `get_illustrations_root` (`settings.data_dir/illustrations`), `book_dir_slug`, `normalize_after_pid`, `resolve_illustration_abs_path`, `delete_stored_file`, `store_illustration_image`, `resolve_chapter_metadata`, `serialize_illustration` |
| [server/routers/illustrations.py](file:///c:/LANOVEL/server/routers/illustrations.py) | 신규 생성 (`/api/illustrations`). `GET ""`, `GET "/book/{book_name}/chapters"`, `GET "/book/{book_name}/pids"`, `POST ""` (원격 `source_path` 403 차단), `PUT "/{illustration_id}"`, `DELETE "/{illustration_id}"` (`DeletedRecord(entity_type="illustration")` 기록), `GET "/{illustration_id}/image"` (`Cache-Control: public, max-age=86400`) |
| [server/routers/books.py](file:///c:/LANOVEL/server/routers/books.py) | `update_folder_name` 시 `novel_illustrations.book_name` 연쇄 갱신, `get_book_urls` 응답에 회차별 `illustration_count` 추가 |
| [server/routers/sync.py](file:///c:/LANOVEL/server/routers/sync.py) | `_build_mobile_optimized_db` (`/full-pack`) 내 `novel_illustrations` 테이블·행 적재, `pull_changes_from_pc` (`/pull`) 응답에 `illustrations` 증분 목록 동봉 |
| [server/server.py](file:///c:/LANOVEL/server/server.py) | `illustrations.router` 등록 |

### B. Web 서재 & 뷰어 (`server/templates/`, `server/static/`)
- **PC 웹 서재** ([library.html](file:///c:/LANOVEL/server/templates/library.html), [library.css](file:///c:/LANOVEL/server/static/library.css) `v=3.9`, [library.js](file:///c:/LANOVEL/server/static/library.js) `v=3.9`):
  - `#tag-editor-modal`에 5번째 탭 `본문 삽화` (`data-tab="illustrations"`) 추가 (파일 업로드, 회차 드롭다운, PID 미리보기 드롭다운, 캡션, 위치 수정/삭제, 뷰어 링크).
  - 목차 모달 회차별 `🖼️ N` 뱃지 표시 및 오프라인 일괄 다운로드(`handleDownloadAllOffline`) 시 삽화 프리페치 연동.
- **모바일 웹 서재** ([library_mobile.html](file:///c:/LANOVEL/server/templates/library_mobile.html), [library_mobile.css](file:///c:/LANOVEL/server/static/library_mobile.css) `v=2.3`, [library_mobile.js](file:///c:/LANOVEL/server/static/library_mobile.js) `v=2.3`):
  - `#m-tag-editor-modal` 내 컴팩트 삽화 관리 UI(`#m-illu-list` 등) 및 목차 `.m-illu-badge` 추가.
- **웹 뷰어** ([viewer.html](file:///c:/LANOVEL/server/templates/viewer.html), [viewer.css](file:///c:/LANOVEL/server/static/viewer.css) `v=3.5`, [viewer.js](file:///c:/LANOVEL/server/static/viewer.js) `v=3.3`):
  - `buildChapterFlowItems` & `createFlowItemHtml` 기반 스크롤/페이지 양쪽 인라인 `.novel-illustration-card` 렌더링, `#illustration-lightbox` 풀스크린 확대(`Esc`/배경 클릭 닫기, 페이지 넘김 충돌 방지), 목차 사이드바 `.toc-item-illu-pill` 뱃지 표시.

### C. Flutter 모바일/태블릿 앱 (`mobile_app/`)
| 파일 | 주요 변경 내용 |
| :--- | :--- |
| [novel_illustration.dart](file:///c:/LANOVEL/mobile_app/lib/models/novel_illustration.dart) | 신규 생성. `NovelIllustration`, `ReaderFlowItem`, `buildReaderFlowItems`, `paginateReaderFlowItems`, `findFlowPageForPid`, `firstPidInFlowPage` |
| [illustration_cache_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/illustration_cache_service.dart) | 신규 생성. `<appDocs>/illustrations/illu_<id>_<updatedAt>.<ext>` 로컬 디스크 캐싱, 구버전·삭제 정리, 네트워크 인증 헤더 URL 생성 |
| [local_db_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/local_db_service.dart) | `onCreate`/`onOpen`에 `novel_illustrations` 테이블·인덱스(`ix_m_illu_book_url`) 생성 및 CRUD(`upsertIllustrationsFromPc`, `deleteIllustrationsByIds`, `getIllustrationsForChapter`, `getAllIllustrations`, `getIllustrationCountsByChapter`) |
| [sync_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/sync_service.dart) | `performFullSeedDownload`·`performIncrementalDownload`에서 삽화 메타데이터 DB 반영, `entity_type == 'illustration'` tombstone 정리, 이미지 바이너리 오프라인 백그라운드 캐싱 |
| [toc_drawer.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/toc_drawer.dart) | `illustrationCountsByUrl` 파라미터 및 목차 `🖼️ N` 배지 추가 |
| [reader_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_screen.dart) | `_flowItems` / `_flowPages` 기반 Scroll & Paging 양쪽 본문 삽화 렌더링, 로컬 파일 우선 로드·백그라운드 캐시·네트워크 폴백, 탭 시 풀스크린 `InteractiveViewer` 라이트박스 표시 |

### D. `novel-illustration` 워크스페이스 스킬 연동
- [novel_scene_helper.py](file:///c:/LANOVEL/.agents/skills/novel-illustration/scripts/novel_scene_helper.py): `register_illustration()` 및 `register-illustration` CLI 서브커맨드 추가 (루프백 시 `source_path`, 원격 시 `image_base64` 자동 선택).
- [SKILL.md](file:///c:/LANOVEL/.agents/skills/novel-illustration/SKILL.md): Step 6(LANOVEL 서재 본문 삽화 자동 등록 절차 및 직접 DB 수정 금지 원칙) 추가.

---

## 3. 검증 결과 (테스트 · 린트)

- **Python Pytest** (`tests/test_illustrations.py`, `tests/test_novel_illustration_helper.py`, `tests/test_sync_router.py`, `tests/test_book_toc_order.py`, `tests/test_highlights.py`, `tests/test_db_safety_guards.py` — `tmp_path` 및 격리 DB 사용): **19 passed** (`0 failed`).
  - *참고*: 별도 기존 파일 `tests/test_library_viewer_api.py` 실행 시 `test_viewer_chapter_content_and_url_title_unification` 1건 실패(본 작업 무관, 모듈 최상단 `TestClient(app)` 컨텍스트 매니저 미진입으로 인한 `TaskManager` 비동기 워커 미기동 현상).
- **Ruff** (`server/` 변경 파일, `novel_scene_helper.py`, `tests/test_illustrations.py`, `tests/test_novel_illustration_helper.py`): **All checks passed** (`0 errors`).
- **Node.js JS 문법 검사** (`library.js`, `library_mobile.js`, `viewer.js`): `node --check` **JS_OK**.
- **Flutter** (`c:\LANOVEL\mobile_app`):
  - `flutter analyze`: **No issues found**.
  - `flutter test` ([novel_illustration_test.dart](file:///c:/LANOVEL/mobile_app/test/novel_illustration_test.dart) 4케이스 포함): **30 passed** (`All tests passed!`).

---

## 4. `outputs_sake_senpai` 2종 실서버 적재 대상
포트 `8001`의 LANOVEL 서버는 외부 트레이 관리자(`C:\ServerHub\server_hub.pyw`)가 `--reload` 없이 실행한 기존 프로세스이므로, **ServerHub에서 LANOVEL 재시작 후** 아래 2건을 `register-illustration`으로 등록합니다.

1. 1화 (`https://novelup.plus/story/579402635/960921147`, `--after-pid "L10"`): `C:\qwen loRa\outputs_sake_senpai\001_t2i_p01_v01_s20261113_01.png`
2. 4화 (`https://novelup.plus/story/579402635/644628703`, `--after-pid "L91"`): `C:\qwen loRa\outputs_sake_senpai\001_t2i_p01_v01_s20261115_01.png`
