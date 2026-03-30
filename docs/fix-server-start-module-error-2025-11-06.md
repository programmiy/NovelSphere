# Fix: Server Startup ModuleNotFoundError

- **날짜:** 2025-11-06
- **작성자:** Gemini

## 변경 사항

`start_server.bat` 실행 시 `server` 디렉토리가 파이썬 패키지로 인식되지 않아 발생하던 `ModuleNotFoundError: No module named 'server.config'` 오류를 해결했습니다.

### 수정 내용

- `start_server.bat`의 작업 디렉토리를 프로젝트 루트(`C:\LANOVEL`)로 변경했습니다.
- `uvicorn` 실행 명령을 `server:app`에서 `server.server:app`으로 수정하여, 파이썬이 `server`를 패키지로 올바르게 인식하고 내부 모듈(`config.py` 등)을 찾을 수 있도록 경로를 명확히 지정했습니다.
