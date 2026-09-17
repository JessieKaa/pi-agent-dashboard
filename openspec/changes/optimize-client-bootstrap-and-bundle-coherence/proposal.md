# Client bootstrap: coherent served-bundle verification + lazy terminal/diff boundaries

## Why

The performance audit traced two first-order problems in the production bootstrap path.

1. **The workspace build and the served static artifact can drift with no way to see
   it.** `POST /api/restart` restarts a server that resolves the installed
   `@blackbelt-technology/pi-dashboard-web/dist` first (module-resolver identity),
   while `npm run build` writes the workspace `packages/client/dist`. The audit
   observed the live `/api/health.bundleHash`
   (`879d335…`) differing from the `PLUGIN_REGISTRY_HASH` embedded in the browser's
   actually-loaded bundle (`59d19bd…`). Because the staleness banner compares the
   server's live hash with the *loaded bundle's* embedded hash, a refresh loop
   cannot converge — the reload keeps loading the same mismatched artifact. Nothing
   in the health surface or the rebuild script reports which static artifact is being
   served or whether it matches the running server.

2. **The landing import graph eagerly reaches terminal and Diff code.** `manualChunks`
   splits `@xterm/*` and `@git-diff-view/*` into files, but manual chunks are not lazy
   boundaries. `EditorPane.tsx` statically imports `TerminalPaneLayer`, `App.tsx`
   statically imports `FileDiffView`, and `pseudo-tab-registry.tsx` statically imports
   `DiffViewer`. Cold mobile boot measured ~2.3 MB of root JS transfer across these
   chunks before any chat renders, driving a 16.6s LCP under Fast-3G + 4x CPU.

Both fixes are reachable without touching the plugin-contract surface (Markdown global
primitives, MDI) that the audit identified as higher risk.

## What Changes

- **Production builds emit a served-artifact declaration.**
  `packages/client/dist/pi-dashboard-build.json` will record a schema version plus the
  same deterministic plugin registry hash already embedded as `PLUGIN_REGISTRY_HASH`.
  It contains no timestamps and no machine-specific paths. The declaration is written
  by the dashboard Vite plugin's production build output lifecycle, after registry
  generation, from the same plugin set. Dev/HMR registry generation remains
  source-only and writes no declaration.

- **The server reports whether its served artifact matches the running plugin set.**
  Static-root resolution moves into one focused helper that preserves the existing
  package-first identity (installed `@blackbelt-technology/pi-dashboard-web` first,
  workspace sibling as the dev fallback). `server.ts` resolves the directory once,
  serves from that exact directory, and reads the declaration at startup. `registerSystemRoutes`
  receives the safe snapshot and adds an additive `/api/health.clientBuild` object —
  the served registry hash (or `null`) plus an explicit status:
  `matched` | `mismatched` | `metadata-missing` | `not-served`. The existing
  `.bundleHash` field and the browser `PluginStalenessBanner` contract are unchanged;
  a startup diagnostic names the condition without printing a filesystem path.

- **The developer rebuild path deploys one verified artifact set.**
  A small Node helper resolves the served static destination the same way the server
  does, synchronizes the freshly built workspace output into it when the two differ,
  and verifies both sides carry identical declarations. `scripts/rebuild-restart.sh`
  runs it between the client build and the restart, so an incoherent set fails before
  any restart or bridge reload. `API-only` hosts and workspace-only layouts are
  explicit, supported outcomes rather than silent mismatches.

- **Terminals load only when a terminal tab exists.** `EditorPane.tsx` replaces the
  static `TerminalPaneLayer` import with a local `React.lazy` boundary, rendered only
  once `openTerminalIds(paneState.openFiles)` is non-empty. The keep-alive contract is
  unchanged: `TerminalPaneLayer` stays the single `TerminalView` mount point, one
  instance per terminal id, hidden by the active-tab toggle rather than unmounted, so
  no WebSocket is re-established on tab switches.

- **Diff loads only at its own routes.** `App.tsx` lazy-loads `FileDiffView` for the
  `/session/:id/diff` branch with a route-local suspense fallback, and
  `pseudo-tab-registry.tsx` swaps only its `diff` entry to a lazy component. The D3
  import-cycle boundary is preserved: `viewer-registry.tsx` and `CappedViewer.tsx`
  still never import a pseudo-tab viewer.

- **Build-output guards pin both properties.** A new build-output regression test
  (beside the existing chunk-size guards) asserts the emitted cold-landing
  `index.html` does not module-preload the `xterm` or `diff` chunks while both chunks
  still exist for their feature routes. It skips without a build and fails loudly if a
  chunk is renamed or merged, the same convention the Monaco/Markdown guards use.

Explicitly **excluded** (each needs its own change): Markdown global-primitive
registration and MDI reduction, mobile banner layout-shift work, startup metadata
request fan-out (openspec/git-status/kb-stats per-folder fetches), sidebar
session-state fan-out, and DnD measurement scaling.

## Capabilities

### Added Capabilities

- `served-client-build-coherence`: the production client artifact carries a
  deterministic build declaration; the server reports whether the static artifact it
  actually serves agrees with its runtime plugin set; the local rebuild path verifies
  that agreement before restarting.
- `lazy-feature-bootstrap`: terminal and diff feature code SHALL NOT be part of the
  cold landing dependency graph — they load when their surfaces open, without
  changing the keep-alive terminal contract or the viewer-registry cycle boundary.

## Impact

**Code**

- `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` — production builds
  write the served-artifact declaration alongside the generated registry.
- `packages/server/src/server.ts` — resolve the static root once via the extracted
  helper; serve from that directory; read the declaration; pass the snapshot into
  system routes; log a path-free startup diagnostic.
- `packages/server/src/routes/system-routes.ts` — additive
  `/api/health.clientBuild` from the injected snapshot; `.bundleHash` unchanged.
- `packages/client/src/components/editor-pane/EditorPane.tsx` — lazy terminal-layer
  boundary gated on open terminal tabs.
- `packages/client/src/components/editor-pane/pseudo-tab-registry.tsx` — lazy `diff`
  entry only.
- `packages/client/src/App.tsx` — route-local lazy `FileDiffView`.
- `scripts/rebuild-restart.sh` — verified sync/verify step before restart.

**Tests**

- Runtime-plugin tests for declaration emit/validate/read, including malformed and
  missing metadata.
- Server health tests for all four `clientBuild` states plus the unchanged
  `bundleHash` field.
- Synchronization-helper tests over temporary directories: copies a complete build,
  rejects missing/invalid declarations, never reports a mismatch as success.
- Editor-pane tests: a terminal tab mounts the keep-alive layer once, switching away
  hides rather than unmounts, closing the tab tears it down.
- Retained viewer-registry partition tests and DiffViewer resolution tests.
- New build-output guard: cold `index.html` preloads neither `xterm` nor `diff`.
- `PluginStalenessBanner.test.tsx` stays green (browser contract unchanged).

**Docs**

- Nearest-directory AGENTS.md rows for the new helper files and the changed
  Vite/server/editor files.
- `README.md` distinguishes a workspace-only build from the verified local
  deployment path.
- `docs/architecture.md` gains the build → served static artifact → health
  compatibility flow (DocScribe).

Out of scope (see What Changes): no deployment or restart is performed by this
change's implementation or automated verification; running the verified rebuild
script against the live dashboard remains a separately authorized action.

## Discipline Skills

- **`performance-optimization`** — the change removes ~785 KB (`@mdi/js`-adjacent
  xterm) and ~335 KB (diff) of cold-boot transfer from the landing path. The
  measured baseline (mobile Fast-3G + 4x CPU cold LCP 16.6s, TTFB 3ms, render
  delay 16.555s) is the budget the lazy boundaries target, and the new
  build-output guard pins the preload property the measurement depends on.
- **`observability-instrumentation`** — the served-artifact declaration plus
  `/api/health.clientBuild` is a new health surface for an existing blind spot
  (which static artifact is served). The startup diagnostic and status enum are
  the instrumentation; there is no new job or external call.
- **`review-code`** — the lazy boundaries touch two contract-heavy seams (terminal
  keep-alive single-mount, D3 viewer-registry cycle) and the sync helper performs
  filesystem mutation on a deployment path. A review pass before commit guards all
  three.

`security-hardening` (no untrusted input or secret surface added; the health field
deliberately carries no filesystem path), `systematic-debugging` (root causes are
established with measurements, not speculation, and pinned by build-output tests),
and `doubt-driven-review` (no migration or public API break — the health field is
additive) do not apply.
