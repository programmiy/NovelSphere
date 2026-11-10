# 모바일 앱 4대 통합 검수 센터 신설 및 찾아바꾸기 탭 독립 분리

> **작업 일자**: 2026-11-10  
> **관련 모듈**: `mobile_app/lib/ui/review/review_center_screen.dart`, `mobile_app/lib/ui/special_batch/special_batch_screen.dart`, `mobile_app/lib/models/special_batch_models.dart`, `mobile_app/lib/services/special_batch_service.dart`, `mobile_app/lib/ui/glossary/glossary_screen.dart`, `mobile_app/lib/ui/library/library_screen.dart`

---

## 1. 개편 배경 및 목적

1. **찾아바꾸기 탭의 순수성 회복**:
   - 기존 찾아바꾸기 탭(`GlossaryScreen`) 상단에 붙어있던 검수 관련 진입 칩(`인명·용어 교정기`, `AI 번역 검수 스튜디오`)을 완전히 걷어내어, 찾아바꾸기 본연의 오프라인 치환, 실시간 Diff 인스펙터, 규칙 보관함에 온전히 집중하도록 정돈했습니다.
2. **PC 관리자(admin.html)의 4대 검수 파이프라인 모바일 완전 일치화**:
   - PC 웹 관리자의 4대 검수 시스템:
     1) `db_editor` (인명·용어 교정기)
     2) `ai_review` (AI 단락 번역 품질 검수)
     3) `ai_reretranslate` (AI 2차 재재번역 센터)
     4) `special_batch` (특별 적재 배치 검수기)
   - 모바일에 누락되어 있던 **특별 적재 배치 검수기(`SpecialBatchScreen`)** 및 서비스/모델을 신규 구축하고, 4대 시스템을 한곳에서 모니터링 및 진입할 수 있는 **'검수 센터(`ReviewCenterScreen`)'** 탭을 하단 네비게이션 독의 3번째 탭으로 신설했습니다.

---

## 2. 주요 구현 및 신규 아키텍처

### ① 하단 네비게이션 독 4대 탭 구조 개편 (`LibraryScreen`)
- 기존 3개 탭(`서재`, `찾아바꾸기`, `설정`)에서 4개 탭으로 확장:
  1. `[📚 서재]` (`Icons.menu_book_rounded`)
  2. `[🔄 찾아바꾸기]` (`Icons.find_replace_rounded`) - 순수 오프라인 치환 및 Diff 인스펙터
  3. `[✅ 검수 센터]` (`Icons.fact_check_rounded`) - 신설: 4대 검수 시스템 통합 허브
  4. `[⚙️ 설정]` (`Icons.settings_rounded`)

### ② 통합 검수 센터 화면 구축 (`ReviewCenterScreen`)
- **실시간 서버 연결 및 대기 큐 HUD**:
  - PC 서버 온/오프라인 상태 실시간 감지
  - 4대 시스템별 대기 문단 수 실시간 카운트 집계
- **4대 검수 시스템 프리미엄 대시보드 카드**:
  1. **인명·용어 교정기** (`/db_editor`): 틴더식 스와이프 검수, 오독 통계 자동 발굴, 실시간 Diff 인스펙터 (`CharacterFixerScreen`)
  2. **AI 번역 검수 스튜디오** (`/ai_review`): 슬라이드 스와이프 승인/거절, 되돌리기, Reroll, 이상치 정밀 교정 (`AiReviewScreen`)
  3. **AI 재재번역 센터** (`/ai_reretranslate`): Gemini 4대 모델별 티어링 큐, 다중 모델 재번역 비교 및 즉시 승격 (`AiReretranslateScreen`)
  4. **특별 적재 검수기** (`/special_batch`): 외부 수집/보정본 문단 검수, 소설/회차별 일괄 승인, 본 DB 즉시 승격 (`SpecialBatchScreen`)

### ③ 특별 적재 검수기 모바일 신규 탑재 (`SpecialBatchScreen`)
- **모델 및 서비스**: `SpecialBatchNovel`, `SpecialBatchChapter`, `SpecialBatchItem` 및 `SpecialBatchService`
- **소설 및 회차 필터 바**: 소설별 대기 건수 배지, 회차별 필터링 지원
- **상태 필터 세그먼트**: `대기(staged)`, `승인 완료(approved)`, `건너뜀(skipped)`, `전체(all)`
- **인라인 번역문 수정 및 퀵 액션**:
  - 카드 내 번역문 터치 시 즉시 수정 모달
  - `[✓ 승인]`, `[✕ 건너뛰기]`, `[↩ 되돌리기]`
  - 플로팅 `[⚡ 일괄 승인 (N건)]` 지원

---

## 3. 검증 결과

- `flutter analyze mobile_app`: **No issues found!** (이슈 0건)
- `flutter test`: **25개 테스트 전건 통과 (All tests passed!)**
