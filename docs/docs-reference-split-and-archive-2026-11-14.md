# 레퍼런스 문서 구조 분리 및 과거 버전 아카이브 (2026-11-14)

## 배경
- 단일 레퍼런스 `codebase-functional-reference-*.md`가 54KB로 커지고, 날짜/접미사 버전 파일이 `docs/` 루트에 33개 누적되어 탐색 비용과 "최신 파일 찾기" 혼선이 증가.
- 문서 내 §2 "발화-코드 매핑 사전"(34행, 약 31KB)은 작업 이력 성격으로 계속 커지는 반면, Fast Lookup 맵·아키텍처는 현재 상태 스냅샷 성격이라 갱신 방식이 서로 다름.

## 변경 내역
| 구분 | 내용 |
| :--- | :--- |
| 신규 핵심 레퍼런스 | `docs/codebase-functional-reference-2026-11-14-3.md` (약 24KB): 문서 구성표 + Fast Lookup 모듈/라우터 맵 + 시스템 아키텍처/데이터 흐름 |
| 신규 매핑 사전 | `docs/reference/intent-routing-dictionary.md` (파일명 고정): 기존 §2 34행 무손실 이관, 최신순 최상단 추가 규칙 명시 |
| 아카이브 | 기존 버전 33개(`2026-10-xx` ~ `2026-11-14-2`)를 `docs/archive/reference/`로 `git mv` (삭제 없음, 이력 보존) |

## 운영 규칙 (신규)
1. 작업 시작 전: 최신 `docs/codebase-functional-reference-*.md` + `docs/reference/intent-routing-dictionary.md` 확인.
2. 작업 완료 시:
   - 구조/함수/API 변경 → 핵심 레퍼런스의 해당 행을 덮어써서 최신화(이력 누적 금지), 새 날짜/접미사로 파일명 갱신 후 직전 버전은 `docs/archive/reference/`로 `git mv`.
   - 작업 이력 → 매핑 사전 표 최상단에 1행 추가.
3. 개별 작업 문서(`docs/[기능]-[YYYY-MM-DD].md`)는 기존대로 `docs/` 루트 유지.

## 검증
- 매핑 사전 행 수: 원본 §2 34행 = 이관본 34행.
- `docs/` 루트의 `codebase-functional-reference-*.md`는 최신 1개만 존재.
- `.agents/`, `scripts/`, `.github/`에서 과거 레퍼런스 파일명을 참조하는 코드 없음. (일부 과거 작업 문서의 파일명 언급은 역사적 기록이므로 유지)
- 코드 변경 없음(문서 전용).
