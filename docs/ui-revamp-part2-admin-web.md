# [Part 2] LANOVEL 관리자 대시보드(Web) 하이테크 사이버네틱스 HUD UI/UX 개편 명세서

> **디자인 기조**: **High-Tech Cybernetics Operations Deck**  
> **핵심 방향**: 캔버스 파티클, 오로라 메쉬, SF 앰비언트 사운드 FX, HUD 텔레메트리 등 **의도된 고비용 사이버펑크 리소스를 100% 유지**하되, 텍스트 가독성이 네온에 묻히지 않도록 **'블랙아웃 옵시디언 패널(Blackout Obsidian Panels)'**과 정밀한 타이포그래피 계층을 결합하여 프로페셔널한 하이엔드 SF 콘솔로 완성  
> **대상 파일**:
> - `server/templates/admin.html`
> - `server/static/admin.css`
> - `server/static/admin.js`

---

## 1. 정체성 재정의: SF 사이버네틱스의 품격 고도화

LANOVEL의 관리자 콘솔은 단순한 관리자 페이지를 넘어, **"번역 데이터를 지휘 통제하는 사이버네틱 오퍼레이션 룸(War Room 콘솔)"**이라는 독창적인 정체성을 가지고 있습니다. 이번 개편은 이 강렬한 SF 비주얼을 유지하면서 작업 완성도를 극대화합니다:

1. **오로라 & 캔버스 배경과 텍스트의 완벽한 분리**:
   - `cyber-bg-canvas`와 `cyber-aurora-bg`의 환상적인 앰비언트 비주얼을 그대로 살리되,
   - 데이터 테이블과 입력 폼 영역에는 **깊은 옵시디언 반투명 패널(Blackout Glass, 배경 투과도 92% 차단)**을 깔아, 네온 배경 위에서도 본문 텍스트가 칼처럼 날카롭게 읽히도록 대비율(Contrast) 7:1 이상을 확보.
2. **HUD 데크 (Master Controls)의 인터페이스 완성도**:
   - `hud-deck-search`, `hud-deck-tools`, `hud-deck-system`의 테두리를 세련된 각진 사이버 챔퍼(Chamfered corner, 45도 절삭 코너)와 미세한 사이안/마젠타 에지 라이트(Edge-light)로 정밀 마감.
3. **실시간 텔레메트리 & 사운드 피드백 정교화**:
   - 통계 바(`stats-wrapper`)의 텔레메트리 레이더 펄스 비콘과 API 쿼터 바를 SF 항공기 계기판 수준의 시각화로 고도화.
   - 클릭 사운드 FX(`cyberSoundToggleBtn`)와 앰비언트 음향의 볼륨 밸런스를 조절하여 귀가 피로하지 않으면서 쾌감을 주는 기계음으로 튜닝.

---

## 2. 구체적 HTML & HUD 구조 고도화 명세 (`admin.html`)

### 2.1 사이버 HUD 상태 표시줄 및 헤더 마감
```html
<header class="main-header cyber-console-header">
    <div class="header-nav">
        <a href="/" class="btn btn-cyber-ghost nav-back-btn">&larr; 서재 차분기관으로 귀환</a>
        
        <div class="header-title-group">
            <div class="cyber-hud-status-bar">
                <span class="cyber-status-pill"><span class="pulse-dot"></span> NEURAL TRANSLATION ONLINE</span>
                <span class="cyber-clock-pill font-mono" id="cyberLiveClock">00:00:00</span>
                <button id="cyberSoundToggleBtn" class="btn btn-outline cyber-sound-btn" title="사이버네틱 인터랙션 사운드">
                    <span class="material-icons">volume_up</span> <span class="sound-label">FX 켜짐</span>
                </button>
                <button id="cyberAmbientToggleBtn" class="btn btn-outline cyber-ambient-btn" title="딥 스페이스 앰비언트 사운드">
                    <span class="material-icons">headphones</span> <span class="ambient-label" id="cyberAmbientLabel">배경음: 켜짐</span>
                </button>
                <button class="btn btn-outline cyber-theme-btn" id="darkModeToggle" title="매트릭스 사이안 / 네온 바이올렛 테마 전환">
                    <span class="material-icons">dark_mode</span>
                </button>
            </div>
            <h1 class="glitch-title" data-text="번역 관리 대시보드">번역 관리 대시보드</h1>
            <p class="cyber-subtitle">NEURAL TEXT COMPILATION & DIAGNOSTIC CONSOLE</p>
        </div>

        <div class="header-actions-deck">
            <button onclick="window.location.href='/ai_review';" class="btn btn-cyber-cyan glow-cyan">
                <span class="btn-icon">🧠</span> AI 번역 검수 &rarr;
            </button>
            <button onclick="window.location.href='/ai_reretranslate';" class="btn btn-cyber-amber glow-amber">
                <span class="btn-icon">⚡</span> AI 재재번역 센터 &rarr;
            </button>
            <button onclick="window.location.href='/db_editor';" class="btn btn-cyber-purple glow-purple">
                <span class="btn-icon">📖</span> 인명·용어 교정기 &rarr;
            </button>
        </div>
    </div>
</header>
```

### 2.2 텔레메트리 통계 그리드 (Data-Telemetry HUD)
```html
<div class="stats-wrapper cyber-panel" id="adminQuickStatsBar">
    <div class="stats-hud-beacon" title="실시간 데이터 텔레메트리">
        <span class="beacon-pulse-ring"></span>
        <span class="beacon-radar-dot"></span>
        <span class="beacon-text font-mono">LIVE TELEMETRY</span>
    </div>
    <!-- 통계 항목: SF 게이지 바와 네온 인디케이터가 살아있는 하이엔드 카드 -->
    <div class="stat-item stat-books cyber-tile">
        <span class="material-icons stat-icon">library_books</span>
        <div class="stat-body">
            <div class="stat-number font-mono" id="statTotalBooks">0</div>
            <div class="stat-label">등록 작품</div>
        </div>
    </div>
    <!-- (회차, 문단, 글자 수, 오늘 번역, API 쿼터 게이지 고도화 유지) -->
</div>
```

---

## 3. CSS 사이버네틱스 스타일 가이드 (`admin.css`)

### 3.1 옵시디언 블랙아웃 서피스 & 네온 에지 림라이트
```css
:root {
    /* 미래지향적 타이포그래피 */
    --font-ui: 'Pretendard', sans-serif;
    --font-cyber: 'Rajdhani', 'Pretendard', sans-serif;
    --font-mono: 'Consolas', 'Courier Prime', monospace;

    /* 하이엔드 사이버펑크 팔레트 */
    --bg-deep-space: #090a0f;
    --surface-obsidian: rgba(13, 16, 23, 0.88);   /* 텍스트 가독성을 보장하는 고농도 패널 */
    --surface-card: rgba(20, 24, 35, 0.82);
    
    /* 정밀 네온 발광 토큰 */
    --neon-cyan: #00f2fe;
    --neon-cyan-glow: 0 0 12px rgba(0, 242, 254, 0.45);
    --neon-purple: #9d4edd;
    --neon-purple-glow: 0 0 12px rgba(157, 78, 221, 0.45);
    --neon-amber: #ffb703;
    
    /* 절삭 코너 (Chamfered Borders) */
    --border-cyber: 1px solid rgba(0, 242, 254, 0.28);
}

/* 텍스트를 감싸는 옵시디언 패널 - 캔버스 배경과 텍스트의 충돌 방지 */
.hud-deck, .stats-wrapper, .records-table-container {
    background: var(--surface-obsidian);
    backdrop-filter: blur(16px);
    border: var(--border-cyber);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), inset 0 0 1px rgba(0, 242, 254, 0.3);
    border-radius: 8px;
}
```

---

## 4. 실행 체크리스트 (별도 세션 진행용)

1. [ ] 파티클 캔버스와 오로라 배경을 유지하되, 데이터 영역에 옵시디언 틴트 패널을 적용하여 텍스트 가독성(WCAG AAA) 완벽 확보
2. [ ] SF 폰트(`Rajdhani`, `Orbitron`)는 헤더/라벨/수치 표시에만 집중 배치하고, 실제 번역문/원문은 최상급 가독성의 본문 폰트로 명확히 분리
3. [ ] 3단 HUD 데크의 레이아웃을 실제 오퍼레이션 콘솔처럼 세련된 그리드로 재정렬
4. [ ] 사운드 FX의 볼륨 노멀라이징 및 토글 상태 브라우저 로컬 저장 기능 강화
5. [ ] API 쿼터 게이지에 사이버 충전 이펙트(Neon Charge Bar) 시각화 적용
