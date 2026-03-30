@echo off
rem Change directory to the project folder
cd /d "C:\LANOVEL"

rem Start the uvicorn server in the background
uvicorn server.server:app --port 8001 --host 0.0.0.0  --reload