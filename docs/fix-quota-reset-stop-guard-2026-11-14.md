# 쿼터 초기화 정각 도달 시 `_QuotaStopState` 자가 무장 해제 버그 수정

> **작업 일자**: 2026-11-14  
> **관련 모듈**: [`server/routers/translation.py`](file:///c:/LANOVEL/server/routers/translation.py), [`tests/test_quota_reset_guard.py`](file:///c:/LANOVEL/tests/test_quota_reset_guard.py)

---

## 1. 문제 배경 및 원인

터보 모드(쾌속 모드)를 켠 상태에서 번역을 진행할 때, 일일 Gemini API 쿼터 초기화 시각(미국 태평양 표준시 자정: 한국 시각 16시 또는 17시)을 넘어가더라도 서버의 정각 자동 중단(`503` 응답)이 작동하지 않는 현상이 발생했습니다.

### 원인 분석
1. [`translate_texts()`](file:///c:/LANOVEL/server/routers/translation.py#L223-L235)는 매 요청마다 `next_reset_dt = get_next_quota_reset_dt(now)`를 호출해 [`_stop_state.check_and_update(now, next_reset_dt)`](file:///c:/LANOVEL/server/routers/translation.py#L81-L115)에 전달합니다.
2. 정각 직전(예: `16:59:48`)까지는 `get_next_quota_reset_dt(now)`가 **당일 17:00:00**을 반환하므로 `_target_reset_ts = 당일 17:00:00`, `_armed = True`로 정상 무장됩니다.
3. 그러나 **17:00:00 정각이 되는 순간**, 미국 LA 시각이 자정을 넘기면서 `get_next_quota_reset_dt(now)`가 즉시 **익일 17:00:00(+24시간)**을 반환합니다.
4. 기존 `check_and_update()`는 첫 줄에서 `if self._target_reset_ts != reset_ts:`를 검사하여 `_target_reset_ts`를 익일 17:00으로 덮어쓰고 **`self._armed = False`로 스스로 무장을 해제**해 버렸습니다. 그 결과 `if self._armed and now_ts >= reset_ts:` 조건은 실제 동적 호출 환경에서 영원히 `True`가 될 수 없었습니다.

---

## 2. 수정 내역

### 2.1. `_QuotaStopState.check_and_update()` 이전 타깃 돌파 우선 판별 ([`server/routers/translation.py`](file:///c:/LANOVEL/server/routers/translation.py#L81-L116))
- `_target_reset_ts`를 새 `reset_ts`(익일 정각)로 갱신하기 전에, 이미 무장(`self._armed == True`)된 이전 타깃(`self._target_reset_ts > 0`)이 존재하고 현재 시각(`now_ts`)이 해당 타깃 시각에 도달(`self._target_reset_ts <= now_ts < self._target_reset_ts + 600`)했는지 먼저 확인합니다.
- 조건 충족 시 즉시 `self._armed = False`로 해제하고 `self._target_reset_ts = reset_ts`로 갱신한 뒤 **`True`(최초 1회 정각 중단)**를 반환합니다.
- 정각 돌파 시점의 안내 시각(`cutoff_hour`)도 익일 기준(`next_reset_dt.hour`)이 아닌 방금 통과한 현재 윈도우 기준(`get_quota_reset_hour(now)`)을 사용하도록 정교화했습니다.

### 2.2. 동적 `get_next_quota_reset_dt(now)` 경계 통과 단위 테스트 추가 ([`tests/test_quota_reset_guard.py`](file:///c:/LANOVEL/tests/test_quota_reset_guard.py#L80-L100))
- `test_quota_stop_state_dynamic_next_reset_dt()`를 추가하여 실제 라우터와 동일하게 매 시각 `get_next_quota_reset_dt(now)`를 동적으로 전달할 때:
  1. `16:59:48` (정각 12초 전): `_armed = True` 무장 및 정상 통과(`False`)
  2. `17:00:01` (정각 1초 후): `next_reset_dt`가 익일 17:00으로 바뀌더라도 최초 1회 중단(`True`) 발동 및 `_armed = False` 해제
  3. `17:00:06` (5초 후 재시도/신데렐라 복구): 추가 차단 없이 정상 통과(`False`)
  전 과정을 검증했습니다.

---

## 3. 검증 결과
- `pytest tests/test_quota_reset_guard.py -v`: 6개 테스트 전건 통과 (100% Pass)
- `ruff check server/routers/translation.py tests/test_quota_reset_guard.py`: 0 에러
