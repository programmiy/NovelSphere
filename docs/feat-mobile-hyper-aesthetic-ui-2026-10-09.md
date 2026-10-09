# LANOVEL 모바일 하이퍼 에스테틱 UI 및 럭셔리 네이티브 리더 전면 개편

- **작업 일자**: 2026-10-09
- **버전**: v1.4.0+2026100901
- **목적**: PC의 스팀펑크/차분기관 스타일과 완전히 차별화된, 스마트폰 OLED 디스플레이와 한 손 터치 제스처에 최적화된 **극상의 에스테틱 & 사용성 극대화 모바일 서재(Library) 및 뷰어(Reader)** UI 구현

---

## 1. 개요 및 주요 아키텍처 변경사항

### (1) 신규 디자인 시스템 모듈 (`mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart`)
- **`HyperAmbientMeshBackground`**: 화면 배경에서 14초 주기로 부드럽게 유영하며 호흡하는 3중 앰비언트 리퀴드 글로우 오브(RadialGradient + 45px Gaussian Blur)로 살아 움직이는 깊이감 부여
- **`HyperGlassCard`**: 다층 백드롭 필터(BackdropFilter blur 14~24px)와 1px 림 라이트(Specular Rim Light), 테마 적응형 은은한 네온 섀도우를 내장한 아크릴 글래스모피즘 컨테이너
- **`HyperHapticPill`**: 마이크로 바운스 애니메이션(AnimatedScale), 햅틱 피드백(HapticFeedback.mediumImpact), 네온 림라이트가 결합된 최첨단 조작 캡슐 버튼
- **`HyperProgressRing`**: 듀얼 스윕 그라디언트 셰이더 기반 네온 원형 프로그레스 링 차트 위젯

### (2) 서재 화면 전면 개편 (`mobile_app/lib/ui/library/library_screen.dart`)
- **플로팅 글래스 네비게이션 독 (Floating Glass Navigation Dock)**:
  - 바닥에 부착된 기존 NavigationBar를 제거하고, 화면 하단에 둥글게 떠 있는 20px 블러 플로팅 글래스 아일랜드 독 구현
  - 탭 선택 시 테마 맞춤 네온 캡슐 백라이트 애니메이션 및 햅틱 진동 피드백
- **크리스탈 글래스 헤더 허브 (Crystal Glass Header Hub)**:
  - 럭셔리 그라디언트 엠블럼, 총 장서 수치 배지(`${_books.length}작품`), 실시간 Wi-Fi 동기화 상태 펄스 뱃지, 미확인 알림 카운트 벨
- **Hero 이어보기 앰비언트 쇼케이스 카드 (Hero Showcase Deck)**:
  - 최근 읽던 책을 3D 북 바인딩 라인(Spine accent)과 `HyperProgressRing` 진도율 게이지로 승격
  - 원터치 햅틱 [계속 읽기 ▶] 캡슐 버튼을 통해 0초 만에 뷰어로 즉시 진입
- **3D 프리즘 북 카드 (Crystal Prism Book Card)**:
  - 그리드 뷰: 3D 책 등표지 라인 효과, 챕터 수치 배지, 완결 태그, 즐겨찾기 스타 배지
  - 리스트 뷰: 와이드 글래스 슬라브 카드 레이아웃
- **크리스탈 액션 시트 모달**:
  - 도서 롱프레스 시 18px 블러 프로스티드 글래스 모달로 인명 교정기, AI 검수 스튜디오, 즐겨찾기 토글 팝업

### (3) 독서 뷰어 화면 전면 개편 (`mobile_app/lib/ui/viewer/reader_screen.dart`)
- **플로팅 에어-글래스 다이내믹 아일랜드 헤더 (Floating Air-Glass Header)**:
  - 상단 여백에 부드럽게 떠오르는 24px 블러 캡슐 바
  - 원형 햅틱 뒤로가기 버튼, 2단 럭셔리 타이포그래피(소설명 + 챕터명 + `제 X화` 네온 뱃지)
  - 목차, 유사 번역 검색, TTS, 폰트/테마 설정을 묶은 글래스 클러스터
- **플로팅 에어로-글래스 컨트롤 독 (Floating Aero-Glass Control Deck)**:
  - 상단 림에 **듀얼 그라디언트 네온 프로그레스 레이(Neon Progress Ray)** 실시간 투영
  - [이전 화 ◀] 및 [다음 화 ▶] 햅틱 글래스 캡슐 버튼 탑재
  - 중앙 [제 X화 / Y화] 캡슐 탭 시 목차 드로어 원클릭 오픈
  - 햅틱 피드백이 연동되는 정밀 슬라이더 및 페이지/스크롤 퍼센티지 캡슐
- **상시 표시 미니멀 앰비언트 프로그레스 레이 (Ambient Micro Progress Ray)**:
  - 컨트롤 바가 닫혀 있을 때 화면 최하단에 2.2px 두께의 초박형 네온 그라디언트 라인이 조용히 빛나며 독서 몰입감 극대화

---

## 2. 품질 및 단위 테스트 검증
- `flutter analyze`: **0 issue found** (모바일 전체 프로젝트 린트 및 타입 에러 0건)
- `flutter test`: **20 passed (100%)**
- `pytest`: **160 passed (100%)**
