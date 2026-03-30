## PWA 오프라인 기능 강화 (v1.0)

### 배경
모바일 환경에서 PWA가 서버 연결 없이 작동하지 않거나 로딩이 어려운 문제가 보고되었습니다. 이는 PWA의 핵심 구성 요소인 `manifest.json` 파일이 부재하고, `service-worker.js`의 초기 캐싱 범위가 충분하지 않았기 때문입니다.

### 변경 사항
1.  **`server/static/manifest.json` 파일 생성:**
    PWA의 이름, 설명, 시작 URL, 디스플레이 모드, 테마 색상 및 아이콘 경로를 정의하는 `manifest.json` 파일을 생성했습니다.
2.  **`server/static/service-worker.js` 수정:**
    `APP_SHELL_URLS` 배열에 `manifest.json`, `/logs` 페이지, 그리고 `service-worker.js` 자체를 추가하여 초기 캐싱 범위를 확장했습니다. 이는 PWA의 핵심 자원들이 오프라인에서도 항상 사용 가능하도록 보장합니다.
3.  **`server/templates/library.html` 수정:**
    메인 진입점인 `library.html` 파일의 `<head>` 섹션에 `<link rel="manifest" href="/static/manifest.json">` 태그를 추가하여 브라우저가 PWA 매니페스트 파일을 인식하고 로드하도록 했습니다.

### 영향
*   **향상된 오프라인 접근성:** `manifest.json`과 확장된 캐싱 범위 덕분에, 모바일 환경에서 서버 연결 없이도 PWA가 더 안정적으로 로드되고 작동할 것입니다.
*   **PWA 설치 가능성:** 브라우저가 앱을 PWA로 인식하여 사용자에게 '홈 화면에 추가'와 같은 설치 옵션을 제공할 수 있게 됩니다.
*   **일관된 사용자 경험:** 네트워크 상태에 관계없이 일관된 사용자 경험을 제공하여 모바일 사용성을 크게 개선합니다.
*   **성능 향상:** 캐싱된 자원을 사용하여 로딩 속도가 빨라집니다.