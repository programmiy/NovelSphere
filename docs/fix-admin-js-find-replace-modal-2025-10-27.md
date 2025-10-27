# Fix: Find & Replace Modal Closing Error

- **Date:** 2025-10-27
- **Commit:** `1f3f8046d4541d2062291edf2da22eb6c588ca4d`

## Description

This commit fixes a `TypeError` that occurred in the admin panel (`admin.js`). The `executeGlobalFindReplace` function and event listeners for the close/cancel buttons called a function `closeFindReplaceModal()` which was not defined.

## Changes

- **`server/static/admin.js`**:
  - Added the `closeFindReplaceModal()` function definition. This function hides the find and replace modal.
  - This resolves the error and allows the modal to be closed as intended after a find/replace operation or by clicking the close/cancel buttons.
