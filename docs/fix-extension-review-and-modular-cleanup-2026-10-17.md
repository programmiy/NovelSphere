# 크롬 확장 프로그램 검수(Review) 기능 레거시 100% 복원 및 단일 책임 모듈 분리 (2026-10-17)

## 1. 개요 및 문제 원인

TypeScript 리팩토링 과정에서 `extension/legacy_backup/content.js`의 **검수(Review) 3대 서브시스템**이 누락되거나 비대해진 단일 파일(`sidebar.ts` 2,000줄, `page_translator.ts` 1,100줄) 내부에 파편화되어 다음과 같은 문제가 발생했습니다.

1. **사이드바 비대화 및 중복 인라인 스타일**: `manifest.json`에서 이미 `content.css`를 로드하고 있음에도 `sidebar.ts` 내부에 800줄에 달하는 중복 CSS 문자열(`injectSidebarStyles`)이 포함되어 파일이 2,000줄로 비대해짐.
2. **알림 센터 연계 재번역 검수 패널(`#review-target-panel`) 불일치**:
   - 서버 `GET /cleanup/review_targets` 응답은 개별 타깃에 `translated` 필드를 포함하지 않음에도 `t.translated`를 참조하여 번역문이 항상 대기 상태로 표시됨.
   - `✓ 검수 완료` 버튼(`POST /cleanup/notifications/{notifId}/dismiss` 및 `lastNotificationDismissed` 스토리지 동기화) 누락.
   - 본문 문단 하이라이트(`.review-target-dom`), 사이드바 행 강조(`tr.review-target-row`, `<span class="review-badge">⚡재검수</span>`), 양방향 포커스 스크롤(`focusAndScrollToPid`) 및 실시간 번역 카드 갱신(`#review-tra-${pid}`) 누락.
3. **구분선 자동 제외 검수 및 복원 패널(`#separator-exclude-panel`, `🛡️`) 누락**:
   - 구분선 전/후 단락 자동 제외 시 본문 DOM 원문 복원, `#separator-exclude-panel` 배너 렌더링, 단건/전체 복원(`POST /translations/restore_excluded`), 제외 단락 조회 모달(`GET /translations/excluded_details`) 및 구분선 초기화(`DELETE /api/separators`)가 누락됨.
4. **사이드바 개별 행 검수 조작 누락**:
   - 신규 번역 행의 `contenteditable` 인라인 수정 + `저장`(`saveSingleTranslation`), 단건 즉시 재번역(`🔄`, `retranslateSingleRow`), 전체 재번역(`#retry-translation-btn`) 시 기존 캐시/테이블 초기화(`startFullRetranslation`)가 누락됨.

---

## 2. 단일 책임 모듈 분리 아키텍처 (Modular Cleanup)

기존 `sidebar.ts`(2,000줄)와 `page_translator.ts`(1,100줄)에 뒤섞여 있던 검수·구분선·DOM 주입·단일 행 조작 로직을 각 역할별 독립 모듈로 분리하고, `state.ts`의 순환 참조 회피용 콜백 해킹을 제거했습니다.

| 모듈 경로 | 줄 수 | 단일 책임 (Single Responsibility) |
| :--- | :---: | :--- |
| `extension/src/ui/sidebar.ts` | ~450줄 | 사이드바 기본 셸, 실시간 로그 콘솔, 쾌속모드/본문적용 배너, 번역 테이블 행 렌더링 (800줄 중복 인라인 CSS 완전 제거) |
| `extension/src/ui/review_panel.ts` | ~220줄 | 알림 센터 연계 재번역 검수 패널(`#review-target-panel`), `✓ 검수 완료` 알림 해제, 본문/사이드바 검수 하이라이트, 실시간 카드 갱신, `focusAndScrollToPid` |
| `extension/src/ui/separator_panel.ts` | ~415줄 | 소설별 구분선 설정 패널(`#separator-settings-panel`), 구분선 기준 번역 자동 제외(`checkAndExcludeSeparatorTranslations`), 제외 단락 검수/복원 배너(`#separator-exclude-panel`), `restoreExcludedItems`, `openExcludedManager` |
| `extension/src/core/row_actions.ts` | ~218줄 | 사이드바 개별 행 수동 편집 저장(`saveSingleTranslation`) 및 단일 문장 고성능 즉시 재번역(`retranslateSingleRow`) |
| `extension/src/core/dom_applier.ts` | ~140줄 | 본문 `<p>` 태그 번역문 주입(`applyTranslationsToPage`), 원문 복원(`restoreOriginalPage`), 적용 상태 동기화(`setPageApplyStatus`), 문단 클릭 연동(`setupParagraphInteraction`) |
| `extension/src/core/page_translator.ts` | ~880줄 | 예산 기반 청크 분할 번역 루프, 적응형 딜레이, 검열/원문복붙 감지, 전체 재번역 초기화(`startFullRetranslation`) |

---

## 3. 검증 결과

- `npm run typecheck` (`tsc --noEmit`): 에러 0건 통과
- `npm run build` (`node build.js`): `content.js` 및 `background.js` 번들 생성 완료
- `npm test`: `excludedPidMap` 상/하단 구분선 메타데이터 매핑, `ExtensionState.isReviewMode()`, `checkIsVerbatimOrParaphrased()` 등 총 12개 단위 테스트 전원 통과
