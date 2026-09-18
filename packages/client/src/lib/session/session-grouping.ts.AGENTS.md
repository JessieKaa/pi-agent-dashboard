# session-grouping.ts — index

Pure session grouping/sorting/filtering utilities. Exports `DirectoryGroup`, `WorkspaceGroup`, `sortSessionsByOrder`, `getUnifiedOrder`, `groupSessionsByDirectory`, `groupSessionsByDirectoryWithWorkspaces`, `filterSessions`, `filterByQuery`, `rankActiveFirst`; re-exports `inferPlatform`, `pathKey`, `resolveSessionGroupPath` from shared. Group-key precedence: pin > `gitWorktree.mainPath` > `cwd`; keyed by canonical `pathKey` to collapse cosmetic drift. See change: simplify-session-card-ordering, folder-workspaces.
C2 (change: fix-archive-feedback-and-sidebar-perf): `groupKeyOf` folds via `pathKey(resolveOrderKey(...), platform)` so `endedTotals`/archive-index/paging all share the folded key space.
B2 (change: fix-archive-feedback-and-sidebar-perf): group keys fold to `pathKey` space so `endedTotals` counts and paging gates stop drifting on cosmetic path variants (`/a/b` vs `/a/b/`).
