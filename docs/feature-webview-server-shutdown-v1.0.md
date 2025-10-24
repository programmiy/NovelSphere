## Webview 종료 시 서버 자동 종료 기능 추가 (v1.0)

### 배경
기존 `main.py`에서는 `webview` 창이 닫히더라도 파이썬 서버 스레드가 백그라운드에서 계속 실행되는 문제가 있었습니다. 이는 `webview.start()` 호출이 완료된 후에도 메인 파이썬 프로세스가 명시적으로 종료되지 않았기 때문입니다.

**추가 문제:** `threading.Timer`를 사용하여 주기적으로 호출되는 `update_progress_bar` 함수가 데몬 스레드가 아니었기 때문에, `sys.exit(0)` 호출 후에도 파이썬 인터프리터가 완전히 종료되지 않고 로그가 계속 출력되는 문제가 발생했습니다.

**`AttributeError: 'Window' object has no attribute 'closed'` 문제:** `pywebview` 버전 호환성 문제로 `window.closed` 이벤트 핸들러 등록 방식이 작동하지 않았습니다.

### 변경 사항
1.  `main.py` 파일 상단에 `app_running = True` 전역 플래그를 추가했습니다.
2.  `start_webview` 함수 내에 `on_webview_closed_callback` 함수를 정의하고, `webview.start(func=on_webview_closed_callback)` 방식으로 `webview` GUI 루프 종료 시 호출될 콜백을 등록했습니다. 이 콜백에서 `app_running` 플래그를 `False`로 설정합니다.
3.  `start_webview()` 호출 직후에 `sys.exit(0)` 코드를 다시 추가하여, `webview` 창이 닫힐 때 메인 파이썬 프로세스가 즉시 종료되도록 했습니다.
4.  `update_progress_bar` 함수 내에서 `app_running` 플래그를 확인하여, 앱 종료 신호가 있을 경우 더 이상 타이머를 예약하지 않도록 수정했습니다. 또한, `threading.Timer` 생성 시 `daemon=True` 옵션을 추가하여, 이 타이머 스레드들도 메인 프로세스 종료 시 함께 종료되도록 변경했습니다. 서버 스레드는 이미 `daemon=True`로 설정되어 있습니다.

### 영향
*   `webview` 창 종료 시 불필요하게 서버 프로세스가 계속 실행되는 것을 방지합니다.
*   `pywebview` 버전 호환성 문제를 해결하고, `webview` 창이 어떤 방식으로든 닫힐 때 애플리케이션이 안정적으로 종료됩니다.
*   애플리케이션의 리소스 관리가 효율적으로 이루어집니다.
*   사용자가 애플리케이션을 완전히 종료했다고 인지할 때, 실제 시스템에서도 완전히 종료됩니다.
*   로그가 계속 출력되는 현상이 사라지고, 애플리케이션이 깔끔하게 종료됩니다.