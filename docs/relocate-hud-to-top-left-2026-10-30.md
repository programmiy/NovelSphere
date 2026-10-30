# 플로팅 HUD 표시 위치 좌상단 재배치 (2026-10-30)

## 1. 개요 및 배경
- **문제점**: 플로팅 HUD 알림(`#lanovel-hud`)이 화면 우상단(`top: 24px; right: 24px`)에 렌더링되면서, 브라우저 우측에 위치한 크롬 확장 사이드바(너비 460px) 헤더, 상단 버튼군(번역 중지/재개/재시도 버튼 등) 및 확장 팝업 버튼 영역과 겹쳐 UI 조작을 가리는 간섭 현상이 발생했습니다.
- **해결책**: HUD의 수직 높이(`top: 24px`)는 그대로 유지하면서 수평 위치를 동일한 간격의 화면 좌상단(`left: 24px; right: auto`)으로 재배치하여, 우측 사이드바 및 확장 프로그램 인터페이스와의 시각적·상호작용 충돌을 완전히 해소했습니다.

---

## 2. 주요 변경 사항

### 2.1. 스타일 시트 수정 (`extension/content.css`)
- `#lanovel-hud`:
  ```css
  /* 변경 전 */
  #lanovel-hud {
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 2147483645;
      ...
  }

  /* 변경 후 */
  #lanovel-hud {
      position: fixed;
      top: 24px;
      left: 24px;
      z-index: 2147483645;
      ...
  }
  ```

---

## 3. 검증 결과
- **TypeScript 타입 검사 (`npm --prefix extension run typecheck`)**: 100% 통과 (0 errors).
- **확장 프로그램 번들링 (`npm --prefix extension run build`)**: 41ms 정상 빌드 완료.
- **UI 간섭 해소**: 우측 사이드바 열림 여부와 무관하게 좌상단에서 번역 진행도 및 카운트다운 타이머가 사이드바/헤더를 가리지 않고 원활하게 노출됨을 확인.
