# 번역 모델 이원화: 기본 번역(Gemini 3.5 Flash Lite) 및 재번역(Gemini 3.0 Flash)

## 개요

번역 요청 시 단일 모델로 처리하던 기존 구조를 2단계 이원화 구조로 개편했습니다.
- **기본 번역 엔진**: 가볍고 빠른 `gemini-3.5-flash-lite` 모델을 기본 번역 엔진으로 적용하여 대량 텍스트 번역 시 속도 향상 및 리소스/비용을 절감합니다.
- **재번역 엔진**: 번역 결과가 만족스럽지 않거나 실패하여 재시도하는 상황(웹페이지 사이드바 다시 시도 버튼, 개별 문장 재번역, 문장 분할 재시도, 관리자 페이지 내 재번역)에서는 기존 최신 모델인 `gemini-3-flash-preview` (Gemini 3.0 Flash Preview)를 사용하여 고품질 번역을 수행합니다.

## 세부 변경 사항

### 1. 백엔드 설정 및 라우터 (`server/settings.py`, `server/routers/translation.py`)
- `server/settings.py`:
  - `gemini_default_model`: 기본 번역 모델 (`gemini-3.5-flash-lite`)
  - `gemini_retranslation_model`: 재번역 고성능 모델 (`gemini-3-flash-preview`)
- `server/routers/translation.py`:
  - `TranslateRequest` 모델에 `is_retranslation: Optional[bool] = False` 및 `model: Optional[str] = None` 필드 추가.
  - `translate_texts` 엔드포인트에서 요청 조건에 따라 API 호출 모델을 동적으로 선택하도록 구현:
    - `is_retranslation=True`인 경우 `gemini_retranslation_model` 사용
    - 기본 요청의 경우 `gemini_default_model` 사용
    - 명시적으로 `model`을 전달한 경우 해당 모델 우선 사용

### 2. 크롬 확장 프로그램 (`extension/background.js`, `extension/content.js`)
- `extension/background.js`:
  - `handleBatchTranslate` 함수 및 `batchTranslate` 메시지 리스너에 `isRetranslation` 파라미터를 추가하여 백엔드 `/translate` API로 플래그 전달.
- `extension/content.js`:
  - 기본 자동 번역(`translateAllPTags`): 기본 엔진(`gemini-3.5-flash-lite`) 사용.
  - 상단 사이드바의 다시 시도 버튼(🔄 `retry-translation-btn`):
    - 번역 완료/취소/새 내용 없음 상태에서 활성화.
    - 클릭 시 기존 캐시를 비우고 `translateAllPTags(true)`를 호출하여 고성능 모델로 전체 재번역.
  - 문장 분할 재시도(`retryWithSentenceSplitting`): 실패한 긴 문장 재시도 시 고성능 재번역 모델 사용.
  - 사이드바 테이블 행별 '재번역(🔄)' 버튼:
    - 각 문장별로 🔄 버튼을 제공하여 특정 문장만 고품질 모델로 즉시 재번역하고 DB 및 본문 갱신.

### 3. 웹 관리자 페이지 (`server/static/admin.js`)
- 관리자 페이지(`/admin`)의 각 번역 레코드 액션 영역에 '재번역(🔄)' 버튼 추가.
- 클릭 시 고성능 모델로 재번역 API를 호출하여 즉시 결과를 반영하고 DB에 저장.

## 검증 내역

- `TranslateRequest` 스키마 및 기본값 유효성 검증 완료.
- 모의 API 호출(Mock)을 통해 기본 요청(`gemini-3.5-flash-lite`), 재번역 요청(`gemini-3-flash-preview`), 명시적 모델 지정 분기 동작 100% 통과 확인.
