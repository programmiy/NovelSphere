# Fix: Separator Recognition Issue

- **Date**: 2025-11-15
- **File**: `extension/content.js`

## Description

The separator `&lt;あとがき&gt;` was not being recognized because it was being treated as a literal string with HTML entities, while the code was only checking for the full-width character version `＜あとがき＞`.

## Changes

- Modified the `translateAllPTags` function in `extension/content.js`.
- Added a condition to recognize `&lt;あとがき&gt;` as a separator, ensuring that translation stops correctly.
