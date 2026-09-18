# Tasks

## 1. Server: immutable cache headers for hashed assets (①)

- [x] 1.1 NEW `packages/server/src/__tests__/static-cache-headers.test.ts`: throws a tmp
  `clientDistOverride` (hashed asset + `.gz` sibling + root html), boots the real server, asserts
  `immutable` + `max-age=31536000` on `/assets/x-HASH.js` and its gzip response; `no-store` on `/`
  and unknown routes.
- [x] 1.2 `packages/server/src/server.ts` `setHeaders`: path-segment `assets` branch (uses `path.sep`,
  never the browser-supplied string) → `public, max-age=31536000, immutable`; `.html` branch keeps
  `no-store`; SPA fallback untouched. `.gz` inherits the decision (runs before the precompressed
  branch).

## 2. mdi: namespace-import elimination + generated dynamic key table (②)

- [x] 2.1 NEW `scripts/generate-dynamic-mdi-keys.mjs`: scans `packages/*/src` + test fixtures for
  quoted `mdi…` literals, verifies each against installed `@mdi/js`, unions into
  `packages/shared/src/dynamic-mdi-keys.json` (preserves manual additions). NEW
  `scripts/__tests__/generate-dynamic-mdi-keys.test.mjs`: idempotence, missing-key failure,
  fixture coverage.
- [x] 2.2 `packages/shared/src/dynamic-mdi-keys.json` generated (includes fixture keys:
  mdiCheck/mdiDelete/mdiRefresh/mdiContentSave/mdiTableLarge/mdiTotallyMadeUpName etc.).
- [x] 2.3 `packages/client/src/lib/preview/mdi-icon-lookup.ts`,
  `packages/client-utils/src/StatusPill.tsx`, `packages/client-utils/src/ActionList.tsx`: namespace
  import → JSON lookup with `in` check; unknown key → `null` (return types unchanged). `manualChunks`
  `"mdi"` entry kept (chunk name stable for guards).
- [x] 2.4 NEW tripwires: `packages/client/src/__tests__/mdi-no-namespace-import.test.ts` (3 files,
  no `import * as mdi`), `packages/client/src/lib/preview/__tests__/dynamic-mdi-keys.test.ts` (each
  key === named export value; unknown → null). `mdi-chunk-size.test.ts` tightened: mdi gz cap
  150 KB + entry marker check retained.

## 3. Markdown payload lazy boundaries (③)

- [x] 3.1 NEW hosts: `components/preview/LazyMarkdownContent.tsx`,
  `components/interactive-renderers/LazyInteractiveRenderer.tsx`,
  `components/tool-renderers/LazyToolRenderer.tsx` — module-level `React.lazy(() => import(…))`,
  built-in `Suspense fallback={null}`, mount-time `void import()` prefetch (InlineTerminalCard
  precedent).
- [x] 3.2 All 19 `MarkdownContent` runtime importers → `LazyMarkdownContent` (main.tsx primitive
  registration updated); `FilePreviewContext.tsx` / `FileLink.tsx` `FilePreviewOverlay` static
  imports → module-level lazy. `ChatView` InteractiveUiCard + `MultiAskPanel` render through
  `LazyInteractiveRenderer`; `ToolCallStep` built-in path renders through `LazyToolRenderer`
  (plugin-claim path untouched).
- [x] 3.3 `packages/client/vite.config.ts`: post-loop `vite/preload-helper` → `util` rule (the
  helper must never land in a LAZY chunk or the entry re-preloads it); NOTE comment recording why
  `syntax-theme.ts` must NOT be pinned into `markdown` (its theme import carries the i18n module;
  pinning re-grows the entry↔markdown static edge).
- [x] 3.4 NEW `components/preview/__tests__/LazyMarkdownContent.test.tsx` +
  `src/__tests__/markdown-lazy-boundaries.test.ts` (source tripwire); `lazy-feature-chunks.test.ts`
  extended with the 3 boundary hosts + markdown payload absence from `index.html`.
- [x] 3.5 Async fallout sweep: 18 suites switched sync→`findBy*`/`waitFor` on
  lazily-rendered content only (status ticks / retry rows / plugin paths kept sync).
- [x] 3.6 `eml-bundle-exclusion.test.ts`: `syntax-theme-*` exempted from the
  no-standalone-syntax-chunk rule (it is the lazy prism-theme module, not the folded
  react-syntax-highlighter vendor chunk; forcing it into `markdown` re-pins the preload regression).
- [x] 3.7 Rebuild verified: preload set = `index, util, mdi, diff, dnd, react-vendor` + CSS;
  entry static imports = `{diff, dnd, mdi, react-vendor, util}` only; markdown chunk emitted
  (338.60 KB gz) but not preloaded — no static entry→markdown edge.

## 4. openspec-config request dedupe + failure negative-cache (④)

- [x] 4.1 RED `packages/client/src/lib/openspec/__tests__/useOpenSpecConfig-dedupe.test.tsx`:
  3 concurrent same-cwd hooks → 1 fetch; shared request not tied to a per-hook signal; unmount of
  one does not break siblings; failed fetch suppresses remount refetch within TTL; refetch after
  TTL; success clears the failure entry; `__resetOpenSpecConfigCache` clears it (epoch path).
- [x] 4.2 GREEN `packages/client/src/lib/openspec/openspec-config-api.ts`: module-level
  `inflightConfigFetches` map + `configFailureAt` map, exported
  `OPENSPEC_CONFIG_FAILURE_TTL_MS = 30_000`, per-hook `cancelled` flag replacing the
  `AbortController`, success clears the failure entry; `__resetOpenSpecConfigCache` clears both maps
  + config cache; seed-then-refetch semantics kept.

## 5. Verification & artifacts (⑤)

- [x] 5.1 Guard sweep against a fresh build: `lazy-feature-chunks` (12), `markdown-chunk-size`,
  `mdi-chunk-size`, `eml-bundle-exclusion`, `markdown-lazy-boundaries`, `mdi-no-namespace-import` —
  27/27 green, 6 files.
- [x] 5.2 Full suite `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` + grep — see
  verification log; known pre-existing reds (keeper E5, openspec-poller-parity, spawn-correlation
  RSS flake, mutation twins) are not regression signals.
- [x] 5.3 `npx tsc --noEmit` (known TS6059 fixture noise only), `node scripts/check-conventions.mjs`,
  `biome check` on changed files.
- [x] 5.4 OpenSpec change artifacts: this proposal + 4 spec deltas + tasks.md;
  `openspec validate trim-cold-start-transfer-and-config-fanout --strict`.
- [x] 5.5 Sidecar `*.AGENTS.md` rows updated for touched files/dirs (server static region,
  mdi-icon-lookup, preview/, interactive-renderers/, tool-renderers/, lib/openspec/, scripts/,
  vite.config chunk rules).
- [x] 5.6 `docker/nginx.conf` checked for its own `/assets` rules — none present (report only).
- [x] 5.7 Deploy (`npm run build` → `scripts/sync-served-client.mjs` → `/api/restart`) and
  browser-measured transfer numbers are OUT of this change's scope: a running-instance deploy
  requires separate explicit authorization.
