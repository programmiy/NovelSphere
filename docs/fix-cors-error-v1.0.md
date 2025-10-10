# CORS 오류 수정 (v1.0)

## 변경 사항

`server.py`의 CORS (Cross-Origin Resource Sharing) 미들웨어 설정을 수정하여 `TypeError: Failed to fetch` 오류를 해결했습니다.

### 기존 문제

- `allow_credentials=True` 와 `allow_origins=["*"]` 설정이 함께 사용되어, 보안상의 이유로 브라우저에서 API 요청이 차단되었습니다.

### 해결 방안

- `allow_origins`에 `http://localhost`, `http://127.0.0.1` 등 로컬 개발 환경의 출처를 명시적으로 추가했습니다.
- `allow_origin_regex="chrome-extension://.*"` 설정을 추가하여 모든 Chrome 확장 프로그램에서의 요청을 허용하도록 변경했습니다.

이를 통해 브라우저 확장 프로그램과 같은 외부 출처에서의 API 요청이 정상적으로 처리될 수 있도록 하였습니다.
