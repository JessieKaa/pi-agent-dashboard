# DOX — packages/client

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. React + Tailwind web client, published as a prebuilt `dist/`. Documents the `./chat-embed` export. |
| `vite.config.ts` | Vite config for client package. Resolves dashboard port via `PI_DASHBOARD_PORT` env → `/tmp/dash-dev-port` marker → `~/.pi/dashboard/config.json` → fallback `8000`. Aliases shared + client-utils sources. `viteDashboardPluginsPlugin` loads dashboard plugins from repo root. `manualChunks` splits react-vendor, markdown, git-diff-view (heavy renderers — lazy subtrees only), diff (small npm util, stays eager for chat line-counts), xterm, dnd, util, monaco chunks. See change: optimize-client-bootstrap-and-bundle-coherence (P1). Dev server proxies `/api` + `/ws` to dashboard port. |
| `vitest.config.ts` | Vitest config for client package. Mirrors `vite.config` aliases (shared + client-utils → workspace `src`) so tests resolve worktree source over hoisted symlink. jsdom, `pool: "forks"`, shared `setup-home.ts` globalSetup. |
