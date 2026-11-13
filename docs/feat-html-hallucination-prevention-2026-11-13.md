# LLM HTML 태그 및 취소선 환각 방지·후처리 파이프라인 구축

## 1. 개요 및 배경
- **현상**: 번역문 중 일부 항목(`<span>「아……」</span>`, `<s>희롱해</s> 괴롭혀 온다.` 등)에 HTML/XML 태그와 LLM 자가 교정용 취소선 마크업이 그대로 저장됨.
- **원인 분석**:
  1. 크롬 확장 프로그램 스크래퍼는 입력 원문의 HTML을 제거하고 순수 텍스트만 전달했으나, 번역 엔진(`gemini-3.5-flash-lite` 등)이 간헐적으로 HTML 태그(`span`, `b`, `strong`, `p`, `em`, `div`, `td`) 및 취소선(`<s>...</s>`)을 환각(Hallucination)으로 생성함.
  2. 기존 시스템 지침(`TRANSLATION_SYSTEM_INSTRUCTION`)과 프롬프트에 HTML 태그·취소선 출력 금지 제약이 없었고, 후처리(`_post_process_translated_text`) 및 DB 저장(`upsert_translations`, `clean_ai_translation`, `special_batch`) 계층에도 HTML 태그 정제 로직이 부재했음.
  3. 특히 `server.rule_classifier.restore_brackets`는 기존 DB 호환을 위해 바깥 HTML 래퍼를 보존한 채 내부 괄호만 복원하므로, 후처리에서 HTML 태그를 먼저 제거하지 않으면 `<span>「...」</span>` 형태로 태그가 유지되는 구조였음.

## 2. 사전 DB 정비 (`translations.db` 읽기 검증)
- 관리자 `전체 찾아 바꾸기` 정규식 2단계 실행으로 본 DB `translations` 테이블 기존 오염 `171`건(1단계 `<s>` 취소선+구버전 오역 제거 `3`건, 2단계 `span|b|strong|p|em|div|td` 태그 제거 `168`건) 완전 정리 확인.
- 읽기 전용 전체 스캔 기준 `translations` 잔여 HTML 태그 `0`건, 소설 본문 일반 꺾쇠 표현(`<머리말>`, `(>_<)` 등 `230`건) 손상 `0`건 확인.

## 3. 다층 방어 및 구현 내용
1. **프롬프트·시스템 지침 레벨 원천 차단**:
   - `server/services/translation_engine.py`: `TRANSLATION_SYSTEM_INSTRUCTION`에 `5. PLAIN TEXT ONLY (NO HTML / MARKUP HALLUCINATION)` 규칙 신설, `_build_translation_prompt`에 HTML/XML 태그 및 취소선 초안 출력 금지 항목 추가.
   - `server/services/translation_recovery.py`: `_recover_verbatim_items` 내 3개 복구 프롬프트(`mini_prompt`, `single_prompt`, `plain_payload`)에 HTML/취소선 금지 지시 보강.
   - `server/routers/ai_review.py` 및 `scripts/run_ai_review_batch.py`: AI 검수/재번역 프롬프트 전반에 HTML 태그·취소선 출력 금지 지시 추가.
2. **공통 HTML 정제 엔진 (`strip_html_hallucinations`) 및 후처리 통합**:
   - `server/services/translation_engine.py`:
     - `strip_html_hallucinations(text)`: HTML 주석(`<!--...-->`), 쌍을 이루는 취소선 자기교정 블록(`<s>...</s>`, `<del>...</del>`, `<strike>...</strike>` + 뒤 수평 공백), 블록/줄바꿈 태그(`<br>`, `</p><p>`, `</div><div>`), 명시적 HTML 태그 목록(`span`, `b`, `strong`, `i`, `em`, `p`, `div`, `td`, `ruby`, `rt` 등)만 정밀 제거.
     - 소설 본문의 일반 꺾쇠 표현(`<머리말>`, `<시스템: ...>`, `<Level 1>`, `(>_<)`, 부등호 `a < b`)은 미매칭으로 100% 보존하며, `<` / `>` 미포함 문장은 O(1) 즉시 반환.
     - `post_process_translated_text(item_text, raw_trans)`: 화살표 분리 → **`strip_html_hallucinations`** → `process_repeated_chars` → `restore_brackets` → 품질 분류(`classify_translation`/`is_verbatim_copy`) 순서로 통합해 태그 제거 후 괄호 복원 및 품질 판정이 수행되도록 일원화. (전부 취소선만 출력된 경우 빈 문자열로 분류해 복구/정리 트리거)
3. **전 경로 라우터·저장 방화벽 연동**:
   - `server/routers/translation.py`: `_post_process_translated_text`가 `post_process_translated_text`를 위임 호출하도록 통합하고, `force_hdtrans` 직접 번역 경로에도 `strip_html_hallucinations` 적용.
   - `server/services/translation_recovery.py`: `_recover_verbatim_items` 내 3곳에 중복되어 있던 후처리 코드를 내부 `_accept_if_valid` + `post_process_translated_text` 호출로 통합.
   - `server/routers/ai_review.py`: `clean_ai_translation` 단일 출구에서 `strip_html_hallucinations`를 적용해 `ai_review_queue` 잔존 `<span>` 항목도 조회/승인 시 자동 정화.
   - `server/routers/data_crud.py`: `upsert_translations` 저장 시 `restore_brackets` 직전에 `strip_html_hallucinations` 적용.
   - `server/routers/special_batch.py`: `approve_staged_item`, `batch_approve_staged` 승인 반영 시 `strip_html_hallucinations` 적용.

## 4. 검증 결과
- **Ruff 린트**: `.\venv\Scripts\ruff.exe check server/ scripts/ tests/test_html_hallucination_prevention.py` 통과 (`0` errors).
- **집중 테스트 (`tests/test_html_hallucination_prevention.py` 포함 7개 파일)**: `60 passed in 1.48s` (신규 9개 케이스: 프롬프트 제약, 실제 DB 사례·중첩/미닫힘 태그 정제, 일반 꺾쇠/상태창 보존, 괄호 복원 순서, `/translate`·`verbatim` 복구·`clean_ai_translation`·`upsert_translations`·`special_batch` 통합 검증).
