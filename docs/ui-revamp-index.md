# LANOVEL 하이엔드 UI/UX 전면 개편 마스터 플랜

> **핵심 철학**: **Distinctive Craftsmanship & High-End Aesthetics**  
> **기조**: LANOVEL 고유의 **스팀펑크(차분기관/황동/가죽), 사이버네틱스(HUD/네온), 하이퍼 에스테틱(오로라/글래스모피즘)** 정체성을 **100% 유지·강화**하면서, 어설픈 그래픽 불일치를 극복하고 장인정신(Impeccable Craftsmanship) 넘치는 디테일과 120fps 부드러운 인터랙션으로 완성합니다.

---

## 3개 파트별 개편 문서 목록

각 파트는 독립된 세션에서 바로 실행할 수 있도록 대상 파일, 보존/강화할 핵심 비주얼, TO-BE 마크업/코드, 체크리스트를 포함하고 있습니다:

| 파트 | 영역 & 테마 | 핵심 비주얼 & 가치 | 문서 링크 |
|---|---|---|---|
| **Part 1** | **서재 페이지 (Web)**<br>`Steam Difference Engine` | • 증기 배관, 톱니바퀴, 5구 황동 압력계 게이지 유지 및 완성도 극대화<br>• 게이지와 필터의 햅틱/사운드 연동 인터랙션<br>• 양장본 가죽 장정, 금박 음각, 황동 코너 프로텍터 질감 고도화 | [ui-revamp-part1-library-web.md](file:///C:/LANOVEL/docs/ui-revamp-part1-library-web.md) |
| **Part 2** | **관리자 대시보드 (Web)**<br>`Cybernetic Operations Deck` | • 캔버스 파티클, 오로라 배경, SF 앰비언트 사운드 FX 유지<br>• 텍스트 가독성을 100% 보장하는 옵시디언 블랙아웃 글래스 패널 도입<br>• 실시간 텔레메트리 비콘 및 SF 계측기 스타일의 HUD 툴바 정돈 | [ui-revamp-part2-admin-web.md](file:///C:/LANOVEL/docs/ui-revamp-part2-admin-web.md) |
| **Part 3** | **모바일 앱 (Flutter)**<br>`Hyper-Aesthetic & Haptic` | • 앰비언트 오로라 메쉬 및 유려한 글래스모피즘(Glassmorphism) 유지<br>• `RepaintBoundary` 레이어 격리를 통해 고비용 그래픽을 120fps로 무결점 구동<br>• Thumb Zone 최적화 및 48dp 터치 타깃, 다단 햅틱 피드백 완성 | [ui-revamp-part3-mobile-app.md](file:///C:/LANOVEL/docs/ui-revamp-part3-mobile-app.md) |

---

## 별도 세션 진행 시 추천 프롬프트

각 파트를 진행할 때 새 세션에서 아래 프롬프트를 복사하여 전달하시면 에이전트가 문서를 기반으로 정확히 리팩토링을 수행합니다:

### [Part 1 세션 시작 프롬프트]
```
docs/ui-revamp-part1-library-web.md 문서를 참고해서, LANOVEL 웹 서재 페이지(library.html, library.css, library.js)의 스팀펑크(증기 배관, 기어, 5구 압력계) 정체성을 100% 살리고, 19세기 왕립 차분기관과 양장본 서가 수준의 장인정신 넘치는 디테일과 인터랙션으로 고도화해줘.
```

### [Part 2 세션 시작 프롬프트]
```
docs/ui-revamp-part2-admin-web.md 문서를 참고해서, LANOVEL 웹 관리자 페이지(admin.html, admin.css, admin.js)의 사이버네틱 HUD, 캔버스 파티클, 사운드 FX를 유지하면서, 옵시디언 틴트 패널을 적용해 텍스트 가독성과 데이터 그리드 완성도를 극대화해줘.
```

### [Part 3 세션 시작 프롬프트]
```
docs/ui-revamp-part3-mobile-app.md 문서를 참고해서, Flutter 모바일 앱(library_screen.dart, hyper_aesthetic_theme.dart)의 오로라 메쉬와 글래스모피즘을 유지하면서, RepaintBoundary 렌더링 최적화(120fps)와 48dp 터치 타깃, 햅틱 피드백을 완성해줘.
```
