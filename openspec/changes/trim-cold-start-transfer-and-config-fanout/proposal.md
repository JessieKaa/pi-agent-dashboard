# Cold-start transfer: immutable hashed assets, tree-shaken mdi, lazy markdown, deduped config fetches

## Why

Cold-start measured against the production instance (browser network panel): **6.8 MB
decoded / 2.0 MB transferred** for a first visit that renders the session list. Three
chunks dominate and every one of them is module-preloaded by the landing `index.html`:

1. **`mdi` chunk ~785 KB gz.** The full `@mdi/js` icon set is eager because three
   modules use a NAMESPACE import (`import * as mdi`). Namespace imports defeat
   tree-shaking, so Rollup keeps all ~7000 icon paths although the repo uses ~180
   named icons and has zero real dynamic keys in `packages/*/src`.
2. **`index` entry ~713 KB gz**, whose landing graph still statically reaches the
   full markdown stack (`react-markdown` + `remark-gfm` + `rehype-raw` + `dompurify` +
   `react-syntax-highlighter`) through `MarkdownContent`, the interactive-renderer
   registry, and the tool-renderer registry — none of which render on the landing
   screen.
3. **`markdown` chunk ~331 KB gz** pulled precisely because of that static edge.

Two secondary wastes compound the first-visit cost:

- **Every re-visit revalidates every hashed asset.** The static handler sets
  `no-store` only for `.html`; content-hashed `/assets/*` files fall through to
  `@fastify/static`'s default `public, max-age=0`, so a returning user re-negotiates
  ~230 files that can never change under their hash.
- **`/api/openspec/config` fans out per card.** Every `SessionCard` mounts
  `useOpenSpecConfig(cwd)`, and each hook fires its own request per mount and per
  epoch bump; concurrent cards sharing a cwd pay N requests for one identical
  payload. A failing endpoint is re-hammered on every remount.

## What Changes

- **Hashed assets become immutable; HTML stays no-store.** The server's static
  `setHeaders` gains a branch: a path containing `assets` as a path segment (the
  Vite content-hashed output directory) gets
  `Cache-Control: public, max-age=31536000, immutable`, including its precompressed
  `.gz` sibling (the header decision runs before the precompressed branch). `.html`
  keeps `no-store`; non-hashed root files (`sw.js`, `manifest.json`) keep the
  default. The SPA fallback is unchanged.

- **The three namespace imports are replaced by generated named lookups.** A Node
  generator (`scripts/generate-dynamic-mdi-keys.mjs`) scans `packages/*/src` plus
  the test fixtures for quoted `"mdi…"` literals, verifies every key against the
  installed `@mdi/js`, and unions the result into
  `packages/shared/src/dynamic-mdi-keys.json` (preserving manual additions). The
  three call sites (`mdi-icon-lookup.ts`, `StatusPill.tsx`, `ActionList.tsx`) do a
  JSON-object lookup instead of a namespace index. Tree-shaking then keeps only the
  referenced icons. **Accepted contract change:** an icon key that is not in the
  JSON (or absent from `@mdi/js`) resolves to `null` rather than a looked-up path —
  already the failure mode for unknown keys today; keys previously reachable only
  *dynamically* and not present in any source literal now require a generator run.

- **Markdown payload leaves the landing graph.** Three lazy hosts
  (`LazyMarkdownContent`, `LazyInteractiveRenderer`, `LazyToolRenderer`) wrap the
  markdown/registry chokepoints with module-level `React.lazy` + built-in
  `Suspense fallback={null}` + a mount-time `void import()` prefetch (the
  `InlineTerminalCard` precedent). All 19 `MarkdownContent` importers and the
  `FilePreviewOverlay` edges switch to the lazy hosts; the renderers that resolve
  through the registries (read/write/ctx/edit/agent/ask-user + the interactive
  family) move behind the boundary whole. The `util` preload-helper rule in the
  Vite `manualChunks` config keeps the emitted `__vitePreload` virtual module out
  of lazy chunks — without it the entry statically imports the lazy chunk it is
  supposed to fetch on demand. Result: the landing preload set is exactly
  `index, util, diff, dnd, mdi(small), react-vendor` + CSS.

- **The config hook dedupes in flight and negative-caches failures.** A module-level
  in-flight map shares one `fetchOpenSpecConfig` promise per cwd across concurrent
  hooks; a per-hook `cancelled` flag replaces the per-hook `AbortController` (an
  unmount must not abort a request a sibling still awaits). A failed fetch records
  a timestamp; remounts within `OPENSPEC_CONFIG_FAILURE_TTL_MS` (30 s) skip the
  refetch, a success or `__resetOpenSpecConfigCache` (the save/epoch path) clears
  the entry. Seed-then-refetch semantics are preserved.

## Discipline Skills

- **`performance-optimization`** — the whole change is a cold-start transfer budget:
  6.8 MB decoded / 2.0 MB transferred baseline; the mdi chunk collapses from
  ~785 KB gz after tree-shaking, and the markdown chunk (~331 KB gz) plus the
  per-visit asset revalidation leave the landing path, with build-output guards
  (`mdi-chunk-size`, `markdown-chunk-size`, `lazy-feature-chunks`) pinning the
  properties the measurements depend on.
- **`review-code`** — the lazy boundaries touch the markdown-primitive seam
  (`main.tsx` global registrations) and the tool/interactive renderer registries;
  the `__vitePreload` chunking rule is a subtle build invariant that a later
  config edit can silently break. A review pass before commit guards these.
- **`doubt-driven-review`** — the mdi change alters a cross-plugin contract
  (dynamic icon keys not present in the generated JSON now resolve to `null`).
  The decision is deliberate and documented here; the review confirms the
  generator's key union covers the fixtures and the failure mode is acceptable.

## Impact

- New capability spec: `static-asset-cache-policy`.
- Modified: `lazy-feature-bootstrap` (markdown payload family + entry topology),
  `mdi-icon-system` (generated key table + tree-shake contract),
  `openspec-profile-config` (request sharing + failure TTL).
- Test fallout: suites asserting synchronous markdown/renderer output switch to
  async queries (`findBy*` / `waitFor`); the eml topology guard drops its
  `syntax-theme` false positive (that module is a lazy chunk, not the folded
  `react-syntax-highlighter` vendor chunk the guard pins).
- Not in scope: deploy/restart of a running instance (requires separate
  authorization); `docker/` has no nginx `assets` rule to change.
