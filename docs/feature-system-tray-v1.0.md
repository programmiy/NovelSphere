# Feature: System Tray/Menubar Functionality

## Description

Implemented system tray functionality for the LANOVEL desktop application. This includes:
- Displaying a system tray icon when the application is running.
- Providing a context menu on right-clicking the tray icon with "Open Library" and "Exit" options.
- The "Open Library" option opens the main application window.
- The "Exit" option properly closes the application.

## Changes

- Modified `main.py` to integrate `pywebview`'s system tray features.
- Added `sys` import for application exit handling.
- Defined `on_tray_menu_select` and `open_library` functions to manage tray menu actions.
- Configured `webview.create_window` to include a `webview.Tray` object with the defined menu.
