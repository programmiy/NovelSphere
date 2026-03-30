## Uvicorn 서버 자동 리로드 기능 추가 및 안정화 (v1.0)

### 배경
기존 `main.py`에서 Uvicorn 서버를 `reload=True` 옵션으로 `threading.Thread` 내에서 실행할 때, `ValueError: signal only works in main thread of the main interpreter` 오류가 발생했습니다. 이는 `reload` 기능이 Python의 `signal` 모듈을 사용하며, `signal` 모듈은 메인 스레드에서만 작동하기 때문입니다.

**추가 문제:** `subprocess.Popen`을 사용했지만 `subprocess` 모듈을 임포트하지 않아 `NameError`가 발생했습니다.

### 변경 사항
`main.py` 파일 내 `start_server` 함수를 제거하고, `uvicorn` 서버를 `subprocess.Popen`을 사용하여 완전히 별도의 프로세스로 실행하도록 수정했습니다.

1.  `server_process` 전역 변수를 추가하여 `uvicorn` 프로세스를 관리합니다.
2.  `start_server_process()` 함수를 정의하여 `subprocess.Popen`으로 `uvicorn`을 시작합니다. 이때 `reload=True` 옵션을 유지하고, 애플리케이션은 임포트 문자열(`"server:app"`)로 전달합니다.
3.  `stop_server_process()` 함수를 정의하여 `uvicorn` 프로세스를 안전하게 종료(SIGTERM 후 강제 종료)합니다.
4.  `if __name__ == "__main__":` 블록에서 `start_server_process()`를 호출하고, `atexit.register(stop_server_process)`를 사용하여 `main.py` 프로세스 종료 시 `uvicorn` 프로세스도 함께 종료되도록 등록했습니다.
5.  `main.py` 파일 상단에 `import subprocess` 라인을 추가하여 `NameError`를 해결했습니다.

### 영향
*   `ValueError: signal only works in main thread of the main interpreter` 오류가 해결됩니다.
*   `NameError: name 'subprocess' is not defined` 오류가 해결됩니다.
*   `uvicorn`의 `reload` 기능이 올바르게 작동하며, 코드 변경 시 서버가 자동으로 재시작됩니다.
*   `main.py`는 `pywebview`를 메인 스레드에서 실행하고, `uvicorn`은 별도의 프로세스에서 실행되어 두 기능이 충돌 없이 동작합니다.
*   애플리케이션 종료 시 `uvicorn` 서버 프로세스도 깔끔하게 종료됩니다.
*   `ConnectionRefusedError`는 서버 시작 타이밍 문제이므로, `main.py`의 헬스 체크 대기 로직(30초)이 서버가 완전히 시작될 때까지 기다려 연결을 성공시킬 것입니다.
*   개발 생산성이 향상됩니다.