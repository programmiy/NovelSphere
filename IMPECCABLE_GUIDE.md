# Impeccable 가이드: AI 기반 프론트엔드 & 모바일 디자인 시스템

`pbakaus/impeccable`을 활용하여 AI 코딩 에이전트 특유의 전형적인 디자인 편향(AI Slop)을 방지하고, 프로덕션 수준의 웹 및 모바일 UI를 구축하는 가이드입니다.

---

## 1. Impeccable 개요

* **정의**: AI 코딩 도구(Gemini, Claude Code, Cursor 등)가 흔히 생성하는 클리셰 UI(단조로운 보라/파란색 그라데이션, Inter 폰트, 무분별한 카드 중첩 등)를 차단하고 일관된 브랜드 정체성을 유지하도록 돕는 오픈소스 디자인 스킬 시스템입니다.
* **핵심 저장소**: [github.com/pbakaus/impeccable](https://github.com/pbakaus/impeccable)

---

## 2. 핵심 디자인 철학 및 안티패턴 방지

| 구분 | 지양할 패턴 (AI Slop) | Impeccable 권장 방향 |
|---|---|---|
| **레이아웃** | 모든 요소를 감싸는 둥근 모서리 카드 중첩 ("카드 감옥") | 타이포그래피 계층, 자연스러운 여백(Whitespace), 절제된 구분선 활용 |
| **컬러** | 보라색-청색 네온 그라데이션, 순수 검정(#000000)/흰색(#ffffff) | 브랜드에 특화된 팔레트, 자연스러운 명암 대비, 명확한 테마 토큰 |
| **타이포그래피** | 획일화된 기본 폰트(Inter, Roboto)의 단조로운 나열 | 서비스 성격에 맞는 서체 선정, 명확한 타이포그래피 스케일(Display/Title/Body) |
| **장식** | 의미 없는 거대한 블러 원형 배경, 과도한 그림자(Box-shadow) | 콘텐츠 가독성을 최우선으로 하는 미니멀하고 기능적인 시각 요소 |

---

## 3. 모바일 앱 (Flutter / React Native) 적용 가이드

`LANOVEL` 프로젝트의 `mobile_app`(Flutter)과 같은 모바일 환경에서도 Impeccable의 원칙은 동일하게 강력하게 적용됩니다.

### 3.1 모바일 특화 체크리스트
1. **카드 남발 방지**: 작은 화면에서 `Card`, `Container(decoration: ...)`를 겹겹이 두르면 화면이 비좁아집니다. 배경 대비와 여백(`SizedBox`, `Padding`)으로 영역을 구분합니다.
2. **터치 타깃 보장**: 주요 인터랙션 요소는 최소 **44×44dp ~ 48×48dp** 이상의 터치 영역을 확보합니다.
3. **엄지 영역(Thumb Zone)**: 모바일 한 손 조작 환경을 고려하여 하단 내비게이션 및 액션 버튼의 접근성을 극대화합니다.
4. **다크/라이트 모드 토큰 일원화**: 하드코딩된 색상 대신 `ThemeData`의 `ColorScheme`을 적극 활용합니다.

---

## 4. 설치 및 CLI 명령어

### 4.1 CLI 설치 및 연동
프로젝트 루트 또는 프론트엔드 디렉터리에서 실행합니다:
```bash
npx impeccable install
```

### 4.2 안티패턴 정적 검사 (Detector)
작성된 코드베이스에서 AI 디자인 안티패턴을 감지합니다 (주로 웹/Tailwind 대상):
```bash
npx impeccable detect <경로>
# 예: npx impeccable detect src/
```

> **참고**: Flutter(`.dart`)나 Swift/Kotlin과 같은 네이티브 모바일 코드는 CLI 자동 파서가 아닌, AI 에이전트(Antigravity)에게 직접 Impeccable 규칙을 적용하도록 지시하여 코드 리뷰 및 리팩토링을 수행합니다.

---

## 5. 프로젝트 설정 (PRODUCT.md & DESIGN.md)

AI 에이전트가 작업할 때 일관된 디자인 정체성을 유지하도록 프로젝트에 가이드 문서를 배치합니다.

### 5.1 `PRODUCT.md` 템플릿
```markdown
# Product Context

- **제품명**: LANOVEL
- **목적**: 웹소설/라이트노벨 번역 및 독서 플랫폼
- **타겟 사용자**: 모바일 환경에서 가독성과 편안한 독서 경험을 중시하는 독자층
- **브랜드 톤앤매너**: 눈의 피로를 최소화하는 차분함, 몰입감, 현대적이고 정갈한 감성
```

### 5.2 `DESIGN.md` 템플릿
```markdown
# Design System Guidelines

## 1. Typography
- 본문 폰트: 장시간 독서에 최적화된 명조/가독성 폰트 (예: KoPubWorldBatang, Noto Serif KR 등)
- UI 폰트: Noto Sans KR / Pretendard
- 계층: Title (20-24sp, SemiBold), Body (15-17sp, Regular, 줄간격 1.6~1.8), Caption (12-13sp)

## 2. Color Palette
- Light: 배경 #F8F9FA, 카드/서피스 #FFFFFF, 텍스트 #1E2022
- Dark/Amoled: 배경 #121212 / #000000, 서피스 #1E1E1E, 텍스트 #E0E0E0
- Accent: 독서 방해가 없는 절제된 단일 포인트 컬러

## 3. Layout & Components
- 중첩 카드 금지: 화면 내 단일 레벨 서피스만 허용
- 여백: 8dp 그리드 시스템 준수 (8, 16, 24, 32)
- 터치 영역: 모든 버튼/아이콘은 최소 48dp 터치 타깃 보장
```

---

## 6. AI 에이전트 협업 프롬프트 예시

AI에게 디자인 및 UI 작업을 요청할 때 아래와 같이 명시하면 Impeccable 원칙이 반영됩니다:

* **신규 화면 작성 시:**
  > "Impeccable 디자인 원칙에 맞춰서 `mobile_app`의 뷰어 설정 화면을 구현해줘. 무의미한 카드 중첩이나 네온 그라데이션을 피하고, 타이포그래피 계층과 여백 중심으로 디자인해줘."
* **기존 UI 리팩토링 시:**
  > "현재 화면의 UI가 전형적인 AI 스타일(AI Slop)인지 점검하고, Impeccable 가이드에 맞춰 더 깔끔하고 완성도 높은 모바일 레이아웃으로 개선해줘."
