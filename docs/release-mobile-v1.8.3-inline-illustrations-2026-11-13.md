# 모바일 v1.8.3 인라인 삽화 릴리즈 빌드·OTA 배포 및 삽화 등록 검증 (2026-11-13)

## 1. 작업 개요 및 목적
1. 앞서 구축한 회차 본문 인라인 삽화 기능(`commit 383b953`)을 안드로이드 모바일/태블릿 앱에 반영하기 위해 `v1.8.3+2026111302` 공식 릴리즈 APK를 컴파일하고 Wi-Fi SSE 무설치 OTA 배포를 실행했습니다.
2. 재기동된 LANOVEL 백엔드(`http://127.0.0.1:8001`)에 『술 선배 동거 러브코미디』 1화·4화 생성 삽화 2건을 등록·검증한 뒤, 로컬 ComfyUI 이미지 생성 서버(`127.0.0.1:8188`)를 종료하여 GPU 메모리를 해제했습니다.

---

## 2. 세부 작업 내역

### 2-1. 『술 선배 동거 러브코미디』 삽화 등록 및 ComfyUI 서버 종료
- 등록 경로: `.agents/skills/novel-illustration/scripts/novel_scene_helper.py register-illustration --server http://127.0.0.1:8001` (`POST /api/illustrations`)
  - **ID `1` (1화 `同居の合図は親公認の挨拶から`)**: `after_pid="L10"`, 캡션 `"쿠레하 선배와의 첫 동거 권유 (1화)"`, `896×1152` PNG (`1,692,921 bytes`), 저장 경로 `server/data/illustrations/b_0cd6c76eba80/illu_1794557270_d6520749.png`
  - **ID `2` (4화 `お酒の勢いに身を任せ`)**: `after_pid="L91"`, 캡션 `"술기운 속 진지해진 쿠레하 선배 (4화)"`, `896×1152` PNG (`1,594,336 bytes`), 저장 경로 `server/data/illustrations/b_0cd6c76eba80/illu_1794557270_ba74ecbd.png`
- ComfyUI 데몬(`task-128`, `127.0.0.1:8188`) 종료: 포트 `8188` 닫힘(`connect_ex` `10035`) 및 GPU 메모리 해제(`RTX 2070 SUPER` `1260 MiB / 8192 MiB`) 확인.

### 2-2. 모바일 v1.8.3 버전 판올림, APK 빌드 및 OTA 배포
- [`mobile_app/pubspec.yaml`](../mobile_app/pubspec.yaml): `version: 1.8.2+2026111301` → `version: 1.8.3+2026111302`
- [`mobile_app/release_notes.json`](../mobile_app/release_notes.json): `"모바일 앱 v1.8.3: 회차 본문 인라인 삽화 뷰어(Scroll/Paging), 목차 삽화 배지(🖼️ N), 풀스크린 라이트박스 확대, 오프라인 삽화 캐싱 및 양방향 동기화 지원"`
- `.agents/skills/mobile-release-build/scripts/bump_and_build.py --version "1.8.3" --build` (`scripts/setup_mobile.ps1 -BuildApk`) 실행:
  - [`mobile_app/build/app/outputs/flutter-apk/app-release.apk`](../mobile_app/build/app/outputs/flutter-apk/app-release.apk): **27,455,882 bytes (26.18 MB)** 빌드 완료
  - `server/static/lanovel-reader-release.apk`: **27,455,882 bytes** 동기화 완료
  - Wi-Fi 연결 기기 대상 `POST http://localhost:8001/api/app/broadcast_update` 무설치 OTA 업데이트 신호 브로드캐스트 완료

---

## 3. 검증 결과
1. **라이브 OTA 엔드포인트 검증**:
   - `GET http://127.0.0.1:8001/api/app/version`: `200 OK`, `version="1.8.3.2026111302"`, `base_version="1.8.3"`, `build_number=2026111302`, `has_apk=true`, `file_size=27455882`
   - `GET http://127.0.0.1:8001/api/app/download`: `200 OK`, `Content-Type: application/vnd.android.package-archive`, `Content-Length: 27455882`, `PK\x03\x04` 시그니처 확인
2. **라이브 삽화 API 및 뷰어 경로 검증**:
   - `GET /api/illustrations?book_name=술%20선배%20동거%20러브코미디`: `200 OK`, 2건 반환 (`L10`, `L91`)
   - `GET /api/illustrations/1/image`, `/2/image`: `200 OK`, `image/png`, 바이트 일치 확인
   - `GET /api/books/술%20선배%20동거%20러브코미디/urls`: 1화·4화 `illustration_count=1` 확인
   - `server/translations.db` (`?mode=ro`): `novel_illustrations` 2건 확인
3. **Flutter 정적 분석 및 단위 테스트 (버전 갱신 이후 재실행)**:
   - `flutter analyze`: **No issues found!** (`22.9s`)
   - `flutter test`: **30/30 All tests passed!** (`app_update_test.dart`, `novel_illustration_test.dart` 등 포함)
4. **Python 단위 테스트**:
   - `pytest tests/test_app_release.py -v`: **7 passed in 1.50s** (`release_notes.json` 원문 보존 확인)
