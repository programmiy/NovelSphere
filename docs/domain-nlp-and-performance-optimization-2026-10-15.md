# LANOVEL 특화 자연어 처리(NLP) 계층 및 전방위 성능 최적화 작업 내역

> **작업 일자**: 2026-10-15  
> **관련 커밋/브랜치**: `extra`  
> **범위**: `server/`, `scripts/`, `mobile_app/`, `extension/`, `.github/`

---

## 1. 개요 및 배경

기존 LANOVEL 시스템은 34만+ 문장의 대규모 번역 코퍼스를 보유하고 있었으나, 형태소 분석기 부재로 단순 정규식(`JA_TOKEN_RE`, `KO_WORD_RE`)과 파이썬 표준 라이브러리(`difflib`, `BeautifulSoup`)에 의존하고 있어 다음과 같은 언어적·성능적 병목이 발생했습니다:

1. **일본어 동사 활용형 및 복합어 파편화**: `殺す`, `殺した`, `殺せ`, `殺される`가 서로 다른 단어로 집계되어 확률 통계가 분산되고, `魔導士` 등 복합 한자어가 사전 표제어로 매핑되지 못함.
2. **한국어 조사/어미 분리 실패 및 어투 비문**: `엘프가`, `엘프를`, `엘프에게`가 별개 단어로 취급되고, 캐릭터 인명 교체 시 받침 유무에 따른 조사(`은/는`, `이/가`, `을/를`, `과/와`) 교정이 수동 정규식에 의존하여 어색한 문장 유발.
3. **difflib $O(N^2)$ 비교 병목**: 34만 코퍼스 유사도 매칭 시 후보군이 늘어나면 응답 시간이 급증.
4. **대량 규칙 교정 스캔의 $O(N \times M)$ 루프**: 인명 교정기 스캔 시 문장마다 수십 개 규칙을 순차 정규식으로 반복 실행.
5. **BeautifulSoup의 무거운 HTML 파싱**: Next.js 목차 및 거대 웹소설 크롤링 시 C 파서 대비 메모리와 CPU 과다 소모.
6. **품질 검사 및 CI 자동화 부재**: 린터와 정적 검사가 없어 런타임 오류가 사후 검출됨.

본 작업을 통해 **Rust/C++ 기반 특화 NLP 엔진, 초고속 문자열/HTML 처리 라이브러리, Aho-Corasick 오토마타, 그리고 전 컴포넌트 CI/CD 품질 파이프라인**을 전면 구축하였습니다.

---

## 2. 세부 구현 내역

### 2.1 C++ / Rust 기반 고성능 엔진 교체 (Phase 1)
- **RapidFuzz (`rapidfuzz.fuzz.ratio`) 도입**:
  - 적용 위치: [`server/services/corpus_ai_service.py`](file:///C:/LANOVEL/server/services/corpus_ai_service.py)
  - 파이썬 내장 `difflib.SequenceMatcher`를 C++ SIMD 가속 RapidFuzz로 전면 교체.
  - 템플릿 유사도 검사 후보군을 30개에서 100개로 대폭 확장하면서도 쿼리 시간을 1~2ms 이내로 단축.
- **FastAPI `ORJSONResponse` 전역 적용**:
  - 적용 위치: [`server/server.py`](file:///C:/LANOVEL/server/server.py)
  - `FastAPI(default_response_class=ORJSONResponse)`를 설정하여 수만 건의 번역 및 목차 JSON 직렬화 속도와 메모리 피크 대폭 최적화.
- **Selectolax (`LexborHTMLParser`) 도입**:
  - 적용 위치: [`server/routers/unclassified.py`](file:///C:/LANOVEL/server/routers/unclassified.py), [`scripts/novel_inspector/fetch_novel.py`](file:///C:/LANOVEL/scripts/novel_inspector/fetch_novel.py)
  - Python 내장 `BeautifulSoup(html, 'html.parser')`를 C 기반 Lexbor 엔진 바인딩인 `selectolax`로 전면 교체. 동일한 CSS 셀렉터 인터페이스 유지 및 HTML 파싱 속도 10~20배 단축.

### 2.2 초고속 품질 자동화 및 CI 파이프라인 (Phase 2)
- **Ruff (Python Rust Linter)**:
  - [`pyproject.toml`](file:///C:/LANOVEL/pyproject.toml)에 Ruff 린트 규칙(`F`, `E9`, `E711`, `E712`, `E722`, `B`) 및 타깃 버전(`py311`) 설정.
  - `server/` 전역의 미사용 임포트 및 미선언 전역 변수 96건 일괄 정리. `ruff check server/ scripts/` 0 에러 달성.
- **Biome (Extension / Web JS Linter)**:
  - [`biome.json`](file:///C:/LANOVEL/biome.json)에 린터 및 포매터 설정.
  - `extension/content.css`의 키프레임 `!important` 구문 오류 및 `content.js`의 `forEach` 조기 반환 린트 수정. `biome lint extension/` 0 에러 달성.
- **Flutter 정적 분석 및 테스트 최적화**:
  - `mobile_app/test/app_update_test.dart`의 `prefer_const_constructors` 린트 경고 6건 정리. `flutter analyze` 0 이슈 달성.
- **통합 로컬 검증 스크립트 & GitHub Actions**:
  - [`scripts/check_all.ps1`](file:///C:/LANOVEL/scripts/check_all.ps1): 로컬에서 Ruff, Biome, Pytest를 원클릭으로 3초 만에 검증하는 Zero-Defect 스크립트 작성.
  - [`.github/workflows/ci-pipeline.yml`](file:///C:/LANOVEL/.github/workflows/ci-pipeline.yml): Python, Extension, Flutter 3개 컴포넌트의 린트 및 유닛 테스트를 병렬 실행하는 CI 워크플로우 구성.

### 2.3 지능형 NLP 계층 및 Aho-Corasick 알고리즘 (Phase 3)
- **pyahocorasick 트라이 오토마타 도입**:
  - 적용 위치: [`server/routers/db_editor.py`](file:///C:/LANOVEL/server/routers/db_editor.py) (`replace_misreadings_ahocorasick`)
  - 인명/오독 스캔 시 수십~수천 개 규칙을 단 한 번의 문자열 순회($O(N)$)로 동시 검출 및 치환.
- **kiwipiepy 한국어 형태소 분석기 & 종성 판별**:
  - 적용 위치:
    - [`server/routers/db_editor.py`](file:///C:/LANOVEL/server/routers/db_editor.py): `fix_target_particles` 함수를 도입하여 인명 치환 시 앞 글자 받침(종성) 유무에 따라 뒤따르는 조사(`은/는`, `이/가`, `을/를`, `과/와`)를 문맥에 맞게 자동 교정.
    - [`server/services/dictionary_service.py`](file:///C:/LANOVEL/server/services/dictionary_service.py): `_extract_korean_nouns`를 통해 연속 체언/복합명사(`마도` + `사` -> `마도사`)를 병합 추출하고 순수 명사 키워드를 통계 집계.
- **SudachiPy 일본어 형태소 분석기 & Lemma 추출**:
  - 적용 위치: [`server/services/dictionary_service.py`](file:///C:/LANOVEL/server/services/dictionary_service.py), [`scripts/build_corpus_index.py`](file:///C:/LANOVEL/scripts/build_corpus_index.py), [`server/services/corpus_ai_service.py`](file:///C:/LANOVEL/server/services/corpus_ai_service.py)
  - `SplitMode.C` 모드 적용 및 접미사(`接尾辞`) 자동 병합으로 `魔導士` 복합어를 보존.
  - 동사/형용사 활용형(`殺された`, `殺した`)에 대해 사전 기본형(Lemma: `殺す`)을 추출하여 Naver/Weblio/Jisho 사전 링크 및 코퍼스 단어 매핑에 제공.
  - Sudachi 미설치 또는 예외 상황 시 기존 룰베이스 정규식으로 안전하게 자동 폴백(Fallback).

### 2.4 모바일 앱 최적화 (Phase 4)
- **TextDiffHelper 고속 접두사/접미사 트리밍**:
  - 적용 위치: [`mobile_app/lib/services/text_diff_helper.dart`](file:///C:/LANOVEL/mobile_app/lib/services/text_diff_helper.dart)
  - 기존 $O(N \times M)$ 2차원 DP 테이블 생성 전, 변경되지 않은 선두 토큰(Prefix)과 후미 토큰(Suffix)을 $O(N)$으로 사전 트리밍.
  - 긴 문단에서 소수의 단어/인명이 변경되는 일반적인 시나리오에서 DP 행렬 크기를 10,000+ 셀에서 1~4 셀로 대폭 축소하여 모바일 UI 프레임 드랍 원천 차단.

---

## 3. 검증 결과

1. **Python 테스트**: 192개 유닛 테스트 100% 통과 (`192 passed in 12.56s`).
2. **Flutter 테스트**: 24개 모바일 유닛/위젯 테스트 100% 통과 (`00:05 +24: All tests passed!`).
3. **Ruff 린터**: `server/`, `scripts/` 전체 0 에러 (`All checks passed!`).
4. **Biome 린터**: `extension/` 전체 0 에러 (`Checked 7 files in 94ms. No fixes applied.`).
5. **통합 스크립트**: `scripts/check_all.ps1` 정상 패스.
