# Feature: Taskbar Progress Display

## Description

Implemented a basic taskbar progress display for long-running background tasks, specifically for fetching missing titles. The application's window title will now show the progress percentage during this operation.

## Changes

-   **`server/server.py`**:
    -   Added a global dictionary `PROGRESS_STATUS` to track the current task, current item, total items, and percentage.
    -   Modified `process_urls_in_background` to update `PROGRESS_STATUS` during its execution and reset it upon completion.
    -   Added a new API endpoint `GET /api/progress` to expose the `PROGRESS_STATUS` to the frontend.
-   **`main.py`**:
    -   Imported the `requests` library for making HTTP calls to the backend.
    -   Implemented `update_progress_bar(window)` function which:
        -   Fetches the progress status from `/api/progress`.
        -   If a task is active, updates the `pywebview` window's title to display the progress percentage.
        -   Resets the title when no task is active.
        -   Schedules itself to run every 2 seconds using `threading.Timer`.
    -   Integrated the `update_progress_bar` function call into `start_webview` to initiate the progress monitoring loop.
