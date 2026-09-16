# Pause all animations while the UI is idle

## Why

The web client burns ~17% of a CPU core continuously **while completely idle**
(no streaming, no spinner, no replay). Measured with a Chrome performance trace
on the live dashboard, 14.6 s of strict idle watch-time, zero user input:

| thread | busy (trace) | share of one core |
|---|---|---|
| GPU process `CrGpuMain` | 1423 ms | ~10% |
| GPU process `VizCompositorThread` | 680 ms | ~5% |
| Renderer `Compositor` (compositor thread) | 335 ms | ~2% |

Root cause, isolated by controlled experiments (all on the same live page):

1. **Pausing all running animations** (`document.getAnimations()` → pause)
   collapses the cost: CrGpuMain 10% → 1.6%, Viz 4.7% → 0.5%, Compositor
   2.3% → 0.5%.
2. **The cost is fixed per-frame pipeline overhead, not raster size.** Replacing
   the three giant (200cqmax, blurred conic) card layers with a single **8×8 px**
   rotating div reproduces the full cost (CrGpuMain ~9.7%). One tiny animation ≈
   three giant ones ≈ ~120 fps of continuous compositor frame production with
   zero input. The browser (here: HeadlessChrome in software/ANGLE mode; the
   same mechanism applies to any compositor that cannot idle one frame ahead)
   never idles while *any* infinite animation runs.
3. **At idle the page runs one animation class**: the selected session card's
   decorative neon trio (`.card-glow-fx-outer`, `.card-glow-fx`, `.card-ring-fx`,
   all `neon-rotate 13s linear infinite`). It is correctly paused off-screen
   (`useFxVisibility`), hidden (`app-hidden`), and under reduced motion — but a
   *visible, untouched* selected card animates forever, even in an empty room.

The shipped `ui-animation-energy` contract ("idle/hidden-state energy
discipline") covers hidden and off-screen states only. "Visible but idle" was
never in scope, and it is the state the user is actually in.

Follow-up measurement (same live page, after the trio-only fix shipped):
switching AWAY from a streaming session leaves its sidebar card's stripes +
status-dot pulses animating — pages with only those running still burn
CrGpuMain 3268 ms per 13.3 s (~24.6% of a core), collapsing to 8 ms when they
pause. So the idle pause must cover ALL animations, not just the selected
card's trio: the target state is "an unattended dashboard shows static state
colors and produces zero compositor frames".

## What Changes

- **Input-idle detection gates the decorative FX.** While the UI is on-screen
  and the user is interacting (pointer press/tap, wheel, keyboard, touch,
  focus — window focus resumes after an alt-tab return) animations run
  normally. After `IDLE_FX_DELAY_MS` (5000 ms) with no
  input the client sets an `fx-idle` class on the document root; ANY subsequent
  input clears it immediately. `pointermove` and `scroll` are deliberately NOT
  activity: a resting hand emits micro-moves, and streaming auto-scroll emits
  trusted scroll events — counting either would hold the FX alive for an entire
  24h stream. New shared hook `useIdleFx()` (App-level, mounted next to
  `useAppHidden`).
- **CSS pauses ALL animations while `fx-idle`** — same wildcard technique as
  `app-hidden` (`*`, `*::before`, `*::after` + `animation-play-state: paused
  !important`). Not just the decorative trio: a background streaming session's
  card stripes + status-dot pulses cost the same per-frame pipeline overhead
  (measured: 24.6% of a core with only those running), and "状态点 + 静态黄/
  青条纹" still communicates the state without motion. Every animation resumes
  within one frame on the first input; nothing functional depends on animation
  completion (`animationend` is unused repo-wide).
- **Off-screen cards freeze the trio via the existing `useFxVisibility` path.**
  The card `<li>` already carries the shared IntersectionObserver class; no new
  hook. The class assertions in the SessionCard test guard the selectors that
  CSS depends on.
- **The frozen UI keeps a static selection affordance** (the existing
  `ring-1 ring-blue-500/30 border-blue-500/60`), and every frozen animation
  element keeps its static color (stripes/dots at rest) — the visual language
  degrades to "still", not "blank".

Out of scope (documented, not fixed here): the software-rendering
environment's per-frame cost profile is not changed; animations themselves are
unchanged while the user interacts.

## Capabilities

### Modified Capabilities

- `ui-animation-energy`: all animations SHALL pause while the UI is visible but
  idle (no user input for a settle window), resuming on the first input; the
  idle state is fully static (state colors, no motion), so an unattended
  dashboard produces zero compositor frames even while background sessions
  stream.

## Impact

**Code**

- NEW `packages/client/src/hooks/useIdleFx.ts` — 5000 ms input-idle detector
  (pointerdown/pointermove/wheel/scroll/keydown/touchstart/focusin at capture),
  toggles `fx-idle` on `document.documentElement`, cleans up listeners + class.
- `packages/client/src/App.tsx` — mount `useIdleFx()` (next to `useAppHidden`).
- `packages/client/src/index.css` — `:root.fx-idle *` pause block (wildcard,
  mirrors `app-hidden`).

**Tests**

- NEW `packages/client/src/hooks/__tests__/useIdleFx.test.tsx` — idle class
  appears after the delay, clears on input, timer resets on activity (fake
  timers).
- `packages/client/src/components/__tests__/SessionCard.test.tsx` — selected
  card renders the trio with the expected layer classes (guards the CSS
  selectors against rename drift).

**Docs**

- AGENTS.md rows: `hooks/` (new file), `src/` (`index.css` row: `fx-idle` pause
  block), root `App.tsx` row (idle-FX wiring).

## Discipline Skills

- **`performance-optimization`** — the change exists to remove ~17% of a core
  of steady-state GPU CPU; the before/after is measured with performance traces
  (recorded numbers in Why), not assumed.
- **`review-code`** — timer/listener lifecycle (fake-timer-safe, StrictMode
  double-invoke, listener capture semantics) is exactly the seam that regresses
  silently.

`security-hardening` (no untrusted input/secrets/auth surface), `observability-
instrumentation` (no endpoint/job/external call), and `systematic-debugging`
(the mechanism was already isolated by experiments before the fix, not during)
do not apply.
