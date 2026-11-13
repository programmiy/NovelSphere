# `novel-illustration` 캐릭터 외형 시트 레지스트리 및 `--preset` CLI 표준화 (2026-11-14)

## 1. 개요
- **작업 목적**: 동일 소설 내 여러 회차에 걸쳐 삽화를 생성할 때 주인공/히로인의 외형(머리색, 헤어스타일, 눈동자, 기본 의상, 기준 시드, 참조 이미지)이 일관되게 유지되도록 작품별 캐릭터 외형 앵커 시트(`characters_registry.json`) 관리 기능을 추가하고, `qwen_batch.py t2i`의 해상도/샘플러 플래그를 `--preset` 기반으로 표준화했습니다.

## 2. 주요 변경 사항
1. **캐릭터 외형 앵커 레지스트리 및 CLI 추가** (`.agents/skills/novel-illustration/scripts/novel_scene_helper.py`):
   - `DEFAULT_CHARACTERS_PATH`: `C:\qwen loRa\outputs_novels\characters_registry.json`
   - `load_character_registry(registry_path)`: JSON 레지스트리 안전 로드 및 기본 스키마(`{"books": {}}`) 보장
   - `save_character_anchor(...)`: 작품(`book`)·캐릭터(`name`) 단위 외형 앵커 병합 저장 (미지정 선택 필드는 기존 값 유지, `updated_at` ISO 타임스탬프 기록)
   - `list_character_anchors(book, registry_path)`: 전체 또는 특정 작품의 저장된 캐릭터 외형 시트 조회
   - `add_character_subparsers(sub)`, `handle_character_command(args)`: `character-save` / `character-list` 공용 CLI 서브커맨드 제공
2. **스킬 가이드 및 프리셋 문서 갱신**:
   - `.agents/skills/novel-illustration/SKILL.md`: `character-list`, `character-save` 워크플로우 반영 및 `qwen_batch.py t2i --preset illust` 기준 예시 통일
   - `.agents/skills/novel-illustration/references/prompt_presets.md`: `--preset` (`illust`, `cover`, `wide`, `square`) 표 및 기본 CLI 플래그 갱신
3. **단위 테스트 추가** (`tests/test_novel_illustration_helper.py`):
   - `test_character_registry_save_and_list(tmp_path)`: 신규 저장, 부분 갱신 시 기존 필드(`outfit`, `seed`, `ref_images`) 보존, 작품별 필터 조회 검증

## 3. 검증
- `.\venv\Scripts\python.exe -m pytest tests/test_novel_illustration_helper.py -v` 통과 (4 passed)
