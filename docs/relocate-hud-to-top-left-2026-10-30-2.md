# 플로팅 HUD 상단 간섭 방지 수직 위치 조정 (top: 150px) (2026-10-30-2)

## 1. 개요 및 배경
- **문제점**: 플로팅 HUD 알림(`#lanovel-hud`)을 좌상단으로 재배치한 후, 수직 높이가 `top: 24px`로 유지되어 소설 플랫폼(카쿠요무, 소설가가 되자 등)의 글로벌 헤더/상단바(GNB, Title Banner)와 겹쳐 상단바 메뉴 조작 및 HUD 텍스트 가독성에 간섭이 발생하는 문제가 확인되었습니다.
- **해결책**: HUD의 상단 고정 위치를 `top: 24px`에서 `top: 150px`로 126px 가량 하향 조정하여, 웹소설 플랫폼의 고정 상단바 영역을 충분히 벗어난 본문 좌측 여백 공간에 안정적으로 안착하도록 개선했습니다.

---

## 2. 주요 변경 사항

### 2.1. 스타일 시트 수정 (`extension/content.css`)
- `#lanovel-hud`:
  ```css
  /* 변경 전 */
  #lanovel-hud {
      position: fixed;
      top: 24px;
      left: 24px;
      z-index: 2147483645;
      ...
  }

  /* 변경 후 */
  #lanovel-hud {
      position: fixed;
      top: 150px;
      left: 24px;
      z-index: 2147483645;
      ...
  }
  ```

---

## 3. 검증 결과
- **TypeScript 타입 검사 (`npm --prefix extension run typecheck`)**: 100% 통과 (0 errors).
- **확장 프로그램 번들링 (`npm --prefix extension run build`)**: 23ms 내 빌드 완료.
- **간섭 해소 검증**: 상단 네비게이션 바 및 우측 사이드바 모두와 겹치지 않고 좌측 본문 여백 영역에 명확하게 노출됨을 확인.
