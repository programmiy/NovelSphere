## 로그 뷰어 페이지에 뒤로가기 버튼 추가 (v1.0)

### 배경
관리 페이지에서 서버 로그를 확인할 때, 로그 뷰어 페이지에서 이전 페이지(관리자 페이지)로 돌아갈 수 있는 직접적인 버튼이 없어 사용자 경험이 불편했습니다.

### 변경 사항
`server/templates/log_viewer.html` 파일에 관리자 페이지(`/admin`)로 이동하는 '뒤로가기' 버튼을 추가했습니다. 이 버튼은 `<h1>서버 로그</h1>` 아래, 기존 '새로고침' 버튼과 함께 `button-group`으로 묶여 배치됩니다.

```html
<!-- 변경 전 -->
<h1>서버 로그</h1>
<button id="refreshLogs">새로고침</button>

<!-- 변경 후 -->
<h1>서버 로그</h1>
<div class="button-group">
    <button id="backToAdmin" onclick="location.href='/admin'">뒤로가기</button>
    <button id="refreshLogs">새로고침</button>
</div>
```

### 영향
*   로그 뷰어 페이지에서 관리자 페이지로의 이동이 편리해져 사용자 경험이 개선됩니다.
*   관리 인터페이스 내에서의 내비게이션이 직관적으로 변합니다.