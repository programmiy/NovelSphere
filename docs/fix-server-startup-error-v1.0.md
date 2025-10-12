# 핫픽스: 서버 시작 오류 해결

## 버전

v1.0

## 변경 사항

- **문제 원인:** `server.py`에서 `sqlite3.connect` 함수에 잘못된 `connect_args` 인수를 사용하여 서버 시작시 오류가 발생했습니다.
- **해결 조치:** 문제가 된 커밋 (64d5b0357243dd29c7fe6daebc68deb61b529fb3)을 되돌려(revert) 서버를 긴급 복구했습니다.
- **추가 작업:** 근본적인 원인(잘못된 DB 연결 파라미터)은 추후 수정이 필요합니다.

## 변경된 파일

- `server/server.py`
- `server/static/viewer.css`
- `server/static/viewer.js`
- `server/templates/viewer.html`
- `docs/refactor-viewer-architecture-v1.0.md` (삭제됨)
