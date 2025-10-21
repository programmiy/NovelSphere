# Feature: Native OS Notifications

## Description

Implemented native OS notifications for key events in the LANOVEL desktop application. Currently, a notification is sent when the "fetch missing titles" background task completes.

## Changes

-   **`main.py`**:
    -   Implemented `send_notification(title, message)` function to display native OS notifications using `pywebview`'s `show_notification` method.
    -   Modified `update_progress_bar()` to call `send_notification()` when the "fetch missing titles" task reaches 100% completion.
