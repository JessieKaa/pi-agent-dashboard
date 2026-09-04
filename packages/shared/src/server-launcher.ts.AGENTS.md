# server-launcher.ts — index

`launchDashboardServer` — single shared spawn primitive (jiti loader, argv, env, log header, readiness) used by Bridge / Standalone / Electron starters. Also exports `RECOVERY_PORT_CONFLICT_EXIT_CODE` + `isPortConflictExitCode` (child exit 2 → `PortConflictError`). See change: fix-worktree-server-autostart-leak.
