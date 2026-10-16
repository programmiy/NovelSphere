# 모바일 하이퍼 에스테틱 UI — Impeller 커스텀 프래그먼트 셰이더(.frag) 기반 오로라 유체 메쉬 개편 (2026-10-16)

## 1. 배경 및 문제점
- 기존 [`HyperAmbientMeshBackground`](file:///C:/LANOVEL/mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart)는 3개의 원형 `Container`를 위젯 트리에서 매 프레임 `AnimatedBuilder`로 이동시키고, 그 위에 풀스크린 `BackdropFilter(sigma: 45)`를 씌우거나 단순 정적 `RadialGradient`로 타협하는 구조였음.
- 풀스크린 `BackdropFilter`는 매 프레임 오프스크린 버퍼 복사(`saveLayer`)와 가우시안 블러 패스를 유발하여 모바일 GPU/배터리 부하가 극심한 반면, 단순 정적 그라디언트는 '자원 소모를 아끼지 않는 극상의 비주얼 에스테틱'이라는 디자인 정체성을 살리지 못하는 한계가 있었음.

## 2. 핵심 해결 방식: Impeller 커스텀 프래그먼트 셰이더 (`.frag` GLSL)
- **단일 패스(Single-pass) GLSL 프래그먼트 셰이더 도입 (`mobile_app/shaders/hyper_ambient_mesh.frag`)**:
  - `saveLayer` 및 `BackdropFilter`를 100% 제거하고, GPU 픽셀 파이프라인에서 직접 색상을 계산하는 `FragmentProgram` 아키텍처로 전환.
  - **2단계 도메인 워핑(Iterative Domain Warping)**: 삼각함수 조화파 중첩(`q`, `r` 벡터 워핑)을 통해 단순 원형 이동이 아닌 실크나 오로라가 물결치듯 일렁이는 진짜 유체(Fluid Mesh) 및 빛의 간섭(Silk Interference) 질감 구현.
  - **마이크로 필름 그레인(Micro Film Grain Dithering)**: 고주파 스크린 공간 해시(`hash12`) 노이즈를 픽셀 단위로 주입하여 8-bit 그라디언트 색상 계단 현상(Color Banding)을 원천 제거하고, 매트 글래스/아노다이징 질감을 동시에 표현.
- **위젯 리빌드 제로(0회) 및 레이어 완전 격리 (`mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart`)**:
  - `AnimatedBuilder` 대신 `CustomPainter(repaint: _controller)`를 사용하여 애니메이션 틱마다 위젯 트리가 전혀 리빌드되지 않고 래스터 스레드에서 Uniform(`uSize`, `uTime`, `uIsDark`, `uIntensity`, `uBgColor`, `uColor1~3`)만 갱신.
  - `RepaintBoundary`로 배경 셰이더 레이어와 전면 콘텐츠(`child`) 레이어를 완전히 분리하여 120Hz ProMotion 스크롤 성능 보장.
  - `WidgetsBindingObserver` 생명주기 연동으로 앱이 백그라운드(`paused`, `hidden`) 진입 시 셰이더 컨트롤러를 즉시 정지하여 유휴 배터리 소모 0% 보장.
- **앱 부팅 시 셰이더 사전 로드 (`mobile_app/lib/main.dart`)**:
  - `main()` 초기화 단계에서 `HyperAestheticTheme.loadMeshShaderProgram()`을 병렬 프리워밍하여 첫 프레임부터 지연 없이 즉시 바인딩.

## 3. 변경 파일 목록
- `mobile_app/shaders/hyper_ambient_mesh.frag`: Impeller GLSL 460 코어 유체 오로라 메쉬 & 필름 그레인 프래그먼트 셰이더 신설
- `mobile_app/pubspec.yaml`: `flutter.shaders` 섹션에 `shaders/hyper_ambient_mesh.frag` 등록
- `mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart`: `HyperAestheticTheme.loadMeshShaderProgram()`, `getAmbientTertiary()`, `HyperAmbientMeshBackground` 및 `_HyperAuroraShaderPainter` 구현
- `mobile_app/lib/main.dart`: 앱 시작 시 프래그먼트 셰이더 사전 로드(`loadMeshShaderProgram`) 연동
