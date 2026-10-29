# 플로팅 HUD 실시간 번역 진행도 및 카운트다운 타이머 고도화 (2026-10-29)

## 1. 개요 및 배경
- **배경**: 웹소설 열람 중 사이드바를 접어두고 본문에 집중할 때, 사이드바 하단 콘솔 로그(`sidebar-log-console`)를 열어보지 않으면 현재 번역 진행 상황(묶음/문장 진행률), 다음 묶음 및 다음 회차로 넘어가는 대기 시간(RPM 적응형 쿨다운)을 시각적으로 확인하기 어려웠습니다.
- **목적**: 화면 우측 상단의 미니멀 플로팅 HUD([`hud.ts`](file:///c:/LANOVEL/extension/src/ui/hud.ts), `#lanovel-hud`)를 고도화하여 사이드바가 닫혀 있어도 **번역 진행도(프로그레스 바 & 백분율)**, **다음 번역간 대기 카운트다운 타이머(초 단위)**, **번역 완료 통계(연속 회차수 및 문장수)** 등을 직관적으로 안내하도록 강화했습니다.

---

## 2. 주요 구현 사항

### 2.1. HUD 모듈 고도화 (`extension/src/ui/hud.ts`)
1. **상세 프로그레스 HUD (`showLanovelProgressHud`)**:
   - 문장 수(`current`/`total`), 묶음 번호(`chunkIndex`/`chunkTotal`), 백분율(`pct%`)을 계산하여 그라디언트 프로그레스 바와 함께 출력.
   - 단일 토스트와 구분되는 `.detailed` 레이아웃 적용.
2. **실시간 1초 단위 카운트다운 타이머 HUD (`startLanovelCountdownHud`)**:
   - 대기 시간(`totalSeconds`) 동안 매초 인터벌을 통해 배지(`N초`) 및 프로그레스 바를 실시간 축소/업데이트.
   - 네온 펄스 애니메이션(`.hud-badge-timer`, `hud-fill-timer`)을 통해 시각적 생동감 부여.
   - 조기 중단 및 정리(Cleanup)가 가능한 취소 함수(`() => void`) 반환.
3. **타이머 및 인터벌 안전 관리 (`clearLanovelHudTimers`, `hideLanovelHud`)**:
   - 새로운 알림이나 카운트다운 발생 시 기존 활성 타이머 및 인터벌을 즉각 해제하여 잔류 현상 및 메모리 누수 방지.
4. **기존 단일 토스트 100% 하위 호환 (`showLanovelHud`)**:
   - 기존의 간결한 텍스트 알림도 문제없이 병행 지원.

### 2.2. 글래스모피즘 HUD 스타일 확장 (`extension/content.css`)
- `#lanovel-hud.detailed`: 가로 250px~320px의 콤팩트 카드형 레이아웃, `backdrop-filter: blur(12px)`.
- `.hud-header-row` / `.hud-badge`: 타이틀 및 강조 뱃지(퍼센트 배지 `#6366f1` / 타이머 배지 `#f59e0b` 네온 펄스).
- `.hud-progress-track` & `.hud-progress-fill`: 부드러운 그라디언트 바.
- `.hud-footer-row`: 하단 보조 설명문 및 묶음 상태.

### 2.3. 번역 라이프사이클 연동 (`extension/src/core/page_translator.ts` & `extension/src/content.ts`)
1. **번역 시작**:
   - 총 문장 수 및 묶음 수 안내 (`⚡ 번역 시작 (총 N문장, M개 묶음)`).
2. **묶음 번역 진행 중**:
   - 청크별 요청 중 및 번역 완료 시 실시간 문장 수/백분율 갱신 (`📖 번역 진행 중 N/M문장 (X%)`).
   - 미완료 빈칸 보완 번역꾸러미 실행 시 보완 상태 실시간 표기.
3. **묶음 간 대기 (2초 이상)**:
   - `startLanovelCountdownHud`로 다음 묶음까지의 대기 시간(초) 카운트다운 표시.
4. **번역 완료**:
   - 번역 완료 시 연속 회차수와 총 문장수를 담은 축하 알림 (`🎉 번역 완료! (총 N문장 / 이번 연속 M화)`).
   - 이미 번역된 페이지 진입 시 안내 (`✅ 번역할 새로운 문장이 없습니다 (이미 번역 완료됨)`).
5. **다음 회차 이동 적응형 딜레이 (8s~55s)**:
   - RPM 보호 구간 및 안전 구간에 맞춘 실시간 초 단위 카운트다운 타이머 HUD 표시.
   - 사용자 번역 취소 또는 쾌속모드 중단 시 즉시 안전 종료.
6. **버튼 조작 피드백**:
   - 중지(`⏹️ 번역이 중지되었습니다.`), 재개(`▶️ 번역을 재개합니다...`), 재시도(`🔄 전체 재번역을 시작합니다...`) 시 즉각 HUD 피드백.

---

## 3. 검증 결과
- **TypeScript 타입 검사 (`npm --prefix extension run typecheck`)**: 100% 통과 (0 errors).
- **확장 프로그램 번들링 (`npm --prefix extension run build`)**: 46ms 내 `content.js` 및 `background.js` 정상 컴파일 완료.
- **회귀 방지 테스트 (`pytest tests/test_corpus_ai_service.py` & `pytest tests/test_rpm_breather.py`)**: 단위 테스트 100% 통과.
