# Fix: Find and Replace Count v1.0

## Description

This update fixes a bug in the global "Find and Replace" feature where the success notification was reporting an incorrect number of updated items.

## Changes

-   **File:** `server/server.py`
-   **Function:** `find_replace_all`
-   **Before:** The `UPDATE` query ran on all translation records, and `cursor.rowcount` returned the total number of rows processed, not the number of rows that were actually changed.
-   **After:** The `UPDATE` query now includes a `WHERE translated LIKE ?` clause. This ensures that the operation only affects rows where the search string is present, causing `cursor.rowcount` to return the accurate number of modified records.
