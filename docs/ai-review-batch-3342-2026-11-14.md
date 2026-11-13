# AI 검수 큐 신규 이상치 3,342건 정밀 정제 및 고품질 재번역 적재 보고서

> **작업 일자**: 2026-11-14  
> **관련 모듈**: `scripts/fetch_unreviewed.py`, `scripts/insert_reviewed_items.py`, `scripts/insert_other_lang_21.py`, `scripts/clean_batch_3342_stage1.py`, `scripts/stage2_part1.py`, `scripts/stage2_part2.py`, `server/rule_classifier.py`, `server/routers/ai_review.py`  
> **연동 UI**: [AI 검수 큐 (/ai_review)](http://localhost:8001/ai_review)

---

## 1. 개요 및 목적
- **배경**: 전체 번역 단락이 **1,002,262건**으로 증가하면서 미검수 이상치(`partial_untranslated` 3,321건 + `other_language` 21건 = **총 3,342건**)가 새롭게 식별됨.
- **목표**:
  - 외부 Gemini API 호출 없이 3,342건 전량을 고품질 라노벨 한국어 문체로 정제·재번역하여 `ai_review_queue`에 `pending_review` 상태로 적재.
  - 승인 이후 `server/rule_classifier.py`의 `classify_translation()` 재분류(`partial_untranslated`, `other_language` 등)가 발생하지 않도록 CJK 잔재 및 4단어 이상 연속 영문 구절까지 전량 `normal` 수준으로 정제.
  - 운영 DB 원본 `translations` 테이블 불변 원칙(`ALLOW_PROD_DB_WRITE="1"` 안전 가드) 철저 준수.

---

## 2. 단계별 처리 내역 (총 3,342건 100% 완결)

| 단계 | 스크립트 | 건수 | 적용 전략 및 핵심 내용 |
| :--- | :--- | :--- | :--- |
| **Step 1. 타 언어(`other_language`) 전량 번역** | `scripts/insert_other_lang_21.py` | **21건** | 영어/중국어 혼입, `Theodore W. Davies`·`KOREAN_TRANSLATION_PLACEHOLDER` 환각, 4단어 이상 영문 구절을 자연스러운 한국어 라노벨 문체로 1:1 대조 번역 (`normal` 전수 검증) |
| **Step 2. 1차 순서 보장 규칙 정제** | `scripts/clean_batch_3342_stage1.py` | **2,932건** | **순서 역전 방지 파이프라인** 적용:<br>1) `~っち` 호칭 사이시옷 규칙(`미낫치`, `하즈킷치`, `사욧치`, `아옷치`, `아츠얏치`, `미코톳치`, `히로톳치`, `무랏치`, `유릿치`, `리릿치`, `모엣치`, `카옷치`, `미즈킷치`) 및 상용구(`どころか`, `だって`, `そろそろ`, `確かに`, `いわゆる`, `というと`, `それで`, `うちに` 등) 선행 치환<br>2) 인용부호/문두 단독 촉음(`っ`→`읏`, `ッ`→`윽`) 정제<br>3) 잔여 촉음·장음·소형 가나·탁점(`゛`/`゜`)·단독 조사 잔재 정제 후 CJK-free & `normal` 항목만 선별 적재 |
| **Step 3-1. 2차 정밀 번역 (Part 1)** | `scripts/stage2_part1.py` | **200건** | Stage 1 이후 잔여 389건 중 ID `723274`~`866032` 구간의 AI 슬롭(`※ 역주:`, 원문 병기 메모), 문말 환각 부호(`ヤ`, `シ`, `ぷ`, `ピ`, `ぴ`, `んだ` 등), 한자/미번역 어절을 원문 대조 기반 1:1 수동 번역 적재 |
| **Step 3-2. 2차 정밀 번역 (Part 2)** | `scripts/stage2_part2.py` | **189건** | ID `866720`~`1029629` 구간 잔여 189건 전량 원문 대조 수동 번역 및 이모티콘 CJK 문자(`口`→`□`) 치환으로 완전 CJK-free & `normal` 적재 완료 |

---

## 3. 데이터베이스 안전 및 품질 검증 결과

1. **잔여 이상치 및 큐 적재 현황**:
   - `scripts/fetch_unreviewed.py` (`get_items(1)`) 최종 확인: **`REMAINING_TOTAL: 0`**
   - `translations` 원본 테이블: **1,002,262건** (0건 수정/삭제, 100% 불변 보존)
   - `ai_review_queue` 테이블: **총 11,204건** (대기 `pending_review`: **11,151건**, 승인 `approved`: **53건**) — 기존 대기 7,809건 + 신규 적재 3,342건 정확히 일치.
2. **최근 적재 3,342건 전수 룰 분류 검증**:
   - `server/rule_classifier.py`의 `classify_translation(original_text, ai_translated_text)` 실행 결과: **3,342건 중 비정상(`!= 'normal'`) 0건**.
3. **코드 정적 분석 (`Ruff`)**:
   - `.\venv\Scripts\ruff.exe check server/ scripts/` 실행 결과: **`All checks passed!` (0 에러)**.
