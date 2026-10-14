# [Part 1] LANOVEL 서재 페이지(Web) 스팀펑크 하이엔드 크래프트맨십 UI/UX 개편 명세서

> **디자인 기조**: **Steampunk Difference Engine High-Craftsmanship**  
> **핵심 방향**: 스팀펑크 고유의 증기기관·황동·양장본 미학을 **100% 유지**하되, 어설픈 장난감 느낌을 벗겨내고 **19세기 왕립 차분기관의 정교한 기계 장치와 고서 아카이브** 수준으로 디테일과 마감(Craftsmanship)을 극대화  
> **대상 파일**:
> - `server/templates/library.html`
> - `server/static/library.css`
> - `server/static/library.js`

---

## 1. 정체성 재정의: 스팀펑크 미학의 완성도 극대화

스팀펑크와 아날로그 기계 장치는 LANOVEL만의 독창적이고 소중한 브랜드 정체성입니다. 이번 개편의 핵심은 장식을 없애는 것이 아니라, **"스팀펑크 기믹이 독서 경험과 완벽하게 융합되는 최고 수준의 장인 마감"**을 달성하는 것입니다:

1. **배관 및 기어 리그 (`steam-engine-top-rig`)의 완성도**:
   - 투박하게 끊어지는 그래픽 대신, 황동 리벳과 유기적인 증기 밸브, 실제 차분기관(Difference Engine) 기어 맞물림 애니메이션의 정밀화.
   - 브라우저 크기에 따라 배관이 찌그러지지 않고 자연스럽게 이어지는 반응형 플렉시블 배관 레이아웃 구축.
2. **5구 압력계 (Manometer) 대시보드의 계측기화**:
   - 가짜 원형 틀이 아닌, 실제 19세기 황동 기압계 느낌의 음각 눈금판, 유리에 반사되는 입체 글레어(`manometer-glass-glare`), 기계식 오도미터(Odometer) 숫자 회전 트랜지션 고도화.
   - 바늘(`needle`)의 댐핑(Damping) 물리 애니메이션(바늘이 목표값에 도달할 때 실제 기압계처럼 미세하게 튕기는 진동 효과) 구현.
3. **가죽 양장본 서가 (Vintage Leather Tome Shelf)**:
   - 책 카드를 흔한 웹 카드 형태가 아닌, **금박 음각 레터링, 가죽 질감의 책등(Spine), 황동 잠금쇠와 태그 플레이트**가 돋보이는 양장본 고서 형태로 승화.
   - 책 표지 호버 시 양장본 표지가 살짝 열리거나 황동 테두리가 미세하게 반응하는 묵직한 마이크로 인터랙션.

---

## 2. 구체적 HTML & 구조 고도화 명세 (`library.html`)

### 2.1 스팀 차분기관 상단 리그 & 인라인 사운드 피드백
```html
<!-- 완성도 높은 차분기관 메인 리그 -->
<header class="library-header steam-header">
    <div class="steam-engine-top-rig">
        <div class="steam-main-pipe">
            <div class="pipe-joint left"></div>
            <div class="pipe-flange left-flange"></div>
            <div class="pipe-segment conduit-brass"></div>
            <div class="pipe-valve-cluster">
                <button class="pipe-valve-wheel interactive-wheel" id="mainSteamValve" title="증기 배출 & 타자기 음향 토글"></button>
                <div class="pipe-gauge-mini brass-glow-gauge"></div>
            </div>
            <div class="pipe-segment conduit-copper"></div>
            <div class="pipe-flange right-flange"></div>
            <div class="pipe-joint right"></div>
        </div>
        <!-- 정밀 기어 클러스터 (차분기관 에스케이프먼트) -->
        <div class="steam-gear-cluster">
            <div class="gear-cog gear-large brass-sheen"></div>
            <div class="gear-cog gear-medium steel-teeth"></div>
            <div class="gear-cog gear-small escapement-gear"></div>
        </div>
    </div>

    <!-- 타이틀 & 황동 헤더 액션 -->
    <div class="header-nav brass-panel-frame">
        <div class="brand-group">
            <div class="brand-logo brass-seal">
                <span class="material-icons">local_library</span>
            </div>
            <div class="brand-text">
                <h1 class="font-display">나의 서재</h1>
                <p class="subtitle font-typewriter">DIFFERENCE ENGINE ARCHIVE & BIBLIOTHECA</p>
            </div>
        </div>

        <div class="header-actions">
            <button class="btn btn-brass steampunk-sound-toggle-btn" id="steampunkSoundToggle" title="아날로그 타자기 사운드">
                <span class="material-icons">volume_up</span> <span class="btn-text">아날로그 사운드</span>
            </button>
            <button id="fetch-missing-titles-btn" class="btn btn-brass" title="원본 사이트 목차 동기화">
                <span class="material-icons">sync</span> 제목 동기화
            </button>
            <button id="download-all-offline-btn" class="btn btn-brass" title="오프라인 로컬 저장">
                <span class="material-icons">cloud_download</span> 오프라인 캐시
            </button>
            <a href="/admin" class="btn btn-brass nav-btn">
                <span class="material-icons">dashboard_customize</span> 번역 관리
            </a>
            <button class="btn btn-brass-icon theme-toggle-btn" id="darkModeToggle" title="파치먼트 / 딥 캐스트아이언 전환">
                <span class="material-icons">dark_mode</span>
            </button>
        </div>
    </div>
</header>
```

### 2.2 5구 정밀 압력계 (Manometer)의 데이터 시각화 강화
게이지를 단순히 보여주는 것에 그치지 않고, 각 게이지를 클릭하면 해당 필터(전체, 즐겨찾기, 읽는 중, 미열람, 완결)로 부드럽게 필터링되는 인터랙티브 기계식 스위치로 진화:
```html
<section class="stats-overview-bar steam-manometer-rack">
    <!-- 클릭 시 해당 필터로 즉각 연동되는 인터랙티브 놋쇠 게이지 -->
    <div class="manometer-gauge-card interactive-gauge" data-filter="all" title="전체 도서 보기">
        <div class="manometer-brass-bezel primary-bezel">
            <div class="bezel-screw s1"></div><div class="bezel-screw s2"></div>
            <div class="bezel-screw s3"></div><div class="bezel-screw s4"></div>
            <div class="manometer-dial-face parchment-dial">
                <div class="dial-scale-ring"></div>
                <div class="dial-unit-label font-typewriter">TOTAL TOMES</div>
                <div class="manometer-needle needle-p1"></div>
                <div class="needle-brass-hub"></div>
                <div class="manometer-glass-glare"></div>
                <div class="odometer-counter-slot">
                    <span class="stat-number font-typewriter" id="statTotalBooks">0</span>
                </div>
            </div>
        </div>
        <div class="manometer-metal-plaque brass-plaque">
            <span class="plaque-ko">전체 서가</span>
            <span class="plaque-en">ARCHIVE INDEX</span>
        </div>
    </div>
    <!-- (즐겨찾기, 읽는 중, 미열람, 완결 게이지 동일하게 인터랙티브 연동) -->
</section>
```

---

## 3. CSS 텍스처 & 장인정신 마감 가이드 (`library.css`)

### 3.1 빅토리안 파치먼트(양피지) & 놋쇠 메탈 토큰 강화
```css
:root {
    /* 19세기 양서각 서체 */
    --font-primary: 'Pretendard', sans-serif;
    --font-serif: 'Noto Serif KR', 'Gowun Batang', serif;
    --font-display: 'Cinzel', serif;
    --font-typewriter: 'Special Elite', 'Courier Prime', monospace;

    /* 리치 황동 & 가죽 텍스처 팔레트 (Light - Victorian Library) */
    --bg-color: #f5ede0;            /* 앤티크 양피지 베이지 */
    --header-bg: #fcf7ee;
    --card-leather: #4a3018;        /* 다크 새들 레더 */
    --card-bg: #fdfbf7;
    --border-brass: #b58232;
    --brass-glow: rgba(200, 150, 62, 0.35);

    /* 정밀 황동 그라데이션 */
    --brass-metallic: linear-gradient(135deg, #f7d58b 0%, #b8832a 50%, #7d5415 100%);
    --copper-metallic: linear-gradient(135deg, #e8956e 0%, #b3562a 50%, #6e2c0e 100%);
    
    /* 리얼 입체 음각/양각 섀도우 */
    --shadow-brass-emboss: inset 1px 1px 1px #fff5d6, inset -1px -1px 2px #4a3411, 0 4px 10px rgba(40,25,10,0.18);
}

body.dark-mode {
    /* 딥 캐스트아이언 & 번트 앰버 (Dark - Midnight Laboratory) */
    --bg-color: #151314;            /* 주철 블랙 */
    --header-bg: #1c191b;
    --card-leather: #241912;
    --card-bg: #211e22;
    --border-brass: #8f6826;
    --brass-glow: rgba(220, 160, 60, 0.25);
    --brass-metallic: linear-gradient(135deg, #dfb25e 0%, #8c6020 50%, #4a320d 100%);
}
```

### 3.2 양장본 책 커버(Tome) 디테일
- 책 표지 좌측에 **3D 둥근 책등(Spine) 입체 그림자** 부여.
- 모서리에 **황동 코너 장식(Brass Corner Protectors)** SVG/CSS 가상요소 부착.
- 표지 호버 시 양피지 냄새가 날 것 같은 묵직하고 부드러운 3D 틸트(`perspective: 1000px`, `transform: rotateY(-8deg)`).

---

## 4. 실행 체크리스트 (별도 세션 진행용)

1. [ ] 배관 리그의 반응형 플렉스 그리드 수정 (화면 축소 시에도 밸브와 기어가 깨지지 않도록 SVG/CSS 뷰박스 보정)
2. [ ] 5구 압력계 클릭 시 해당 상태 탭 필터링이 즉각 일어나는 햅틱/사운드 인터랙션 연동
3. [ ] 압력계 바늘 애니메이션에 자연스러운 댐핑 바운스(Spring Damping) CSS 키프레임 적용
4. [ ] 양장본 책 카드에 황동 모서리 및 가죽 엠보싱 텍스처 스타일 고도화
5. [ ] 타자기 및 증기 밸브 사운드 FX 음량 및 재생 반응성 미세 조율
