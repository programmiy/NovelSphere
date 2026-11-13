---
name: novel-cover
description: >-
  Use this skill whenever the user wants to design or generate standalone light
  novel book cover art (7:10 portrait framing, title-safe negative space, genre
  mood, and hero/heroine focal key visual) from a LANOVEL book synopsis, tags,
  and opening chapters or user-provided pitch using C:\qwen loRa\qwen_batch.py.
---

# LANOVEL 소설 표지(Book Cover) 일러스트 생성 스킬

이 스킬은 LANOVEL 소설의 줄거리(`summary`)·태그·초반 회차 분위기를 분석해, **단독 책 표지·키 비주얼 아트(`896×1280` 7:10 라노벨 단행본 판형)**를 `C:\qwen loRa` (`Qwen-Image-2.1 Q4`) 파이프라인으로 생성하는 표준 런북입니다.

* **역할 분리**: 특정 회차의 한 장면을 그려 본문 중간(`--after-pid L10` 등)에 삽입할 때는 **`novel-illustration`** 스킬을 사용하고, 작품 전체를 대표하는 **표지 일러스트·키 비주얼**을 만들 때는 이 **`novel-cover`** 스킬을 사용합니다.

---

## 📌 핵심 경로 및 안전 수칙

| 항목 | 경로 / 규칙 |
| :--- | :--- |
| **ComfyUI / 배치 루트** | `C:\qwen loRa` (`venv\Scripts\python.exe`, `qwen_batch.py`) |
| **LANOVEL DB (읽기 전용)** | `c:\LANOVEL\server\translations.db` — **반드시** [novel_cover_helper.py](./scripts/novel_cover_helper.py)로 `?mode=ro` 조회 (직접 쓰기 연결 절대 금지) |
| **표지 저장 폴더** | `C:\qwen loRa\outputs_covers\<작품슬러그>\` |
| **연령/안전 가드레일** | 수위·노출 요소가 있는 표지는 **성인(20세 이상) 등장인물 맥락인지 먼저 확인**하며, 미성년자 성적 묘사는 절대 생성하지 않음 |

---

## 🛠️ 단계별 실행 절차 (Step-by-Step)

### Step 1. GPU · 메모리 · ComfyUI 서버 점검
[novel_cover_helper.py](./scripts/novel_cover_helper.py)로 GPU 온도·Windows 커밋 메모리 여유·ComfyUI(`http://127.0.0.1:8188`) 상태를 먼저 확인합니다.

```powershell
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-cover/scripts/novel_cover_helper.py env-check
```

* ComfyUI가 중지 상태이면 데몬으로 기동 후 `schedule` 10~15초 대기하여 포트 `8188`을 확인합니다.
  ```powershell
  Set-Location "C:\qwen loRa\ComfyUI"; & "C:\qwen loRa\venv\Scripts\python.exe" main.py --fp16-unet --preview-method auto --cache-none --disable-pinned-memory --listen 127.0.0.1 --port 8188
  ```

---

### Step 2. 소설 줄거리 · 태그 · 도입부 추출 (Read-Only)
`brief` 명령으로 `book_activity`(줄거리·메모), `tags`, 전체 회차 수/초반 목차, 1~2화 도입부를 한 번에 조회합니다.

```powershell
# 1. 작품명 검색
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-cover/scripts/novel_cover_helper.py books --search "검색어"

# 2. 표지 기획용 작품 브리프(줄거리 + 태그 + 초반 본문) 조회
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-cover/scripts/novel_cover_helper.py brief --book "소설폴더명"
```

---

### Step 3. 표지 구도 · 타이틀 여백 · 캐릭터 앵커 설계
상세 장르 템플릿과 네거티브 규칙은 [cover_design_presets.md](./references/cover_design_presets.md)를 따릅니다.

1. **`t2i` 기본 모드 유지**: `edit` 모드는 `c10.dll` 커밋 초과 위험이 크므로, `env-check`에서 `edit_mode_safe=True`이고 사용자가 명시적으로 요청한 경우 외에는 `t2i`를 사용합니다.
2. **표지 전용 구도 3원칙**:
   * **타이틀 세이프 상단 여백(Title-Safe Upper Third)**: 책 제목을 얹어도 인물 얼굴을 가리지 않도록 상단 25~30%에 하늘·실내 빛·배경 여백(`clean atmospheric breathing room in the upper third for book title composition`)을 확보합니다.
   * **타이포그래피 배제**: AI가 깨진 일본어/가짜 글자를 넣지 않도록 네거티브에 `title text, book cover typography, author name, obi strip, barcode, logo watermark`를 반드시 포함합니다.
   * **히어로/히로인 시선 유도 + 썸네일 대비**: 서재 작은 섬네일에서도 인물이 살아 보이도록 강한 림 라이트(`dramatic rim lighting`)와 중심 시선(`engaging eye contact toward viewer`) 또는 역동적인 2인 대칭/등맞대기 구도를 사용합니다.
3. **`novel-illustration`과의 앵커 공유**: 같은 작품의 본문 삽화도 추후 생성할 계획이라면, 여기서 확정한 **주인공 외형 앵커(머리색·눈·대표 의상) 문구**를 그대로 복사해 사용합니다.

---

### Step 4. 표지 생성 및 선택적 업스케일 (`t2i` → 선택 `upscale`)
단행본 라노벨 7:10 비율(`896×1280`)로 1장씩 생성합니다. 시안을 2장 이상 뽑을 때는 **반드시 이미지 사이에 `schedule` 도구(`DurationSeconds=90`~`120`)로 GPU 쿨다운**을 둡니다.

```powershell
& "C:\qwen loRa\venv\Scripts\python.exe" "C:\qwen loRa\qwen_batch.py" t2i `
  --out-dir "C:\qwen loRa\outputs_covers\<작품슬러그>" `
  --width 896 --height 1280 --steps 27 --cfg 3.5 `
  --sampler res_multistep --scheduler beta `
  --cache-device auto --cache-dtype int8 `
  --seed <고유시드> `
  --prompt "<표지 5블록 영어 프롬프트>" `
  --negative "<표지 전용 네거티브>"
```

* **(선택) 고해상도 인쇄/보관용 업스케일**: 확정된 시안 1장을 키우고 싶을 때만 GPU 쿨다운 후 `qwen_batch.py upscale --scale-by 1.5 --denoise 0.25`를 별도 실행합니다.

---

### Step 5. 검수 · 보고 · (선택) 1화 권두 표지 등록
1. 생성된 PNG를 `read_file`로 직접 열어 상단 여백, 얼굴·손가락 왜곡, 가짜 텍스트 유무, 작품 분위기 부합도를 확인합니다.
2. 결과 이미지 링크(`file:///C:/qwen%20loRa/outputs_covers/...`), 시드·해상도·GPU 온도를 보고합니다.
3. LANOVEL 서재 양장본 책 카드는 기본 표지를 유지하므로, 사용자가 **뷰어 1화 최상단(권두 컬러 표지)에도 띄우길 원할 때만** 아래 명령으로 등록합니다.

```powershell
c:\LANOVEL\venv\Scripts\python.exe .agents/skills/novel-cover/scripts/novel_cover_helper.py register-frontispiece `
  --book "소설폴더명" `
  --chapter-url "1화_URL" `
  --image "C:\qwen loRa\outputs_covers\<작품슬러그>\001_t2i_....png" `
  --caption "작품 표지 일러스트"
```
