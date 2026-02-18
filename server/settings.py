import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

# 프로젝트의 루트 디렉토리를 기준으로 경로를 설정합니다.
# 이 파일(settings.py)은 server/ 디렉토리에 있으므로, 부모 디렉토리가 프로젝트 루트입니다.
APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class Settings(BaseSettings):
    """
    애플리케이션 설정을 관리하는 클래스.
    환경 변수, .env 파일을 통해 값을 로드합니다.
    """
    # Pydantic-settings 설정
    model_config = SettingsConfigDict(
        env_file=os.path.join(APP_ROOT, ".env"),
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore' # .env 파일에 추가적인 변수가 있어도 무시
    )

    # --- General Settings ---
    app_name: str = "LANOVEL"
    debug: bool = Field(default=False, description="디버그 모드 활성화")

    # --- Server Settings ---
    server_host: str = "127.0.0.1"
    server_port: int = 8001
    
    # --- API Keys ---
    gemini_api_key: str = Field(default="", description="Gemini API 키")

    # --- Database Settings ---
    database_url: str = f"sqlite:///{os.path.join(APP_ROOT, 'server', 'translations.db')}"

    # --- CORS Settings ---
    allowed_origins: List[str] = [
        "http://localhost", 
        "http://localhost:8001", 
        "http://127.0.0.1", 
        "http://127.0.0.1:8001",
        "https://kakuyomu.jp",
        "http://kakuyomu.jp",
        "https://novel18.syosetu.com",
        "http://novel18.syosetu.com",
        "https://syosetu.com",
        "http://syosetu.com"
    ]

    # --- Celery Settings ---
    redis_url: str = "redis://localhost:6379/0"
    celery_always_eager: bool = Field(default=False, description="Celery 작업을 즉시 실행하여 테스트 환경에서 사용")

    # --- Path Settings ---
    log_dir: str = os.path.join(APP_ROOT, "logs")
    backup_dir: str = os.path.join(APP_ROOT, "server", "backups")
    static_dir: str = os.path.join(APP_ROOT, "server", "static")
    templates_dir: str = os.path.join(APP_ROOT, "server", "templates")
    metadata_file: str = os.path.join(APP_ROOT, "server", "server_meta.json")

    # --- Application Logic Settings ---
    backup_threshold_seconds: int = 24 * 3600  # 24 hours
    autostart: bool = Field(default=False, description="애플리케이션 자동 시작 활성화")
    gemini_api_delay_seconds: int = Field(default=20, description="Gemini API 호출 전 지연 시간 (초)")


# 설정 객체 인스턴스화
# 이 객체를 다른 모듈에서 import하여 사용합니다.
settings = Settings()

# 필요한 디렉토리 생성
os.makedirs(settings.log_dir, exist_ok=True)
os.makedirs(settings.backup_dir, exist_ok=True)