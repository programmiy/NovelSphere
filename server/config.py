import os

script_dir = os.path.dirname(os.path.abspath(__file__))
DATABASE_FILE = os.path.join(script_dir, "translations.db")
LOG_DIR = os.path.join(script_dir, "logs")

allowed_origins_list = ["http://localhost", "http://localhost:8001", "http://1227.0.0.1", "http://127.0.0.1:8001", "https://novel18.syosetu.com", "https://kakuyomu.jp", "http://192.168.219.100", "http://192.168.219.100:8001", "http://172.31.176.1", "http://172.31.176.1:8001"]
