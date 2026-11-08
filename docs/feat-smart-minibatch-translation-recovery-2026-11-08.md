# 번역 복구 엔진 스마트 미니배치 최적화 (2026-11-08)

## 1. 개요 및 배경
- **문제 현상**:
  - Gemini API(Flash-lite 등)가 긴 일본어 청크 번역 시 일시적인 언어 이탈(Language Drift) 환각을 일으켜 배치 전체(30~50문단)를 중국어(`paraphrased_zh`)로 출력하는 현상이 발생함.
  - 기존 백엔드 복구 엔진(`_recover_verbatim_items`)은 원래 1~2개 문장 복사(Verbatim) 구제용으로 작성되어, 오염된 문장이 40개 이상이어도 무조건 1문장씩 40~50회 연속 단일 API 호출을 수행함.
  - 이로 인해 일일 쿼터(RPD)가 급격히 소모되고, 60초 슬라이딩 윈도우 RPM이 14회(Red Zone)까지 치솟아 `proactive_rpm_rest`의 7~12초 강제 쿨다운이 걸려 번역 지연이 심화됨.
- **개선 목표**:
  - 대량 불량 발생 시 낱개로 쪼개지 않고 15개 단위 미니배치 재호출을 우선 수행하여 **API 호출 횟수를 90~95% 절감**하고, RPM 급등 및 쿨다운 지연을 원천 방어함.

---

## 2. 변경 내용 및 구현 세부사항

### 2.1 2단계 계층형 복구(Tiered Recovery Strategy) 도입 (`server/services/translation_recovery.py`)
- **Step 1: 스마트 미니배치 복구 (대량 불량 건: 4개 이상)**
  - `target_orig_items`가 4개 이상 감지되면 개별 분할을 즉시 억제하고 15개 단위 미니배치 청크로 분할.
  - 한국어 번역 지침을 강화한 미니배치 프롬프트 적용:
    ```text
    Translate the following JSON array from Japanese to natural Korean.
    CRITICAL REQUIREMENTS:
    1. You MUST translate into natural, fluent KOREAN (한국어). Do NOT output Chinese (中文/汉字) or Japanese (日本語).
    2. Translate each item independently and uniquely based only on its own text.
    3. Do NOT repeat or carry over translations from other items.
    4. Return ONLY a valid JSON array of objects with 'id' and 'translated':
    ```
  - `call_gemini_api` 1회 호출로 15개 문장을 일괄 수복하고, 기존의 괄호 복원(`restore_brackets`), 반복문자 처리(`process_repeated_chars`), 품질 분류(`classify_translation`)를 통과한 건을 즉시 결과 맵에 반영.
- **Step 2: 잔여 개별 문장 정밀 복구 (소량 불량 건: 1~3개)**
  - 미니배치 복구 후에도 미복구 잔여 문장이 있거나, 애초에 1~3개 소량이었던 경우에만 기존 단일 JSON 및 단일 일반 텍스트 재시도를 수행.

---

## 3. 검증 결과
- **효과 분석**:
  - 40개 문장 기준: 기존 40~80회 단일 호출 $\rightarrow$ 3회(15+15+10) 미니배치 호출로 **API 호출 횟수 93% 절감**.
  - RPM 슬라이딩 윈도우 수치 안정화 (Red Zone 12~14 RPM 진입 차단 $\rightarrow$ 0초 쿨다운 유지).
- **테스트 결과**:
  - `tests/test_verbatim_cleanup.py`의 `test_recover_verbatim_items_smart_minibatch` 신설 및 17건 전건 통과.
  - 관련 품질 및 괄호 복원 테스트(`tests/test_abnormal_other_language.py`, `tests/test_character_fixer.py`, `tests/test_restore_brackets.py`) 28건 전건 통과.
