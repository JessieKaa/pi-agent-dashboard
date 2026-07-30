# Session History Window Roadmap

## Status

- [x] Phase 1 — Tail window. Implemented. Validated. Not committed.
- [ ] Phase 2 — Cumulative manual loading. Deferred.

## Context

- Session replay retains full history.
- Compaction reduces paint events.
- Virtualization reduces mounted rows.
- Initial subscription still sends full retained replay.
- Client reducer still folds full retained replay.
- Prior full retained baseline measures 18 batches.
- Prior full retained baseline measures 833 events.
- Prior full retained baseline measures approximately 1.75 MB after prior compaction/coalescing.
- Prior full retained terminal timing measures approximately 5.73 s.
- Replay phase measures around 3.29 s.
- Long-task total measures around 3.92 s.

## Goal

- Initial load cost stays independent from total retained history.
- Initial view shows latest coherent transcript content.
- Live stream preserves existing ordering contracts.

## Phase 1 — Tail window

### Scope

- [x] Client opts into `historyWindow.messages: 200` by default.
- [x] `BrowserToServerMessage` subscribe request carries optional history-window intent.
- [x] Server selects safe replay boundary.
- [x] Server never starts inside message lifecycle.
- [x] Server never starts inside tool lifecycle.
- [x] Server preserves required setup events for selected tail.
- [x] Server returns replay-window metadata.
- [x] Metadata reports full-history availability.
- [x] Metadata reports selected-window shape.
- [x] Legacy clients omit history-window intent.
- [x] Legacy clients receive full replay.
- [x] Cache boundary mismatch triggers replay-cache reset.
- [x] Client exposes simple `Load full history` action.
- [x] Action requests one full replacement replay.
- [x] Phase 1 adds no cumulative paging.

### Safe Server boundary

- Selector counts logical transcript items from newest content backward.
- Selector expands boundary to lifecycle-safe event start.
- Selector keeps paired message start/update/end events.
- Selector keeps paired tool start/end events.
- Selector keeps state required by retained rows.
- Selector preserves original event sequence values.
- Subscription handler sends one coherent replay window.
- Live catch-up starts after replay cursor.

### Acceptance

- [x] Wire payload drops materially against baseline.
- [x] Reducer input drops materially against baseline.
- [x] Latest transcript content matches full replay.
- [x] `Load full history` restores complete retained replay.
- [x] Message lifecycle stays complete.
- [x] Tool lifecycle stays complete.
- [x] Live events catch up without gaps.
- [x] Replay events and live events keep order.
- [x] Legacy client receives unchanged full replay.
- [x] Replay cache resets when boundary changes.
- [x] Long-session benchmark records batches, events, bytes, terminal timing, LCP.
- [x] Independent review finds cold-hydration boundary reset gap.
- [x] Fix covers cold-hydration boundary reset.
- [x] Independent review finds unwindowed full-history escape gap.
- [x] Fix covers unwindowed full-history escape.
- [x] Independent review finds stale metadata clearing gap.
- [x] Fix covers stale metadata clearing.

### Validation

- Default client subscribe requests `historyWindow.messages: 200`.
- Legacy clients omit `historyWindow`.
- Legacy clients retain full replay.
- Safe boundary can overshoot requested logical count.
- Session `019fad0e-9980-76f5-b366-ba3de1e598f9` returns `effectiveMessages: 265`.
- Session `019fad0e-9980-76f5-b366-ba3de1e598f9` returns `startSeq: 1014`.
- Session `019fad0e-9980-76f5-b366-ba3de1e598f9` returns `endSeq: 1652`.
- Session `019fad0e-9980-76f5-b366-ba3de1e598f9` returns `hasOlder: true`.
- Isolated production cold load uses `http://127.0.0.1:8000`.
- Cold load transfers 639 compacted events.
- Cold load transfers 13 batches.
- Cold load transfers approximately 1.32 MB.
- Cold load reaches terminal replay in approximately 677 ms.
- Cold load records LCP 394 ms.
- Prior full retained baseline transfers 833 events.
- Prior full retained baseline transfers 18 batches.
- Prior full retained baseline transfers approximately 1.75 MB after prior compaction/coalescing.
- Prior full retained baseline reaches terminal replay in approximately 5.73 s.
- `Load full history` sends unwindowed legacy subscribe.
- Full-history validation transfers 1652 retained events.
- Full-history validation transfers 34 batches.
- Full-history validation transfers approximately 3.48 MB.
- Full-history validation reaches terminal replay in approximately 2.60 s.
- `Load full history` button disappears after terminal replay.
- Server history tests pass 30 tests.
- Client history tests pass 49 tests.
- Shared full suite passes 1421 tests.
- Build passes.
- Full server suite retains 10 unrelated existing Git/SPA environment failures.
- Full client suite passes 3872 tests.
- Full client suite retains existing TanStack Virtual teardown `window is not defined`.
- TypeScript retains pre-existing `rootDir` errors.
- TypeScript retains pre-existing plugin-runtime errors.
- TypeScript retains pre-existing unknown-body errors.
- Phase 1 changes remain uncommitted.

## Phase 2 — Cumulative manual loading

### Scope

- [ ] Manual action expands logical window 200 → 400 → 600.
- [ ] Each response replaces transcript atomically.
- [ ] Client shows loading state.
- [ ] Client shows recoverable error state.
- [ ] Client preserves stable scroll anchor after replacement.
- [ ] Optional replay-cache metadata v2 stores cumulative-window identity.
- [ ] Repeated loading stops at full retained history.
- Phase 2 remains deferred.

### Acceptance

- 200 → 400 replacement shows no duplicate rows.
- 400 → 600 replacement shows no missing rows.
- Replacement exposes no partial intermediate transcript.
- Scroll anchor keeps same visible logical item.
- Failed expansion keeps prior transcript intact.
- Retry resumes from prior successful window.

## Out of scope

- Auto infinite scroll.
- Disk reverse paging.
- Recovery of evicted `EventStore` entries.
- Search changes.
- Export changes.
- Diff changes.
- Event cap changes.
- Cache cap changes.

## Risks

- Unsafe boundary breaks message lifecycle.
- Unsafe boundary breaks tool lifecycle.
- Missing setup event corrupts retained row state.
- Replay/live race drops catch-up event.
- Replay/live race duplicates catch-up event.
- Cache key collision restores wrong window.
- Logical-item counting drifts from rendered transcript.
- Full-history action creates one large fallback transfer.
- Legacy compatibility regresses through subscribe default change.
- Benchmark noise hides replay improvement.

## Rollout gates

- Gate 1 requires protocol default = full replay.
- Gate 2 requires selector unit coverage for message and tool boundaries.
- Gate 3 requires subscription coverage for replay/live handoff.
- Gate 4 requires client reducer coverage for window replacement.
- Gate 5 requires replay-cache boundary reset coverage.
- Gate 6 requires `Load full history` UI coverage.
- Gate 7 requires old-client compatibility coverage.
- Gate 8 requires 3-run long-session benchmark evidence.
- Gate 9 requires no lifecycle regression in retained latest content.
- Gate 10 requires Phase 1 metrics before Phase 2 design lock.

## Critical files

- Shared browser protocol: [`packages/shared/src/browser-protocol.ts`](../../packages/shared/src/browser-protocol.ts).
- Server replay-window selector: [`packages/server/src/session/replay-window.ts`](../../packages/server/src/session/replay-window.ts).
- Server subscription handler: [`packages/server/src/browser-handlers/subscription-handler.ts`](../../packages/server/src/browser-handlers/subscription-handler.ts).
- Client shell: [`packages/client/src/App.tsx`](../../packages/client/src/App.tsx).
- Client message handler: [`packages/client/src/hooks/useMessageHandler.ts`](../../packages/client/src/hooks/useMessageHandler.ts).
- Client transcript view: [`packages/client/src/components/chat/ChatView.tsx`](../../packages/client/src/components/chat/ChatView.tsx).
