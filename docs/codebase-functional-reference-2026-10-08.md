# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트가 사용자 요구사항 및 구어체 지시를 입력받았을 때, 혼선이나 회귀(Regression) 없이 전체 아키텍처와 1:1 타깃 코드를 0초 만에 직관적으로 파악할 수 있도록 압축 정리한 단일 진실 공급원(SSOT) 기술 레퍼런스입니다.
> **최신 동기화 일자**: 2026-10-08 (최근 번역 회차 연동 적응형 RPM 방어 시스템, 쾌속/일반 모드 가변 지연시간 & 묶음 완충, 서버 회차 슬라이딩 윈도우 선제 휴식, GET /api/rpm_status 모니터링, 사전 연동 및 34만 누적 번역 코퍼스 학습/교정 엔진, 웹 뷰어 사전·용례 패널 & 단어 선택 플로팅 툴팁, 모바일 사전 퀵점프 및 수동 교정 바텀시트 연동, 브라우저 확장 스마트 내비게이션, OTA 무선 업데이트)

---

## ⚡ 빠른 탐색용 핵심 모듈 & 라우터 맵 (Fast Lookup)

| 구분 | 파일 경로 | 핵심 역할 및 주요 함수/클래스 |
| :--- | :--- | :--- |
| **데스크톱** | `main.py` | PyWebView 윈도우 + 시스템 트레이(`Pystray`) + 서버/셀러리 서브프로세스 수명주기 관리 |
| **설정/연결** | `server/settings.py` | Pydantic 환경변수 (.env), Gemini 모델(`gemini-3.5-flash-lite`), 포트(8001), CORS 허용 출처 |
| **DB 코어** | `server/database.py` | SQLite WAL 모드, `busy_timeout=5000`, `REGEXP` 함수 주입, SQLAlchemy 세션 제너레이터 |
| **ORM 모델** | `server/models.py` | `Translation`, `BookActivity`(`is_visible` 포함), `NovelSeparatorSetting`, `TranslationTrash` 등 12개 테이블 |
| **RPM 관리** | `server/services/rpm_manager.py` | **2단계 슬라이딩 윈도우(API 60초 + 회차 5분)**, 최근 회차 가중 적응형 휴식([`proactive_rpm_rest`](file:///C:/LANOVEL/server/services/rpm_manager.py)), 세션 소켓 재생성, 회차 기반 가변 딜레이 계산([`calculate_episode_adaptive_delay`](file:///C:/LANOVEL/server/services/rpm_manager.py)) |
| **품질/복원** | `server/rule_classifier.py` | 100% 룰베이스 번역 품질 분류(규칙 1~4), 대사 괄호(`「%」`) 자동 복원([`restore_brackets`](file:///C:/LANOVEL/server/rule_classifier.py)) |
| **알림/현황판** | `server/notifications.py` | 배민 스타일 단일 번역 현황판([`update_translation_status`](file:///C:/LANOVEL/server/notifications.py)), Gemini API 오류 통계, 인메모리 버퍼 & SSE 스트림 |
| **서버 코어** | `server/server.py` | **15개 라우터 등록**, FTS5 가상테이블/트리거, 30분 괄호복원 태스크, 24시간 온라인 백업, 캐시 버스팅 |
| **번역 엔진** | `server/routers/translation.py` | Gemini 호출, 기본모델 verbatim 2단계 자체 복구([`_recover_verbatim_items`](file:///C:/LANOVEL/server/routers/translation.py)), 17시 안전 중단, **`GET /api/rpm_status`** |
| **데이터 CRUD** | `server/routers/data_crud.py` | FTS5 전문 검색, N+1 제거 upsert, 이상 번역 검출, 복원 센터 모달(휴지통/알림) |
| **사전/코퍼스** | `server/routers/dictionary.py` | **100% No-AI 사전 연동 및 누적 코퍼스 검색** (`GET /api/dictionary/lookup`, `GET /api/dictionary/links`) |
| **사전 서비스** | `server/services/dictionary_service.py` | 네이버/Weblio/Jisho/Goo 사전 링크 생성, 34만+ 문장 코퍼스 검색, 빈도 등급 및 한국어 대응 표현 통계 |
| **서재/책** | `server/routers/books.py` | 도서 숨김/표시, URL 번역 상태 배치 확인([`check_translated_urls`](file:///C:/LANOVEL/server/routers/books.py)), NovelUp+ 줄거리 크롤링, 회차 내 위치 복원 |
| **목차 파서** | `server/routers/toc_importer.py` | 카쿠요무(Apollo State Next.js), 소설가가 되자, NovelUp+ ([`fetch_all_novelup_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)) 목차 수집 |
| **동기화** | `server/routers/sync.py` | 모바일 초고속 양방향 동기화: `/ping`, 하이브리드 zlib 압축 SQLite 시드 DB(`/full-pack`), `/pull`, `/push` |
| **앱 배포** | `server/routers/app_release.py` | 모바일 OTA 무선 자동 업데이트: `/api/app/version`, `/api/app/download`, 웹 랜딩 페이지(`/download`) |
| **구분선** | `server/routers/separators.py` | 후기/광고 번역 차단용 소설별 구분선 CRUD (공통 7종, 프리셋 6종) |
| **크롬 확장** | `extension/content.js` | **최근 번역 회차 연동 적응형 RPM 스로틀링(8초~55초 가변 대기)**, **키보드 내비게이션(`[`/`]`, `H`/`L`, `O`/`T`, `N`)**, **미니멀 HUD**, **목차 번역 배지 & 미번역 퀵 점프 패널**, **다음화 자동 번역 연동** |
| **모바일 앱** | `mobile_app/lib/` | Flutter 네이티브 리더 (Sqflite 하이브리드 압축 DB, **사전 연동 퀵 바텀시트**, **유사 번역 용례 탐색기**, 독립 단락 교정 화면, 루비/방점 렌더러) |
| **웹 프론트** | `server/static/` | `viewer.js` (**사전 & 용례 학습 패널**, 단어 드래그 플로팅 툴팁, 단락 수정 연동), `library.js`, `admin.js` (사전 연동) |

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 플랫폼 (Kakuyomu / Syosetu / NovelUp+ / Hameln) ]
           ▲
           │ DOM 파싱 (p/l 태그, 소설명 감지, 구분선 감지, 다음 화 '次へ' 자동 이동)
           │ 스마트 키보드 내비게이션 (]/L 다음화+자동번역, [/H 이전화, O/T 목차, N 미번역 퀵점프)
           ▼
[ 크롬 확장 프로그램 (extension) ]
   - content.js: 적응형 회차별 지연시간(8~55s), 묶음 완충(2~4.5s), 키보드 내비게이션, HUD 플로팅 배지, 목차 상태 배지/미번역 퀵점프 패널, 쾌속모드
   - background.js: API 중계, 토큰 인증, 에러 로깅
           │ HTTP (POST /translate, GET /api/rpm_status, POST /api/check_translated_urls, GET /api/dictionary/lookup)
           ▼
[ FastAPI 백엔드 서버 (server:app, Port: 8001) ]
   - translation.py        ──▶ [ Google Gemini API ] (gemini-3.5-flash-lite / gemini-3.8-flash)
   - rpm_manager.py        ──▶ [ API 60초 + 회차 5분 2단계 슬라이딩 윈도우 & 선제적 쿨다운 휴식 ]
   - dictionary.py         ──▶ [ dictionary_service.py ] (100% No-AI, 34만+ 누적 SQLite 코퍼스 & 포털 사전 연동)
   - data_crud.py          ──▶ [ SQLite DB (translations.db - WAL Mode) ]
   - books.py              ──▶ [ FTS5 가상 테이블 및 URL 번역 배치 확인 API ]
   - sync.py               ──▶ [ 하이브리드 zlib 압축 SQLite 시드 DB 생성 엔진 ]
   - app_release.py        ──▶ [ 모바일 APK 패키징 및 OTA 업데이트 배포 ]
   - notifications.py      ──▶ [ 인메모리 배민 스타일 단일 번역 현황판 & 로컬 SSE 브로드캐스트 ]
   - rule_classifier.py (100% 룰베이스 번역 품질 검증 및 대사 괄호 「%」 자동 복원)
           ▲
           │ Wi-Fi 로컬 네트워크 동기화 (HTTP Gzip/zlib) & OTA 무선 업데이트
           ▼
[ 클라이언트 생태계 (Desktop Web & Mobile Native) ]
   1. 데스크톱 앱 (main.py): PyWebView + Pystray 시스템 트레이
   2. 웹 프론트엔드 (static/):
      - viewer.js: 📖 사전 & 누적 용례 학습 패널 (Shift+D/W), 단어 선택 플로팅 툴팁, 수동 수정 연동 [이 표현 반영]
      - library.js: 숨김 필터
      - admin.js: 추천 패널 사전 연동 퀵링크 (네이버, Weblio, Jisho)
   3. 모바일 독립 앱 (mobile_app/): Flutter 기반 네이티브 리더 (Android / iOS)
      - SimilarTranslationsPanel: 상단 사전 연동 칩 ([네이버 ↗], [Weblio ↗], [Jisho ↗]) 탑재
      - SentenceEditPage: 원문 상단 [사전 연동 & 용례] 버튼 및 단어 선택 툴바 [📖 사전 연동] -> 로컬 DB 0ms 대조 및 원클릭 교정
```

---

## 2. 적응형 RPM 방어 및 회차 가변 지연 파이프라인 (Adaptive RPM Pipeline)

```
1. [회차 번역 완료 및 다음 화 이동 트리거]
   - 확장 프로그램: `recordRecentEpisode(cleanUrl)`로 최근 번역 회차 슬라이딩 윈도우에 타임스탬프 기록 (10분 만료)
   - `getRecentEpisodeCount(5)`로 최근 5분간 번역 완료된 고유 회차 수 실시간 산출
2. [적응형 지연시간 산출 (Adaptive Throttling)]
   - 0~2화: 8초 (안전 구간, 최대 처리량)
   - 3화: 15초 (주의 구간, RPM 누적 완화)
   - 4화: 22초 (경고 구간)
   - 5화: 30초 (과열 주의 구간)
   - 6화: 40초 (과열 위험 구간)
   - 7화 이상: 55초 (완전 쿨다운, 60초 슬라이딩 윈도우 리셋)
   - 묶음 간 대기시간도 최근 회차 4화 이상 시 2초 -> 3.0~4.5초로 미세 완충
3. [서버 측 2차 방어선 (rpm_manager.py)]
   - 번역 요청 진입 시 `record_episode_translation(url)`로 서버 측 슬라이딩 윈도우 동기화
   - `proactive_rpm_rest`: 최근 5분 번역 회차가 4화 이상이면 7 RPM부터 Yellow Zone(2.5~4.5s) 완충 휴식, 7화 이상이면 9 RPM부터 Red Zone(8.5~16.5s) 쿨다운 및 세션 소켓 재생성
4. [상태 모니터링]
   - `GET /api/rpm_status`: 현재 60초 RPM, 최근 5분 번역 회차 수, Zone(green/yellow/red), 권장 대기시간 제공
   - UI 사이드바 및 미니 HUD에 과열 방지 지연 사유 실시간 안내
```

---

## 3. 백엔드 핵심 모듈 명세

### `server/server.py` (라이프사이클 및 코어 서비스)
- **15개 라우터 등록**: `ui`, `translation`, `data_crud`, `books`, `system`, `tasks`, `admin`, `url_config`, `db_editor`, `toc_importer`, `separators`, `notifications`, `sync`, `app_release`, `unclassified`, `dictionary`.

### `server/services/rpm_manager.py` (적응형 RPM & 세션 관리 엔진)
- `record_episode_translation(url, novel_title)`: 회차별 번역 타임스탬프 기록 (30초 내 중복 방지).
- `get_recent_episode_count(window_seconds=300.0) -> int`: 최근 5분간 번역된 고유 회차 수 반환.
- `calculate_episode_adaptive_delay(recent_episodes, is_turbo=True) -> float`: 회차 수 비례 지연시간 계산.
- `proactive_rpm_rest(novel_title, episode_title, url)`: API 호출 직전 RPM과 최근 회차 빈도를 결합 분석하여 선제적 휴식 수행.

### `server/routers/translation.py` (번역 API 및 모니터링 엔드포인트)
- `POST /translate`: Gemini 번역 수행, 회차 번역 타임스탬프 자동 기록.
- `GET /api/rpm_status`: 현재 RPM, 최근 5분 번역 회차 수, 권장 대기시간 반환.

---

## 4. 사용자 지시 및 발화-코드 1:1 매핑 사전 (Intent Routing Dictionary)

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 처리 내용 |
| :--- | :--- | :--- |
| **"최근 소설이 분당 번역수가 늘어나서 rpm제한에 걸려" / "최근 번역한 회차가 많으면 지연시간 늘려줘" / "짧은 소설 연속 번역할 때 429 안 뜨게 해줘"** | `extension/content.js` (`recordRecentEpisode`, `getRecentEpisodeCount`, `calculateAdaptiveEpisodeDelay`, `calculateAdaptiveChunkDelay`)<br>`server/services/rpm_manager.py` (`record_episode_translation`, `get_recent_episode_count`, `proactive_rpm_rest`)<br>`server/routers/translation.py` (`GET /api/rpm_status`) | 최근 5분간 번역된 회차 수를 실시간 추적하여, 회차가 많을수록 다음 화 이동 대기시간을 8초에서 최대 55초까지 계단식으로 늘려 분당 호출 폭증을 완벽 차단. 서버에서도 회차 급증 시 선제적 쿨다운 휴식 가동. |
| **"지금까지 쌓인 데이터로 사전 연동해줘" / "단어 사전이랑 예문 찾아줘" / "공부용으로 사전이랑 원문 예문 보게 해줘" / "수동으로 번역 수정할 때 사전 뜻이랑 다른 번역 예문 보게 해줘"** | `server/services/dictionary_service.py`<br>`server/routers/dictionary.py`<br>`server/static/viewer.js` (`openDictDrawer`, `executeDictSearch`)<br>`mobile_app/lib/ui/viewer/similar_translations_panel.dart`<br>`mobile_app/lib/ui/viewer/sentence_edit_page.dart` | 100% No-AI로 네이버/Weblio/Jisho 사전 연동 및 34만 누적 소설 DB 실시간 코퍼스 검색. 웹 뷰어 드로어 및 텍스트 선택 플로팅 툴팁, 수동 수정 모드 [이 표현 반영], 모바일 앱 바텀시트 연동. |
| **"원문 드래그해서 다른 데선 어떻게 번역됐는지 보고 싶어" / "유사 번역 용례 찾아줘" / "다른 곳에선 어떻게 번역했나 띄워줘"** | `mobile_app/lib/ui/viewer/similar_translations_panel.dart`<br>`mobile_app/lib/ui/viewer/quick_edit_dialog.dart`<br>`mobile_app/lib/services/local_db_service.dart` (`searchSimilarTranslations`) | 뷰어 상단 검색 및 교정 다이얼로그 원문 드래그 시 하단 슬라이딩 미니 패널 호출. 로컬 SQLite zlib 역색인 0ms 검색 + PC 서버 하이브리드 병합, 카드 내 단어 선택 시 꼬리를 무는 연쇄 탐색 지원. |
| **"키보드로 다음화 넘어가게 해줘" / "소설 읽다가 다음화로 바로 번역되게 해줘"** | `extension/content.js` (`setupLanovelKeyboardNavigation`, `checkAutoTranslateNextTrigger`)<br>`extension/content.css` (`#lanovel-hud`) | `]` 또는 `L` 누르면 세션 플래그 설정 후 다음 화로 이동 -> 새 페이지 로드 즉시 자동 번역 시작 + 플로팅 HUD 안내. |
| **"목차에서 안 읽은(미번역) 화만 골라서 보고 싶어" / "목차에 번역됐는지 표시해줘"** | `extension/content.js` (`initTocPageFeatures`, `renderQuickJumpPanel`)<br>`server/routers/books.py` (`check_translated_urls`) | 목차 페이지 감지 시 에피소드 링크별 번역 여부 배지 부착, 우측 하단 `[⚡ 미번역 N화]` 퀵 점프 드로어 제공, `N`키 순차 탐색 및 `Enter` 진입. |
| **"번역문에 루비/방점 나오게 해줘" / "단어 위에 점/루비 표시해줘"** | `mobile_app/lib/ui/viewer/novel_ruby_text.dart`<br>`mobile_app/lib/ui/viewer/reader_screen.dart` | `NovelRubyParser`로 `글(・)` 방점 및 `단어《루비》` 패턴 자동 감지 -> O(1) 필터링 후 `NovelRubyText` 위젯으로 출판사급 상단 첨자 렌더링. |
| **"스마트폰 독립 앱으로 보고 싶어" / "모바일 앱 동기화해줘"** | `server/routers/sync.py`<br>`mobile_app/lib/services/sync_service.dart`<br>`mobile_app/lib/services/local_db_service.dart` | 하이브리드 zlib 압축 SQLite 시드 DB를 Gzip 스트리밍 다운로드. 1ms 챕터 압축 해제 및 양방향 증분 pull/push. |
| **"모바일 앱 업데이트 어떻게 해?" / "새 버전 앱 깔아줘" / "-BuildApk 쓰면 알아서 무설치 업데이트해줘"** | `scripts/setup_mobile.ps1`<br>`server/routers/app_release.py`<br>`mobile_app/lib/services/app_update_service.dart` | `-BuildApk` 완료 즉시 ADB 직배포, Wi-Fi 접속 기기에는 안드로이드 시스템 설치 팝업 없는 100% 무인 무설치 자동 교체. |
| **"푸시 알림 너무 많이 와" / "배민처럼 하나로 합쳐줘" / "상단바에 진행바 띄워줘"** | `server/notifications.py` (`TranslationStatusBoard`)<br>`mobile_app/lib/services/local_notification_service.dart` | 고정 ID(9001) 단일 번역 현황판 알림으로 진행률/에러 통계 실시간 갱신. 삼성 Now Bar/잠금화면 호환 및 3분 유휴 자동 해제. |
| **"노벨업 플러스 번역해줘" / "novelup.plus 지원해줘"** | `server/routers/toc_importer.py` (`fetch_all_novelup_chapters`)<br>`extension/content.js`<br>`server/settings.py` | NovelUp+ 목차 파싱, 줄거리 크롤링(`.novel_synopsis`), 뷰어 본문 치환 및 다음 화 자동 이동 전면 지원. |
| **"원문 복붙된 것들 다 지워줘" / "일본어가 그대로 번역이라고 나와"** | `server/routers/translation.py` (`_recover_verbatim_items`, `handle_verbatim_cleanup_items`)<br>`server/rule_classifier.py` (`is_verbatim_copy`) | 기본 모델(gemini-3.5-flash-lite)로 단일 JSON 및 순수 텍스트 2단계 자체 복구. 화살표(`->`) 분리 후 실패 항목만 격리. |
| **"다 읽은 책 숨기고 싶어" / "서재에서 책 안 보이게 해줘"** | `server/models.py` (`BookActivity.is_visible`)<br>`server/routers/books.py` (`update_book_visibility`, `get_folders`)<br>`server/static/library.js` | `is_visible` 필터링 및 서재 "숨긴 도서 표시" 토글 버튼 제공. |
| **"모바일에서 페이지 넘기려는데 자꾸 수정창이 떠"** | `server/static/viewer.js`<br>`mobile_app/lib/ui/viewer/reader_screen.dart` | 우측 넘김 터치와 편집 충돌 해결: 500ms 이상 **롱프레스(Long-press)** 시에만 수정 모달 오픈. |
| **"번역 중에 쾌속모드 켰는데 왜 안 빨라져?"** | `extension/content.js` (`translateAllPTags`) | 루프 순회마다 실시간으로 쾌속모드 플래그 체크하여 즉각 대기시간 동적 반영. |
| **"번역 끝나갈 때 빈칸 문장들이 남아있어"** | `extension/content.js`<br>`server/routers/translation.py` | 번역 직전 미번역 빈칸 문장들을 마지막 번역 꾸러미에 자동 포함 및 보완 메커니즘 가동. |
| **"원문에 「 」 괄호가 있는데 번역문에 없어" / "대사 괄호 복원해줘"** | `server/rule_classifier.py` (`restore_brackets`, `batch_restore_brackets_in_db`)<br>`server/server.py` (`periodic_bracket_restoration_task`) | 원문이 `「%」`인 대사 문장에만 한정 적용. 30분 주기 백그라운드 자동 복구 및 실시간 적재 시 자동 복원. |
| **"구분선 밑으로 번역 안 되게 해줘" / "구분선 다음 단락들도 같이 제외해줘"** | `server/routers/separators.py`<br>`extension/content.js` (`checkAndExcludeSeparatorTranslations`) | 구분선 발견 시 첫 단락을 제외하고 후속 단락 전체를 일괄 제외 등록 및 DOM 정리. |
| **"뷰어에서 읽던 위치(진도)가 저장이 안 돼"** | `server/static/viewer.js`<br>`mobile_app/lib/ui/viewer/reader_screen.dart`<br>`server/routers/books.py` | 회차 내부 페이지/스크롤 위치를 정확히 저장 및 복원. |
| **"Gemini 모델 바꿔줘" / "재번역할 때 다른 모델 쓰게 해줘"** | `server/settings.py` (`gemini_default_model`, `gemini_retranslation_model`)<br>`server/routers/translation.py` | 일반 번역은 `gemini-3.5-flash-lite`, 단락 재번역은 `gemini-3.8-flash` 분기 사용. |
| **"책을 파일 하나로 저장해서 인터넷 없이 보고 싶어"** | `server/routers/books.py` (`export_book_as_html`) | CSS/JS와 소설 JSON 데이터를 인라인 결합한 단일 HTML 파일 내보내기. |
