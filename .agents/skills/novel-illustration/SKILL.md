---
name: novel-illustration
description: >-
  Use this skill whenever the user wants to turn novel episodes from LANOVEL or
  user-provided novel text into scene illustrations or book cover art using the
  local ComfyUI Qwen-Image-2.1 pipeline (C:\qwen loRa\qwen_batch.py).
---

# LANOVEL 소설 삽화 · 표지 생성 스킬 (Qwen-Image-2.1 Runbook)

이 스킬은 LANOVEL 소설 본문 또는 사용자가 제공한 텍스트를 바탕으로, 로컬 `C:\qwen loRa` (`Qwen-Image-2.1 Q4` + `RTX 2070 SUPER 8GB`) 환경에 최적화된 고품질 라노벨 삽화·표지 일러스트를 안전하게 생성하기 위한 표준 런북입니다.

---

## 📌 핵심 경로 및 안전 수칙

| 항목 | 경로 / 규칙 |
| :--- | :--- |
| **ComfyUI / 배치 루트** | `C:\qwen loRa` (`venv\Scripts\python.exe`, `qwen_batch.py`, `run_comfyui.bat`) |
| **LANOVEL DB (읽기 전용)** | `c:\LANOVEL\server\translations.db` — **반드시** [novel_scene_helper.py](./scripts/novel_scene_helper.py)로 `?mode=ro` 조회 (쓰기 연결 절대 금지) |
| **이미지 저장 폴더** | `C:\qwen loRa\outputs_novels\<작품슬러그>\` (`c:\LANOVEL` 워크스페이스 내부에 PNG를 쌓지 않음) |
| **연령/안전 가드레일** | 수위가 높은(매운) 장면을 다룰 때는 반드시 **성인(20세 이상·성인 판타지) 등장인물 맥락인지 먼저 확인**하고, 미성년자 성적 묘사는 절대 생성하지 않음 |

---

## 🛠️ 단계별 실행 절차 (Step-by-Step)

### Step 1. GPU · 메모리 · ComfyUI 서버 상태 점검
먼저 헬퍼 스크립트로 현재 GPU 온도, Windows 가상 커밋 메모리 여유, ComfyUI(`http://127.0.0.1:8188`) 실행 여부를 확인합니다.

```powershell
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-illustration/scripts/novel_scene_helper.py env-check
```

* **ComfyUI가 중지되어 있는 경우**: 아래 명령으로 ComfyUI를 데몬(`IsDaemon=true`)으로 기동하고(`run_comfyui.bat`과 동일 플래그), `schedule` 10~15초 대기 후 `env-check`로 포트 `8188` 응답을 확인합니다.
  ```powershell
  Set-Location "C:\qwen loRa\ComfyUI"; & "C:\qwen loRa\venv\Scripts\python.exe" main.py --fp16-unet --preview-method auto --cache-none --disable-pinned-memory --listen 127.0.0.1 --port 8188
  ```
* **GPU 온도가 높은 경우(`> 48°C`)**: 작업을 바로 시작하지 말고 `schedule` 타이머로 60~120초 식힌 뒤 시작합니다.

---

### Step 2. 소설 본문 조회 (Read-Only)
사용자가 소설 제목·회차만 언급한 경우, 헬퍼 스크립트로 안전하게 본문을 읽습니다.

```powershell
# 1. 소설 검색
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-illustration/scripts/novel_scene_helper.py books --search "검색어"

# 2. 회차 목록 확인
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-illustration/scripts/novel_scene_helper.py chapters --book "소설폴더명"

# 3. 특정 회차 및 PID 구간 본문 추출
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-illustration/scripts/novel_scene_helper.py scene --book "소설폴더명" --chapter "1" --pid-start "L5" --pid-end "L30"
```

---

### Step 3. 프롬프트 설계 (`t2i` 기본 + 캐릭터 외형 앵커 고정)
상세 템플릿과 해상도 프리셋은 [prompt_presets.md](./references/prompt_presets.md)를 읽고 따릅니다.

1. **생성 모드 선택 원칙 (`t2i` 우선)**:
   * **`t2i` 모드를 기본으로 사용합니다.** `edit` 모드는 `TextEncodeQwenImage21`이 `qwen3vl_8b` 비전 인코더, VAE, 참조 잠재벡터(`reference_latents`)를 한꺼번에 적재하므로 Windows 가상 커밋 메모리 여유(`commit_avail_gib`)가 부족하면 `c10.dll` (`0xc0000005`) 크래시가 발생할 수 있습니다.
   * `edit` 모드는 사용자가 명시적으로 원하고 `env-check`에서 `edit_mode_safe=True` (`commit_avail_gib >= 18 GiB`)일 때만 사용합니다.
2. **연속 장면 일관성 유지**:
   * 같은 작품의 2장 이상 삽화를 생성할 때는 **캐릭터 외형 앵커**(머리색·헤어스타일·눈동자·기본 의상·체형)와 **배경/화풍 앵커**를 영어 문장으로 고정하고, 장면별 포즈·표정·카메라 구도·소품만 변경합니다.
3. **삽화 vs 표지 프리셋**:
   * **기본 삽화**: `--width 896 --height 1152` (세로 3:4 라노벨 판형)
   * **표지 일러스트**: `--width 896 --height 1280` + 상단 제목 여백 지시 및 텍스트/타이포그래피 네거티브 강화
   * **와이드 장면**: `--width 1152 --height 896`

---

### Step 4. 이미지 생성 및 GPU 쿨다운 (1장씩 순차 실행)
RTX 2070 SUPER (8GB VRAM) 부하와 발열을 억제하기 위해 **1회 호출당 1장씩** 생성하고, **이미지 사이에 반드시 90~120초 휴지기**를 둡니다.

```powershell
& "C:\qwen loRa\venv\Scripts\python.exe" "C:\qwen loRa\qwen_batch.py" t2i `
  --out-dir "C:\qwen loRa\outputs_novels\<작품슬러그>" `
  --width 896 --height 1152 --steps 27 --cfg 3.5 `
  --sampler res_multistep --scheduler beta `
  --cache-device auto --cache-dtype int8 `
  --seed <고유시드> `
  --prompt "<5블록 영어 프롬프트>" `
  --negative "<기본 네거티브 + 장면 배제어>"
```

* **2장 이상 연속 생성 시 필수 쿨다운 규칙**:
  1. 1장 완료 후 `nvidia-smi` 온도 확인 및 결과 이미지 `read_file` 검수.
  2. Antigravity **`schedule` 도구(`DurationSeconds=90`~`120`)**로 GPU 휴지 대기 (**셸 `sleep` 명령 사용 금지**).
  3. 타이머 완료 후 `env-check`로 온도가 내려갔는지 확인(`<= 40°C` 권장)하고 다음 장 생성.

---

### Step 5. 결과 검수 및 보고
1. 생성된 PNG 파일을 `read_file`로 직접 확인하여 손가락/사지 왜곡, 캐릭터 외형 일치 여부, 소설 장면 반영도를 점검합니다.
2. 이상이 없다면 결과 이미지 클릭 링크(`file:///C:/qwen%20loRa/outputs_novels/...`), 사용된 시드·해상도·소요 시간·GPU 온도를 간결하게 보고합니다.
