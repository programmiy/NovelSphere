# 태블릿(탭 S8) 전자책 서재 및 원문 대조 하이라이트(수정 대기) 파이프라인 구축

## 1. 개요 및 목적
- **디바이스별 적응형 UI/UX 이원화**:
  - 📱 **스마트폰(갤럭시 S24 울트라 등)**: 19.5:9 세로형 최적화 (단일 컬럼/2열 그리드, 원핸드 제스처, 상단 Hero 이어보기 카드).
  - 📟 **태블릿(갤럭시 탭 S8)**: 16:10 11인치 대화면에 맞춘 **'실감형 전자책 서가(Classic E-Bookshelf)'** UI/UX 구축 (4~6열 와이드 책장 그리드, 3D 양장본 스파인/림라이트 입체감, 상단 와이드 대시보드 및 자동 동기화 텔레메트리).
- **앱 실행/포그라운드 복귀 시 무음 자동 동기화**:
  - 앱 시작(Cold Start) 및 포그라운드 복귀(Resume) 시 로컬 Wi-Fi와 PC 서버(8001)의 온라인 상태를 0.1초 고속 감지하여, 백그라운드에서 증분 동기화(`SyncService.performIncrementalDownload(silent: true)`)를 자동 발동. 별도 터치 없이 서재가 최신 번역본으로 무새로고침 갱신.
- **원문 대조 및 어색한 번역문 하이라이트(수정 대기 마킹) 파이프라인**:
  - 태블릿 특성상 가상 키보드로 긴 문장을 타이핑 수정하기 어려우므로, 독서 중 어색한 문장에서 인라인으로 원문을 즉시 대조하고 **[🖊️ 수정 대기 마킹]**만 1-터치로 콕 찍어둠.
  - 마킹된 단락은 본문에서 은은한 앰버 형광펜 배경과 인디케이터로 표시.
  - 서재 책 표지에 **`[🖊️ N건]`** 골드 뱃지가 표시되며, 탭 시 해당 소설의 마킹 목록에서 해당 회차/단락(PID)으로 0초 만에 순간이동.
  - PC 관리자(`admin.html`)의 **`[🖊️ 태블릿 마킹 N건]`** 패널과 연동되어, PC 키보드로 1초 만에 수정 및 저장 시 자동으로 마킹이 해결(`is_resolved=1`)되어 태블릿에서도 뱃지가 0으로 자동 정리됨.

---

## 2. 주요 아키텍처 및 구현 내역

### 2-1. 백엔드 데이터베이스 및 API (`server/`)
1. **신규 모델**: `server/models.py`
   - `SentenceHighlight`: `id`, `book_name`, `chapter_title`, `url`, `pid`, `original`, `translated`, `note`, `created_at`, `updated_at`, `is_resolved` (0: 대기중, 1: 수정완료).
   - 비파괴 테이블 생성 보장 (`UNIQUE(url, pid)`).
2. **신규 라우터**: `server/routers/highlights.py`
   - `GET /api/highlights`: 미해결 또는 전체 하이라이트 목록 조회.
   - `GET /api/highlights/counts`: 서재/대시보드용 도서별 미해결 카운트 집계.
   - `POST /api/highlights`: 하이라이트 등록/갱신(Upsert).
   - `POST /api/highlights/resolve`: 하이라이트 해결(수정 완료) 처리.
   - `DELETE /api/highlights/{id}`: 하이라이트 삭제/취소.
3. **수정 시 자동 해결 연동**:
   - `server/routers/data_crud.py` (`upsert_translations`): PC에서 번역문 수정 저장 시 해당 `(url, pid)`의 `SentenceHighlight`를 `is_resolved=1`로 자동 갱신.
   - `server/routers/sync.py`:
     - `PushPayload`에 `highlights` 필드 추가. 모바일에서 전송된 하이라이트 upsert 및 모바일 번역 수정 시 자동 resolve.
     - `pull_changes_from_pc`: PC의 최신 하이라이트 및 해결 상태를 모바일로 내려주어 양방향 완전 동기화.

### 2-2. 모바일 로컬 DB 및 동기화 (`mobile_app/`)
1. **모델 및 로컬 DB**:
   - `mobile_app/lib/models/sentence_highlight.dart` 신설.
   - `mobile_app/lib/models/sentence.dart`: `bool isHighlighted = false;` 필드 추가.
   - `mobile_app/lib/services/local_db_service.dart`:
     - `sentence_highlights` 테이블 생성 및 인덱스 부여.
     - 시드 교체(`replaceSeedDatabase`) 시 하이라이트 백업/복원 방어.
     - `addSentenceHighlight`, `removeSentenceHighlight`, `getHighlightsByBook`, `getHighlightCountsByBook`, `getHighlightedPids`, `syncHighlightsFromPc`.
2. **동기화 파이프라인**:
   - `mobile_app/lib/services/sync_service.dart`:
     - 증분 다운로드(`performIncrementalDownload`) 시 서버의 `highlights`를 로컬 DB에 자동 반영.
     - 업로드(`performManualUpload`) 시 오프라인 큐의 `highlight_add`를 서버로 전송.

### 2-3. 뷰어(Reader) UX 고도화 (`mobile_app/lib/ui/viewer/`)
1. **원문 대조 편의성**:
   - 문장 아래 `[原 원문 대조]` 버튼 터치 시 인라인으로 일본어 원문 즉시 펼침/접힘 토글.
   - 원문 바로 옆에 `[🖊️ 마킹]` 원터치 토글 버튼 배치.
2. **어색한 문장 1-터치 마킹**:
   - 롱프레스 시 미니멀 액션 시트(`_showSentenceActionSheet`):
     - `[수정 대기 하이라이트 콕 찍기]` (ON/OFF 원터치 전환).
     - `[본문에서 원문 항상 펼치기]`.
     - `[키보드로 직접 수정하기]`.
     - `[일본어 원문 복사]`.
3. **하이라이트 시각화**:
   - 마킹된 문장은 부드러운 앰버 형광펜 배경(`color: Colors.amber.withOpacity(...)`) + 좌측 3.5px 오렌지 인디케이터 바 + 상단 `[수정 대기 마킹됨]` 배지 표기.
4. **특정 단락 순간이동**:
   - `ReaderScreen`에 `initialPid` 파라미터 추가하여 하이라이트 목록에서 터치 시 해당 단락으로 0초 만에 점프.

### 2-4. 서재(Library) UI/UX 분기 (`mobile_app/lib/ui/library/`)
1. **기기 너비 기준 반응형 분기**:
   - `shortestSide >= 600` 기준으로 폰(`_buildPhoneLibraryView`)과 태블릿(`_buildTabletLibraryView`) 완전 분기.
2. **태블릿(탭 S8) 전자책 서가 뷰**:
   - 16:10 가로/세로 화면비 맞춤 4~6열 대형 책장 그리드.
   - 3D 입체 양장본 표지: 스파인 라인, 림라이트, 타이포그래피, 회차 게이지.
   - 표지 좌상단 **`[🖊️ N건 마킹]`** 골드 뱃지 (터치 시 해당 소설의 마킹 모아보기 시트 즉시 오픈).
   - 상단 와이드 대시보드: 소설 권수, 회차 수, 총 마킹 건수 텔레메트리 및 PC 자동 동기화 상태 인디케이터.
3. **실행 시 무음 자동 동기화**:
   - `WidgetsBindingObserver` 기반 `initState` 및 `resumed` 시 PC 서버 온라인 자동 핑 ➔ 증분 다운로드 백그라운드 자동 실행.

### 2-5. PC 관리자 연동 (`server/templates/admin.html`, `server/static/admin/`)
1. **헤더 독 액션 바**:
   - `[🖊️ 태블릿 마킹 N건]` 실시간 네온 뱃지 버튼 배치.
2. **수정 대기 모달 및 점프 엔진**:
   - `admin-highlights.js`: 미해결 하이라이트 목록 로드.
   - 모달 내부에서 인라인으로 번역문 수정 후 `[💾 저장 & 해결]` 원클릭 처리.
   - `[🔗 본문 행 점프]` 클릭 시 해당 소설/회차 아코디언 자동 오픈 및 해당 단락 행(`#tr-${pid}`)으로 부드러운 스크롤 이동 + 펄스 발광 + 커서 포커스.

---

## 3. 검증 결과
1. **백엔드 라우터 단위 테스트**: `tests/test_highlights.py`
   - 하이라이트 생성, 카운트 집계, 목록 필터 조회, 해결(Resolve) 처리, 삭제 전체 라이프사이클 100% 통과 (1 passed in 1.11s).
2. **동기화 통합 테스트**: `tests/test_snapshot_sync.py`
   - 스냅샷 및 증분 동기화 100% 무결성 통과.
