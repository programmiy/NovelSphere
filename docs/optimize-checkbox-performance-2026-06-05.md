# 수십만 건의 대용량 데이터 체크박스 성능 극대화 최적화 (2026-06-05)

## 1. 개선 배경
* 데이터 복원 완료 후 번역 데이터셋이 20만 건 규모로 크게 늘어나면서, "전체 선택" 또는 "그룹 선택" 클릭 시 브라우저가 극도로 굳어지며 심각한 렉이 발생했습니다.

## 2. 원인 분석
* 사용자가 개별 문장을 체크하거나 일괄 선택(전체/그룹)을 누를 때마다 [updateBulkActionPanel()](file:///C:/LANOVEL/server/static/admin.js#L802) 함수가 트리거되었습니다.
* 이 함수 내부에서 `document.querySelectorAll('.item-checkbox:checked')`를 사용해 화면의 모든 체크박스 DOM 트리(약 20만 개)를 매번 풀 스캔(Full Scan)하여 개수를 직접 세어왔습니다.
* 수십만 건 규모의 데이터가 로드된 상황에서 이와 같은 DOM 풀 스캔 쿼리가 실행될 때마다 브라우저 JS 싱글 스레드가 일시적으로 블로킹(블랙아웃)되어 렉이 급격히 증가하는 원인이 되었습니다.

## 3. 해결 조치
* **Set 메모리 자료구조 도입 ($O(1)$ 연산 성능 확보):**
  * DOM 트리를 풀 스캔하는 대신, 메모리 상에서 선택된 ID들을 추적하는 전역 Set 객체인 `selectedIds`를 선언했습니다.
  * [admin.js](file:///C:/LANOVEL/server/static/admin.js) 및 [history.js](file:///C:/LANOVEL/extension/history.js) 소스 코드를 개선하였습니다.
* **이벤트 기반 카운트 증감 및 일괄 대입:**
  * 개별 체크, 그룹 선택, 폴더 선택 시 DOM을 탐색하지 않고 `selectedIds.add(id)` 및 `selectedIds.delete(id)`를 직접 수행하도록 수정하여 연산 비용을 $O(N)$에서 $O(1)$로 단축했습니다.
  * `updateBulkActionPanel()`은 단순히 `selectedIds.size` 프로퍼티 조회 단 한 번으로 패널 갱신 여부를 판별합니다.
* **일괄 액션(삭제/이동) 로직 최적화:**
  * 일괄 처리 시에도 DOM 탐색 없이 메모리의 `Array.from(selectedIds)`를 즉시 서버 API 인자로 제공하도록 전환하여, 액션 가동 속도 또한 극적으로 가속했습니다.
