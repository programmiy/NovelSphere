@echo off
rem Change directory to the project folder
cd /d "D:\attempt\python scraper~rj\LANOVEL"

rem Start the uvicorn server in the background
start /b uvicorn server:app --port 8000
