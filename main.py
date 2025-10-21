import threading
import time
import os
import uvicorn
import webview
import sys # Import sys for exit
import platform # Import platform to detect OS
import json # Import json to read settings
import requests # Import requests for API calls

# Get the directory where main.py is located
# This will be the root of the packaged application
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(APP_ROOT, "server") # Assuming server.py is in a 'server' subdirectory

# Path to the settings file
SETTINGS_FILE = os.path.join(SERVER_DIR, "settings.json")

# Ensure the logs directory exists within the packaged app's root
LOG_DIR = os.path.join(APP_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

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
    app_path = os.path.abspath(sys.argv[0]) # Path to the executable

    if current_os == "Windows":
        try:
            # Create a VBScript to run the executable silently
            vbs_path = os.path.join(os.getenv("APPDATA"), "Microsoft\\Windows\\Start Menu\\Programs\\Startup", f"{app_name}.vbs")
            with open(vbs_path, "w") as vbs_file:
                vbs_file.write(f'Set WshShell = CreateObject("WScript.Shell")\n')
                vbs_file.write(f'WshShell.Run chr(34) & "{app_path}" & chr(34) & " -minimized", 0\n')
                vbs_file.write(f'Set WshShell = Nothing\n')
            print(f"Windows autostart enabled: {vbs_path}")
        except Exception as e:
            print(f"Error enabling Windows autostart: {e}")
    elif current_os == "Darwin": # macOS
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
            # Load the LaunchAgent
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
    elif current_os == "Darwin": # macOS
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
    try:
        webview.windows[0].show_notification(title, message)
    except Exception as e:
        print(f"Error sending notification: {e}")

# Function to run the FastAPI server
def start_server():
    # Change current working directory to the server directory
    # so server.py can find its static/templates/db files correctly
    os.chdir(SERVER_DIR)
    # Use the server.py module directly
    uvicorn.run("server:app", host="127.0.0.1", port=8001, log_level="info")

# Function to handle tray menu selections
def on_tray_menu_select(window, item):
    if item == "Open Library":
        open_library(window)
    elif item == "Exit":
        window.destroy()
        sys.exit() # Ensure the application fully exits

# Function to open the webview window to the library URL
def open_library(window):
    if not window.is_shown():
        window.show()
    window.load_url("http://127.0.0.1:8001/library")
    window.set_focus()

# Function to update the progress bar
def update_progress_bar(window):
    try:
        response = requests.get("http://127.0.0.1:8001/api/progress")
        response.raise_for_status()
        progress_data = response.json()

        if progress_data["task"] == "fetch_titles" and progress_data["total"] > 0:
            percentage = progress_data["percentage"]
            window.set_title(f"LANOVEL - Fetching Titles ({percentage}%)")
            # pywebview doesn't have a direct progress bar API for the window itself.
            # This would typically involve injecting JS into the webview to update a custom progress bar,
            # or using OS-specific APIs if pywebview exposed them.
            # For now, we'll update the title as a simple feedback mechanism.
            # If a more advanced progress bar is needed, it would require more complex JS injection.
        else:
            if progress_data["task"] == "fetch_titles" and progress_data["percentage"] == 100:
                send_notification("LANOVEL", "제목 가져오기 작업이 완료되었습니다.")
            window.set_title("LANOVEL") # Reset title
    except requests.exceptions.RequestException as e:
        print(f"Error fetching progress: {e}")
    finally:
        # Schedule the next update
        threading.Timer(2, update_progress_bar, args=(window,)).start()

# Function to create and open the webview window
def start_webview():
    # Wait for the server to start
    time.sleep(5) # Give the server some time to boot up

    # Define tray menu
    tray_menu = (
        webview.menu.Menu(
            "Open Library",
            on_tray_menu_select,
            "Open the LANOVEL library in the app"
        ),
        webview.menu.Menu(
            "Exit",
            on_tray_menu_select,
            "Close the LANOVEL application"
        )
    )

    # Create a webview window
    window = webview.create_window(
        "LANOVEL",
        "http://127.0.0.1:8001/library",
        width=1200,
        height=800,
        # Set the tray icon. If no .ico found, pywebview might use a default or none.
        # For now, we'll omit the icon path and let pywebview handle it.
        # If an icon is provided later, it can be added here: icon='path/to/icon.ico'
        tray=webview.Tray(
            icon=None, # Placeholder for now, will add if user provides one
            menu=tray_menu
        )
    )
    webview.start()
    # Start the progress bar update loop
    threading.Timer(2, update_progress_bar, args=(window,)).start()

if __name__ == "__main__":
    # Apply autostart setting on application launch
    if load_autostart_setting():
        enable_autostart()
    else:
        disable_autostart()

    # Start the FastAPI server in a separate thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Start the webview window
    start_webview()