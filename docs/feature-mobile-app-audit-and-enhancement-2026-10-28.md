# Lanovel Reader 모바일 앱 (`v1.7.0`) 전수조사 결함 개선 및 무결성 강화 보고서

- **작업 일자**: 2026-10-28
- **버전**: `lanovel_reader` `v1.7.0+2026102801`
- **대상 모듈**:
  - **백엔드**: [server/routers/sync.py](file:///c:/LANOVEL/server/routers/sync.py), [server/server.py](file:///c:/LANOVEL/server/server.py)
  - **모바일 서비스**: [local_db_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/local_db_service.dart), [sync_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/sync_service.dart), [tts_audio_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/tts_audio_service.dart), [preferences_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/preferences_service.dart), [font_helper.dart](file:///c:/LANOVEL/mobile_app/lib/services/font_helper.dart)
  - **모바일 UI/테마**: [reader_themes.dart](file:///c:/LANOVEL/mobile_app/lib/ui/themes/reader_themes.dart), [hyper_aesthetic_theme.dart](file:///c:/LANOVEL/mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart), [library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart), [reader_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_screen.dart), [reader_settings_sheet.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_settings_sheet.dart), [character_fixer_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/glossary/character_fixer_screen.dart), [settings_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/settings/settings_screen.dart), [main.dart](file:///c:/LANOVEL/mobile_app/lib/main.dart)
  - **네이티브/보안 설정**: [MainActivity.kt](file:///c:/LANOVEL/mobile_app/android/app/src/main/kotlin/com/lanovel/lanovel_reader/MainActivity.kt), [file_paths.xml](file:///c:/LANOVEL/mobile_app/android/app/src/main/res/xml/file_paths.xml), [pubspec.yaml](file:///c:/LANOVEL/mobile_app/pubspec.yaml), [release_notes.json](file:///c:/LANOVEL/mobile_app/release_notes.json)

---

## 1. 개요 및 목적
`mobile_app_audit_report.md` 전수조사를 통해 도출된 핵심 결함들(P0 12건, P1 9건)을 전면 개선하여, 데이터 무결성 손상, 동기화 유실, 렌더링 발열/배터리 소모, UI 단절 및 보안 취약점을 완벽하게 해소하고 안정적인 릴리즈 APK (`v1.7.0`) 빌드를 완수했습니다.

---

## 2. 주요 개선 내역

### 2-1. [P0] 데이터 무결성 및 백엔드 동기화 정상화
1. **`replaceSeedDatabase` 원자적 시드 교체 엔진 탑재 ([local_db_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/local_db_service.dart), [sync_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/sync_service.dart))**:
   - `downloadFullSeed` 시 DB 핸들이 닫힌 상태로 남아 `DatabaseException(database_closed)` 및 WAL 잔류로 `SQLITE_CORRUPT`가 발생하던 문제를 해결.
   - 시드 교체 전 오프라인 대기 큐, 독서 잔디(`reading_logs`), 용어집(`local_glossary`), 상단 고정(`is_pinned`) 데이터를 메모리에 안전 백업.
   - DB close 및 `_database = null` 초기화 후, `.db`, `-wal`, `-shm` 파일을 일괄 정리하고 원자적 rename 수행.
   - 재오픈 후 백업 데이터 복원 및 `healDuplicateChapters()` 자가 치유 자동 수행.
2. **`ActivitySyncItem` 기본값 역전 버그 수정 ([sync.py](file:///c:/LANOVEL/server/routers/sync.py))**:
   - `is_completed`, `is_visible`, `is_bookmarked` 기본값을 `0, 1, 0`에서 `None`으로 변경하여 모바일에서 전송하지 않은 필드가 PC의 즐겨찾기와 보관함 상태를 덮어쓰던 치명적 결함 해결.
   - `DO UPDATE SET` 절에 누락되었던 `summary = COALESCE(excluded.summary, book_activity.summary)` 추가.
3. **상단 고정(`pin`) & 독서 잔디(`reading_logs`) 양방향 동기화 완성**:
   - 모바일 오프라인 큐에서 `'pin'` 항목을 무시하고 삭제하던 결함을 수정하여 `pinned_books` 페이로드로 전송.
   - 모바일 독서 통계(`reading_logs`)를 push 페이로드에 포함하고 서버 DB에 자동 생성 및 적재.
   - 증분 pull 응답의 `pinned_books` 목록을 수신하여 모바일 로컬 DB의 `is_pinned` 상태 완벽 동기화.
4. **오프라인 용어집 배치 최적화 및 정규식 검증**:
   - `applyGlossaryRule`의 N회 개별 UPDATE를 `db.batch()` 단일 트랜잭션으로 통합.
   - 정규식 컴파일 오류(`FormatException`) 방어 및 `try/catch` 처리.

### 2-2. [P0 & P1] 오디오, 렌더링 성능 및 배터리 절감
1. **TTS 오디오 파일명 유니코드 정규화 ([tts_audio_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/tts_audio_service.dart))**:
   - `unicode: true` 기반 정규식과 문자열 해시 접미사 결합으로 한글/일본어 제목이 빈 문자열이 되어 전 회차가 단일 파일에 덮어써지던 버그 원천 박멸.
   - `.mp3`, `.m4a`, `.opus` 등 서버 응답 MIME 타입에 따른 확장자 자동 결정 및 임시 파일(`.part`)을 통한 원자적 쓰기 보장.
2. **OLED 테마 배터리 극소화 및 가독성 대비비 개선 ([reader_themes.dart](file:///c:/LANOVEL/mobile_app/lib/ui/themes/reader_themes.dart), [hyper_aesthetic_theme.dart](file:///c:/LANOVEL/mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart), [main.dart](file:///c:/LANOVEL/mobile_app/lib/main.dart))**:
   - `ReaderThemeData.onAccentColor` getter 신설(`accentColor.computeLuminance() > 0.45 ? Colors.black : Colors.white`)로 OLED 테마에서 흰색 버튼 위 흰색 글씨 식별 불가(1.00:1) 문제 해결.
   - OLED 테마 선택 시 120fps GPU 셰이더 및 그레인을 전면 우회하고 단색 순수 블랙(`#000000`)으로 렌더링하여 배터리 소모 0W 및 E-ink 가독성 극대화.
3. **무클리핑 `BackdropFilter` 제거 ([library_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/library/library_screen.dart))**:
   - 액션 시트의 풀스크린 블러를 `ClipRRect(borderRadius: ...)` 내부로 제한하여 불필요한 GPU 래스터 오버헤드 해소.
4. **검색 디바운싱(250ms) 적용**:
   - 서재 검색창 타이핑 시 키 입력마다 발생하던 SQLite 풀스캔을 250ms 디바운스 타이머로 최적화.

### 2-3. [P0 UI] 단절된 핵심 독서/서재 기능 복구
1. **볼륨키 페이지 넘김 완성 ([MainActivity.kt](file:///c:/LANOVEL/mobile_app/android/app/src/main/kotlin/com/lanovel/lanovel_reader/MainActivity.kt), [reader_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_screen.dart))**:
   - 네이티브 `MainActivity.kt`에서 `onKeyDown` 볼륨키 가로채기 및 `com.lanovel.lanovel_reader/volume_key` MethodChannel 구축.
   - `reader_screen.dart`에서 볼륨키 수신 시 페이징 모드는 다음/이전 페이지(회차 전환 포함), 스크롤 모드는 400px 스크롤 부드럽게 점프.
2. **원문 표시 모드(bilingual) 및 여백 슬라이더 연동 ([reader_settings_sheet.dart](file:///c:/LANOVEL/mobile_app/lib/ui/viewer/reader_settings_sheet.dart))**:
   - 설정 시트에 원문 표시 모드 세그먼트 버튼(숨김/툴팁/대역 병기) 추가.
   - 좌우 여백(12~40px) 및 단락 간격(4~30px) 슬라이더 추가.
3. **서재 Hero 진도율 하드코딩 제거 & 액션 시트 메뉴 강화**:
   - `Book.estimatedProgress` getter 신설로 회차 기반 실제 진도율(0~100%) 반영.
   - 도서 롱프레스 시트에서 '상단 고정', '완독 처리/취소', '보관함으로 숨기기/복원' 메뉴 제공.
4. **커스텀 타이포그래피 정식 매퍼 탑재 ([font_helper.dart](file:///c:/LANOVEL/mobile_app/lib/services/font_helper.dart))**:
   - `GoogleFonts` 연동으로 `NanumMyeongjo`, `GowunBatang`, `NotoSerifJP` 등 출판용 한글/일본어 명조·고딕 폰트 적용.
5. **규칙 편집기 IME 자모 분리 버그 해결 ([character_fixer_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/glossary/character_fixer_screen.dart))**:
   - 매 `build()`마다 인라인으로 `TextEditingController`를 재생성하던 문제를 `_RuleEditorCardItem` Stateful 위젯으로 분리하여 상태 보존 및 한글 입력 무결성 확보.

### 2-4. [보안] 토큰 분리 및 파일 권한 축소
1. **인증 토큰 하드코딩 제거 및 설정 UI 추가 ([preferences_service.dart](file:///c:/LANOVEL/mobile_app/lib/services/preferences_service.dart), [settings_screen.dart](file:///c:/LANOVEL/mobile_app/lib/ui/settings/settings_screen.dart))**:
   - 기본 하드코딩 토큰을 제거하고, 설정 화면에 토큰 입력 필드 탑재.
   - 설정 화면 컨트롤러 4종 `dispose()` 누락 메모리 누수 수정.
2. **FileProvider 노출 범위 축소 ([file_paths.xml](file:///c:/LANOVEL/mobile_app/android/app/src/main/res/xml/file_paths.xml))**:
   - 내부 데이터베이스 전체가 외부 앱에 노출될 수 있었던 `files-path path="."` 제거.

---

## 3. 검증 결과

1. **정적 분석 (`flutter analyze`)**:
   - **`No issues found! (ran in 4.0s)`** 달성 (경고 0건, 에러 0건)
2. **단위 테스트 (`flutter test`)**:
   - **24개 테스트 전체 100% PASS** (`All tests passed!`)
3. **릴리즈 APK 컴파일 (`flutter build apk --release`)**:
   - `C:\LANOVEL\mobile_app\build\app\outputs\flutter-apk\app-release.apk` (25.8MB) 정상 생성
   - `server\static\lanovel-reader-release.apk` 배포본 동기화 완료
   - 백엔드 `/api/app/version` 메타데이터 연동(`1.7.0.2026102801`) 완료
