---
name: mobile-release-build
description: >-
  Use this skill when modifying mobile_app/pubspec.yaml version, drafting or updating
  mobile_app/release_notes.json, building the Flutter Android release APK, or deploying
  mobile OTA updates for the LANOVEL application.
---

# LANOVEL 모바일 릴리즈 & 빌드 스킬 (Mobile Release & Build Runbook)

이 스킬은 LANOVEL Flutter 모바일 앱의 버전 판올림(`pubspec.yaml`), 릴리즈 노트 작성(`release_notes.json`), 릴리즈 APK 빌드 및 OTA 무선 배포(`setup_mobile.ps1 -BuildApk`)를 안전하고 일관되게 수행하기 위한 공식 런북입니다.

---

## 📌 핵심 구성 파일 및 규격

| 파일 경로 | 역할 및 형식 규격 |
| :--- | :--- |
| `mobile_app/pubspec.yaml` | `version: X.Y.Z+YYYYMMDDNN`<br>• `X.Y.Z`: Semantic Versioning (버그/UI수정은 Patch, 기능 확장은 Minor)<br>• `+YYYYMMDDNN`: 빌드 번호 (연월일 8자리 + 당일 2자리 시퀀스 `01, 02...`) |
| `mobile_app/release_notes.json` | `{"release_notes": "모바일 앱 vX.Y.Z: [핵심 변경 내역 요약]"}`<br>• 백엔드 `/api/app/version` 및 웹 랜딩(`/download`), 모바일 OTA 업데이트 팝업에 노출되는 설명문 |
| `scripts/setup_mobile.ps1` | 빌드 스크립트 (`-BuildApk` 플래그 사용)<br>• `D:\flutter\bin` 및 `D:\jdk-17` 환경 자동 주입<br>• `flutter build apk --release` 수행<br>• `server/static/lanovel-reader-release.apk` 복사 동기화<br>• ADB 연결 기기 직배포 (`adb install -r`) 및 Wi-Fi SSE 브로드캐스트 (`/api/app/broadcast_update`) |

---

## ⚡ 빠른 실행 가이드 (One-Step Automation)

스킬 내장 헬퍼 스크립트를 사용하여 버전 갱신, 릴리즈 노트 반영, 빌드를 한 번에 실행할 수 있습니다:

```powershell
# 1. 릴리즈 노트와 함께 빌드 번호 자동 판올림 및 APK 빌드 원클릭 실행
python .agents/skills/mobile-release-build/scripts/bump_and_build.py --notes "모바일 앱 v1.7.3: 주요 개선 사항 설명" --build

# 2. Semantic Version도 변경할 경우 (예: 1.7.3)
python .agents/skills/mobile-release-build/scripts/bump_and_build.py --version "1.7.3" --notes "모바일 앱 v1.7.3: 신규 기능 추가" --build

# 3. 변경 사항 미리보기 (Dry Run)
python .agents/skills/mobile-release-build/scripts/bump_and_build.py --notes "테스트" --dry-run
```

---

## 🛠️ 수동 단계별 표준 절차 (Step-by-Step Procedure)

### Step 1. 변경 내역 파악 및 버전 / 릴리즈 노트 결정
1. 최근 수정된 모바일 코드(`mobile_app/lib/`), UI 개선점, 버그 해결 사항을 정리합니다.
2. 현재 `mobile_app/pubspec.yaml`의 버전을 확인합니다.
   - 예: `version: 1.7.2+2026103101`
3. 오늘 날짜(`YYYYMMDD`)를 확인하고 빌드 번호를 산출합니다:
   - 당일 첫 빌드: `+YYYYMMDD01`
   - 당일 추가 빌드: 이전 번호의 마지막 2자리를 +1 증가 (예: `2026103101` -> `2026103102`)
4. 릴리즈 노트는 사용자 친화적으로 핵심 기능을 간결하게 작성합니다.

### Step 2. `mobile_app/pubspec.yaml` 수정
`mobile_app/pubspec.yaml` 상단의 `version:` 라인을 갱신합니다.
```yaml
version: 1.7.3+2026103102
```

### Step 3. `mobile_app/release_notes.json` 수정
`mobile_app/release_notes.json` 파일에 JSON 형식으로 작성합니다.
```json
{
  "release_notes": "모바일 앱 v1.7.3: 설정 탭 OTA 버튼 가림 해소, 서재 정렬 고도화, 원문 툴팁 팝업 복원"
}
```

### Step 4. 빌드 및 배포 스크립트 실행
PowerShell 콘솔에서 다음 명령을 실행합니다:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_mobile.ps1 -BuildApk
```

> [!NOTE]
> 스크립트가 실행되는 동안 다음 과정이 순차적으로 진행됩니다:
> 1. Flutter SDK 및 JDK 17 경로 확인
> 2. `flutter pub get` 의존성 확인
> 3. `flutter build apk --release` 컴파일
> 4. `server/static/lanovel-reader-release.apk`로 자동 복사
> 5. USB/무선 ADB 연결 기기 존재 시 `adb install -r` 무설치 자동 덮어쓰기 설치 및 앱 실행
> 6. 서버(8001) 실행 중인 경우 Wi-Fi 연결 기기에 실시간 OTA 알림 SSE 전송

### Step 5. 빌드 무결성 및 배포 검증
빌드가 완료된 후 다음 항목을 점검합니다:
1. **산출물 파일 존재 및 크기 확인**:
   - `mobile_app\build\app\outputs\flutter-apk\app-release.apk` (약 20~60MB)
   - `server\static\lanovel-reader-release.apk`
2. **버전 API 확인 (서버 구동 시)**:
   - `GET http://localhost:8001/api/app/version` 호출 시 응답의 `version`, `build_number`, `release_notes`가 올바른지 확인.

---

## ⚠️ 주의사항 및 트러블슈팅

1. **Flutter/JDK 환경변수 누락**:
   - `scripts/setup_mobile.ps1`에 `D:\flutter\bin` 및 `D:\jdk-17`이 하드코딩되어 경로를 보정해주므로, 일반 PowerShell 창에서도 정상 작동합니다.
2. **AAPT/Gradle 잠금 또는 캐시 충돌**:
   - 빌드 실패 시 `.\scripts\setup_mobile.ps1 -Clean`을 먼저 수행하여 캐시를 정리한 후 `-BuildApk`를 재실행합니다.
3. **데이터베이스 안전 규칙 준수**:
   - 빌드 작업 중 DB(`translations.db`)를 직접 삭제하거나 조작하지 않습니다.
