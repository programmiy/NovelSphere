# 모바일 릴리즈 & 빌드 스킬 구축 작업 보고서 (2026-10-31)

## 1. 작업 개요 및 목적
LANOVEL Flutter 모바일 앱의 릴리즈 배포 과정(버전 판올림, 릴리즈 노트 작성, 릴리즈 APK 컴파일, OTA 배포 신호 발송)을 하나의 표준화된 런북 및 자동화 도구로 통합하기 위해 Antigravity 워크스페이스 전용 스킬(`mobile-release-build`)을 구축하였습니다.

---

## 2. 생성 및 수정된 파일 내역

| 파일 경로 | 구분 | 핵심 기능 및 변경 내역 |
| :--- | :---: | :--- |
| `.agents/skills/mobile-release-build/SKILL.md` | 신규 | **모바일 릴리즈 & 빌드 공식 스킬 정의서**: 버전 규칙, 릴리즈 노트 작성 규격, 단계별 수동 절차 및 원클릭 자동화 명령어 안내 |
| `.agents/skills/mobile-release-build/scripts/bump_and_build.py` | 신규 | **버전 판올림 & 빌드 자동화 스크립트**: `pubspec.yaml` 버전(Semantic Version + `YYYYMMDDNN`) 자동 증가, `release_notes.json` 갱신, `setup_mobile.ps1 -BuildApk` 호출 및 산출물 크기 검증, Windows cp949 콘솔 안전 인코딩 지원 |
| `.agents/skills/mobile-release-build/references/workflow_guide.md` | 신규 | **상세 아키텍처 및 파이프라인 레퍼런스**: 백엔드 `/api/app/version` 및 SSE 브로드캐스트 연계 원리, ADB 자동 설치 및 트러블슈팅 가이드 |

---

## 3. 핵심 설계 및 워크플로우

### 3-1. 버전 관리 규칙
- **Semantic Versioning**: `X.Y.Z` (버그 수정: Patch, 기능 확장: Minor)
- **Build Number**: `+YYYYMMDDNN` (오늘 날짜 8자리 + 당일 빌드 차수 2자리 `01, 02...`)
- 당일 빌드 이력이 있으면 마지막 2자리 자동 +1 증가, 새로운 날짜면 `01`로 리셋.

### 3-2. 원스텝 실행 및 검증
```powershell
# 릴리즈 노트 지정 + 자동 빌드 번호 증가 + APK 빌드 및 OTA 브로드캐스트
python .agents/skills/mobile-release-build/scripts/bump_and_build.py --notes "모바일 앱 v1.7.3: 주요 개선 내용" --build
```

### 3-3. 안전장치 및 호환성
- Windows 콘솔의 기본 `cp949` 코덱 충돌을 방지하기 위해 표준 태그(`[OK]`, `[INFO]`, `[BUILD]`, `[SUCCESS]`) 및 `reconfigure(encoding='utf-8', errors='replace')` 적용.
- `--dry-run` 플래그로 실제 파일 쓰기나 빌드 실행 전 변경 결과를 사전에 안전하게 검증 가능.

---

## 4. 기능 검증 결과
- `python .agents/skills/mobile-release-build/scripts/bump_and_build.py --dry-run` 검증 완료 (버전 `1.7.2+2026103102` 정상 산출)
- `python .agents/skills/mobile-release-build/scripts/bump_and_build.py --notes "테스트 릴리즈 노트" --dry-run` 검증 완료 (`release_notes.json` 포맷 정상 검증)
