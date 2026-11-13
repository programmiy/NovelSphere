# 모바일 v1.8.4 업로드 변경 내역 확인 & 폰·태블릿 마킹 분리 릴리즈 빌드 (2026-11-13)

## 1. 작업 개요 및 목적
- 앞서 커밋(`1bb409f`)에서 구현한 **모바일 업로드 변경 내역 확인 스튜디오(`PendingChangesSheet`)** 및 **바형 스마트폰·태블릿 마킹 기능 완전 분리(`DeviceUtils`)** 변경 사항을 반영하여 안드로이드 공식 릴리즈 APK(`v1.8.4+2026111303`)를 빌드하고 OTA 배포를 동기화했습니다.

---

## 2. 세부 작업 내역

### 2-1. 버전 판올림 및 릴리즈 노트 갱신
- 스크립트: `.agents/skills/mobile-release-build/scripts/bump_and_build.py --version "1.8.4" --notes "..." --build`
- [`mobile_app/pubspec.yaml`](../mobile_app/pubspec.yaml): `version: 1.8.3+2026111302` → `version: 1.8.4+2026111303`
- [`mobile_app/release_notes.json`](../mobile_app/release_notes.json): `"모바일 앱 v1.8.4: 업로드 전 변경 내역(문장 수정 Diff·진도·찾아바꾸기) 상세 확인 스튜디오 및 바형 스마트폰·태블릿 마킹 기능 완전 분리"`

### 2-2. Android Release APK 빌드 및 OTA 배포
- [`scripts/setup_mobile.ps1`](../scripts/setup_mobile.ps1) `-BuildApk` 실행:
  - `flutter build apk --release` 완료 (`Running Gradle task 'assembleRelease'... 158.4s`)
  - [`mobile_app/build/app/outputs/flutter-apk/app-release.apk`](../mobile_app/build/app/outputs/flutter-apk/app-release.apk): `26.3MB` 생성
  - `server/static/lanovel-reader-release.apk`: **27,569,990 bytes (`26.29 MB`)** 동기화 완료
  - Wi-Fi 연결 기기 대상 `POST http://localhost:8001/api/app/broadcast_update` 무설치 OTA 업데이트 SSE 신호 발송 완료 (ADB 유선/무선 연결 기기 미감지로 Wi-Fi OTA 브로드캐스트 적용)

---

## 3. 검증 결과
1. **라이브 OTA 엔드포인트 확인 (`GET http://127.0.0.1:8001/api/app/version`)**:
   - `version`: `"1.8.4.2026111303"`, `base_version`: `"1.8.4"`, `build_number`: `2026111303`
   - `has_apk`: `true`, `file_size`: `27569990`, `file_name`: `"lanovel-reader-v1.8.4.2026111303.apk"`
   - `release_notes`: UTF-8 정상 일치 확인
2. **Flutter 정적 분석 및 테스트 (버전 갱신 이후 재실행)**:
   - `flutter analyze`: **No issues found!** (`7.8s`)
   - `flutter test`: **37 passed** (`All tests passed!`)
3. **Python 릴리즈 API 테스트**:
   - `.\venv\Scripts\python.exe -m pytest tests/test_app_release.py -v`: **7 passed in 1.57s**
