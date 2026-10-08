# 최근 번역 회차 연동 적응형 RPM 방어 시스템 (2026-10-08)

## 1. 개요 및 배경
- **문제점**: 최근 회차당 분량이 짧은 웹소설(카쿠요무, 소설가가 되자 등)을 연속으로 번역할 때, 분당 번역 회차 수가 급증하여 Gemini API의 분당 요청 한도(RPM, Rate Limit)에 도달해 429(RESOURCE_EXHAUSTED) 오류가 빈번히 발생하는 현상이 있었습니다.
- **원인 분석**: 기존 시스템은 회차 완료 후 다음 회차로 넘어가는 대기시간이 쾌속모드 기준 8초로 고정되어 있어, 분량이 적은 소설의 경우 1분에 3~5회차 이상이 번역되면서 순간 분당 요청 수(RPM)가 12~15회 이상으로 폭증했습니다.
- **해결책**: 클라이언트(확장 프로그램)와 서버(백엔드) 양단에 **"최근 번역한 회차가 많을수록 지연시간을 크게 부여하는 적응형 스로틀링(Episode-Aware Adaptive Delay & Throttling)"** 시스템을 구축했습니다.

---

## 2. 주요 구현 사항

### 2.1. 크롬 확장 프로그램 (`extension/content.js`)
1. **최근 번역 회차 슬라이딩 윈도우 추적**:
   - `recordRecentEpisode(cleanUrl)`: 회차 번역 완료 시 로컬 스토리지에 타임스탬프와 함께 기록 (10분 만료 자동 정리, 30초 내 중복 방지).
   - `getRecentEpisodeCount(windowMinutes = 5)`: 최근 5분간 번역 완료된 고유 회차(Distinct URL) 수를 실시간 집계.
2. **회차 수 비례 다음 화 이동 적응형 지연시간 (`calculateAdaptiveEpisodeDelay`)**:
   - **쾌속모드**:
     * 0 ~ 2화: **8초** (안전/초기 구간 - 최대 속도 유지)
     * 3화: **15초** (주의 구간 - 초기 RPM 누적 완화)
     * 4화: **22초** (경고 구간)
     * 5화: **30초** (과열 주의 구간)
     * 6화: **40초** (과열 위험 구간)
     * 7화 이상: **55초** (완전 쿨다운 구간 - 1분 슬라이딩 윈도우 안전 리셋)
   - **일반모드**: 기본 60초 유지, 최근 회차 5화 이상 시 75초, 7화 이상 시 90초로 연장.
3. **묶음(Chunk) 간 대기시간 완충 (`calculateAdaptiveChunkDelay`)**:
   - 최근 번역 회차가 4화 이상일 경우, 단일 회차 내 묶음 간 대기시간도 기존 2초에서 3.0초 ~ 4.5초로 미세 완충하여 순간 API 버스트를 방어.
4. **직관적인 사용자 안내 (HUD & 사이드바 로그)**:
   - 과열 위험 감지 시 사이드바 및 미니멀 HUD에 지연시간 연장 사유를 실시간 안내 (`⚡ [RPM 적응형 보호] 최근 5분간 번역 회차: N화 감지 → 다음 회차 대기 시간을 X초로 자동 연장합니다.`).

### 2.2. 백엔드 서버 (`server/services/rpm_manager.py` & `server/routers/translation.py`)
1. **인메모리 에피소드 슬라이딩 윈도우 (`_EPISODE_RECORDS`)**:
   - `record_episode_translation(url, novel_title)`: 회차별 번역 진입 시 타임스탬프 기록.
   - `get_recent_episode_count(window_seconds = 300.0)`: 최근 5분간 번역된 고유 회차 수 반환.
2. **최근 회차 빈도 연동 선제적 휴식 강화 (`proactive_rpm_rest`)**:
   - 최근 5분간 4화 이상 번역 시: Yellow Zone 임계치를 7 RPM으로 낮추고 2.5~4.5초 완충 휴식.
   - 최근 5분간 7화 이상 번역 시: Red Zone 임계치를 9 RPM으로 낮추고 8.5~16.5초 휴식 및 세션 소켓 재생성(Session Rejuvenation).
3. **신규 모니터링 API (`GET /api/rpm_status`)**:
   - 현재 RPM, 최근 5분 번역 회차 수, 현재 Zone(green/yellow/red), 권장 대기시간을 외부/클라이언트에 반환.

---

## 3. 검증 결과
- `tests/test_rpm_breather.py` 총 11개 단위 테스트 100% 통과:
  * 슬라이딩 윈도우 만료 및 30초 내 중복 방지 테스트 통과
  * 적응형 딜레이 계산식(8s ~ 55s) 정확도 검증 완료
  * 회차 급증 시 선제적 Yellow/Red Zone 전환 및 세션 재생성 검증 완료
  * `/api/rpm_status` 엔드포인트 응답 검증 완료
- `node -c extension/content.js` 문법 검증 완료
