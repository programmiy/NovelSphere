import threading
import time
import os
import uvicorn
import webview
import sys # Import sys for exit

# Get the directory where main.py is located
# This will be the root of the packaged application
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.join(APP_ROOT, "server") # Assuming server.py is in a 'server' subdirectory

# Ensure the logs directory exists within the packaged app's root
LOG_DIR = os.path.join(APP_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

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

if __name__ == "__main__":
    # Start the FastAPI server in a separate thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Start the webview window
    start_webview()