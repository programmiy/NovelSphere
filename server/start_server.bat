@echo off
rem Change directory to the project folder
cd /d "C:\LANOVEL\server"

rem Start the uvicorn server in the background
uvicorn server:app --port 8001 --workers 13 --host 0.0.0.0