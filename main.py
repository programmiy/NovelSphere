import threading
import time
import os
import uvicorn
import webview
import sys
import platform
import json
import requests
from PIL import Image
import pystray
import multiprocessing
import subprocess

import subprocess

# Get the directory where main.py is located
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(APP_ROOT, "server")

# Path to the settings file
SETTINGS_FILE = os.path.join(SERVER_DIR, "settings.json")

# Ensure the logs directory exists
LOG_DIR = os.path.join(APP_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

window = None
server_process = None

def load_autostart_setting():
    """Loads the autostart setting from settings.json."""
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            settings = json.load(f)
            return settings.get("autostart", False)
    except (FileNotFoundError, json.JSONDecodeError):
        return False

def enable_autostart():
    """Enables the application to start automatically on system startup."""
    current_os = platform.system()
    app_name = "LANOVEL"
    app_path = os.path.abspath(sys.argv[0])

    if current_os == "Windows":
        try:
            vbs_path = os.path.join(os.getenv("APPDATA"), "Microsoft\\Windows\\Start Menu\\Programs\\Startup", f"{app_name}.vbs")
            with open(vbs_path, "w") as vbs_file:
                vbs_file.write(f'Set WshShell = CreateObject("WScript.Shell")\n')
                vbs_file.write(f'WshShell.Run chr(34) & "{app_path}" & chr(34) & " -minimized", 0\n')
                vbs_file.write(f'Set WshShell = Nothing\n')
            print(f"Windows autostart enabled: {vbs_path}")
        except Exception as e:
            print(f"Error enabling Windows autostart: {e}")
    elif current_os == "Darwin":
        try:
            plist_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lanovel.autostart</string>
    <key>ProgramArguments</key>
    <array>
        <string>{app_path}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>"""
            plist_path = os.path.join(os.path.expanduser("~/Library/LaunchAgents"), "com.lanovel.autostart.plist")
            with open(plist_path, "w") as plist_file:
                plist_file.write(plist_content)
            os.system(f"launchctl load {plist_path}")
            print(f"macOS autostart enabled: {plist_path}")
        except Exception as e:
            print(f"Error enabling macOS autostart: {e}")
    else:
        print(f"Autostart not supported on {current_os}")

def disable_autostart():
    """Disables the application from starting automatically on system startup."""
    current_os = platform.system()
    app_name = "LANOVEL"

    if current_os == "Windows":
        try:
            vbs_path = os.path.join(os.getenv("APPDATA"), "Microsoft\\Windows\\Start Menu\\Programs\\Startup", f"{app_name}.vbs")
            if os.path.exists(vbs_path):
                os.remove(vbs_path)
                print(f"Windows autostart disabled: {vbs_path}")
        except Exception as e:
            print(f"Error disabling Windows autostart: {e}")
    elif current_os == "Darwin":
        try:
            plist_path = os.path.join(os.path.expanduser("~/Library/LaunchAgents"), "com.lanovel.autostart.plist")
            if os.path.exists(plist_path):
                os.system(f"launchctl unload {plist_path}")
                os.remove(plist_path)
                print(f"macOS autostart disabled: {plist_path}")
        except Exception as e:
            print(f"Error disabling macOS autostart: {e}")
    else:
        print(f"Autostart not supported on {current_os}")

def send_notification(title, message):
    """Sends a native OS notification."""
    global window
    if window:
        try:
            window.show_notification(title, message)
        except Exception as e:
            print(f"Error sending notification: {e}")

def start_server():
    """Function to run the FastAPI server as a subprocess."""
    global server_process
    os.chdir(APP_ROOT)
    command = [
        sys.executable,  # Use the same python interpreter
        "-m", "uvicorn",
        "server.server:app",
        "--host", "127.0.0.1",
        "--port", "8001",
        "--reload"
    ]
    server_process = subprocess.Popen(command)

def on_tray_menu_select(icon, item):
    """Function to handle tray menu selections."""
    global window, server_process
    if str(item) == "Open Library":
        if window:
            window.show()
    elif str(item) == "Exit":
        if server_process:
            server_process.terminate()
        if window:
            window.destroy()
        icon.stop()
        sys.exit()

def open_library():
    """Function to open the webview window to the library URL."""
    global window
    if window:
        if not window.is_shown():
            window.show()
        window.load_url("http://127.0.0.1:8001/library")
        window.set_focus()

def update_progress_bar():
    """Function to update the progress bar."""
    global window
    if not window:
        return

    try:
        response = requests.get("http://127.0.0.1:8001/api/progress")
        response.raise_for_status()
        progress_data = response.json()

        if progress_data["task"] == "fetch_titles" and progress_data["total"] > 0:
            percentage = progress_data["percentage"]
            window.set_title(f"LANOVEL - Fetching Titles ({percentage}%)")
        else:
            if progress_data["task"] == "fetch_titles" and progress_data["percentage"] == 100:
                send_notification("LANOVEL", "제목 가져오기 작업이 완료되었습니다.")
            window.set_title("LANOVEL")
    except requests.exceptions.RequestException as e:
        print(f"Error fetching progress: {e}")
    finally:
        threading.Timer(2, update_progress_bar).start()

def start_webview():
    """Function to create and open the webview window."""
    global window
    time.sleep(5)
    window = webview.create_window(
        "LANOVEL",
        "http://127.0.0.1:8001/library",
        width=1200,
        height=800,
    )
    webview.start(update_progress_bar)

def setup_tray(icon):
    icon.run()

if __name__ == "__main__":
    if load_autostart_setting():
        enable_autostart()
    else:
        disable_autostart()

    start_server()

    image = Image.new('RGB', (64, 64), 'white')
    menu = (pystray.MenuItem('Open Library', on_tray_menu_select), pystray.MenuItem('Exit', on_tray_menu_select))
    icon = pystray.Icon("name", image, "LANOVEL", menu)

    tray_thread = threading.Thread(target=setup_tray, args=(icon,), daemon=True)
    tray_thread.start()

    start_webview()

    if server_process:
        server_process.terminate()
    sys.exit(0)