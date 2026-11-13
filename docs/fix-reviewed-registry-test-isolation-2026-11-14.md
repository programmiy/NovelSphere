# 검수완료 레지스트리 테스트 격리 및 스킬 스크립트 린트 정리 (2026-11-14)

## 1. 원인 및 개요
- `tests/test_raw_collector.py::test_save_manual_translations_with_review_completion` 실행 시 `reviewed_service` 싱글톤이 실제 `server/reviewed_registry.json` 파일에 직접 쓰기를 수행하여 테스트 더미 데이터(`"직접_번역할_소설"`, `"https://ncode.syosetu.com/n4444dd/1/"`)가 워킹 트리에 남는 문제가 있었습니다.
- 또한 `.agents/skills/mobile-release-build/scripts/bump_and_build.py`에 미사용 `import os` (`F401`) 린트 경고가 존재했습니다.

## 2. 수정 내역
1. **테스트 격리** (`tests/test_raw_collector.py`):
   - 오염된 `server/reviewed_registry.json`을 원본으로 복원 (`git checkout -- server/reviewed_registry.json`).
   - `test_save_manual_translations_with_review_completion`에 `tmp_path`, `monkeypatch`를 주입해 `reviewed_service.file_path`, `_reviewed_books`, `_reviewed_chapters`를 임시 경로/빈 집합으로 격리.
2. **린트 정리** (`.agents/skills/mobile-release-build/scripts/bump_and_build.py`):
   - 미사용 `import os` 제거 (`ruff check .agents/skills/` 0 에러 달성).
3. **종합 레퍼런스 갱신** (`docs/codebase-functional-reference-2026-11-14-2.md`):
   - `novel-illustration`/`novel-cover` 캐릭터 외형 시트(`character-save`/`character-list`)·`--preset` 표준화 및 테스트 격리 내역 반영.

## 3. 검증
- `.\venv\Scripts\python.exe -m pytest tests/test_novel_illustration_helper.py tests/test_novel_cover_helper.py tests/test_raw_collector.py -v` 전건 통과
- `.\venv\Scripts\ruff.exe check server/ scripts/ .agents/skills/ tests/test_novel_illustration_helper.py tests/test_novel_cover_helper.py tests/test_raw_collector.py` 0 에러
- `git diff server/reviewed_registry.json` 무변경 확인
