# Tasks

## 1. Served-artifact declaration (build side)

- [x] 1.1 NEW `packages/dashboard-plugin-runtime/src/server/build-metadata.ts` (Node-only):
  declaration filename constant, schema type (`{ schemaVersion: 1; pluginRegistryHash: string }`),
  `serializeBuildMetadata()` (deterministic key order, no timestamps/paths), `parseBuildMetadata(raw)`
  (null on malformed/missing fields), `readBuildMetadata(dirPath)` (safe read → null). Plus
  `build-declaration-sdk.ts` (the Vite-plugin-facing surface) — both re-exported from
  `src/server/index.ts`.
- [x] 1.2 `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts`: `configResolved` captures the
  resolved build outDir (build command only); `buildStart` regenerates the registry; `closeBundle`
  writes `pi-dashboard-build.json` from the SAME entry set that generates `PLUGIN_REGISTRY_HASH`.
  Dev/HMR writes nothing.
- [x] 1.3 NEW test `packages/dashboard-plugin-runtime/src/__tests__/build-metadata.test.ts` (10 tests):
  roundtrip serialize→parse; malformed JSON → null; wrong schemaVersion → null; missing hash field →
  null; `readBuildMetadata` on missing file → null; no timestamp / no absolute path in serialized form.
  Plus `vite-plugin.test.ts` additions covering the closeBundle emit.

## 2. Server: resolve once, serve that, report compatibility

- [x] 2.1 NEW `packages/server/src/lib/client-dist.ts` (actual location; plan hedged on
  `src/static/`): extracts the installed-package-first resolution inline in `server.ts`
  (`createRequire().resolve("@blackbelt-technology/pi-dashboard-web/package.json")` → sibling `dist`
  when `index.html` exists; workspace sibling fallback; `DASHBOARD_CLIENT_DIST_DIR` env override).
  Returns the resolved directory or `null`.
- [x] 2.2 `packages/server/src/server.ts`: resolves via `resolveClientDist` once BEFORE
  `registerSystemRoutes` (`createServer(config, options?)` now takes `options.clientDistOverride`);
  the same resolved dir is reused for Fastify static serving; declaration read once; safe snapshot
  passed into system routes; one-line startup diagnostic on missing/mismatched metadata with NO
  filesystem path (filename only).
- [x] 2.3 `packages/server/src/routes/system-routes.ts`: deps type extended with the snapshot;
  additive `clientBuild` on `/api/health` with
  `{ pluginRegistryHash: string | null, status: "matched" | "mismatched" | "metadata-missing" | "not-served" }`.
  `bundleHash` computation unchanged; `PluginStalenessBanner` browser contract untouched.
- [x] 2.4 NEW `packages/server/src/__tests__/health-client-build.test.ts` (7 tests; the older
  `health-compatibility.test.ts` is untouched): all four status values driven by injected dirs;
  null dir + absent dep degrade to `not-served`; `bundleHash` still present; no absolute path in any
  response arm; missing-declaration `console.warn` carries filename only.

## 3. Verified rebuild path

- [x] 3.1 NEW `scripts/sync-served-client.mjs` (actual location: `scripts/` root, not
  `scripts/lib/`): pure helpers for resolve-destination (installed web package identity, `--dest`
  override for tests), declaration read, recursive copy, and `syncServedClient({ sourceDir, destDir })`
  that refuses a source without a valid declaration, skips the copy when destination matches, copies
  and re-verifies otherwise, and returns a structured result never reporting mismatch as success.
  CLI entry (`--dry-run` supported) at `node scripts/sync-served-client.mjs`.
- [x] 3.2 `scripts/rebuild-restart.sh`: sync/verify step inserted between client build and restart;
  fails before restart when the source declaration is missing or the destination cannot be verified.
- [x] 3.3 NEW `scripts/__tests__/sync-served-client.test.mjs` (9 tests): copy when different; no-op
  when identical; missing source declaration rejected; malformed declaration rejected; mismatch after
  copy never reported as success; no destination (workspace-only layout) → explicit result.

## 4. Lazy terminal boundary

- [x] 4.1 `packages/client/src/components/editor-pane/EditorPane.tsx`: static `TerminalPaneLayer`
  import replaced with a local `React.lazy`; rendered only when
  `openTerminalIds(paneState.openFiles).length > 0`; suspension covered by the pane body's existing
  `Suspense`. Also found + converted the second xterm entry point: `ChatView.tsx`'s
  `InlineTerminalCard` is now `Suspense`-wrapped lazy — without it xterm stayed eagerly preloaded.
- [x] 4.2 NEW `packages/client/src/components/editor-pane/__tests__/TerminalPaneLayer.keep-alive.test.tsx`
  (3 tests, mocked `TerminalView`): opening a terminal mounts one instance; switching to a file tab
  keeps it mounted (hidden, `visible=false`); switching back reuses the same instance; closing the
  terminal tab unmounts it.
- [x] 4.3 Additionally `EditToolRenderer.tsx`: desktop `RichDiff` converted to `LazyRichDiff`
  (`Suspense` fallback `null`) — the build proved it was the remaining eager `@git-diff-view` importer
  outside lazy boundaries (its mobile `HomegrownDiff` legitimately keeps eager npm `diff`).

## 5. Lazy Diff boundaries

- [x] 5.1 `packages/client/src/App.tsx`: route-local lazy `FileDiffView` for the `/session/:id/diff`
  branch plus the shell `renderDiff` slot, with an inline `DiffRouteFallback` ("Loading diff…");
  `SessionDiffProvider` and session routing stay eager.
- [x] 5.2 `packages/client/src/components/editor-pane/pseudo-tab-registry.tsx`: only the `diff` entry
  is lazy (`lazy(() => import("./DiffViewer.js")...)`); typed record pin preserved
  (`Record<PseudoTabViewer, ComponentType<ViewerProps>>`); no `DiffViewer` import reintroduced into
  `viewer-registry.tsx`/`CappedViewer.tsx`.
- [x] 5.3 `viewer-registry.test.tsx` D3 partition tests pass unchanged; `DiffViewer.test.tsx` stays
  green (mocked `DiffPanel` path unaffected).
- [x] 5.4 Remaining eager diff importing found: `EditToolRenderer` (converted, see 4.3) via
  `RichDiff`. `lineDelta.ts` imports npm `diff` (6 KB) eagerly — REQUIRED (chat turn summaries) and
  kept, which forced the `manualChunks` split below.
- [x] 5.5 `packages/client/vite.config.ts`: manualChunks split `@git-diff-view/*` (heavy renderers,
  lazy subtrees only) from npm `diff` (small util, stays eager for chat line-counts). Plan said
  "do not change manual chunk names unless the build proves a naming adjustment is required" — the
  build DID prove it: one merged `diff` chunk kept the git-diff-view graph module-preloaded.

## 6. Build-output lazy guard

- [x] 6.1 NEW `packages/client/src/__tests__/lazy-feature-chunks.test.ts` (7 tests; pattern of
  `monaco-chunk-size.test.ts`): skips without a build; source tripwire asserts each lazy-reader file
  has the dynamic import and no static import; fails when `xterm-*` / `git-diff-view-*` chunks are
  absent from `dist/assets`; fails when the entry `index.html` module-preloads either; asserts
  `pi-dashboard-build.json` matches both the generated `PLUGIN_REGISTRY_HASH` and the hash embedded
  in the served entry chunk. RED on the pre-change build, GREEN after 4.x/5.x.

## 7. Docs

- [x] 7.1 AGENTS rows: `packages/dashboard-plugin-runtime/src/server/AGENTS.md`
  (`build-metadata.ts` + `build-declaration-sdk.ts`), `src/vite-plugin/AGENTS.md` (declaration emit),
  `packages/server/src/AGENTS.md` (client-dist resolve + new test row), `src/lib/AGENTS.md`
  (`client-dist.ts`), `routes/AGENTS.md` (clientBuild field), `src/test-support/AGENTS.md`
  (`clientDistOverride: null`), `scripts/AGENTS.md` (sync helper + hardened rebuild script),
  `packages/client/src/components/editor-pane/AGENTS.md` (lazy terminal + lazy diff entry),
  `packages/client/src/components/chat/AGENTS.md` (lazy InlineTerminalCard),
  `tool-renderers/AGENTS.md` (LazyRichDiff), `packages/client/AGENTS.md` (manualChunks split),
  `packages/client/src/AGENTS.md` (lazy diff route on `App.tsx`).
- [x] 7.2 `README.md`: new `### Rebuilding the served client` section distinguishing `npm run build`
  (workspace build) from the verified local deployment path via `scripts/rebuild-restart.sh`, plus
  `/api/health.clientBuild` status meanings.
- [x] 7.3 `docs/architecture.md`: served-static + health-compatibility flow added (DocScribe,
  caveman style); `docs/AGENTS.md` architecture.md row updated.

## 8. Verify

- [x] 8.1 Focused (isolated HOME): `build-metadata.test.ts` 10 ✅, `vite-plugin.test.ts` 17 ✅,
  `health-client-build.test.ts` 7 ✅, `sync-served-client.test.mjs` 9 ✅, EditorPane suite
  79 ✅, `TerminalPaneLayer.keep-alive.test.tsx` 3 ✅, `EditToolRenderer.test.tsx` 17 ✅,
  `viewer-registry.test.tsx` + `DiffViewer.test.tsx` ✅, `PluginStalenessBanner.test.tsx` ✅,
  `lazy-feature-chunks.test.ts` 7 ✅. Full client suite 489/489 serial.
- [x] 8.2 `npm run build` → `packages/client/dist/pi-dashboard-build.json` exists; hash matches
  generated `PLUGIN_REGISTRY_HASH` (`59d19bdd…`) and is embedded in the served entry chunk; chunk-size
  + lazy guards pass against that output; modulepreload graph excludes xterm/git-diff-view.
- [x] 8.3 Full capture: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`. Final run:
  18095/18138 passed, 42 skipped, 1 failed — `spawn-correlation-performance.test.ts` RSS
  assertion under full-suite memory pressure (passes in isolation; passed in a prior full run
  with identical code). Pre-existing flakes characterized: `openspec-poller-parity.test.ts`
  (CLI-derived, unrelated change), `CwdGonePill.test.tsx` (shared-localstorage language leak).
  Also fixed MY regressions found here: 2 lazy-RichDiff async assertions (ToolCallStep,
  tool-renderer-payload-fontsize) + i18n-lint `--strict` violation from `758dc7f2`
  (MarkdownContent throw message normalized to the lowercase `use...must be used within...`
  house style). Biome pass on all changed files: no new diagnostics
  (EditorPane 8→4, server.ts 48→47, system-routes 20→13, ChatView 20→19 vs HEAD).
- [x] 8.4 Browser check on an isolated Vite dev server (`--port 5199`, no dashboard restart,
  no prompts to any session): resource-timing capture on the disposable /tmp session
  (spawned via `/api/session/spawn`, shut down + terminal closed after) —
  cold landing 0 xterm / 0 git-diff-view / 0 terminal modules; `/diff` route loads
  git-diff-view graph + FileDiffView/DiffPanel/RichDiff, xterm stays 0; editor layout alone
  loads neither; `新建终端` click loads xterm + TerminalPaneLayer and mounts `.xterm` DOM.
  Tab-switch keep-alive covered by `TerminalPaneLayer.keep-alive.test.tsx`.
- [ ] 8.5 Deployment verification is deferred to a separately authorized run: execute the hardened
  rebuild script, then `/api/health.clientBuild.status` is `matched` and the browser banner stays
  absent after a fresh load. NOTE: the dev-server run regenerated
  `packages/client/src/generated/plugin-registry.tsx` with the dev-only `demo` plugin entry —
  reverted before the final test run; do not commit a dev-flavored registry.
