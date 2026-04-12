# 서버 실행 환경 개선 및 의존성 누락 해결 (2026-04-12)

## 개요
- 전역 Python 패키지 의존성을 제거하고 가상환경(`venv`) 기반의 독립적인 서버 실행 환경 구축.
- 실행 중 발생한 모듈 누락 오류(`ModuleNotFoundError`)를 해결하기 위해 의존성 목록 업데이트 및 설치.

## 수정 사항

### 1. `server/start_server.bat` 수정
- 서버 실행 전 `call venv\Scripts\activate`를 호출하도록 수정하여 항상 가상환경 내부의 패키지를 사용하도록 보장.

### 2. `server/requirements.txt` 업데이트
- 코드 내에서 사용 중이지만 누락되었던 `win10toast_persist` 패키지 추가.

### 3. 가상환경 의존성 설치
- `pydantic-settings`, `win10toast_persist` 등 누락된 모든 패키지를 `venv` 내에 설치 완료.

## 결과
- 서버 실행 시 전역 환경의 영향을 받지 않음.
- `ModuleNotFoundError` 없이 정상적으로 서버 및 라우터 로드 확인 가능.
