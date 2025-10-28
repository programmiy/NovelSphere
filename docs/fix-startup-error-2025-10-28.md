# 시작 오류 및 종속성 누락 해결

## 문제

애플리케이션 시작 시 `Attribute "app" not found in module "server"` 오류가 발생하여 서버가 정상적으로 실행되지 않았습니다. 또한, 시스템 트레이 아이콘 관련 기능에 필요한 라이브러리가 `requirements.txt`에 누락되어 있었습니다.

## 원인

1.  **ASGI 앱 로딩 오류**: `server`라는 디렉토리와 그 안의 `server.py` 파일 이름이 동일하여, `main.py`에서 `uvicorn`이 ASGI 애플리케이션(`app`)을 찾지 못하는 파이썬 모듈 경로 충돌이 발생했습니다.
2.  **종속성 누락**: `main.py`에서 시스템 트레이 아이콘을 생성하고 제어하는 데 사용되는 `pystray`와 `Pillow` 라이브러리가 `server/requirements.txt`에 명시되어 있지 않았습니다.

## 해결

1.  **모듈 경로 수정**:
    *   `main.py`의 `start_server` 함수에서 `os.chdir()` 호출을 제거했습니다.
    *   `uvicorn.run()`의 대상을 `"server:app"`에서 `"server.server:app"`으로 명확하게 변경하여, `server` 패키지 내의 `server` 모듈에 있는 `app` 인스턴스를 정확히 가리키도록 수정했습니다.
2.  **파일 경로 기준 수정**:
    *   `server/server.py`에서 데이터베이스 및 API 키 파일 경로를 스크립트 실행 위치가 아닌, `server.py` 파일의 위치를 기준으로 하도록 수정하여 경로 일관성을 확보했습니다.
3.  **누락된 종속성 추가**:
    *   `server/requirements.txt` 파일에 `pystray`와 `Pillow`를 추가하여 필요한 모든 라이브러리가 설치되도록 보장했습니다.
