# useArchivedSessions.ts — index

Per-key lazy cache for archived-session listings (`<groupPath>` for folder folds, `q:<text>` for search). Exports `useArchivedSessions`, `ARCHIVE_PAGE_SIZE` (50), `ArchivedKeyState`. Loads pages, retries, invalidates on count changes. See change: archive-sessions-lazy-load.
