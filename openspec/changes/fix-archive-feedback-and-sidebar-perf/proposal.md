# Fix archive feedback and long-session sidebar cost

## Why

A two-track research pass (behavior bugs + performance, 2026-09-18) over the
long-session sidebar produced deterministic defects, each located end-to-end
with file:line evidence:

1. **"Duplicate sessions" are display-name collisions.** The fallback chain in
   `getSessionDisplayName` ends at `cwd.split("/").pop()` with no id suffix, so
   every unnamed dashboard-spawned session in a folder renders an identical
   label — only the relative-time badge differs. One measured folder held 19
   visually identical rows.
2. **Archive failures are silent.** `handleArchiveSession` discards
   `requestArchive`'s result, the WS protocol has no `archive_result` frame,
   and the client blind-sends. Every rejection (live / running / not-found)
   looks like "clicked, nothing happened".
3. **A sticky `live:true` makes ended sessions unarchivable until server
   restart.** Cold-start normalization rewrites `status`/`endedAt` but keeps
   `live:true` on the in-memory row, and no runtime path clears the in-memory
   flag. `decideArchiveAction` then rejects forever and the sweeper skips the
   row. This is the "archive works, then one crash later it never works again"
   time pattern.
4. **`end-then-archive` intents leak through the `update` seam.** The intent is
   consumed only at `onUnregister`; `force_kill` and `session_moved` end
   sessions through `update({status:"ended"})` and never trigger it. The 60s
   TTL then expires silently.
5. **`session_archived` is a shed-able transcript frame**, so under
   back-pressure the client never learns the archive happened.
6. **Sidebar cost grows with history.** Every folder row mounts
   `FolderInitScope` → `GET /api/git/worktree/init-status`, whose server path
   runs a synchronous spawnSync git-probe chain (~17ms measured, blocking the
   event loop). Every session event re-renders the whole sidebar: `SessionCard`
   and `SessionList` are un-memoized, `App` recreates the session array each
   render, and ~60 sites clone the sessions Map per event.
7. **`endedTotals` grows without bound per historical cwd** (the #650 stub
   mechanism), pinning one visibility row per cwd forever.
8. **Client memory grows with tab lifetime**: `replay-persist` never trims
   persisted buffers and the client never sends `unsubscribe`, so the server
   keeps streaming every session the user ever opened.

## What Changes

- **A1 — display-name disambiguation**: when the chain falls through to the
  cwd basename (no name, no firstMessage), append `" · " + id.slice(0,8)`.
  Named and firstMessage-derived labels are untouched. `filterByQuery` keeps
  matching the basename (search-by-id is additive, not required).
- **A2 — `session_archived` becomes a state-class frame**: delivery key
  `session_archived:<sessionId>`, so back-pressure coalesces instead of
  shedding it.
- **A3 — dnd measuring**: `MeasuringStrategy.Always` → `WhileDragging`.
- **A4 — live-flag self-heal + intent seam**: cold-start normalization clears
  the in-memory `live` flag on rows it normalizes (and recovery
  revoke/grace-expiry clear it too); the pending-archive intent is consumed on
  the `ended` transition seam (`onEnded`) so `force_kill`/`session_moved`
  paths no longer leak it.
- **A5 — `useInitStatus` gains a module-level cache + in-flight dedup**:
  resolved cwds are served from cache on row remount; only uncached or
  `needsInit` cwds re-probe. `refetch` bypasses and repopulates the cache.
- **B1 — archive acknowledgment**: new `archive_result { sessionId, ok,
  pending?, error? }` server→browser frame sent by `handleArchiveSession`;
  the client surfaces failures (not-found / live / running / spawn failure)
  through the existing toast path. REST route behavior unchanged.
- **B2 — group-key normalization consistency**: every `endedTotals` and
  archive-index write/read uses the folded group key (the client's `pathKey`
  space), and the client's optimistic pin write normalizes with the same
  helper, so "N ended" counts and paging gates stop drifting on cosmetic path
  variants.
- **C1 — render-path quick wins**: `SessionCard` wrapped in `React.memo`;
  card callbacks the list owns stabilized; `now` coarsened to a shared
  bucket so it stops piercing memo per frame; `App` memoizes the
  `Array.from(sessions.values())` array used by `SessionList` and the tag
  derivation.
- **C2 — bound the stub surface**: the snapshot's `endedTotals` map is
  capped server-side (top-N cwds by most recent ended activity + the total of
  the rest), and the client renders stub rows beyond a small budget as a
  single "N more folders" summary row that expands on demand. The paging
  contract for groups that remain listed is unchanged.
- **C3 — client lifetime bounds**: `replay-persist` trims each session's
  buffer to its tail window after every successful flush (sized to the
  server's replay window, so a cache hit rehydrates the same amount a fresh
  load would), and the client releases a session's subscription when it loses
  selection — overlay-guarded (a plugin overlay's own subscribe is never cut),
  paired with deleting the subscribed-guard entry so a later re-selection
  re-subscribes. The unload beacon is intentionally omitted: the server tears
  down all per-connection subscription state on socket close, so an unload
  send would be redundant and unreliable, and the live cursor is preserved
  across the reconnect.

Explicitly out of scope: chat transcript virtualization, per-session event
subscription refactor, server-side ended-row eviction, animation budget
changes, and the two queued features (compact-sidebar stub hiding, folder-level
archive) — the last one depends on B1 landing first.

## Capabilities

### New Capabilities

- `archive-feedback`: WS archive requests receive an explicit
  `archive_result` acknowledgment (ok/pending/error), and the client surfaces
  failures. The `live`-flag lifecycle is bounded: a flag that survived a crash
  is cleared on cold-start normalization so it cannot permanently reject
  archive.
- `session-subscription-lifecycle`: the client releases a session's live
  subscription when it loses selection (with an overlay carve-out), keeps the
  subscribed-guard entry consistent with the release, and deliberately sends
  no unload beacon — connection close already tears down server-side
  subscription state.

### Modified Capabilities

- `session-display-name-resolution`: the cwd-basename fallback is
  disambiguated with an id suffix.
- `ws-frame-delivery-policy`: `session_archived` moves from transcript to
  state class (key `session_archived:<sessionId>`).
- `session-listing`: `endedTotals` becomes a bounded map (top-N + tail
  total); stub rows beyond the client budget collapse into a summary row.
- `session-archive`: the end-then-archive intent is consumed on the ended
  transition itself, not only on unregister.
- `browser-worktree-init-probe` (or nearest): init-status reads are served
  from a client-side cache with in-flight dedup.
- `shared-protocol`: the sessions snapshot message carries the optional
  `endedTotalsOverflow` tail total.
- `session-replay-persistence`: the in-memory buffer is trimmed to the
  persisted tail after a flush, and a non-descended session schedules no flush
  debounce.
- `browser-gateway-decomposition`: the lazy-subscription requirement is
  retired — the client subscription lifecycle is specified by the new
  `session-subscription-lifecycle` capability instead.

## Impact

- `packages/shared/src/browser-protocol.ts` — `ArchiveResultMessage` (new),
  union membership.
- `packages/server/src/browser-handlers/session-meta-handler.ts` —
  `handleArchiveSession` sends the result; doc note.
- `packages/server/src/pairing/browser-gateway.ts` — `frameClassOf` case for
  `archive_result` (state class, keyed by sessionId) and the `archive_session`
  dispatch passes a reply thunk; `session_archived` frame class.
- `packages/server/src/server.ts` — cold-start normalization clears
  in-memory `live`; recovery revoke/grace paths clear it too.
- `packages/server/src/event-wiring.ts` — intent consumption moves to the
  ended transition seam.
- `packages/server/src/session/memory-session-manager.ts` /
  `session-archive.ts` — folded group keys for `endedTotals` and index rows.
- `packages/client/src/lib/session/session-display-name.ts` — A1 suffix.
- `packages/client/src/hooks/useInitStatus.ts` — cache + dedup.
- `packages/client/src/hooks/useSessionActions.ts` — archive failure toast
  via `archive_result`.
- `packages/client/src/hooks/useMessageHandler.ts` — `archive_result`
  handling.
- `packages/client/src/components/session/SessionList.tsx` —
  `MeasuringStrategy.WhileDragging`; stub budget row; card callback
  stabilization.
- `packages/client/src/components/session/SessionCard.tsx` — `React.memo`
  wrap (displayName set for tests).
- `packages/client/src/lib/replay/replay-persist.ts` — buffer trim;
  debounce gated on provenance.
- `packages/client/src/lib/session/subscription-transition.ts` (new) — the
  pure release/ref-advance decision the App effect consumes.
- `packages/client/src/App.tsx` — memoized session array; subscription release
  on selection change (overlay-guarded) with subscribed-guard cleanup.
- Tests beside each of the above; `AGENTS.md` sidecars updated; `docs/`
  prose delegated to DocScribe (caveman style).

## Discipline Skills

- `performance-optimization` — C1/C2/C3 are latency/throughput-budget
  changes on the event path; measure render counts before/after, do not tune
  unrelated knobs.
- `observability-instrumentation` — B1 adds a protocol frame; the failure
  toast and (optional) counter must not leak paths/PII.
- `security-hardening` — not triggered: no new endpoint, no untrusted input
  beyond the existing WS surface, no secrets.
- `doubt-driven-review` — the sticky-`live` fix touches recovery semantics;
  run the 3-cycle bound on the "clear at normalization" decision before it
  stands.
- `review-code` — before commit, after tests pass.
- `scenario-design` — test-plan manifest folded into tasks.
