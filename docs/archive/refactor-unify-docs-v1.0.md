# Refactor: Unify Documentation Directories

- **Version:** 1.0
- **Date:** 2025-10-10

## Description

This refactoring unifies the previously separate `extension/docs` and `server/docs` directories into a single, root-level `docs` directory. This change simplifies the project structure and makes it easier to find all documentation in one place.

## Changes

- Created a new `docs` directory at the project root.
- Moved all markdown files from `extension/docs` to the new `docs` directory.
- Moved all markdown files from `server/docs` to the new `docs` directory.
- Removed the now-empty `extension/docs` and `server/docs` directories.
