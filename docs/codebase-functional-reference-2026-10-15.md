# LANOVEL 종합 코드베이스 기능 및 함수 레퍼런스 (Architectural & Functional Reference)

> **문서 목적**: AI 어시스턴트가 사용자 요구사항 및 구어체 지시를 입력받았을 때, 혼선이나 회귀(Regression) 없이 전체 아키텍처와 1:1 타깃 코드를 0초 만에 직관적으로 파악할 수 있도록 압축 정리한 단일 진실 공급원(SSOT) 기술 레퍼런스입니다.
> **최신 동기화 일자**: 2026-10-15 (특화 자연어 처리(NLP) 계층 및 전방위 성능 최적화: SudachiPy SplitMode.C 일본어 Lemma 추출, kiwipiepy 한국어 복합 체언/조사 분리 및 인명 받침 조사 자동 교정, RapidFuzz C++ SIMD 가속 difflib 대체, pyahocorasick 트라이 기반 대량 오독 스캔, selectolax C Lexbor 엔진 HTML 파서, FastAPI ORJSONResponse 전역 직렬화, Flutter TextDiffHelper O(N) 접두/접미 트리밍, Ruff/Biome/GitHub Actions 3축 CI/CD 파이프라인 전면 구축)

---

## ⚡ 빠른 탐색용 핵심 모듈 & 라우터 맵 (Fast Lookup)

| 구분 | 파일 경로 | 핵심 역할 및 주요 함수/클래스 |
| :--- | :--- | :--- |
| **데스크톱** | `main.py` | PyWebView 윈도우 + 시스템 트레이(`Pystray`) + 서버/셀러리 서브프로세스 수명주기 관리 |
| **설정/연결** | `server/settings.py` | Pydantic 환경변수 (.env), Gemini 모델(`gemini-3.5-flash-lite`), 포트(8001), CORS 허용 출처, 보안 토큰 해시 |
| **보안 코어** | `server/security.py` | PBKDF2-HMAC-SHA256 (10만 회 솔트 해시), `verify_token` 상수 시간 비교, `is_safe_external_url` SSRF 사설망 방어 |
| **DB 코어** | `server/database.py` | SQLite WAL 모드, `busy_timeout=5000`, `REGEXP` 함수 주입, SQLAlchemy 세션 제너레이터 |
| **코퍼스 DB** | `server/database_corpus.py` | `corpus_ai.db` SQLite 전용 커넥션 제너레이터, 템플릿/구문 정렬/어투 통계 테이블 관리 |
| **ORM 모델** | `server/models.py` | `Translation`, `BookActivity`(`is_visible` 포함), `NovelSeparatorSetting`, `TranslationTrash` 등 12개 테이블 |
| **RPM 관리** | `server/services/rpm_manager.py` | **2단계 슬라이딩 윈도우(API 60초 + 회차 5분)**, 최근 회차 가중 적응형 휴식([`proactive_rpm_rest`](file:///C:/LANOVEL/server/services/rpm_manager.py)), 세션 소켓 재생성, 회차 기반 가변 딜레이 계산([`calculate_episode_adaptive_delay`](file:///C:/LANOVEL/server/services/rpm_manager.py)) |
| **품질/복원** | `server/rule_classifier.py` | 100% 룰베이스 번역 품질 분류(규칙 1~4), 대사 괄호(`「%」`) 자동 복원([`restore_brackets`](file:///C:/LANOVEL/server/rule_classifier.py)) |
| **알림/현황판** | `server/notifications.py` | 배민 스타일 단일 번역 현황판([`update_translation_status`](file:///C:/LANOVEL/server/notifications.py)), Gemini API 오류 통계, 인메모리 버퍼 & SSE 스트림 |
| **서버 코어** | `server/server.py` | **15개 라우터 등록**, `default_response_class=ORJSONResponse` 초고속 직렬화, `lanovel_security_middleware` (루프백 100% 프리패스 + LAN 토큰 검증 + CSRF 차단), FTS5 가상테이블/트리거, 30분 괄호복원, 백업 |
| **번역 엔진** | `server/routers/translation.py` | Gemini 호출, 기본모델 verbatim 2단계 자체 복구([`_recover_verbatim_items`](file:///C:/LANOVEL/server/routers/translation.py)), 17시 안전 중단, **`GET /api/rpm_status`** |
| **데이터 CRUD** | `server/routers/data_crud.py` | FTS5 전문 검색, N+1 제거 upsert, 이상 번역 검출, 복원 센터 모달(휴지통/알림) |
| **사전/코퍼스** | `server/routers/dictionary.py` | **100% No-AI 사전 연동 및 누적 코퍼스 검색** (`GET /api/dictionary/lookup`, `GET /api/dictionary/links`, `GET /api/dictionary/word_breakdown`, `GET /api/dictionary/study_quiz`) |
| **사전 서비스** | `server/services/dictionary_service.py` | **SudachiPy(`SplitMode.C`) 일본어 Lemma 추출**, **kiwipiepy 한국어 복합 체언/조사 분리([`_extract_korean_nouns`](file:///C:/LANOVEL/server/services/dictionary_service.py))**, 네이버/Weblio/Jisho/Goo 사전 링크 생성, 34만+ 문장 코퍼스 검색, 빈도 등급 및 한국어 대응 표현 통계 |
| **코퍼스 AI** | `server/services/corpus_ai_service.py` | **RapidFuzz C++ 가속 문장 유사도 계산**, Sudachi 형태소 기반 구문 스티칭(Tier 2), 종결어미 어투 일관성 검사([`check_style_consistency`](file:///C:/LANOVEL/server/services/corpus_ai_service.py)) |
| **인명/교정기** | `server/routers/db_editor.py` | **pyahocorasick 트라이 오토마타 기반 O(N) 고속 오독 스캐너([`replace_misreadings_ahocorasick`](file:///C:/LANOVEL/server/routers/db_editor.py))**, **kiwipiepy 종성(받침) 판별 기반 조사 자동 교정([`fix_target_particles`](file:///C:/LANOVEL/server/routers/db_editor.py))** |
| **서재/책** | `server/routers/books.py` | 도서 숨김/표시, URL 번역 상태 배치 확인([`check_translated_urls`](file:///C:/LANOVEL/server/routers/books.py)), NovelUp+ 줄거리 크롤링, 회차 내 위치 복원 |
| **목차 파서** | `server/routers/toc_importer.py` | **selectolax Lexbor C 엔진 기반 초고속 파싱**, 카쿠요무(Apollo State Next.js), 소설가가 되자, NovelUp+ ([`fetch_all_novelup_chapters`](file:///C:/LANOVEL/server/routers/toc_importer.py)) 목차 수집 |
| **동기화** | `server/routers/sync.py` | 모바일 초고속 양방향 동기화: `/ping`, 하이브리드 zlib 압축 SQLite 시드 DB(`/full-pack`), `/pull`, `/push` |
| **앱 배포** | `server/routers/app_release.py` | 모바일 OTA 무선 자동 업데이트: `/api/app/version`, `/api/app/download`, 웹 랜딩 페이지(`/download`) |
| **구분선** | `server/routers/separators.py` | 후기/광고 번역 차단용 소설별 구분선 CRUD (공통 7종, 프리셋 6종) |
| **크롬 확장** | `extension/content.js` | **최근 번역 회차 연동 적응형 RPM 스로틀링(8초~55초 가변 대기)**, **키보드 내비게이션(`[`/`]`, `H`/`L`, `O`/`T`, `N`)**, **미니멀 HUD**, **목차 번역 배지 & 미번역 퀵 점프 패널**, **다음화 자동 번역 연동** |
| **모바일 앱** | `mobile_app/lib/` | **v1.5.0 하이퍼 에스테틱 Luminary UI**, **고속 접두/접미 트리밍 TextDiffHelper ([`text_diff_helper.dart`](file:///C:/LANOVEL/mobile_app/lib/services/text_diff_helper.dart))**, Sqflite 하이브리드 압축 DB, 루비/방점 렌더러 |
| **웹 프론트** | `server/static/` | `viewer.js` (3D 닉시관 인디케이터, 사전 & 용례 학습 패널), `library.js` (증기 차분기관 톱니/배관/압력계 대시보드), `admin.js` |
| **품질 검증** | `scripts/check_all.ps1` | **Ruff (Python) + Biome (Extension) + Pytest (Core) 3축 로컬 검증 스크립트** |
| **CI 파이프라인** | `.github/workflows/ci-pipeline.yml` | GitHub Actions 기반 Python, Extension, Flutter 3개 컴포넌트 린트 및 테스트 자동화 |

---

## 1. 시스템 전체 아키텍처 및 데이터 흐름

```
[ 웹소설 플랫폼 (Kakuyomu / Syosetu / NovelUp+ / Hameln) ]
           ▲
           │ DOM 파싱 (selectolax C 엔진 연동 크롤링, p/l 태그, 구분선 감지, 다음 화 '次へ' 자동 이동)
           │ 스마트 키보드 내비게이션 (]/L 다음화+자동번역, [/H 이전화, O/T 목차, N 미번역 퀵점프)
           ▼
[ 크롬 확장 프로그램 (extension) - Biome Linted ]
   - content.js: 적응형 회차별 지연시간(8~55s), 묶음 완충(2~4.5s), 키보드 내비게이션, HUD 플로팅 배지, 목차 상태 배지/미번역 퀵점프 패널, 쾌속모드
   - background.js: API 중계, 토큰 인증, 에러 로깅
           │ HTTP (POST /translate, GET /api/rpm_status, POST /api/check_translated_urls, GET /api/dictionary/lookup)
           ▼
[ FastAPI 백엔드 서버 (server:app, Port: 8001, ORJSONResponse) - Ruff Linted ]
   - translation.py        ──▶ [ Google Gemini API ] (gemini-3.5-flash-lite / gemini-3.8-flash)
   - rpm_manager.py        ──▶ [ API 60초 + 회차 5분 2단계 슬라이딩 윈도우 & 선제적 쿨다운 휴식 ]
   - dictionary_service.py ──▶ [ SudachiPy & kiwipiepy 형태소 분석기 ] (100% No-AI, 사전 링크 & 복합명사 추출)
   - corpus_ai_service.py  ──▶ [ RapidFuzz C++ 가속 템플릿 매칭 & corpus_ai.db ]
   - db_editor.py          ──▶ [ pyahocorasick 트라이 기반 O(N) 고유명사/오독 스캐너 & 받침 조사 자동 보정 ]
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
      - library.html / library.css: 증기 차분기관(구리 배관, 기어 클러스터, 5구 황동 압력계 게이지, 펀치카드 도서 목록)
      - viewer.html / viewer.css: 3D 진공관 닉시관(Nixie Tube) 오렌지 네온 회차 & 인디케이터
      - viewer.js: 📖 사전 & 누적 용례 학습 패널 (Shift+D/W), 단어 선택 플로팅 툴팁, 수동 수정 연동
   3. 모바일 독립 앱 (mobile_app/) - Flutter Analyzed:
      - text_diff_helper.dart: 고속 공통 접두/접미 토큰 트리밍 LCS 알고리즘 탑재
      - hyper_aesthetic_theme.dart: 유체 앰비언트 블러 메쉬 배경, 프로스티드 글래스모피즘, 햅틱 네온 캡슐
      - library_screen.dart: 플로팅 글래스 네비게이션 아일랜드 독, Hero 쇼케이스 덱, 3D 프리즘 북 카드
      - reader_screen.dart: 플로팅 에어-글래스 다이내믹 아일랜드 헤더, 네온 프로그레스 레이 컨트롤 독
      - SimilarTranslationsPanel: 상단 사전 연동 칩 ([네이버 ↗], [Weblio ↗], [Jisho ↗]) 탑재
      - SentenceEditPage: 원문 상단 [사전 연동 & 용례] 버튼 및 단어 선택 툴바 [📖 사전 연동]
```

---

## 2. 사용자 지시 및 발화-코드 1:1 매핑 사전 (Intent Routing Dictionary)

| 사용자 발화 / 요청 예시 | 연관 파일 및 핵심 함수 | 핵심 처리 내용 |
| :--- | :--- | :--- |
| **"일본어 동사 활용형 때문에 사전 링크가 안 열려" / "殺された에서 殺す로 사전 찾아줘" / "단어장 퀴즈 분해가 이상해"** | `server/services/dictionary_service.py` (`tokenize_japanese_sentence`, `_get_sudachi_tokenizer`) | Rust 기반 고속 SudachiPy(SplitMode.C)를 적용하여 모든 동사/형용사 활용형을 사전 기본형(Lemma)으로 정규화하고 접미사를 병합하여 포털 사전 링크 및 코퍼스 빈출 번역어 매칭 정확도 극대화. |
| **"인명 바꾸니까 조사가 어색해" / "유우는 -> 용사는, 엘프를 -> 오크를 처럼 받침에 맞게 조사 바꿔줘"** | `server/routers/db_editor.py` (`fix_target_particles`)<br>`server/services/dictionary_service.py` (`_get_kiwi`, `_extract_korean_nouns`) | kiwipiepy 한국어 형태소 분석기를 활용해 변경 대상 단어 끝 글자의 종성(받침) 유무를 판별하고, 뒤따르는 조사(`은/는`, `이/가`, `을/를`, `과/와`)를 문맥에 맞게 실시간 자동 교정. |
| **"인명 교정기 스캔이 너무 느려" / "오독 규칙이 수백 개인데 빠르게 찾아줘"** | `server/routers/db_editor.py` (`replace_misreadings_ahocorasick`) | 트라이(Trie) 기반 pyahocorasick 오토마타를 구축하여 규칙 수와 무관하게 본문을 단 한 번만 훑는 $O(N)$ 단일 패스로 모든 인명/오독 후보를 고속 치환. |
| **"코퍼스 검색이랑 유사도 비교 빠르게 해줘" / "문장 추천이 버벅여"** | `server/services/corpus_ai_service.py` (`synthesize_translation`, `check_style_consistency`) | 순수 파이썬 $O(N^2)$ `difflib.SequenceMatcher`를 C++ SIMD 가속 RapidFuzz(`rapidfuzz.fuzz.ratio`)로 전면 교체하여 100개 이상의 후보군도 1~2ms 안에 고속 비교. |
| **"크롤링이나 목차 수집할 때 파싱 빠르게 해줘" / "BeautifulSoup 말고 가벼운 걸로 바꿔줘"** | `server/routers/unclassified.py`<br>`server/routers/toc_importer.py`<br>`scripts/novel_inspector/fetch_novel.py` | C 기반 Lexbor 엔진 바인딩인 `selectolax.lexbor.LexborHTMLParser`로 전면 교체하여 CSS 셀렉터 문법을 유지하며 HTML 파싱 속도 10~20배 단축. |
| **"모바일에서 변경 전후 비교할 때 화면이 버벅여" / "긴 문단 수정창 띄울 때 멈춰"** | `mobile_app/lib/services/text_diff_helper.dart` (`computeDiff`) | 2차원 DP 테이블 생성 전 앞뒤 동일한 공통 접두사/접미사 토큰을 선제적으로 잘라내는 $O(N)$ 패스트 패스를 도입하여 행렬 크기를 99% 이상 압축. |
| **"코드 검사 한 번에 돌려줘" / "린트랑 테스트 통과하는지 확인해줘"** | `scripts/check_all.ps1`<br>`.github/workflows/ci-pipeline.yml` | Ruff (Python), Biome (Extension JS), Flutter analyze/test, Pytest를 통합 검증하는 스크립트 및 CI 파이프라인 가동. |
| **"모바일 서재 느낌 확실히 나게 해줘" / "모바일 전용 고유 UI 만들어줘"** | `mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart`<br>`mobile_app/lib/ui/library/library_screen.dart`<br>`mobile_app/lib/ui/viewer/reader_screen.dart` | 유체 앰비언트 블러 메쉬 배경, 플로팅 글래스 네비게이션 아일랜드 독, Hero 쇼케이스 덱, 뷰어 다이내믹 아일랜드 헤더 및 네온 프로그레스 레이 컨트롤 독. |
| **"최근 소설이 분당 번역수가 늘어나서 rpm제한에 걸려" / "최근 번역한 회차가 많으면 지연시간 늘려줘"** | `extension/content.js` (`recordRecentEpisode`, `calculateAdaptiveEpisodeDelay`)<br>`server/services/rpm_manager.py` (`proactive_rpm_rest`) | 최근 5분간 번역된 회차 수를 실시간 추적하여 다음 화 이동 대기시간을 8초에서 최대 55초까지 계단식으로 조절하고 서버 측 선제적 쿨다운 휴식 가동. |
| **"키보드로 다음화 넘어가게 해줘" / "소설 읽다가 다음화로 바로 번역되게 해줘"** | `extension/content.js` (`setupLanovelKeyboardNavigation`) | `]` 또는 `L` 누르면 다음 화로 이동 후 새 페이지 로드 즉시 자동 번역 시작 + 플로팅 HUD 안내. |
| **"목차에서 안 읽은(미번역) 화만 골라서 보고 싶어"** | `extension/content.js` (`initTocPageFeatures`, `renderQuickJumpPanel`)<br>`server/routers/books.py` (`check_translated_urls`) | 목차 페이지 감지 시 에피소드 링크별 번역 여부 배지 부착 및 우측 하단 `[⚡ 미번역 N화]` 퀵 점프 패널 제공. |

---

## 3. 🛡️ 보안 아키텍처 및 세션별 온/오프(Bypass) 가이드

* **전체 상세 레퍼런스 문서:** [`docs/SECURITY_SYSTEM_REFERENCE.md`](file:///C:/LANOVEL/docs/SECURITY_SYSTEM_REFERENCE.md)
* **보안 요약:**
  1. **로컬 루프백 100% 프리패스 (`127.0.0.1`, `localhost`):** PC 브라우저, 크롬 확장, 개발 테스트는 토큰 없이 작동.
  2. **브라우저 Cross-Origin CSRF 차단:** 악성 외부 사이트에서 로컬 서버로 들어오는 요청 차단 (`403 Forbidden`).
  3. **외부 LAN 기기 토큰 검증:** 스마트폰 등 외부 기기는 `X-Lanovel-Key` 검증 (`server/server.py`).
  4. **단방향 솔트 해시 보관:** `.env`에 `LANOVEL_AUTH_HASH` (PBKDF2-HMAC-SHA256 100,000회)로 보관.
* **다른 개발 세션에서 보안 해제(Bypass) 필요 시:**
  * `.env` 파일에서 `LANOVEL_AUTH_HASH=""` 및 `REMOTE_TOKEN=""` 으로 비우기만 하면 즉시 모든 API가 완전 무인증 프리패스로 전환됩니다.
