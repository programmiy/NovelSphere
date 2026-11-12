# 모바일 v1.8.2 OTA 빌드·배포 및 Python Ruff 린트 일괄 정리 (2026-11-13)

## 1. 작업 개요 및 목적
1. `v1.8.1+2026111001` 이후 `mobile_app/lib/`에 구현되었으나 릴리즈 빌드·OTA에 반영되지 않았던 4건의 모바일 기능(태블릿 3D 전자책 서재, 뷰어 롱프레스 일본어 원문 토글 및 `[🖊️ 마킹]` 파이프라인, 스냅샷 무음 자동 동기화, 인명·용어 교정기 스마트 추천)을 `v1.8.2+2026111301` 공식 릴리즈 APK로 컴파일하고 서버 OTA 배포를 완료했습니다.
2. `server/` 및 `scripts/` 전역에 누적되어 있던 Python Ruff 린트 오류 36건(중복 딕셔너리 키 `F601`, `zip(..., strict=False)` 미지정 `B905`, 미사용 변수 `F841`, 미사용 import `F401`, 불필요 f-string `F541`)을 정리하고, 테스트 실행 시 `mobile_app/release_notes.json`을 덮어쓰던 `tests/test_app_release.py` 격리 결함을 수정했습니다.

---

## 2. 세부 변경 내역

### 2-1. 모바일 v1.8.2 릴리즈 빌드 및 OTA 배포
- `mobile_app/pubspec.yaml`: `version: 1.8.1+2026111001` → `version: 1.8.2+2026111301` 판올림
- `mobile_app/release_notes.json`: v1.8.2 변경 내역 요약 반영
- `scripts/setup_mobile.ps1 -BuildApk` 실행:
  - `mobile_app/build/app/outputs/flutter-apk/app-release.apk` (27,223,801 bytes / 26.0MB) 빌드 완료
  - `server/static/lanovel-reader-release.apk` 동기화 완료
  - 로컬 서버(`http://localhost:8001/api/app/broadcast_update`)를 통해 Wi-Fi 연결 기기 대상 무설치 OTA 업데이트 SSE 신호 발송 완료
  - `GET http://localhost:8001/api/app/version` 응답 `version: "1.8.2.2026111301"`, `has_apk: true` 실측 검증

### 2-2. Ruff 린트 오류 36건 및 테스트 격리 수정
| 구분 | 대상 파일 | 수정 내용 |
| :--- | :--- | :--- |
| **중복 키 (`F601`)** | `server/routers/admin.py` | `get_admin_analytics` 반환 딕셔너리의 중복 `"efficiency": efficiency_stats` 키 제거 |
| **`zip` `strict` 명시 (`B905`)** | `server/routers/translation.py`<br>`server/services/hdtrans_service.py`<br>`server/services/translation_recovery.py` | 기존과 동일한 동작 보존을 위해 `zip(..., strict=False)` 명시 |
| **미사용 변수/임포트 (`F401`, `F841`)** | `server/routers/collector.py`, `server/routers/special_batch.py`, `server/routers/translation.py`, `server/services/book_service.py`, `server/services/collector_service.py`, `server/services/hdtrans_service.py` | 미사용 import 및 미사용 변수 `now` 제거 (`book_service.py` 내 `update_book_toc_order`의 로컬 `import time`/`datetime` 폴백은 그대로 유지) |
| **스크립트 정리 (`F401`, `F541`, `F841`)** | `scripts/auto_clean_and_insert.py`, `scripts/export_remaining_311.py`, `scripts/fetch_special_batch.py`, `scripts/insert_special_batch.py`, `scripts/repair_and_stage_shifts.py`, `scripts/stage_punct_fixes_to_special_batch.py`, `scripts/test_final_cleaner.py` | 미사용 import·변수(`orig_map`, `prefix`, `suffix`) 및 플레이스홀더 없는 f-string 제거 |
| **테스트 파일 격리** | `tests/test_app_release.py` | `test_update_release_notes` 및 `test_bump_app_version`이 `tmp_path` + `monkeypatch`로 격리된 임시 파일만 수정하도록 개선하고 미사용 `import pytest` 제거 |

---

## 3. 검증 결과
1. **Python Ruff 린트**: `.\venv\Scripts\ruff.exe check tests/test_app_release.py server/ scripts/` → **All checks passed! (0 errors)**
2. **Flutter 정적 분석 및 테스트**:
   - `flutter analyze`: **No issues found!**
   - `flutter test`: **26/26 All tests passed!**
3. **Python Pytest 검증**:
   - 수정 연관 모듈 테스트(`test_book_toc_order.py`, `test_censorship_hdtrans_fallback.py`, `test_hdtrans_fallback_after_last_chunk.py`, `test_hdtrans_service.py`, `test_raw_collector.py`, `test_special_batch.py`, `test_admin_analytics.py`, `test_highlights.py`): **33 passed**
   - 핵심 스위트(`test_corpus_ai_service.py`, `test_character_fixer.py`, `test_sync_router.py`, `test_unclassified.py`, `test_dictionary_service.py`): **35 passed**
   - `tests/test_app_release.py`: **7 passed** (실행 후 `mobile_app/release_notes.json` 원문 보존 확인)
4. **참고 (기존 레거시 테스트 특이사항)**:
   - 전체 `pytest` 실행(`312 passed, 2 failed`) 중 `test_library_viewer_api.py::test_viewer_chapter_content_and_url_title_unification`은 커밋 `397a3eb`(일반 소설 미분류 보관함 강제 격리 정책)과 레거시 테스트 가정 간 불일치로, `test_snapshot_sync.py::test_updated_at_and_tombstone_sync`는 `test_raw_collector.py` 실행 잔여 데이터 영향(단독 실행 시 통과)으로 실패함. 본 작업 변경사항과 무관한 기존 현상임.
