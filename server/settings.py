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
    server_host: str = "0.0.0.0"
    server_port: int = 8001
    
    # --- API Keys & Models ---
    gemini_api_key: str = Field(default="", description="Gemini API 키")
    gemini_default_model: str = Field(default="gemini-3.5-flash-lite", description="기본 번역 모델")
    gemini_retranslation_model: str = Field(default="gemini-3.8-flash", description="재번역 모델 (Gemini 3.8 Flash)")

    # --- Database Settings ---
    database_url: str = f"sqlite:///{os.path.join(APP_ROOT, 'server', 'translations.db')}"
    corpus_db_url: str = f"sqlite:///{os.path.join(APP_ROOT, 'server', 'corpus_ai.db')}"

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
        "http://syosetu.com",
        "https://ncode.syosetu.com",
        "http://ncode.syosetu.com",
        "https://novelup.plus",
        "http://novelup.plus",
        "http://192.168.219.103",
        "http://192.168.219.103:8001",
        "http://192.168.219.106",
        "http://192.168.219.106:8001",
        "http://100.126.88.22",
        "http://100.126.88.22:8001"
    ]

    # --- Celery Settings ---
    redis_url: str = "redis://localhost:6379/0"
    celery_always_eager: bool = Field(default=False, description="Celery 작업을 즉시 실행하여 테스트 환경에서 사용")

    # --- Path Settings ---
    data_dir: str = os.path.join(APP_ROOT, "server", "data")
    log_dir: str = os.path.join(APP_ROOT, "logs")
    backup_dir: str = os.path.join(APP_ROOT, "server", "backups")
    static_dir: str = os.path.join(APP_ROOT, "server", "static")
    templates_dir: str = os.path.join(APP_ROOT, "server", "templates")
    metadata_file: str = os.path.join(APP_ROOT, "server", "server_meta.json")

    # --- Application Logic Settings ---
    backup_threshold_seconds: int = 24 * 3600  # 24 hours
    autostart: bool = Field(default=False, description="애플리케이션 자동 시작 활성화")
    gemini_api_delay_seconds: int = Field(default=20, description="Gemini API 호출 전 지연 시간 (초)")

    # --- ntfy Push Notification Settings (완전 분리 및 기본 비활성화) ---
    ntfy_enabled: bool = Field(default=False, description="외부 ntfy 푸시 알림 활성화 여부 (LANOVEL 자체 네이티브 SSE 알림으로 대체)")
    ntfy_server: str = Field(default="https://ntfy.sh", description="ntfy 서버 URL")
    ntfy_topic: str = Field(default="NovelSphere", description="ntfy 토픽 이름")
    ntfy_progress_step: int = Field(default=100, description="번역 진행도 알림 주기 (100은 100% 완료 시에만 알림, 25/50은 중간 진행률 알림)")

    # --- Remote Control & LAN Security Token ---
    remote_token: str = Field(default="", description="원격 제어 API 인증 토큰 또는 해시 (.env의 REMOTE_TOKEN)")
    lanovel_auth_token: str = Field(default="", description="로컬 LAN 및 모바일 연동 평문 토큰 (.env의 LANOVEL_AUTH_TOKEN)")
    lanovel_auth_hash: str = Field(default="", description="PBKDF2-SHA256 암호화된 토큰 해시 (.env의 LANOVEL_AUTH_HASH)")


# 설정 객체 인스턴스화
# 이 객체를 다른 모듈에서 import하여 사용합니다.
settings = Settings()

# settings.json 오버라이드 로드
SETTINGS_JSON_PATH = os.path.join(APP_ROOT, "server", "settings.json")
def load_runtime_settings():
    if os.path.exists(SETTINGS_JSON_PATH):
        try:
            import json
            with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if "autostart" in data:
                    settings.autostart = bool(data["autostart"])
                if "ntfy_enabled" in data:
                    settings.ntfy_enabled = bool(data["ntfy_enabled"])
                if "ntfy_server" in data and data["ntfy_server"]:
                    settings.ntfy_server = str(data["ntfy_server"]).strip()
                if "ntfy_topic" in data:
                    settings.ntfy_topic = str(data["ntfy_topic"]).strip()
                if "ntfy_progress_step" in data:
                    settings.ntfy_progress_step = int(data["ntfy_progress_step"])
        except Exception:
            pass

def save_runtime_settings(updates: dict):
    data = {}
    if os.path.exists(SETTINGS_JSON_PATH):
        try:
            import json
            with open(SETTINGS_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}
    data.update(updates)
    import json
    with open(SETTINGS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
    load_runtime_settings()

load_runtime_settings()

# 필요한 디렉토리 생성
os.makedirs(settings.log_dir, exist_ok=True)
os.makedirs(settings.backup_dir, exist_ok=True)