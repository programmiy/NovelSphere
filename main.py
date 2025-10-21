import threading
import time
import os
import uvicorn
import webview

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

# Function to create and open the webview window
def start_webview():
    # Wait for the server to start
    time.sleep(5) # Give the server some time to boot up

    # Create a webview window
    webview.create_window("LANOVEL", "http://127.0.0.1:8001/library", width=1200, height=800)
    webview.start()

if __name__ == "__main__":
    # Start the FastAPI server in a separate thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Start the webview window
    start_webview()