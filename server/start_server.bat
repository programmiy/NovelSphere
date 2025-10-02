@echo off
rem Change directory to the project folder
cd /d "D:\attempt\python scraper~rj\LANOVEL\server"

rem Start the uvicorn server in the background
uvicorn server:app --port 8001
