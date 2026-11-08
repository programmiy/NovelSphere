"""
hdTrans 오프라인 규칙 기반 번역 엔진 다운로드 및 셋업 스크립트.
GitHub 최신 릴리스에서 윈도우용 바이너리를 내려받아 tools/hdtrans 디렉토리에 설치합니다.
"""

import os
import urllib.request
import zipfile

HDTRANS_RELEASE_URL = "https://github.com/sokcuri/hdTrans/releases/download/v0.9.4/hdTrans-0.9.4-windows.zip"


def setup():
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    tools_dir = os.path.join(project_root, "tools")
    os.makedirs(tools_dir, exist_ok=True)
    zip_path = os.path.join(tools_dir, "hdTrans-windows.zip")
    target_dir = os.path.join(tools_dir, "hdtrans")

    print(f"Downloading hdTrans from {HDTRANS_RELEASE_URL} ...")
    urllib.request.urlretrieve(HDTRANS_RELEASE_URL, zip_path)
    print("Download complete. Extracting...")

    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(target_dir)

    if os.path.exists(zip_path):
        os.remove(zip_path)
    print("hdTrans extracted successfully to:", target_dir)


if __name__ == "__main__":
    setup()
