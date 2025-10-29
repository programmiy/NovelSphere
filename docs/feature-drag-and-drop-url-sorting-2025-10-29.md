## 기능: URL 그룹 드래그 앤 드롭 정렬 및 자동 스크롤 개선

### 개요
관리자 페이지의 '번역 기록 탭' (URL 그룹)에서 사용자가 마우스 드래그 앤 드롭을 통해 URL 그룹의 정렬 순서를 직접 변경할 수 있는 기능을 구현했습니다. 또한, 긴 목록에서 드래그 시 스크롤링 불편함을 해소하기 위해 자동 스크롤 기능을 추가하고, 스크롤 속도와 한 번에 보이는 정보의 양을 개선했습니다.

### 변경 사항

1.  **`admin.html` 수정**
    *   SortableJS 라이브러리를 CDN을 통해 추가하여 드래그 앤 드롭 기능을 활성화했습니다.
    ```html
    <script src="https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"></script>
    <script src="/static/admin.js?v=1.1"></script>
    ```

2.  **`server.py` 수정**
    *   여러 URL 그룹의 순서를 한 번에 효율적으로 업데이트할 수 있는 일괄 처리 API (`PUT /api/url_metadata/batch`)를 새로 추가했습니다.
    *   `UrlMetadataBatchUpdate` Pydantic 모델을 정의하여 요청 본문의 유효성을 검사합니다.
    ```python
    class UrlMetadataBatchUpdate(BaseModel):
        updates: List[UrlMetadataUpdate]

    @app.put("/api/url_metadata/batch")
    def update_url_metadata_batch(req: UrlMetadataBatchUpdate):
        # ... (구현 세부 사항은 server.py 참조)
    ```

3.  **`admin.js` 수정**
    *   `renderGroupedHistory` 함수를 수정하여 각 폴더 내의 URL 그룹 목록에 SortableJS를 적용했습니다.
    *   SortableJS 초기화 시 `scroll: true`, `scrollSensitivity: 20`, `scrollSpeed: 50`, `forceFallback: true` 옵션을 추가하여 드래그 중 자동 스크롤 기능을 활성화했습니다. `folderContentElement` 자체가 스크롤 가능한 요소가 되었으므로 `scroll: true`로 설정하여 해당 요소 내에서 자동 스크롤이 작동하도록 했으며, 스크롤 감도와 속도를 조정하고 `forceFallback: true`를 추가하여 드래그 앤 드롭의 안정성을 높였습니다.
    *   기존의 개별 URL 정렬 순서 입력 필드 (`<input type="number" class="form-input url-sort-order">`)와 저장 버튼 (`.save-url-sort-order-btn`)을 제거했습니다.
    *   `handleHistoryClick` 함수에서 제거된 저장 버튼에 대한 이벤트 리스너 로직을 삭제했습니다.

4.  **`admin.css` 수정**
    *   `#history-container`에 적용했던 `overflow-y: auto;` 및 `max-height` 속성을 제거하여 첫 페이지 렌더링 시 UI 문제를 해결했습니다.
    *   대신 `.folder-group-content`에 `overflow-y: auto;` 및 `max-height: calc(100vh - 350px);` 속성을 추가하여, 각 폴더가 펼쳐졌을 때 그 내용이 많아지면 해당 폴더 내부에서 스크롤이 발생하도록 했습니다. `max-height`를 동적으로 설정하여 한 번에 더 많은 정보를 볼 수 있도록 개선했습니다. 이로써 SortableJS의 자동 스크롤 기능이 각 폴더 내부에서 올바르게 작동할 수 있는 환경을 조성했습니다.

### 사용 방법
관리자 페이지의 '번역 기록 탭'에서 각 폴더 내의 URL 그룹을 마우스로 드래그 앤 드롭하여 원하는 순서로 재배열할 수 있습니다. 폴더가 펼쳐진 상태에서 해당 폴더 내의 목록이 길어 화면을 벗어날 경우, 드래그 중 마우스를 해당 폴더 영역의 상하단 경계에 가져가면 자동으로 스크롤됩니다. 스크롤 속도와 감도가 개선되어 더 부드러운 드래그 앤 드롭 경험을 제공합니다. 순서 변경이 완료되면 자동으로 서버에 저장됩니다.