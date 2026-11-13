# `novel-cover` 캐릭터 외형 시트 공유 연동 및 `--preset cover` 표준화 (2026-11-14)

## 1. 개요
- **작업 목적**: 표지 기획·생성(`novel-cover`) 단계에서 확정한 주인공/히로인의 외형 앵커를 본문 삽화 스킬(`novel-illustration`)과 동일한 `characters_registry.json`에 저장·조회할 수 있도록 CLI를 공유 연결하고, 표지 생성 명령을 `qwen_batch.py t2i --preset cover` 기준으로 통일했습니다.

## 2. 주요 변경 사항
1. **캐릭터 외형 시트 헬퍼 및 CLI 연동** (`.agents/skills/novel-cover/scripts/novel_cover_helper.py`):
   - `novel_scene_helper`로부터 `DEFAULT_CHARACTERS_PATH`, `load_character_registry`, `save_character_anchor`, `list_character_anchors`, `add_character_subparsers`, `handle_character_command` 재노출
   - `build_parser()`에 `add_character_subparsers(sub)` 등록 및 `main()`에서 `handle_character_command(args)` 처리 추가
2. **표지 스킬 문서 & 프리셋 갱신**:
   - `.agents/skills/novel-cover/SKILL.md`: `character-list` / `character-save` 명령 안내 및 `qwen_batch.py t2i --preset cover` 적용
   - `.agents/skills/novel-cover/references/cover_design_presets.md`: `t2i --preset cover` (`896×1280`, `steps=27`, `cfg=3.5`, `res_multistep`, `beta`, `cache-dtype int8`) 표기 통일
3. **단위 테스트 보강** (`tests/test_novel_cover_helper.py`):
   - `test_cover_helper_character_cli_integration(tmp_path)`: `cover_helper.main(["character-save", ...])` 실행 후 `cover_helper.list_character_anchors(...)` 연동 검증

## 3. 검증
- `.\venv\Scripts\python.exe -m pytest tests/test_novel_cover_helper.py -v` 통과 (3 passed)
