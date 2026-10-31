# LANOVEL 모바일 릴리즈 & 빌드 워크플로우 상세 레퍼런스

## 1. 버전 체계 및 식별 원리

### 1-1. `pubspec.yaml`
```yaml
name: lanovel_reader
description: "LANOVEL 모바일 완전 독립 서재 앱 - 오프라인 퍼스트 & 양방향 압축 동기화 전자책 리더"
version: 1.7.2+2026103101
```
* **Semantic Version (`1.7.2`)**:
  * Major: 아키텍처 대격변 (1.x -> 2.x)
  * Minor: 신규 주요 기능 (예: 서재 정렬 추가, 리모컨 큐 탑재 등)
  * Patch: 버그 수정, 여백/UI 미세 조정 (예: 1.7.1 -> 1.7.2)
* **Build Number (`2026103101`)**:
  * 8자리 연월일(`YYYYMMDD`) + 2자리 일일 시퀀스(`01~99`)
  * Flutter 빌드 시 Android `versionCode`로 주입되어 시스템이 새 버전 여부를 단조 증가 숫자로 엄격하게 판정함.

---

## 2. 릴리즈 노트(`release_notes.json`) 연계 흐름

```
[ mobile_app/release_notes.json ]
               │
               ▼
[ server/routers/app_release.py ]
   - get_release_notes() -> release_notes.json 파싱
   - GET /api/app/version -> {"version": "1.7.2.2026103101", "release_notes": "...", ...}
   - GET /download -> 웹 랜딩 다운로드 페이지 릴리즈 카드 렌더링
               │
               ▼
[ mobile_app / Flutter UI ]
   - 설정 탭 > "최신 버전 확인" 버튼 및 백그라운드 OTA 체크
   - 새 버전 감지 시 업데이트 다이얼로그에 release_notes 텍스트 표시
```

---

## 3. 빌드 및 배포 파이프라인 (`setup_mobile.ps1 -BuildApk`)

```
1. 환경 설정 (D:\flutter\bin, D:\jdk-17, JAVA_HOME 세팅)
2. flutter pub get (패키지 의존성 무결성 점검)
3. flutter build apk --release (R8 ProGuard 최적화 및 AOT 네이티브 컴파일)
4. 산출물 동기화:
   build\app\outputs\flutter-apk\app-release.apk -> server\static\lanovel-reader-release.apk
5. ADB 직배포:
   연결된 USB/Wi-Fi Android 스마트폰 감지 시 `adb install -r` 실행 후 `MainActivity` 자동 실행
6. Wi-Fi 무선 배포:
   로컬 서버(포트 8001)에 POST /api/app/broadcast_update 호출 -> SSE 연결된 모바일 앱들에 자동 업데이트 팝업 트리거
```

---

## 4. 자주 발생하는 이슈 및 조치

* **`Gradle build failed` / Java 버전 불일치**:
  * LANOVEL 모바일은 JDK 17(`D:\jdk-17`)에 최적화되어 있습니다. 다른 JDK 환경변수가 우선되면 빌드 실패할 수 있으므로, 반드시 `setup_mobile.ps1` 또는 `bump_and_build.py`를 통해 빌드하십시오.
* **`server\static\lanovel-reader-release.apk` 파일 락 걸림**:
  * 서버가 클라이언트에 대용량 파일을 전송 중이거나 특정 프로세스가 잡고 있는 경우 복사 오류가 발생할 수 있습니다. 필요시 서버 프로세스를 잠시 재시작하거나 전송 완료 후 재시도하십시오.
