# Gemini API 503 전건 계측 복원 및 정각 쿼터 리셋 인메모리 동기화 (2026-11-06)

## 1. 개요 및 목적
- **목적**:
  1. **구글 게이트웨이와 로컬 쿼터 계측 100% 동기화**: 구글 Gemini API는 요청이 서버 과부하(`503 UNAVAILABLE / Overload`)로 실패하더라도 게이트웨이 레벨에서 일일 쿼터(RPD, Requests Per Day)를 1회 소모한 것으로 차감함. 로컬에서 503을 계측에서 제외할 경우 로컬 카운터(예: 450회)와 구글 실제 쿼터(500회 소진) 간에 괴리가 발생하여, "50회 남음" 상태에서 429(RESOURCE_EXHAUSTED)가 발생하는 모순을 방지하기 위해 구글에 전달된 모든 요청(503 포함)을 정상 계측으로 복원.
  2. **17시/16시 쿼터 리셋 인메모리 퍼센티지 고착 버그 해결**: 일일 쿼터 초기화 시점(한국 17시/16시)에 호출 횟수(`api_calls_today`)는 0회로 리셋되었으나, 인메모리 현황판의 진행 백분율(`percentage = 90.2%`)이 초기화되지 않고 직전 수치로 남아있던 버그 해결.
  3. **모바일 앱 대시보드 및 서재 배너 쿼터 동기화 완비**: `StatusDashboardService`에 `quotaPercentage`를 정식 도입하고 비활성/0호출 시 0.0% 강제 보정 적용.

---

## 2. 세부 변경 사항

### 2.1. 구글 게이트웨이 쿼터 동기화 (503 전건 기록)
- **`server/quota.py`**:
  - `record_api_call`: 구글 서버에 전송된 503 응답도 실제 구글 쿼터 차감과 일치하도록 `ApiCallLog`에 전건 기록.
  - `get_today_api_call_count`: `status_code != 503` 필터를 제거하여 구글 실제 소비량과 1:1 일치.
- **`server/services/translation_engine.py` & `translation_recovery.py`**:
  - 선제적 503 스킵 가드를 제거하고 호출 시도 전건을 정확하게 로깅.

### 2.2. 정각 리셋 인메모리 퍼센티지 및 UI 방어 보정
- **`server/notifications.py` (`get_translation_status`)**:
  - `q["window_start_ts"] > updated_at` 조건 충족(정각 리셋 감지) 시 `_CURRENT_TRANSLATION_STATUS["percentage"] = q["percentage"]` 및 `data["percentage"] = q["percentage"]`로 즉시 초기화.
  - `elif not data.get("is_active"):` 블록에서 `data["percentage"] = q["percentage"]`로 상시 최신 쿼터 퍼센트와 동기화.
- **`server/routers/notifications.py` (`/summary`)**:
  - `"quota_percentage"` 필드를 명시적으로 반환.
- **`server/static/admin/admin-tree.js`**:
  - `calls === 0`일 때 무조건 `pct = 0`으로 강제 보정.
  - `pct < 70`일 때 빨간색/주황색 테두리를 기본 테두리로 복원(`apiQuotaStatItem.style.borderColor = ''`).

### 2.3. 모바일 앱 동기화 및 릴리즈 빌드 (`mobile_app/`)
- **`StatusDashboardService` (`mobile_app/lib/services/status_dashboard_service.dart`)**:
  - `quotaPercentage` 필드 정식 탑재 및 `calls == 0 && !active` 시 `percentage = 0.0` 강제 가드 추가.
- **`LibraryScreen` (`mobile_app/lib/ui/library/library_screen.dart`)**:
  - 상단 배너에 `status.quotaPercentage`를 1순위로 바인딩하여 쿼터 리셋 시 즉각 `API 쿼터 0.0%`로 동기화.
- 버전 판올림: `v1.7.5+2026110603` 릴리즈 APK 컴파일 완료.

---

## 3. 검증 내역
- `tests/test_quota_logic.py`: 503 포함 전건 계측 검증 및 쿼터 윈도우 계산 단위 테스트 3건 통과.
- `tests/test_notifications.py`: 알림 및 번역 상태 10건 전체 통과.
- `get_translation_status()` 실행 결과: 0/500 시 `percentage: 0.0`, `quota_percentage: 0.0` 출력 확인.
- 모바일 릴리즈 APK 컴파일 및 `server/static/lanovel-reader-release.apk` 동기화 확인.
