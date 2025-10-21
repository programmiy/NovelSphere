# Feature: Auto-start on Computer Startup

## Description

Implemented the functionality for the LANOVEL desktop application to automatically start when the computer boots up. This feature is configurable via a checkbox in the admin settings UI.

## Changes

-   **`server/templates/admin.html`**: Added a "컴퓨터 시작 시 자동 실행" (Auto-start on computer startup) checkbox to the admin UI.
-   **`server/static/admin.css`**: Added CSS styles for the new custom checkbox.
-   **`server/static/admin.js`**:
    -   Cached the `autoStartCheckbox` element.
    -   Added an event listener to `autoStartCheckbox` to trigger `saveAutoStartState()` on change.
    -   Modified `loadAndRenderGrouped()` to fetch the initial auto-start setting from the backend and update the checkbox state.
    -   Implemented `saveAutoStartState()` to send the checkbox state to the backend API.
-   **`server/server.py`**:
    -   Defined `SETTINGS_FILE` and `SETTINGS` global variables for managing application settings.
    -   Implemented `load_settings()` and `save_settings()` functions to handle reading from and writing to `settings.json`.
    -   Updated the `lifespan` function to call `load_settings()` on application startup.
    -   Added new API endpoints:
        -   `GET /api/settings/autostart`: Retrieves the current auto-start setting.
        -   `POST /api/settings/autostart`: Updates the auto-start setting.
-   **`main.py`**:
    -   Imported `platform` and `json` modules.
    -   Defined `SETTINGS_FILE` to locate the settings file.
    -   Implemented `load_autostart_setting()` to read the auto-start preference.
    -   Implemented OS-specific `enable_autostart()` and `disable_autostart()` functions for Windows (using VBScript in Startup folder) and macOS (using LaunchAgents plist).
    -   Integrated the auto-start logic into the main execution block (`if __name__ == "__main__":`) to apply the setting on application launch.
