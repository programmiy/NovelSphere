
# Admin Page Multi-Drag and Drop

This document outlines the implementation of multi-drag and drop functionality on the admin page.

## Feature

- Users can now select multiple URL groups and drag them simultaneously to reorder them within a folder.
- Selection is done by clicking on the URL group headers.
- Selected items are highlighted with a different background color.

## Implementation Details

- **SortableJS `MultiDrag` Plugin:** The `MultiDrag` plugin for `SortableJS` is used to enable this functionality.
- **`admin.js`:**
    - The `MultiDrag` plugin is mounted.
    - The `Sortable` instance is initialized with `multiDrag: true` and `selectedClass: 'selected-drag'`.
    - The `handleHistoryClick` function is updated to toggle the `selected-drag` class on the `.list-group` elements when they are clicked.
- **`admin.css`:**
    - A new style for the `.selected-drag` class is added to provide visual feedback for selected items.
