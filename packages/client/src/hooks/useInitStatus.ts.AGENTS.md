# useInitStatus.ts — index

`useInitStatus(cwd) → { status: WorktreeInitStatus\|null, refetch }`. Single shared `GET /api/git/worktree/init-status` probe for a folder-action-bar row; feeds BOTH `ProjectInitButton` (scaffold) and `WorktreeInitButton` (hook run) from one fetch (avoids double-probe). `refetch` re-issues after a hook run flips the gate. Fail-open via `fetchWorktreeInitStatus`. See change: distinguish-initialize-actions.
A5 cache (change: fix-archive-feedback-and-sidebar-perf): module-level resolved-cwd cache + in-flight dedup (lib/git/init-status-cache.ts) — remounts for a resolved cwd serve from cache (zero probes); `refetch()` bypasses and repopulates; failures do not poison the cache. C2 bounds how many stub rows can probe at all (`STUB_GROUP_BUDGET`).
