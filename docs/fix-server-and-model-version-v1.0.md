# 핫픽스: 서버 시작 오류 및 모델 버전 수정

## 버전

v1.0

## 변경 사항

- **서버 시작 오류 해결:** `server.py`에서 `sqlite3.connect` 함수에 잘못된 `connect_args` 인수를 사용하여 발생하는 오류를 수정했습니다. `check_same_thread=False`를 사용하도록 변경했습니다.
- **모델 버전 수정:** 번역 API 모델을 `gemini-1.5-flash`에서 사용자가 요청한 `gemini-2.5-flash`로 수정했습니다.

## 변경된 파일

- `server/server.py`
