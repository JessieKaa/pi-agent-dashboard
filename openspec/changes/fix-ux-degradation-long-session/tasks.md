# Tasks

## 1. Red tests (reproduce the defects first)

- [ ] 1.1 NEW `packages/client/src/hooks/__tests__/useBodyDragStyle.test.tsx` (`renderHook`):
  (a) begin sets `body.style.cursor`/`userSelect`, end clears both; (b) **regression**
  begin then `unmount()` → both are `""` (RED on the three component cleanups today);
  (c) unmount before any begin leaves body styles untouched; (d) two hook instances —
  unmounting an idle instance must not clear the active drag's styles.
- [ ] 1.2 Extend `components/__tests__/ResizableSidebar.test.tsx`: mousedown sets
  body styles, `fireEvent.mouseUp(document)` clears them; **regression** mousedown →
  `unmount()` → `userSelect === ""`.
- [ ] 1.3 Extend `components/__tests__/CopyButton.test.tsx`: replace the two
  vacuous assertions — (a) `writeText` rejects + `document.execCommand` stubbed
  `vi.fn(() => true)` → button shows the check icon and the hidden textarea is
  removed; (b) `writeText` rejects + no `execCommand` (jsdom default) → does not
  throw, no check icon.
- [ ] 1.4 Extend `hooks/__tests__/useStaleToolReconcile.test.ts`: pure
  `selectActiveToolKeys` cases (running / non-running / missing row keys); plus an
  integration case driving a tick where a resolved row's `lastAttemptRef` /
  `count404Ref` keys are pruned.
- [ ] 1.5 NEW `components/shell/__tests__/MobileShell.test.tsx`: the shell's root
  element carries `flex-1 min-h-0` and NO viewport-unit height class
  (`h-[100dvh]`/`100vh`) — the regression is a shell that again claims the
  viewport and overflows the document when a banner is mounted above it.
- [ ] 1.6 Extend `components/__tests__/ChatView.scroll-race.test.tsx`:
  (a) the `setScrollPosition` helper clamps `scrollTop` writes to
  `scrollHeight − clientHeight` (browser-faithful; the unclamped stub hid the
  defect); (b) **regression** pin lands, `scrollHeight` grows with `scrollTop`
  frozen, pin's scroll event dispatches → button stays hidden and the next
  growth is chased to the new bottom (RED today: `stickToBottomRef` cleared);
  (c) view moved above the pinned position with no wheel/touch → released.

## 2. Hook: `useBodyDragStyle`

- [ ] 2.1 NEW `packages/client/src/hooks/useBodyDragStyle.ts`: returns
  `{ beginBodyDrag(cursor), endBodyDrag() }`. `commandRef` holds `{ active, cursor }`
  (no setState across renders, no render-time `document` access). `beginBodyDrag`
  writes `document.body.style.cursor` + `userSelect = "none"`, sets `active`;
  `endBodyDrag` clears both + `active = false` (idempotent). Unmount cleanup:
  `if (commandRef.current.active) { clear; active = false }`. JSDoc notes it
  converges the ad-hoc cleanup `useTreeColumnWidth` carries (not refactored here).
- [ ] 2.2 §1.1 green.

## 3. Replace the three dragers

- [ ] 3.1 `ResizableSidebar.tsx`: `beginBodyDrag("col-resize")` in mousedown,
  `endBodyDrag()` in mouseup; drop the direct `document.body.style` writes. Keep
  the `dragging` ref (move/up gating) and listener cleanup.
- [ ] 3.2 `SplitDivider.tsx`: same, `beginBodyDrag(cursor)` (existing `cursor` var).
- [ ] 3.3 `FileDiffView.tsx` (`ResizableTreePanel`): same, import via
  `../../hooks/useBodyDragStyle.js`.
- [ ] 3.4 §1.2 green; no regression in existing drag tests.

## 4. CopyButton fallback

- [ ] 4.1 `CopyButton.tsx` calls `copyText` from `lib/util/clipboard.js`; ✓ only on
  `true`; failure stays silent. §1.3 green.

## 5. Reconcile map prune

- [ ] 5.1 `useStaleToolReconcile.ts`: export
  `selectActiveToolKeys(sessionStates: Map<string, SessionState>): Set<string>` —
  every `${sessionId}:${toolCallId}` key in `session.toolCalls`.
- [ ] 5.2 In `tick()`, before `selectStaleRunningTools` runs: build the set from
  `statesRef.current`, delete every non-member key from `lastAttemptRef.current`
  and `count404Ref.current`. `inFlightRef` untouched (`finally` self-clears).
- [ ] 5.3 §1.4 green.

## 6. Mobile viewport bound

- [ ] 6.1 `MobileShell.tsx`: root class `relative w-full flex-1 min-h-0
  overflow-hidden bg-[var(--bg-primary)]` (was `w-screen h-[100dvh]`); JSDoc
  records why the parent owns the viewport bound.
- [ ] 6.2 `App.tsx` mobile branch root: `flex flex-col h-[100dvh] overflow-hidden`
  so the in-flow banners stack above the flexing shell; `MobileShell` supplies no
  height of its own. §1.5 green.
- [ ] 6.3 Manual (mobile emulation 390×844, banner visible): document
  `scrollHeight === innerHeight` (page cannot scroll); opening a long session does
  not shift the header off-screen.

## 7. Scroll pin vs measurement clamp

- [ ] 7.1 `ChatView.tsx`: `stampProgrammaticScroll(invalidateIntent, reason)` tags
  each programmatic write (`"pin-bottom"` for the follow-effect and `onChange`
  re-pins; `"jump"` default for scrollToBottom/scrollToTurn/restore/corrections).
  Module-level `isPinnedBottomClamp(snapshot, el)` predicate + `pinnedSnapshotRef`
  `{top, height}` recorded at each pin (achieved scrollTop + write-time
  scrollHeight). §1.6 green.
- [ ] 7.2 `handleScroll`: `"jump"` events leave the refs and button untouched;
  `"pin-bottom"` events matching the clamp predicate hold the follow
  (`if (nearBottom) stickToBottomRef.current = true`, button untouched); all else
  falls through to the existing position rules. `onWheel`/`onTouchMove` clear the
  tag AND the snapshot. No snapshot clear on session switch (tag + snapshot must
  BOTH match; every restore branch stamps its own tag).
- [ ] 7.3 Manual (mobile emulation 390×844, the long session): after replay,
  `scrollTop === scrollHeight − clientHeight` (remain 0, button hidden); wheel-up
  then releases (button appears, view moves less than half).

## 8. Verify

- [ ] 8.1 Targeted:
  `npx vitest run packages/client/src/hooks/__tests__/useBodyDragStyle.test.tsx packages/client/src/components/shell/__tests__/MobileShell.test.tsx packages/client/src/components/__tests__/ResizableSidebar.test.tsx packages/client/src/components/__tests__/CopyButton.test.tsx packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts packages/client/src/components/__tests__/ChatView.scroll-race.test.tsx packages/client/src/components/__tests__/ChatView.selection-anchor.test.tsx`
- [ ] 8.2 Full + types/format: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`
  (grep summary); `npm run lint`; `npx biome check` on changed files (diagnostic
  count parity with HEAD — the ratchet).
- [ ] 8.3 Manual (browser): drag sidebar/divider then collapse or switch session
  mid-drag → after mouseup, chat text selectable + copyable; drag then release the
  mouse outside the window → selection works on return; copy over an http tunnel
  (no Clipboard API) → ✓ shows and paste is correct.
- [ ] 8.4 Deploy: `npm run build && curl -X POST http://localhost:8000/api/restart`.

## 9. Spec

- [x] 9.1 Deltas written (`specs/`): `patch-editing-and-resize` (ADDED — body style
  scoped to drag lifecycle, unmount clears), `content-copy` (MODIFIED — CopyButton
  requirement rewritten as fallback-backed), `incremental-event-sync` (ADDED —
  reconcile diagnostic keys do not grow without bound), `mobile-shell` (ADDED —
  root bounds the viewport; banners stack above a flexing shell),
  `chat-scroll-lock` (MODIFIED — the replay-robustness requirement restated with
  the measurement-clamp hold, the moved-above-pin release, the zero-height-pin
  fall-through, and the relocating-write exemption), and
  `chat-selection-preservation` (MODIFIED — background-session stream updates
  retain foreground markdown DOM nodes and selection).

## 10. Preserve foreground selection during background streaming

- [x] 10.1 Extend `MarkdownContent.test.tsx` with red DOM-identity regressions:
  fresh equivalent `ToolContext` values retain paragraph, inline-code, link, and
  table nodes.
- [x] 10.2 Refactor `MarkdownContent.tsx` to use stable module-level
  `react-markdown` renderers; pass context-dependent values through a render
  context instead of inline renderer closures.
- [x] 10.3 Narrow `App.tsx` `toolContext` memo dependencies to the selected
  session's `subagents` map, rather than the full `sessionStates` map.
- [x] 10.4 Manually verify in an isolated browser: an injected background event,
  a 60/s background-event stream, and a completed-selection hold retain the
  foreground selection with no foreground transcript child-list mutations.
- [x] 10.5 Re-run the targeted Markdown regression suite and production client
  build after the final renderer change.
