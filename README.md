# LANOVEL

## 프로젝트 개요

LANOVEL은 웹 기반의 라노벨 번역 지원 도구입니다. FastAPI 백엔드와 웹 UI를 통해 번역 작업을 효율적으로 관리하고, Celery를 활용한 비동기 작업 처리로 대규모 번역 및 크롤링 작업을 안정적으로 수행합니다. Pydantic 기반의 설정 관리, SQLAlchemy를 통한 데이터베이스 관리, 그리고 Pytest를 활용한 테스트 자동화로 프로젝트의 안정성과 유지보수성을 높였습니다.

## 주요 기능

-   **웹 기반 번역 UI**: 사용자 친화적인 웹 인터페이스를 통해 번역 작업을 수행합니다.
-   **비동기 작업 처리**: Celery와 Redis를 사용하여 번역, 크롤링 등 시간이 오래 걸리는 작업을 백그라운드에서 안정적으로 처리합니다.
-   **데이터베이스 관리**: SQLAlchemy를 통해 번역 데이터 및 관련 정보를 체계적으로 관리합니다.
-   **API 문서 자동화**: FastAPI의 자동 문서 생성 기능(Swagger UI)을 통해 API 명세를 쉽게 확인하고 활용할 수 있습니다.
-   **컨테이너 기반 개발/배포**: Docker 및 Docker Compose를 활용하여 개발 환경 설정을 간소화하고 배포를 표준화합니다.

## 시작하기

### 필수 조건

-   Python 3.9+
-   Docker 및 Docker Compose (컨테이너 환경에서 실행 시)

### 1. Docker를 이용한 빠른 시작 (권장)

Docker Compose를 사용하면 모든 서비스(웹 서버, Celery 워커, Redis)를 한 번에 쉽게 실행할 수 있습니다.

1.  **`docker-compose.yml` 설정**:
    프로젝트 루트에 있는 `docker-compose.yml` 파일을 열고 `GEMINI_API_KEY` 환경 변수 값을 실제 Gemini API 키로 교체합니다.

    ```yaml
    # ...
    environment:
      - GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE # <-- 여기에 실제 API 키 입력
    # ...
    ```

2.  **애플리케이션 실행**:
    프로젝트 루트 디렉토리에서 다음 명령어를 실행합니다.

    ```bash
    docker-compose up --build
    ```

    `--build` 옵션은 첫 실행 시 이미지를 빌드하며, 이후 변경 사항이 있을 때만 다시 빌드합니다.

3.  **접속**:
    웹 브라우저에서 `http://localhost:8000`으로 접속하여 애플리케이션을 확인할 수 있습니다.

### 2. 로컬 환경에서 실행 (Docker 없이)

Docker를 사용하지 않고 로컬 환경에서 직접 실행하려면 다음 단계를 따릅니다.

1.  **가상 환경 설정**:
    ```bash
    python -m venv venv
    .\venv\Scripts\activate # Windows
    source venv/bin/activate # macOS/Linux
    ```

2.  **의존성 설치**:
    ```bash
    pip install -r requirements.txt
    ```
    **주의**: `requirements.txt`에 로컬 경로 의존성(`-e d:\...`)이 포함되어 있을 경우, 해당 라인을 제거하거나 적절히 수정해야 합니다.

3.  **환경 변수 설정**:
    프로젝트 루트에 `.env` 파일을 생성하고 필요한 환경 변수를 설정합니다. 최소한 `GEMINI_API_KEY`는 설정해야 합니다.

    ```ini
    GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"
    REDIS_URL="redis://localhost:6379/0" # Redis를 로컬에 설치하여 실행해야 합니다.
    ```

4.  **Redis 서버 실행**:
    Celery를 사용하려면 로컬에 Redis 서버가 실행 중이어야 합니다. Redis 설치 및 실행 방법은 Redis 공식 문서를 참조하세요.

5.  **애플리케이션 실행**:
    ```bash
    python main.py
    ```
    이 명령은 FastAPI 서버, Celery 워커, 그리고 웹뷰 데스크톱 애플리케이션을 함께 실행합니다.

## 설정

애플리케이션 설정은 `server/settings.py` 파일에서 관리됩니다. `Pydantic BaseSettings`를 사용하여 환경 변수 또는 `.env` 파일로부터 설정을 로드합니다. 민감한 정보는 `.env` 파일을 통해 관리하는 것을 권장합니다.

## 개발 워크플로우

이 프로젝트는 Git-Flow를 단순화한 브랜치 전략을 따릅니다.

### 브랜치 종류

-   **`main`**: 실제 배포 가능한 안정적인 버전의 코드를 관리하는 브랜치입니다.
-   **`extra`**: 새로운 기능 개발, 버그 수정 등 모든 코드 변경 작업을 진행하는 브랜치입니다.
-   **`backup`**: `main` 브랜치에서 발생할 수 있는 오류에 대비하여 이전 버전의 코드를 임시 저장하는 브랜치입니다.

### 개발 및 병합 절차

1.  **작업 시작**: 모든 개발 작업은 `extra` 브랜치에서 직접 진행합니다.
2.  **개발 및 테스트**: `extra` 브랜치에서 코드를 작성하고 수정한 후, 로컬 환경에서 충분히 테스트하여 오류가 없는지 확인합니다.
3.  **`main`으로 병합**: `extra` 브랜치의 기능이 안정적으로 동작하고 배포할 준비가 되면, `main` 브랜치로 병합(merge)합니다.

## API 문서

FastAPI는 자동으로 API 문서를 생성합니다. 애플리케이션이 실행 중일 때 다음 URL에서 API 명세를 확인할 수 있습니다:

-   **Swagger UI**: `http://localhost:8000/docs`
-   **ReDoc**: `http://localhost:8000/redoc`