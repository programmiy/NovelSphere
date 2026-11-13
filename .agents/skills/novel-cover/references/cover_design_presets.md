# Qwen-Image-2.1 소설 표지(Book Cover) 프롬프트 프리셋

`C:\qwen loRa\qwen_batch.py` (`896×1280` 7:10 라노벨 단행본 비율)에 맞춘 표지 전용 프롬프트 설계 가이드입니다.

---

## 1. 표지 5블록 프롬프트 공식

본문 장면 삽화(`novel-illustration`)가 "특정 행동의 순간"에 초점을 맞춘다면, **표지(`novel-cover`)**는 **"인물의 매력 + 작품 장르 톤 + 상단 타이틀 공간"**이 핵심입니다.

```text
[1. 라노벨 표지 아트워크 품질 앵커]
+ [2. 주인공/히로인 외형 앵커 (연속 작업 시 novel-illustration과 동일 문구 공유)]
+ [3. 아이코닉 포즈 · 카메라 앵글 · 시선]
+ [4. 작품을 상징하는 핵심 소품 · 의상 포인트]
+ [5. 장르 배경 · 색채 대비 · 상단 타이틀 여백(Upper Third Negative Space)]
```

### 블록 1: 표지 전용 화풍 앵커
```text
Published Japanese light novel front cover illustration key visual, flagship publisher quality, ultra-crisp delicate lineart, luminous painterly cel shading, striking color contrast, depth of field blur in foreground and distant background.
```

### 블록 5: 타이틀 세이프 여백 문구 (필수 권장)
```text
composed vertically with clean uncluttered negative space across the upper quarter for book title layout, zero typography.
```

---

## 2. 표지 전용 네거티브 프롬프트

깨진 가짜 텍스트·바코드·잡지 띠지를 막기 위해 기본 네거티브에 표지 배제어를 결합합니다.

```text
title text, book cover typography, Japanese text overlay, kanji, hiragana, katakana, author name, publisher logo, barcode, price tag, obi strip, decorative border frame, speech bubble, watermark, distorted hands, extra fingers, extra limbs, plastic skin, strong HDR, flat colors, blank white studio background, photorealistic, 3D render, low detail
```

---

## 3. 장르별 표지 무드 · 구도 프리셋

### A. 러브코미디 · 동거 · 현대 로맨스
- **카메라**: `medium three-quarter portrait with playful slight Dutch tilt, warm close framing`
- **조명/배경**: `golden evening window glow or cozy warm apartment lamp light, floating dust motes, soft warm peach and crimson color harmony`
- **소품 예시**: 음료 캔/머그컵, 열쇠 꾸러미, 헐렁한 니트 소매 등 캐릭터 성격을 드러내는 시그니처 1~2개만 배치

### B. 다크 판타지 · 검술 · 복수극
- **카메라**: `dramatic low-angle hero shot, billowing cloak framing silhouette`
- **조명/배경**: `cool slate-blue moonlight slicing across obsidian ruins, floating embers and mist, sharp cyan-gold rim highlight`
- **소품 예시**: 검·마법진 파편·부서진 왕관 등 상징물 중심

### C. 미스터리 · 서스펜스 · 사이버펑크
- **카메라**: `cinematic half-profile looking back over shoulder, moody neon reflections`
- **조명/배경**: `rain-slicked night street or rainy café glass refraction, deep indigo shadows with one sharp accent color (crimson/amber/cyan)`

### D. 2인 투샷 표지 (주인공 + 히로인)
- 인물이 3명 이상 늘어나면 Qwen Q4 `896×1280`에서 손/얼굴 디테일이 분산되므로 **최대 2인 이내(`back-to-back stance` 또는 `foreground-background depth layering`)**로 제한합니다.

---

## 4. 해상도 및 후처리 파라미터

| 단계 | CLI 명령 & 파라미터 | 설명 |
| :--- | :--- | :--- |
| **표지 기본 생성** | `t2i --width 896 --height 1280 --steps 27 --cfg 3.5 --sampler res_multistep --scheduler beta --cache-device auto --cache-dtype int8` | 라노벨 단행본 7:10 황금비율, RTX 2070 SUPER 8GB 안정 (~3분대) |
| **와이드 래핑/배너형 표지** | `t2i --width 1280 --height 896` | 앞·뒤 커버 펼침 일러스트 또는 가로형 헤더 아트용 |
| **선택 업스케일(인쇄용)** | `upscale --image "<PNG>" --scale-by 1.5 --denoise 0.25 --steps 18 --cfg 3.0` | 확정된 표지 1장을 `1344×1920` 수준으로 선명하게 확대할 때만 사용 |
