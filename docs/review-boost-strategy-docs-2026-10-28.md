# 검수완료율 가속화 및 DB 용량 최적화 전략 문서화 (2026-10-28)

## 1. 개요 및 목적
- **목적**: 장기 DB 용량 증가(Trigram 인덱스 및 1시간 주기 백업)를 방어하고, 검수완료(`is_reviewed = true`)율을 기폭제로 삼아 Cold Data 격리/회차 통압축을 실현하기 위한 전략 입안서 영구 문서화.
- **해당 세션**: [Database Capacity And Growth Discussion](conversation://f79607f1-0971-4f0d-9437-294930697a95)
- **주요 파일**: `review_acceleration_plan/review_boost_strategy.md`

## 2. 전략 입안서 핵심 요약
1. **배경 및 한계 진단**:
   - Trigram FTS5 색인의 장기 비대화 및 시간당 백업 I/O 부담 해소 필요.
   - 검수완료 회차를 아카이브 DB로 격리하고 zlib/BLOB 회차 통압축 시 70~90% 용량 절감 가능하나, 현재 검수율이 0.1% 미만으로 정체.
2. **병목 원인**:
   - 이벤트 배관 단절(검수 패널의 알림 해제만 처리되고 `reviewed_service`로 직접 연결 안 됨).
   - 클린(Clean) 회차 방치(린터에 안 걸린 98% 회차는 검수 패널을 거칠 기회가 없음).
   - 심리적 진입 장벽(회차 전체 문단을 전부 검수해야 한다는 부담감).
3. **패러다임 전환 & 솔루션**:
   - **기계적 슬롭 린팅과 사람의 번역투 교정 분리**.
   - **완결 근접도(Near-Completion) & 작은 목표**: 사용자가 평소 읽으면서 부분 수정한 회차(Touch Rate가 높은 회차)는 남은 미검수 문장이 매우 적으므로 30초 내 검수완료 가능.
   - **게이미피케이션 & 촉진 연출**: 콤보/스트릭, 동일 오역 패턴 연쇄 폭발(Chain Explode/Multi-Kill), 소설 오염도 정화율(Purification Rate), APM 스피드런 모드.

## 3. 변경 파일 목록
- `review_acceleration_plan/review_boost_strategy.md` (신규 입안서 추가)
- `docs/review-boost-strategy-docs-2026-10-28.md` (본 작업 문서)
- `docs/codebase-functional-reference-2026-10-28.md` (종합 레퍼런스 업데이트)
