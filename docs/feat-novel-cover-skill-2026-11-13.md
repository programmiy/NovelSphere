# 소설 표지(Book Cover) 생성 워크스페이스 스킬 구축 (`novel-cover`)

> **작업 일자**: 2026-11-13
> **대상 브랜치**: `extra`
> **목적**: LANOVEL 워크스페이스 `.agents/skills/` 폴더에 단독 소설 표지·키 비주얼 생성 전용 스킬 `novel-cover`를 추가하고, 장면 삽화 스킬 `novel-illustration`과의 역할을 명확히 분리

---

## 1. 추가 및 변경 파일

| 파일 | 역할 |
| :--- | :--- |
| [SKILL.md](file:///c:/LANOVEL/.agents/skills/novel-cover/SKILL.md) | `novel-cover` 스킬 워크플로우 (`env-check` → `brief` → 표지 5블록 설계 → `896×1280` `t2i`/선택 `upscale` → 검수 및 선택적 1화 `TOP` 권두 등록) |
| [cover_design_presets.md](file:///c:/LANOVEL/.agents/skills/novel-cover/references/cover_design_presets.md) | 타이틀 세이프 상단 여백, 표지 전용 타이포그래피 배제 네거티브, 장르별 무드 프리셋(러브코미디/다크판타지/미스터리/투샷), 업스케일 파라미터 |
| [novel_cover_helper.py](file:///c:/LANOVEL/.agents/skills/novel-cover/scripts/novel_cover_helper.py) | `novel_scene_helper.py`의 Read-Only/환경/등록 유틸리티를 재사용하면서 `book_activity`(줄거리·메모)·`tags`·초반 회차 도입부를 집계하는 `get_cover_brief` (`brief`), `register-frontispiece` 커맨드 제공 |
| [novel-illustration/SKILL.md](file:///c:/LANOVEL/.agents/skills/novel-illustration/SKILL.md) | `description`을 회차 장면 인라인 삽화 전용으로 명확화하고 표지는 `novel-cover`와 역할 구분 |
| [test_novel_cover_helper.py](file:///c:/LANOVEL/tests/test_novel_cover_helper.py) | `get_cover_brief` 전체 스키마(`book_activity`·`tags`·`book_tags`) 및 최소 스키마 폴백 검증 |

---

## 2. 검증 결과

* `c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-cover/scripts/novel_cover_helper.py brief --book "술 선배 동거 러브코미디" --chapters 1 --lines 6`: 읽기 전용(`?mode=ro`) 정상 조회 확인 (총 50화, 1화 도입부 추출).
* `pytest tests/test_novel_cover_helper.py tests/test_novel_illustration_helper.py tests/test_illustrations.py -v`: **8 passed** (`0 failed`).
* `ruff check`: `novel_cover_helper.py`, `novel_scene_helper.py`, `test_novel_cover_helper.py`, `test_novel_illustration_helper.py`, `tests/test_illustrations.py` — **All checks passed!**.
