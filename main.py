import threading
import time
import os
import webview
import sys
import platform
import json
from PIL import Image
import pystray
import subprocess

# This must be the first import from the server, to ensure settings are loaded.
from server.settings import settings

# Get the directory where main.py is located
APP_ROOT = os.path.dirname(os.path.abspath(__file__))

window = None
server_process = None
celery_process = None

def enable_autostart():
    """Enables the application to start automatically on system startup."""
    current_os = platform.system()
    app_name = settings.app_name
    # This will use the path to the executable in a packaged app
    app_path = os.path.abspath(sys.argv[0])

    if current_os == "Windows":
        try:
            vbs_path = os.path.join(os.getenv("APPDATA"), "Microsoft\Windows\Start Menu\Programs\Startup", f"{app_name}.vbs")
            with open(vbs_path, "w") as vbs_file:
                vbs_file.write(f'Set WshShell = CreateObject("WScript.Shell")\n')
                vbs_file.write(f'WshShell.Run chr(34) & "{app_path}" & chr(34) & " -minimized", 0\n')
                vbs_file.write(f'Set WshShell = Nothing\n')
            print(f"Windows autostart enabled: {vbs_path}")
        except Exception as e:
            print(f"Error enabling Windows autostart: {e}")
    elif current_os == "Darwin":
        # macOS autostart logic remains the same
        pass
    else:
        print(f"Autostart not supported on {current_os}")

def disable_autostart():
    """Disables the application from starting automatically on system startup."""
    current_os = platform.system()
    app_name = settings.app_name

    if current_os == "Windows":
        try:
            vbs_path = os.path.join(os.getenv("APPDATA"), "Microsoft\Windows\Start Menu\Programs\Startup", f"{app_name}.vbs")
            if os.path.exists(vbs_path):
                os.remove(vbs_path)
                print(f"Windows autostart disabled: {vbs_path}")
        except Exception as e:
            print(f"Error disabling Windows autostart: {e}")
    elif current_os == "Darwin":
        # macOS autostart logic remains the same
        pass
    else:
        print(f"Autostart not supported on {current_os}")

def start_server():
    """Function to run the FastAPI server as a subprocess."""
    global server_process
    os.chdir(APP_ROOT)
    command = [
        sys.executable,
        "-m", "uvicorn",
        "server.server:app",
        "--host", settings.server_host,
        "--port", str(settings.server_port),
    ]
    # Enable reload only in debug mode
    if settings.debug:
        command.append("--reload")
        
    server_process = subprocess.Popen(command)

def start_celery_worker():
    """Function to run the Celery worker as a subprocess."""
    global celery_process
    os.chdir(APP_ROOT)
    command = [
        sys.executable,
        "-m", "celery",
        "-A", "server.celery_app",
        "worker",
        "--loglevel=info"
    ]
    celery_process = subprocess.Popen(command)

def on_tray_menu_select(icon, item):
    """Function to handle tray menu selections."""
    global window, server_process, celery_process
    if str(item) == "Open Library":
        if window:
            window.show()
    elif str(item) == "Exit":
        if server_process:
            server_process.terminate()
        if celery_process:
            celery_process.terminate()
        if window:
            window.destroy()
        icon.stop()
        sys.exit()

def start_webview():
    """Function to create and open the webview window."""
    global window
    time.sleep(5) # Wait for server to start
    window = webview.create_window(
        settings.app_name,
        f"http://{settings.server_host}:{settings.server_port}/library",
        width=1200,
        height=800,
    )
    webview.start()

def setup_tray(icon):
    icon.run()

if __name__ == "__main__":
    # Autostart is now configured via .env or environment variables
    if settings.autostart:
        enable_autostart()
    else:
        disable_autostart()

    start_server()
    start_celery_worker()

    image = Image.new('RGB', (64, 64), 'white')
    menu = (pystray.MenuItem('Open Library', on_tray_menu_select), pystray.MenuItem('Exit', on_tray_menu_select))
    icon = pystray.Icon("name", image, settings.app_name, menu)

    tray_thread = threading.Thread(target=setup_tray, args=(icon,), daemon=True)
    tray_thread.start()

    start_webview()

    if server_process:
        server_process.terminate()
    if celery_process:
        celery_process.terminate()
    sys.exit(0)