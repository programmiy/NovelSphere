# Qwen-Image-2.1 소설 삽화 · 표지 프롬프트 프리셋 레퍼런스

이 문서는 `C:\qwen loRa` 환경(`qwen-image-2.1-step90000-Q4_K_M.gguf` + `qwen3vl_8b_int8_convrot.safetensors`)에서 검증된 프롬프트 작성 규격과 해상도 프리셋을 정리합니다.

---

## 1. 5블록 영어 자연어 프롬프트 구조

Qwen3-VL 8B 텍스트 인코더는 Danbooru 태그 나열보다 **서술형 영어 자연어 문장**에서 구도·시선·손동작·조명 재현율이 가장 높습니다.

```text
[1. 화풍 앵커] + [2. 고정 캐릭터 외형 앵커] + [3. 구도·카메라 시점] + [4. 동작·표정·핵심 소품] + [5. 배경·조명]
```

### 블록 1: 기본 화풍 앵커 (검증된 라노벨 스타일)
```text
High-detail modern Japanese anime illustration, light novel cover art quality, intricate crisp lineart, rich multi-layered shading with soft ambient gradients and warm rim lighting.
```

### 블록 2: 캐릭터 외형 앵커 (연속 장면에선 그대로 복붙 고정)
같은 작품의 여러 화를 그릴 때는 아래 항목을 **매번 동일 문구로 고정**해야 `t2i`에서도 동일 인물처럼 유지됩니다.
- 연령대(성인 명시): `21-year-old`, `young adult woman`, `adult man` 등
- 헤어 컬러·스타일: 예) `long crimson-red hair tied into a loose side-tail resting over one shoulder, wispy bangs`
- 눈동자·특징점: 예) `expressive warm amber eyes with detailed iris highlights`
- 의상(색상·재질·실루엣): 예) `cozy loose wide-neck off-white knit sweater slipping off one shoulder, dark casual home shorts`

### 블록 3~5: 구도 · 액션 · 배경
- **카메라 구도**: `three-quarter length vertical framing`, `intimate low-angle POV looking up from sitting on floor cushions`, `close-to-medium framing` 등 명시
- **접촉/손동작**: 소설 핵심 포인트를 구체적으로 묘사 (`a young man's hand reaching from the lower edge of the frame gently grips the bottom hem of her sweater`)
- **조명/배경**: 시간대와 광원 색상 지정 (`dim warm evening floor lamp lighting, soft midnight shadows, Japanese apartment living room`)

---

## 2. 기본 네거티브 프롬프트

```text
Strong HDR, plastic skin, unnecessary limbs, extra hands, extra fingers, distorted hands, speech bubble, text, watermarks, brand logos, flat colors, minimalist face, simple dot eyes, blank white background, unfinished sketch, low detail, crude lineart, photorealistic, 3D render
```
- **장면 전환 시 추가 배제**: 이전 장면에만 있던 소품이나 상반된 표정은 네거티브에 명시합니다(예: `holding a drink, aluminum can, cheerful laughing smile`).
- **표지 생성 시 추가 배제**: `title text, book cover typography, author name, barcode, border frame`

---

## 3. 출력 목적별 해상도 & 샘플링 프리셋

모든 크기는 32의 배수이며, RTX 2070 SUPER (8GB VRAM) 기준 `1.0~1.15 MP` 범위가 속도와 메모리 면에서 가장 안정적입니다.

| 프리셋 (`--preset`) | `--width` | `--height` | 용도 및 추가 프롬프트 지시 |
| :--- | :---: | :---: | :--- |
| **기본 삽화 (`illust`, 기본값)** | `896` | `1152` | 가장 권장. 캐릭터 3/4~전신·대화 구도에 최적 |
| **표지 일러스트 (`cover`)** | `896` | `1280` | 프롬프트 끝에 `clean uncluttered negative space in the upper third for book title placement, no text` 추가 |
| **와이드 장면 (`wide`)** | `1152` | `896` | 2인 대치, 실내·야외 배경 비중이 큰 장면 |
| **정사각 (`square`)** | `1024` | `1024` | 인물 클로즈업, 프로필/썸네일용 |

### 기본 적용 CLI 플래그 (`qwen_batch.py t2i` 내장 기본값)
```text
--preset illust --steps 27 --cfg 3.5 --sampler res_multistep --scheduler beta --cache-device auto --cache-dtype int8
```

---

## 4. 실전 검증 사례: 『술 선배 동거 러브코미디』 (1화 → 4화 `t2i` 연속 생성)

1. **1화 (`L5~L10`, `seed=20261113`, `197.9s`, `45°C`)**
   - 캐릭터 앵커(진홍색 사이드테일, 호박색 눈, 헐렁한 오프화이트 니트 스웨터, 다크 숏팬츠) + 레몬 사워 캔 + 바닥 빈 술캔 + 유혹 미소
2. **GPU 2분(120초) 쿨다운 (`45°C → 36°C`)**
3. **4화 (`L73~L91`, `seed=20261115`, `207.7s`, `45°C`)**
   - 1화의 **캐릭터·의상·방 앵커를 그대로 유지**하고, 네거티브에 `holding a drink, aluminum can, cheerful laughing smile` 추가
   - 구도만 `intimate low-angle POV` + `hand grabbing the bottom hem of her knit sweater` + `serious half-lidded gaze with moist parted lips`로 변경하여 크래시 없이 완벽한 연속 삽화 달성
