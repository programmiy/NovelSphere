# 대화/인용 괄호 컨텍스트 추적 및 순수 수식/기호 Fast-Path 자동 대입 시스템 구축

> **작업 일자**: 2026-11-07  
> **관련 모듈**: `extension/src/core/filters.ts`, `extension/src/core/page_translator.ts`, `extension/tests/core.test.ts`, `server/routers/data_crud.py`

---

## 1. 개요 및 배경

### 1.1 배경 문제
* 카쿠요무 등 웹소설에서 작가가 퀴즈/암호 수식이나 긴 대사를 여러 개의 `<p>` 태그로 분할하여 작성하는 경우:
  ```html
  <p id="p2">「1＋7=8</p>
  <p id="p3">  2＋9=11</p>
  <p id="p4"> 11＋3=2</p>
  <p id="p5"> 8＋2=A</p>
  <p id="p6"> 10＋6=B</p>
  <p id="p7"> 24＋1=C</p>
  <p id="p8">　A.B.Cに入る数字を出せ。さすれば真の答えが導き出せるだって。どういうことだと思う皆んな？」</p>
  ```
* 기존 `isTranslatableText` 필터는 가나/한자(`JAPANESE_REGEX`) 또는 자체 괄호/침묵 부호만 검사하여:
  * 첫 문단 `p2`(`「1＋7=8`)는 `「`가 있어 번역 대상으로 인식되었으나,
  * 중간 문단 `p3` ~ `p7`은 가나/한자가 없고 괄호가 없어 **번역 목록에서 완전히 제외(스킵)**되는 현상이 발생.
  * 결과적으로 사이드바 행 누락 및 웹 뷰어에서 원문 스타일 방치로 시각적 불일치가 유발됨.

### 1.2 해결 전략
1. **대화 괄호 컨텍스트(Bracket Context) 추적**:
   문단 순회 시 열린 괄호(`「`, `『`, `（` 등)가 닫힐 때까지의 중간 문단을 대사 연속 문단(`inBracket = true`)으로 판정하여 번역 파이프라인에 안전하게 포함.
2. **API 리소스 보호 (Fast-Path 연계)**:
   괄호 안 문단 중 가나/한자가 없는 순수 수식/숫자/기호/변수 문단(`2＋9=11`, `8＋2=A` 등)은 Gemini API 호출 없이 `isPureMathOrPunctuation()` 판별을 통해 **Fast-Path(0ms 원문 즉시 대입)** 처리하여 API 쿼터 0 소모 및 뷰어 스타일 100% 적용.

---

## 2. 주요 변경 사항

### 2.1 `extension/src/core/filters.ts`
* **`updateBracketDepth(currentDepth, text)` 신설**:
  문단 텍스트 내의 열림 괄호(`「『（(【《〈〔“`)와 닫힘 괄호(`」』）)】》〉〕”`), 큰따옴표의 짝을 검사하여 누적 깊이를 계산.
* **`isTranslatableText(text, inBracket = false)` 확장**:
  `inBracket === true`인 경우 공백이 아닌 모든 문단을 번역 대상으로 포함.
* **`isPureMathOrPunctuation(text)` 신설**:
  가나/한자/한글이 전혀 없고, 순수 숫자/수식 기호(`＋, -, *, /, =, <, >`) 및 단일 변수 알파벳(`A`, `B`, `C`)으로 구성된 문단을 Fast-Path 대상으로 판별.
* **`isSymbolOrPunctOnly(text)` 연동**:
  수식 문단이 원문 복제(Verbatim) 오탐으로 삭제되지 않도록 판별기 연동.

### 2.2 `extension/src/core/page_translator.ts`
* **`hasUntranslatedParagraphs()` & `translateAllPTags()`**:
  * 문단 순회 시 `bracketDepth`를 실시간 추적하고 `inBracket` 플래그를 전달.
  * 작가의 괄호 닫기 누락에 대비한 30문단 연속 안전 리셋 가드 탑재.
  * 수식/기호 문단은 `isPureMathOrPunctuation()`을 거쳐 `instantPunctuationItems`로 즉시 대입.

### 2.3 누락 데이터 미분류 보관함 적재
* 카쿠요무 에피소드(`https://kakuyomu.jp/works/16817330649887412046/episodes/16817330660848758639`)의 누락되었던 5개 수식 문단(`p3` ~ `p7`)을 백엔드 공식 엔드포인트(`POST /translations/upsert`)를 통해 미분류 보관함(`folderName: None`)으로 안전하게 삽입 완료.

---

## 3. 검증 결과
* **TypeScript 정적 타입 분석**: `tsc --noEmit` 무결점 통과 (에러 0건).
* **확장 유닛 테스트**: `tests/core.test.ts` 신규 괄호 추적 및 수식 Fast-Path 테스트 포함 23개 전건 통과 (`23 passed, 0 failed`).
* **번들 컴파일**: esbuild 34ms 초고속 빌드 완료 (`content.js`, `background.js`).
