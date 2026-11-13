# LANOVEL 소설 삽화·표지 생성 Antigravity 스킬 구축 (`novel-illustration`)

## 1. 개요 및 배경
- **목적**: 새 Antigravity 세션에서도 LANOVEL DB([server/translations.db](file:///c:/LANOVEL/server/translations.db))의 소설 본문 또는 사용자 제공 텍스트를 분석해 로컬 `C:\qwen loRa` (`Qwen-Image-2.1 Q4` + `RTX 2070 SUPER 8GB`) 환경에서 고품질 라노벨 삽화·표지 일러스트를 안전하게 일괄/연속 생성할 수 있는 워크스페이스 스킬을 구축함.
- **실전 검증 배경**:
  - 『술 선배 동거 러브코미디』 1화(`L5~L10`)·4화(`L73~L91`) 연속 생성 테스트에서 `edit` 모드 실행 시 Windows 가상 커밋 메모리 한계(`commit_avail ≈ 11 GiB`) 초과로 `torch\lib\c10.dll` (`0xc0000005`) 크래시가 발생함을 확인.
  - 대신 **고정 캐릭터 외형 앵커 + `t2i` 모드**(`896×1152`, `steps=27`, `cfg=3.5`, `res_multistep / beta`, `cache_dtype=int8`) 및 **장면 간 120초 GPU 쿨다운** 조합으로 크래시 없이 일관된 연속 삽화 생성(`45°C` → `36°C` → `45°C`)에 성공함.

## 2. 구현 내용
1. **스킬 런북 및 프롬프트 프리셋 신설 (`.agents/skills/novel-illustration/`)**:
   - `SKILL.md`: 5단계 표준 실행 절차(환경·GPU·ComfyUI 점검 → Read-Only DB 본문 조회 → `t2i` 기본 및 캐릭터 앵커 고정 프롬프트 설계 → 1장 단위 순차 생성 및 `schedule` 90~120초 GPU 쿨다운 → 결과 이미지 `read_file` 검수). 성인 등장인물 맥락 확인 가드레일 및 `C:\qwen loRa\outputs_novels\<슬러그>` 분리 저장 규칙 명시.
   - `references/prompt_presets.md`: Qwen3-VL 8B용 5블록 영어 자연어 프롬프트 구조, 기본 네거티브 프롬프트, 목적별 해상도 프리셋(기본 삽화 `896×1152`, 표지 `896×1280`, 와이드 `1152×896`, 정사각 `1024×1024`), 검증 사례 기록.
2. **Read-Only 소설 조회 & 환경 점검 CLI 헬퍼 신설 (`.agents/skills/novel-illustration/scripts/novel_scene_helper.py`)**:
   - `open_readonly_db()`: SQLite `?mode=ro` URI 모드로만 연결하여 운영 DB(`translations.db`) 쓰기 잠금 및 변조를 OS/SQLite 수준에서 차단.
   - `books` / `chapters` / `scene`: 소설 검색, `toc_sort_order` 기준 회차 목록, `--pid-start`~`--pid-end` 구간 본문 추출 지원.
   - `env-check`: `nvidia-smi` GPU 온도/VRAM, Windows `GlobalMemoryStatusEx` 물리/가상 커밋 메모리 여유(`commit_avail_gib >= 18 GiB` 여부로 `edit_mode_safe` 판정), ComfyUI(`127.0.0.1:8188`) 큐 상태 일괄 진단.
3. **격리 단위 테스트 추가 (`tests/test_novel_illustration_helper.py`)**:
   - `tmp_path` 격리 SQLite DB로 `list_books`, `list_chapters`, `extract_scene`(PID 구간 및 원문 폴백), `open_readonly_db` 쓰기 차단 동작 검증.

## 3. 검증 결과
- **단위 테스트**: `pytest tests/test_novel_illustration_helper.py -v` → `2 passed in 0.10s`.
- **정적 린트**: `ruff check .agents/skills/novel-illustration/scripts/novel_scene_helper.py tests/test_novel_illustration_helper.py` → `All checks passed!`.
- **실전 동작 확인**: `novel_scene_helper.py env-check` 및 `scene --book "술 선배 동거 러브코미디" --chapter "1" --pid-start "L5" --pid-end "L10"` 정상 동작 확인.
