# 모바일 앱 설정 및 찾아바꾸기 탭 하단 독 여백 확보 수정 및 v1.7.2 배포 보고서

- **작업 일자**: 2026-10-31
- **버전**: `lanovel_reader` `v1.7.2+2026103101`
- **대상 모듈**:
  - **모바일 설정 UI**: [settings_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/settings/settings_screen.dart)
  - **모바일 찾아바꾸기 UI**: [glossary_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/glossary/glossary_screen.dart)
  - **모바일 서재 메인 네비게이션**: [library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart)
  - **모바일 배포/버전**: [pubspec.yaml](file:///c:/LANOVEL/mobile_app/pubspec.yaml), [release_notes.json](file:///c:/LANOVEL/mobile_app/release_notes.json)

---

## 1. 개요 및 문제점
- **문제 현상**:
  - 모바일 앱의 메인 스캐폴드([library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart))는 하단 플로팅 글래스 네비게이션 독(서재 / 찾아바꾸기 / 설정, 약 100~110px 높이 점유)의 투명도 블러 효과를 살리기 위해 `extendBody: true`로 본문을 확장하여 렌더링함.
  - 이로 인해 [settings_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/settings/settings_screen.dart)의 본문 `ListView` 기본 패딩(`EdgeInsets.all(20)`) 상태에서는 최하단 섹션인 **"앱 버전 & 무설치 자동 업데이트 (In-App OTA)"** 카드의 **`[최신 버전 확인 및 무설치 자동 업데이트]`** 버튼이 하단 플로팅 네비게이션 바 뒤로 가려져 클릭이나 터치에 걸리는 현상 발생.
  - 2번째 탭인 [glossary_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/glossary/glossary_screen.dart)(찾아바꾸기) 역시 `SingleChildScrollView` 하단 패딩이 20px로 동일하여 최근 규칙 리스트의 최하단 항목이 독에 일부 간섭될 수 있는 잠재 이슈 확인.

---

## 2. 세부 조치 및 개선 내역

### 2-1. [설정 화면] 하단 플로팅 독 간섭 방지 패딩 적용
- **파일**: [settings_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/settings/settings_screen.dart) (Line 550 부근)
- **변경 사항**:
  - `ListView`의 패딩을 `const EdgeInsets.all(20)`에서 `const EdgeInsets.fromLTRB(20, 20, 20, 110)`으로 상향 조정.
  - 컨테이너 높이(64px) + 마진(12px) + 시스템 네비게이션 제스처 바 인셋(약 24~34px)을 온전히 포용하는 110px의 하단 세이프존을 확보하여, 스크롤을 끝까지 내렸을 때 OTA 업데이트 버튼이 플로팅 바 위로 여유 있게 온전히 노출되도록 개선.

### 2-2. [찾아바꾸기 화면] 탭 간 일관된 하단 여백 동기화
- **파일**: [glossary_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/glossary/glossary_screen.dart) (Line 127 부근)
- **변경 사항**:
  - `SingleChildScrollView`의 패딩을 `const EdgeInsets.all(20)`에서 `const EdgeInsets.fromLTRB(20, 20, 20, 110)`으로 통일.
  - 최근 찾아바꾸기 규칙 및 버튼 목록이 하단 독과 겹치는 현상을 원천 차단.

### 2-3. [버전 및 릴리즈 노트 갱신 & 릴리즈 빌드]
- **파일**: [pubspec.yaml](file:///c:/LANOVEL/mobile_app/pubspec.yaml), [release_notes.json](file:///c:/LANOVEL/mobile_app/release_notes.json)
- **버전 상향**: `v1.7.1+2026103001` -> `v1.7.2+2026103101`
- **릴리즈 노트 갱신**: In-App OTA 버튼 및 찾아바꾸기 탭 플로팅 독 110px 세이프존 확보 내용 반영.
- **배포 빌드**: `.\scripts\setup_mobile.ps1 -BuildApk`를 통해 릴리즈 APK 빌드 및 `server/static/lanovel-reader-release.apk` 동기화, 실시간 OTA 브로드캐스트 수행.

---

## 3. 검증 결과

1. **정적 분석 (`flutter analyze / dart analyze`)**:
   - `Analyzing settings_screen.dart, glossary_screen.dart...`
   - **`No issues found!`** (경고 및 에러 0건)
2. **단위 및 위젯 테스트 (`flutter test`)**:
   - **22개 테스트 전체 통과 (100% PASS)** (`All tests passed!`)
3. **APK 릴리즈 빌드 (`setup_mobile.ps1 -BuildApk`)**:
   - release APK 정상 컴파일 완료 및 `server/static/lanovel-reader-release.apk` 갱신
