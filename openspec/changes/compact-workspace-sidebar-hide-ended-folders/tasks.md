# Tasks — compact-workspace-sidebar-hide-ended-folders

## 1. RED — failing tests first

- [x] 1.1 New describe block in `packages/client/src/components/__tests__/SessionList.folder-menu.test.tsx`: compact on + unpinned held-ended-only folder → group header absent (compact off → present).
- [x] 1.2 Compact on + zero-held stub (endedTotals only) → stub row absent; compact off → present.
- [x] 1.3 Compact on + alive folder → still renders (guard: no over-hide; the default `session` in `renderList` is alive and asserted present in 1.1).
- [x] 1.4 Filter exemption: session search matching an ended session; workspace path filter matching an ended-only folder; archive-search match (`SessionList.tags-filter.test.tsx`) — all with compact on → folder renders.
- [x] 1.5 Pinned ended-only folder + compact on → still renders.
- [x] 1.6 Confirm RED: 6 failed / 30 passed in the two touched test files before implementation (5 new tests + 1 archive-exemption test); the pinned guard was green pre-change (a keep-behavior guard, not RED evidence).

## 2. GREEN — minimal implementation

- [x] 2.1 `SessionList.tsx`: module-level `compactShowsGroup(group, { sessionSearch, archivedMatchesFor })` (alive || search-hit || archive-hit) + a compact branch in the `visibleTopUnpinned` chain after the tag/workspace branches; off → today's chain verbatim. Pinned tier and workspace-card folders untouched.
- [x] 2.2 Stub-budget loop consumes the same filtered list — hidden stubs consume no budget (pinned by the "budget counts only rendered stubs" test; compact renders 0 stubs for a fully stale map with no overflow row).
- [x] 2.3 `SettingsPanel.tsx`: `compactWorkspaceSidebarDescription` EN hint extended; zh (`i18n.tsx`) + hu (`i18n-hu.ts`) catalogs updated; i18n parity/orphan tests green.
- [x] 2.4 Focused re-run → 131 passed across the 4 touched test files.

Integration edge (found by review, not in the original plan): a seek-to-card to a compact-hidden ended-only folder needed the reveal-first exemption. Added `revealCwd` (useMemo over `revealRequest` + `sessions`) gating the compact branch, plus a seek test; the rAF comment documents the timing. Without it the seek silently stalled to the 5 s backstop.

## 3. Sidecars + quality

- [x] 3.1 `SessionList.tsx.AGENTS.md` (+ compact no-alive paragraph), `SettingsPanel.tsx.AGENTS.md`, `lib/i18n/AGENTS.md` rows updated.
- [x] 3.2 `npx tsc --noEmit` root: only the known `TS6059` rootDir fixture error, 0 errors in changed files; `node scripts/check-conventions.mjs` clean (60 advisories in untouched files, report-only); `npm run lint:e2e` ✓; `z-layer-lint` ok (34 = baseline). `quality:changed` reports "0 files" wrongly on uncommitted-only trees — ran `biome check` per changed file instead; the 11 `noExcessiveCognitiveComplexity` warnings match HEAD's 11 exactly (in-repo side-by-side; `/tmp` copies under-report due to biome config resolution).
- [x] 3.3 `openspec validate compact-workspace-sidebar-hide-ended-folders --strict` → valid.

## 4. Review

- [ ] 4.1 `review-code` inline pass on the diff (filter-chain interaction with C2 budget + archive-search exemption); opt-in CodeRabbit gate per ship rules.

## 5. Deploy (requires separate explicit authorization)

- [x] 5.1 Deployed 2026-09-18 on user authorization. Backup: `/tmp/pi-deploy-backup-compact-20260918-171618/dist-pre.tar` (global pi-dashboard-web/dist). `npm run build` → declaration `30cffc01…` (matches runtime) → `node scripts/sync-served-client.mjs` (destination replaced, hash verified) → `POST /api/restart` (pid 2644737 → 3031634; served bundle `index-dEFXbBwG.js` → `index-aIHsTy06.js`; `/api/health.clientBuild` matched). Browser verify (compact was already ON in the user's localStorage): folder headers 24 → 5, and the 5 shown cwds are EXACTLY the 5 groups with a live session per `/api/sessions` cross-check (0 hidden-but-alive, 0 shown-but-dead); compact off → all 25 render; user's `dashboard:compact-sidebar` restored to its pre-deploy `true`. Working tree carries only source changes (no build artifacts tracked).

## Verification record

Full suite (2026-09-18, post-implementation): 6 failed / 20604 passed / 43 skipped — all 6 known and not caused by this change:
- keeper E5 (`waitFor` 63.5 s timeout at keeper.test.ts:855) — deterministic pre-existing red on this machine.
- spawn-correlation RSS-delta — known load flake.
- openspec-poller-parity — known pre-existing red in isolation (CLI-derived).
- session-status-visuals, package-queue — isolated 246/246 green (mutation-harness contamination twins).
- SessionCard notifyLog invariance — isolated green; area untouched by this change (last touched at merge base 1bd29e030). Journal empty, no mutation residue.
