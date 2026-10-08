# Fix: Stacking Toast Notifications v1.0

## Description

This update refactors the toast notification system to support stacking. Previously, new notifications would replace the existing one. Now, multiple notifications can be displayed simultaneously, stacking on top of each other.

This prevents notifications from being missed during busy processes and provides a more robust user feedback mechanism.

## Changes

### 1. Stacking Toast Logic

-   **File:** `server/static/admin.js`
-   **Change:** The `showToast` function was completely overhauled.
    -   It now manages a dedicated `#toast-container` element.
    -   New toasts are prepended to the container, causing them to appear at the top of the stack.
    -   Each toast has an independent 5-second timer. When the timer expires, the toast is gracefully removed with a fade-out animation.

### 2. CSS for Stacking

-   **File:** `server/static/admin.css`
-   **Change:** Added styles for the `#toast-container` and adjusted the `.toast` styles.
    -   The container is positioned at the top-right of the screen.
    -   Individual toasts are styled to appear as block elements within the container, with appropriate margins and animations for entering and leaving the stack.
