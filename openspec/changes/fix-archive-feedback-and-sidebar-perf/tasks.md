# Tasks — fix-archive-feedback-and-sidebar-perf

TDD order: failing test → minimal implementation → green. Every test file
listed is created or extended in the same task.

## 1. A1 — display-name disambiguation

- [ ] 1.1 RED: extend `packages/client/src/lib/__tests__/session-display-name.test.ts`
      + `packages/client/src/__tests__/session-display-name.test.ts`: basename
      fallback (no name / empty firstMessage) returns
      `"<basename> · <id.slice(0,8)>"`; `cwd: "/"` → `" · <id8>"`; named and
      firstMessage cases byte-identical to today.
- [ ] 1.2 GREEN: `packages/client/src/lib/session/session-display-name.ts` —
      append the suffix in the basename branch only.
- [ ] 1.3 Verify `filterByQuery` still matches by basename (documented mirror);
      adjust its doc comment to state the suffix is display-only.

## 2. A2 — session_archived state frame

- [ ] 2.1 RED: extend the `frameClassOf` test beside `browser-gateway` tests:
      `session_archived` → `{ cls: "state", key: "session_archived:<id>" }`.
- [ ] 2.2 GREEN: `packages/server/src/pairing/browser-gateway.ts` — add the
      case.
- [ ] 2.3 Coordinate with `close-registry-frame-shed-gaps` (same function,
      different cases — no shared lines).

## 3. A3 — dnd measuring strategy

- [ ] 3.1 `SessionList.tsx` (`DndContext`): `MeasuringStrategy.Always` →
      `MeasuringStrategy.WhileDragging`.
- [ ] 3.2 Confirm existing dnd/folder tests green (behavioural change is
      measurement-only).

## 4. A4 — sticky live:true + intent seam

- [ ] 4.1 RED: server test — a scanned row with `live:true` + non-ended status
      normalizes to `ended` AND its in-memory `live` clears; a genuinely
      running session's row keeps `live:true` until it ends.
- [ ] 4.2 GREEN: `packages/server/src/server.ts` cold-start normalization
      branch clears `live` on the restored row; recovery revoke / grace-expiry
      paths call the same clear.
- [ ] 4.3 RED: server test — end-then-archive intent recorded, then the
      session ends through `update({status:"ended"})` (force-kill seam) →
      `sessionArchive.archiveSession` is called once.
- [ ] 4.4 GREEN: consume the intent at the ended-transition seam
      (`event-wiring.ts` `onEnded`) instead of only `onUnregister`; keep
      `onUnregister` consumption removed or idempotent (double-consume is a
      no-op by design of the one-shot registry).
- [ ] 4.5 `doubt-driven-review` the clear-at-normalization decision (bounded).

## 5. A5 — useInitStatus cache

- [ ] 5.1 RED: extend `packages/client/src/hooks/__tests__/effect-cleanup-contract.test.tsx`
      (or a new `useInitStatus.test.tsx`): two mounts for the same cwd →
      one fetch; remount after resolve → zero fetches; `refetch()` issues one
      fresh fetch and updates the cache; failure does not poison the cache.
- [ ] 5.2 GREEN: `useInitStatus.ts` — module-level `Map<cwd, WorktreeInitStatus>`
      + in-flight `Map<cwd, Promise>`; effect serves cache synchronously,
      dedups in-flight; `refetch` bypasses cache, repopulates.

## 6. B1 — archive_result protocol (task-plan pivot: protocol first as the test oracle)

- [x] 6.1 RED (protocol shape): extend the browser-protocol test to include
      `archive_result` with `{type, sessionId, ok, pending?, error?, code?}`.
- [x] 6.2 RED (server): gateway test — `archive_session` for a live/running
      session sends `archive_result {ok:false,error}` back on the same socket;
      ended session → `archive_result {ok:true}`; idle-alive → `{ok:true,
      pending:true}`; no-index → `archive.unavailable` (never a silent drop).
      A2 `frameClassOf` test extended for the new key.
- [x] 6.3 GREEN: `packages/shared/src/browser-protocol.ts` adds
      `ArchiveResultBrowserMessage`; `requestArchive` gains an outcome `code`
      per rejection branch; `handleArchiveSession` acks via `ctx.sendTo`;
      `browser-gateway.ts` `frameClassOf` maps `archive_result` to state,
      key `archive_result:<sessionId>` (latest-wins, no shedding).
- [x] 6.4 RED (client): handler test — `{ok:false}` toasts a translated
      `err.archive.*` message; `{ok:true}` and `{ok:true,pending:true}` stay
      quiet; the `sessions` Map is never touched (no optimistic removal).
- [x] 6.5 GREEN: `useMessageHandler.ts` handles `archive_result` via
      `resolveServerMessage`; no optimistic removal on failure.
- [x] 6.6 REST route unchanged (already returns the result; outcome `code` is
      additive).

## 7. B2 — group-key normalization

- [x] 7.1 RED: server test — `endedTotals` keys and archive-index `groupPath`
      are folded (`pathKey` space) for cwd variants (`/a/b` vs `/a/b/`);
      pin toggling a worktree does not move an ended session between keys.
      (Actual: `memory-session-manager.test.ts` B2 describe — variant fold,
      worktree-mainPath fold, pin-variant paging; `archive-placement.test.ts`
      — archive + seed/rebuild `groupPath` fold; client RED in
      `useMessageHandler.event-coalescing.test.tsx` (live increment targets
      the folded key) and `SessionList.tags-filter.test.tsx` (archived
      matches file under the folded group key).)
- [x] 7.2 GREEN: fold every write/read site in `memory-session-manager.ts`
      (`groupKeyOf` consumers) and `session-archive.ts` (index row writes) to
      the same folded key; client optimistic pin write (`App.tsx`) normalizes
      with the shared helper.
      (Actual: `groupKeyOf` → `pathKey(resolveOrderKey(...), platform)`;
      archive `row.groupPath` = the folded index key on both `rebuild` and
      `insertRow`; `useMessageHandler.endedTotalsGroupKey` folded; SessionList
      computes one `foldPlatform` + `foldKey` and folds every group-keyed
      read/write (endedTotals, archivedCountMap, archivedMatchesByGroup,
      endedExpanded, archiveExpanded, heldEndedByCwd, paging — `sessions_page`
      now sends the folded key). App.tsx pin write left as-is:
      `AddFoldersDialog` already `normalizePath`s on pin, and the folded
      lookups make any residual cosmetic spelling inert.)
- [x] 7.3 Verify the `endedTotals`/paging key contract test still holds
      (same key space as `sessions_page` / `sessions_page_result`).
      (event-coalescing E35 + folder-menu stub/paging tests green; 75/75 B2
      suites, 234/234 adjacent regression suites.)

## 8. C1 — render-path quick wins

- [x] 8.1 RED: React Profiler-driven test (render-count assertions via a
      counting wrapper) — a `session_updated` for session A re-renders only
      A's card, not B's; `now` bucket change alone does not re-render cards
      whose relative label is unchanged.
      (Actual: `SessionList.render-memo.test.tsx` renders the REAL card and
      counts body renders via a spy on `useSessionCardDragHandle` — called
      unconditionally in the card body and read by SessionCard ONLY (a mocked
      SessionCard sits above the `React.memo` boundary and could never observe
      it; `useMobile` fires for folder menus too). Three tests: identical-props
      rerender → 0 body renders; one session object swapped → exactly 1;
      same-30s-bucket clock jump (`Date.now` mocked to a bucket-aligned base)
      → 0 renders with the label left legibly stale, then the next bucket →
      re-render + label advances "10s"→"40s".)
- [x] 8.2 GREEN: `SessionCard` → `React.memo` (named export preserved,
      `displayName` set); stabilize list-owned callbacks (`handleArchive`,
      onSelect wrapper, onSeekToCard) with `useCallback`/ref-stable pattern;
      `now` coarsened to a 30s shared bucket in `SessionList`.
      (Actual: `React.memo` + module-level `sessionCardPropsEqual` comparator
      (per-field session compare; identity for value-bearing props and direct
      pass-through callbacks; arrows + `onSelect` deliberately skipped —
      guarded by the session/callback-identity checks); `displayName` set;
      `now` floored to a 30s bucket (`nowBucket`) at the single card call
      site. `handleArchive` was already `useCallback`. The RED test surfaced
      TWO additional render-storm sources, fixed at the source: (a) dnd-kit's
      `useSortable` returns a fresh `listeners` object per render →
      `SortableSessionCard`'s context value changed identity every render →
      context propagation bypassed the memo and re-rendered every card body
      (context-driven renders cannot be memo-skipped) → `DragHandleCtx` now
      carries an identity-stable ref-box refreshed in place; (b) the
      collapsed-groups prune effect committed a fresh (equal) Set on mount →
      `collapsedGroups` churn → `seekToFolderOpenSpec` identity churn → one
      spurious whole-list re-render → functional-setState equality bail.)
- [x] 8.3 GREEN: `App.tsx` — memoize the `Array.from(sessions.values())`
      array (single memo reused by `SessionList` + `allTagsInUse`).
      (Actual: the `allSessionsList` memo already existed; unified so
      `SessionList`, `allTagsInUse`, the plugin provider, and the folder
      views all consume the ONE memo — previously SessionList and `allTags`
      each allocated their own `Array.from(sessions.values())`.)
- [x] 8.4 Confirm inline per-card arrow props are gated by the memo
      comparator only where safe (document the pass-through set).
      (Actual: comparator doc + inline comment enumerate the skipped arrow set
      (`onSelect` + 13 per-card arrows); every direct pass-through
      (`onArchive`, `onShutdown`, `onSeekToFolderOpenSpec`,
      `onOpenOpenSpecSettings`) IS identity-checked. 375 sidebar regression
      tests green; tsc 1 pre-existing fixture error; Biome net-neutral.)

## 9. C2 — bounded stub surface

- [x] 9.1 RED: server test — snapshot `endedTotals` is capped (top-N by most
      recent ended activity + `endedTotalsOverflow` total); a cwd outside the
      cap is still pageable via `sessions_page` if it ever had a row.
      (Actual: new describe in `memory-session-manager.test.ts` — 30 groups ×
      2 ended with increasing recency → 25 keys (g5..g29), g0..g4 dropped,
      `endedTotalsOverflow === 10`, `listed + overflow === 60`; <25 groups →
      no overflow field; capped-out group still pageable (via
      `endedSequence`, after `seedGlobalWindowFiller` pushes its rows out of
      the resident window); recency = max endedAt per group.)
- [x] 9.2 GREEN: `memory-session-manager.ts` `buildSnapshot` caps the map;
      protocol type gains the overflow count (additive optional).
      (Actual: `SNAPSHOT_ENDED_TOTALS_GROUPS = 25`; groups ranked by max
      `endedSortKey`; overflow counts SESSIONS not groups; field omitted when
      0. `SessionsSnapshotMessage.endedTotalsOverflow?: number` in
      `browser-protocol.ts` + protocol-type test no-change (additive); the
      gateway's spread path carries the field automatically and the legacy
      no-manager fallback omits it. E18/P1 byte-bound contract updated to
      25 keys + `listed + overflow === 4_000`.)
- [x] 9.3 RED: client test — stub groups beyond the budget render as one
      summary row ("+N more folders"); expanding materializes them.
      (Actual: `SessionList.folder-menu.test.tsx` "stub-group budget (C2)"
      describe — 12 stubs → 8 `folder-stub-body` rows + `stub-budget-overflow`
      row carrying "4" and "more folders"; click → 12 rows, summary gone;
      session-bearing groups do not consume the budget.)
- [x] 9.4 GREEN: `SessionList.tsx` stub budget + summary row; spec delta for
      `session-listing` updated in the same task.
      (Actual: `STUB_GROUP_BUDGET = 8`; budget applies only in the default
      view (no session search / tag / workspace-path filter — each of those
      narrows the candidate set anyway); gate initially used
      `!folderMatchesFilters(group)` which is TRUE for empty-session groups
      in the unfiltered view — fixed by mirroring the visibility branch's own
      condition. Net-new delta files:
      `specs/session-listing/spec.md` (modified "Browser pages older ended
      sessions on demand" + 3 budget scenarios) and
      `specs/shared-protocol/spec.md` (modified snapshot-message requirement
      with overflow field + 2 scenarios). `npx openspec validate
      fix-archive-feedback-and-sidebar-perf` → valid.)
- [x] 9.5 `performance-optimization` checkpoint: before/after stub-row count
      and init-status request count on a seeded large dataset.
      (Actual: `useInitStatus.cache.test.tsx` "C2: stub budget bounds the
      init-status probe count" — 14 stub groups, cold cache: 8
      `folder-stub-body` rows and exactly 8 `fetchWorktreeInitStatus` calls at
      mount (pre-change: 14 rows / 14 probes); expanding the summary → 14
      rows and 14 probes. Falsified against `STUB_GROUP_BUDGET = 99`
      (expected 14 to be 8). Each probe is a blocking `spawnSync` git chain
      server-side (~17ms measured, proposal §6), so the default view's
      per-paint blocking probe budget is now ≤ 8 regardless of history size;
      the server snapshot cap (25 group keys + overflow) independently bounds
      the stub CANDIDATE set for any history depth.)

## 10. C3 — client lifetime bounds

- [x] 10.1 RED: `replay-persist` test — after a successful flush the session's
      buffer holds at most N recent events; a never-descended session does not
      schedule flush work.
      (Actual: 3 tests in `replay-persist.test.ts` "Buffer lifetime bound (C3)"
      — tail trim via `retainLimitOverride` (payload seqs 51..100, maxSeq 100);
      append-after-trim keeps dedup/contiguity (53..102); the timer test keeps
      a live-only session X at 0 timers while a separate replay-recorded
      session Y schedules exactly 1 — restructuring forced by the documented
      contamination invariant: `record(live)` marks X contaminated, and a
      later replay batch for X can NEVER promote it (dedup drops rows ≤ maxSeq;
      only `seed()` restores), so a same-session promote premise would have
      violated the invariant the module exists to enforce.)
- [x] 10.2 GREEN: `replay-persist.ts` trim-after-flush.
      (Actual: `retainLimit = max(DEFAULT_MEMORY_LIMITS.maxReplayEvents,
      MIN_REPLAY_WINDOW)` = the server full-stream window; `schedule()`
      early-returns for non-descended buffers (every provenance-setting edge
      calls schedule after the flag is set). The trim red-tests then surfaced a
      LATENT defect in the first cut: the post-await re-check reused the
      captured payload, so an event recorded DURING the IndexedDB write was
      dropped — the next live frame (101 gone → 102) would read as a
      dropped-frame gap and permanently void provenance. Fixed by re-slicing
      the same buffer instance (`buf.slice(-retainLimit)`), with a 4th RED
      test gating the mid-flight append ("an append during a pending flush
      survives the post-flush trim"). 24/24.)
- [x] 10.3 RED: subscription test — deselecting a session sends `unsubscribe`;
      unmount sends `unsubscribe` for all held subscriptions.
      (Actual — substitution: the unmount/unload half was DROPPED by design
      after the safety analysis, so the test covers the deselect decision
      instead. No test renders the full `App` in this repo; the release logic
      was extracted into the pure `resolveSubscriptionTransition(prev, next,
      overlayMatched)` (precedent: `deriveSelectedSessionId`) and tested at
      `src/__tests__/subscription-transition.test.ts` (6 cases: deselect,
      switch, no-prev, unchanged-selection no-op, overlay hold of BOTH release
      and ref, held-then-overlay-close releases). Falsified: forcing the
      overlay branch to advance the ref fails 2 tests.)
- [x] 10.4 GREEN: client `unsubscribe` on selection change/unload (server path
      already exists).
      (Actual — unload beacon OMITTED, recorded rationale: the server already
      tears down ALL per-connection subscription state on socket close
      (`subscriptions.delete(ws)` in the gateway's close handler;
      `registerDisconnectHandler` precedent in server.ts), a browser-native
      send during unload is unreliable across browsers, and both the
      in-memory `maxSeqMapRef` cursor and the durable cache cursor survive so
      the next connect/reload re-subscribes gap-free. App.tsx effect now:
      transition → `send({type:"unsubscribe"})` + `subscribedRef.delete(id)`
      (a stale guard entry would skip the re-subscribe on a later
      re-selection because the server no longer streams that session) →
      `prevSelectedRef = transition.nextPrev` (frozen while overlay-matched).
      Ref-freeze replaces the prior unfrozen advance, which could LOSE a held
      session's id so its subscription could never be released. Spec deltas
      authored in the same task and validated: new capability
      `session-subscription-lifecycle` (release / overlay hold / no-unload
      beacon), `session-replay-persistence` MODIFIED (tail bound + mid-flight
      append + no-debounce scenarios), `browser-gateway-decomposition` REMOVED
      ("Lazy session subscription" — retired, superseded by the lifecycle
      capability; its snapshot-transport wording was stale). proposal.md C3
      line + capability lists + impact updated to match landed behavior.
      `npx openspec validate` → valid.)

## 11. Verification + docs

- [x] 11.1 Focused suites via `HOME=$(mktemp -d) npx vitest run <files>`;
      then one full `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
      (Actual — focused numbers this session: replay-persist 24/24,
      subscription-transition 6/6, C3-adjacent 54/54, post-edit surface
      suites 40/40, event-wiring suites 30/30; all with BOTH isolation flags
      (HOME + --localstorage-file). Full run #1 (15:19–15:31, 740 s):
      1 failed | 20602 passed | 43 skipped (1762 files). The single failure
      is keeper.test.ts E5 (pre-existing: reproduced IDENTICAL, 63503 ms
      timeout, in a detached worktree at HEAD with the same test pair;
      environment/process-contention issue in the real-keeper spawn, not
      this change). openspec-poller-parity PASSED in this run. A prior run
      at 15:04 was DISCARDED as contaminated: the repo's own mutation
      harness (`scripts/__tests__/async-semantics-mutation.test.mjs`)
      deliberately writes broken code into real source files
      (prompt-bus.ts, tui-prompt-adapter.ts) and spawns nested vitest while
      the full suite runs, which also produced two false failures
      (session-status-visuals, package-queue — both pass 107/107 in
      isolation). Recovery used the harness's own journal + `reconcile()`;
      journal-cleared, no residue (`grep "mutated:"` on sources clean).)

- [x] 11.2 `npm run quality:changed` + `npx tsc --noEmit` on touched packages.
      (Actual — `--changed` is blind on the vcs defaultBranch (develop), so
      used explicit file lists from `git diff --name-only` +
      `git ls-files --others`. Net −17 findings across the 10 hotspot files
      vs HEAD; 3 net-new findings (2 new-file, 1 complexity) all fixed
      (type="button" on the new button, `consumePendingArchiveIntent`
      extraction, unused import removal). Repo-wide `npx biome lint .`:
      0 error-tier findings. Root `npx tsc --noEmit` exit 0; lint:e2e ✓;
      z-layer-lint ✓ (34/34 baseline).)

- [x] 11.3 `npx openspec validate fix-archive-feedback-and-sidebar-perf`.
      (Actual — "Change 'fix-archive-feedback-and-sidebar-perf' is valid"
      (re-run at 15:1x after all spec deltas landed);
      `node scripts/check-conventions.mjs` → no violations.)

- [x] 11.4 `AGENTS.md` sidecar rows for every touched/new file.
      (Actual — 13 sidecars + table rows updated: App.tsx, replay-persist.ts,
      SessionCard/SessionList/SortableSessionCard, useInitStatus,
      useMessageHandler, useSessionActions, session-grouping,
      event-wiring, browser-gateway, server.ts, memory-session-manager,
      browser-protocol, i18n (en+hu), init-status-cache, virtualizer-jsdom
      reset hook, subscription-transition row, session-meta-handler row,
      session-archive row. New files all carry rows.)

- [x] 11.5 DocScribe: `docs/` prose (caveman style) for the archive-feedback
      flow and the bounded-stub contract.
      (Actual — DocScribe subagent. docs/architecture.md: state-class frame
      list gains `session_archived` (moved class) + `archive_result`; the
      STALE `endedTotals` sentence corrected in place ("every group with
      ≥1 ended session" → top-25 by recency + `endedTotalsOverflow`);
      new Key-folding bullet (`pathKey`); Client-merge bullet gains
      `STUB_GROUP_BUDGET = 8` + `stub-budget-overflow` row + exemptions;
      Session-Archiving gains the ack bullet (codes + toasts + live-flag
      self-heal + onEnded intent); sidebar ordering gains client lifetime
      bounds (replay-persist trim + subscription release + overlay hold +
      no unload beacon). docs/AGENTS.md architecture.md row gains the
      change sentence. Net +7/−3, verified against source constants
      (`SNAPSHOT_ENDED_TOTALS_GROUPS = 25`, `STUB_GROUP_BUDGET = 8`).)

- [x] 11.6 Browser E2E on localhost:8000 after explicit user-authorized
      deploy: archive reject path shows the error toast; duplicate-looking
      cards now carry distinct labels; sidebar reload no longer fans out
      uncached init-status probes.
      (Actual — deploy AUTHORIZED by user ("部署") and completed
      2026-09-18 15:5x: backed up 7 pre-deploy globals to
      /tmp/pi-deploy-backup-20260918-154335 (each `cmp`-verified identical
      to HEAD pre-copy); copied 6 `packages/server/src` + 1
      `packages/shared/src` files into the global install (cmp-verified
      post-copy); `npm run build` (hash unchanged 30cffc01…, registry
      clean); `node scripts/sync-served-client.mjs` → replaced + verified;
      `pi-dashboard restart` → new pid 2644737, `/api/health.clientBuild`
      = matched, served entry `index-dEFXbBwG.js` contains the
      `stub-budget-overflow` marker; bridges reconnected 7/7. E2E (Playwright
      against the live instance, read-only): (1) A1 CONFIRMED — 7/8 visible
      cards render basename + `" · " + id8` (e.g. `rpa-dispatcher ·
      01a0b293`), 0 identical label pairs; (2) A5 CONFIRMED — cold load 26
      probes for 26 unique folders (0 duplicate cwds), collapse+re-expand
      remounts issue 0 additional probes (module cache hit); (3) C2 — the
      default view here has ≤8 stub groups so `stub-budget-overflow` does not
      render (budget satisfied) and no "+N" text is expected; overflow branch
      stays covered by SessionList render-memo tests; (4) no console errors
      from this change. Reject-toast path NOT browser-driven: the toast only
      fires in the tab that ISSUED the WS `archive_session` (frame is
      unicast to the requester, session-meta-handler.ts:170), and driving
      that race (archive a session mid-run from the same tab) would mutate
      live session state — intentionally not done; that path is unit-covered
      (useMessageHandler.archive-result + browser-gateway-archive-ack +
      memory-session-manager decision tests). NOTED pre-existing, NOT from
      this deploy: every `/api/openspec/config?cwd=<non-openspec-folder>`
      answers 502 on this machine (server PATH lacks the `openspec` binary;
      `binary-lookup.ts`/`openspec-routes.ts`/`platform/*` are untouched by
      this change and the global copies match HEAD via `git show HEAD | cmp`
      — fix candidate for a separate change).)
