# Fix long-session UX degradation and background-stream selection loss

## Why

After the dashboard is used for a while, two user-visible degradations appear, plus
one slow internal leak. All three were found by walkthrough + independent review and
are deterministic defects, not speculation:

1. **Copy/selection dies permanently.** Three drag-to-resize components
   (`ResizableSidebar`, `SplitDivider`, `FileDiffView`'s inline `ResizableTreePanel`)
   set `document.body.style.cursor` + `userSelect = "none"` on `mousedown` and clear
   them only in their `mouseup` handler. Their effect cleanups remove the listeners
   but **do not clear the styles**. If the component unmounts mid-drag (breakpoint
   flip, panel collapse, session switch) or the `mouseup` is lost (mouse released
   outside the window), the page keeps `user-select: none` **forever** — text can no
   longer be selected or copied until a refresh. The correct pattern already exists
   in `useTreeColumnWidth` (guarded cleanup at its effect), but it was never applied
   to the three older dragers.

2. **CopyButton silently fails in non-secure contexts.** `CopyButton` calls
   `navigator.clipboard.writeText` directly and swallows every failure (`catch {}`,
   no fallback). Over an http tunnel (zrok/ngrok) the Clipboard API is unavailable,
   so the button does nothing while still looking like a button. A working
   fallback — `copyText` in `lib/util/clipboard.ts` (writeText → hidden textarea +
   `execCommand("copy")`, returns boolean) — already exists and is used elsewhere
   (`ToolsSection`); `CopyButton` was never migrated to it.

3. **The stale-tool reconcile diagnostic maps only grow.** `useStaleToolReconcile`
   keys `lastAttemptRef` and `count404Ref` by `${sessionId}:${toolCallId}` and never
   deletes entries. In a long-lived 24h session every tool call the user ever ran
   leaves two permanent map entries — an unbounded memory growth proportional to
   tool-call count, on top of the per-tick scan cost of iterating them.

4. **The mobile page scrolls, dragging the whole shell out of the viewport.**
   The App's mobile branch renders the in-flow banners (`PluginStalenessBanner`,
   `ConnectionStatusBanner`) in normal flow above `MobileShell`, whose root was
   `h-[100dvh]`. Banner height + `100dvh` exceeds the viewport, so the DOCUMENT
   becomes scrollable by exactly the banner height. Measured on a 390×844
   emulation: `document.scrollHeight` 887 vs `innerHeight` 844 with the 43px
   staleness banner visible. Entering a session or focusing the composer then
   scrolls the page, shifting the entire shell up — the user sees the "progress
   bar"/header mid-screen instead of pinned at the top.

5. **A long session lands mid-conversation on mobile, never at the latest
   message.** A measurement-induced scroll event was mistaken for a user
   escaping the bottom: the bottom-pin writes `el.scrollTop = el.scrollHeight`
   (clamped to the then-current maximum), then rows below the viewport measure
   in and grow `scrollHeight` BEFORE the induced scroll event dispatches. That
   event reads `nearBottom = false` with no gesture involved, and
   `handleScroll`'s else-branch (`stickToBottomRef = nearBottom`) cleared the
   follow, so the view parked wherever growth stopped. Measured on the live
   session (`01a0a2d5`, 390×844 emulation): view at `scrollTop 25521 / max
   38909` — 13388 px of unread content below — frozen across samples while
   `scrollHeight` climbed from 21136 to 39578. This violates the shipped
   `chat-scroll-lock` contract ("the auto-scroll chase SHALL continue across
   every subsequent `event_replay` batch until either replay completes or the
   user performs a real scroll gesture") and is the "停在对话中间" symptom.

6. **A background stream destroys selections in the foreground transcript.**
   `App` rebuilt `ToolContext` whenever the whole `sessionStates` map changed,
   including a thinking/SSE update for an unselected session. `MarkdownContent`
   then supplied fresh inline renderer functions to `react-markdown`; React
   treats those functions as new component types and unmounts/replaces matching
   paragraph, code, link, and table nodes. A browser selection anchors to those
   DOM nodes, so a single background event collapses an in-progress drag and a
   sustained stream prevents selection and copy entirely. The isolated browser
   repro observed 26 foreground child-list mutations from one background event;
   after the fix, one event and a 60/s event stream cause zero such mutations.

Evaluated and explicitly **excluded** (each needs its own proposal, out of scope
here): capping client message arrays (breaks history-gap / spliceRev / two-sided
terminus semantics), granular context splitting for the display-prefs/model-config
maps (18 consumers, medium risk), and trimming `scrollStateMap` (e2e
`chat-transcript-virtualization.spec.ts` depends on its survival).

## What Changes

- **New shared hook `useBodyDragStyle`** — owns the body cursor/userSelect write
  pair with a single unmount cleanup guarded by a ref (`active`), idempotent
  `endBodyDrag()`. An unmount while a drag is active clears the styles; an unmount
  while idle touches nothing (StrictMode double-invoke safe: both cleanups run
  before user input and no-op when `active === false`).
- **The three dragers delegate to the hook** — they keep their own `dragging` ref
  (still gates move/up logic) and just call `beginBodyDrag(cursor)` /
  `endBodyDrag()` instead of touching `document.body.style` directly. Their listener
  cleanups keep removing the listeners; style cleanup is the hook's job now.
  `useTreeColumnWidth` is intentionally NOT refactored onto the new hook in this
  change: it is already correct, and its effect also owns localStorage persistence —
  merging it would widen the diff for no user-visible gain (future merge candidate).
- **`CopyButton` routes through `copyText`** — shows the ✓ icon only on a `true`
  result; failure stays silent, exactly as today (no new toast — deliberately not
  widening scope).
- **The mobile root owns the viewport bound, and `MobileShell` flexes into the
  remainder.** App's mobile branch becomes `flex flex-col h-[100dvh]
  overflow-hidden`; `MobileShell`'s root drops `w-screen h-[100dvh]` for
  `w-full flex-1 min-h-0`. Banners may then appear and disappear without the
  document ever exceeding the viewport, so the page cannot scroll. The
  viewport-anchored overlays (`Toast`, `SpawnErrorToastHost`,
  `RecoveryOfferHost`, `WorktreeInitStack`, `firstLaunchModal`,
  `addFoldersDialog`) are `fixed`/`fixed inset-0` and stay in the flex flow
  without adding height.
- **`useStaleToolReconcile` prunes its diagnostic maps each tick** — new pure
  selector `selectActiveToolKeys(states)` builds the set of `${sessionId}:${toolCallId}`
  keys for tool rows that still exist; `tick()` deletes every key from
  `lastAttemptRef`/`count404Ref` not in that set, before scanning. Deleting a key of
  a finished/removed row is lossless: the scan only reads keys of rows that still
  exist (the selectors guard `status === "running"`), so a pruned key can never be
  read again. `inFlightRef` is untouched (self-clearing in `finally`).
- **The scroll machinery learns WHICH write produced an event.** Programmatic
  writers tag themselves (`stampProgrammaticScroll(invalidateIntent, "pin-bottom" |
  "jump")`); `handleScroll` consults the tag before its position rules. A
  `"pin-bottom"` event is held as a follow-preserving clamp only when it matches
  the recorded pin snapshot (`pinnedSnapshotRef`: the scrollTop the write
  ACHIEVED + the scrollHeight at write time) AND the content has since grown AND
  the pin landed with real content (`height > 0`); anything else — view moved up,
  no growth — falls through to the existing position rules, so a real escape
  (wheel/touch, scrollbar drag, keyboard) still releases. The tag clears ONLY on
  real input (the wheel/touch handler). `"jump"` writers (scrollToBottom,
  scrollToTurn, restore, splice corrections) leave the refs untouched entirely,
  fixing the same defect on their paths (notably a phone `scrollToBottom`, which
  is an instant write whose single event lands inside the suppression window).
- **The selected `ToolContext` ignores unrelated session-state churn.** `App`
  now retains only the selected session's `subagents` map — the sole state read
  by its agent-tool consumers — so an update to another session cannot create a
  new otherwise-equivalent context.
- **Markdown renderers have stable module-level component types.** Dynamic
  content, `ToolContext`, syntax theme, and loopback-link behavior now flow
  through a render context instead of closure-captured inline functions. React
  therefore reconciles the existing markdown DOM nodes when context changes,
  rather than remounting them and invalidating a browser `Selection`.

## Capabilities

### Added Capabilities

- `patch-editing-and-resize`: shared body-styles-during-drag contract for the
  dashboard's mouse-drag resize surfaces — a drag's body cursor/userSelect pair is
  scoped to a drag lifecycle and is ALWAYS cleared on drag end and on unmount.
- `mobile-shell`: the mobile root SHALL bound itself to the viewport
  (`100dvh` + `overflow-hidden`) and stack in-flow banners above a flexing
  shell, so no banner can make the document scrollable.

### Modified Capabilities

- `content-copy`: CopyButton's copy path becomes fallback-backed — the shared
  `copyText` helper (`navigator.clipboard.writeText` when available, else the
  hidden-textarea `execCommand("copy")` fallback) — and the ✓ feedback is driven
  by the helper's success boolean. This closes the "button does nothing over an
  http tunnel" defect (a body-wide `user-select: none` left behind by a resize
  drag is the other selection/copy blocker, and is closed by the added
  `patch-editing-and-resize` contract).
- `incremental-event-sync`: the stale running-tool reconcile's per-row diagnostic
  state (`lastAttemptRef`, `count404Ref`) SHALL NOT grow without bound — keys for
  rows that no longer exist are pruned each tick.
- `chat-scroll-lock`: the auto-scroll follow SHALL survive a measurement clamp —
  a programmatic bottom-pin whose induced scroll event arrives AFTER rows below
  the viewport grew `scrollHeight` SHALL NOT clear the follow, while a real user
  escape (wheel/touch, scrollbar drag, keyboard) SHALL continue to release it.
  This sharpens the existing "Auto-scroll robust to multi-batch event replay"
  requirement, which the clamp violation broke in practice.
- `chat-selection-preservation`: a background session's SSE or thinking update
  SHALL NOT replace the selected foreground transcript's markdown DOM nodes or
  collapse its selection. Equivalent render contexts SHALL reconcile existing
  renderer types rather than remounting them.

## Impact

**Code**

- NEW `packages/client/src/hooks/useBodyDragStyle.ts` — shared drag body-style hook.
- `packages/client/src/components/shell/ResizableSidebar.tsx` — delegate to hook.
- `packages/client/src/components/split/SplitDivider.tsx` — delegate to hook.
- `packages/client/src/components/diff/FileDiffView.tsx` (inline `ResizableTreePanel`) — delegate to hook.
- `packages/client/src/components/primitives/CopyButton.tsx` — use `copyText`.
- `packages/client/src/hooks/useStaleToolReconcile.ts` — `selectActiveToolKeys` + per-tick prune.
- `packages/client/src/App.tsx` — viewport-bounded mobile flex root; selected
  `ToolContext` depends only on selected `subagents`, not the full session map.
- `packages/client/src/components/preview/MarkdownContent.tsx` — stable
  module-level `react-markdown` renderers supplied with dynamic data through
  `MarkdownRenderContext`.
- `packages/client/src/components/shell/MobileShell.tsx` — `w-full flex-1 min-h-0`
  instead of `w-screen h-[100dvh]`.
- `packages/client/src/components/chat/ChatView.tsx` — writer-tagged
  `stampProgrammaticScroll`, `pinnedSnapshotRef` + `isPinnedBottomClamp`, the
  clamp-hold branch and jump-skip in `handleScroll`, tag clearing in the
  wheel/touch handler.

**Tests**

- NEW `packages/client/src/hooks/__tests__/useBodyDragStyle.test.tsx` — set/clear,
  unmount-mid-drag clears, unmount-before-drag no-op, two-instance isolation.
- NEW `packages/client/src/components/shell/__tests__/MobileShell.test.tsx` —
  the shell root fills its parent (`w-full flex-1 min-h-0`) and never claims a
  viewport unit.
- `packages/client/src/components/__tests__/ResizableSidebar.test.tsx` — body style
  set on drag start / cleared on mouseup, cleared on unmount-mid-drag.
- `packages/client/src/components/__tests__/CopyButton.test.tsx` — real failure →
  fallback path (execCommand) shows ✓ and removes the hidden textarea; no
  execCommand → no throw, no ✓.
- `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts` — pure
  `selectActiveToolKeys` semantics + tick-driven prune of resolved rows.
- `packages/client/src/components/__tests__/ChatView.scroll-race.test.tsx` —
  browser-faithful clamping `setScrollPosition` (scrollTop writes clamp to the
  max, as in a real browser) + two regression cases: the measurement clamp holds
  the follow through the grow, and a view moved above the pin (no wheel/touch)
  still releases.
- `packages/client/src/components/__tests__/MarkdownContent.test.tsx` —
  equivalent fresh `ToolContext` values preserve paragraph, inline-code, link,
  and table DOM identity.

**Docs**

- AGENTS.md rows: `hooks/` (new file + `useStaleToolReconcile` detail), component
  directories (`shell/`, `split/`, `diff/`, `primitives/`) + per-file sidecars
  for `SplitDivider.tsx`, `FileDiffView.tsx`, `App.tsx`, and
  `preview/MarkdownContent.tsx`.

Out of scope (see Why) — no behavior change beyond the documented defects; the
optional `blur` listener for "mouse released outside window" and a pointer-capture
rewrite are pre-existing, acceptable behavior and stay out.

## Discipline Skills

- **`systematic-debugging`** — each defect's root cause is asserted against a
  mechanism (missing cleanup path, unavailable Clipboard API, unbounded keyed
  maps, banner + `100dvh` document overflow, pin-clamp scroll event misread as
  an escape, background state churn remounting markdown DOM) and pinned by a
  red test before the fix: the unmount-mid-drag regression, the execCommand-
  fallback path, the prune behavior, the shell's parent-filling root, the
  browser-faithful clamp harness, and DOM-identity tests plus an isolated
  background-event selection repro.
- **`review-code`** — the drag-style fix is a lifecycle/cleanup seam that is easy
  to subtly regress (StrictMode double-invoke, two mounted consumers, missed
  mouseup). The scroll fix and selection preservation change are state/identity
  changes in timing-sensitive client paths; a review pass before commit guards
  both.

`security-hardening` (no untrusted input/secrets/auth surface touched — the
execCommand fallback already exists and is unchanged), `performance-optimization`
(no measured latency budget — the prune is an obvious unbounded-growth fix, not a
tuning exercise), and `observability-instrumentation` (no new endpoint/job/external
call) do not apply.
