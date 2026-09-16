# Pause all animations while the UI is idle

Follow-up scope (measured after the trio-only fix shipped): switching away from
a streaming session leaves its card's stripes + status-dot pulse animating;
those alone burn CrGpuMain 3268 ms / 13.3 s (~24.6% of a core) at idle. The
pause covers ALL animations (wildcard, same as `app-hidden`).

## 1. Red tests

- [ ] 1.1 NEW `packages/client/src/hooks/__tests__/useIdleFx.test.tsx` (fake
  timers, `renderHook`): (a) after `IDLE_FX_DELAY_MS` with no input,
  `document.documentElement` carries `fx-idle`; (b) a `pointerdown` inside the
  window clears it immediately; (c) activity before the delay resets the timer
  (no class at delay-1ms after a mid-window input); (d) unmount removes the
  class and the listeners (no timer leak: `vi.getTimerCount()`).
- [ ] 1.2 Extend `packages/client/src/components/__tests__/SessionCard.test.tsx`
  (selector-drift GUARD, green from the start): a selected card renders
  `.card-glow-fx` ×2 (outer carries both classes), `.card-glow-fx-outer` ×1,
  `.card-ring-fx` ×1; unselected renders none — guards the exact class names
  the `fx-idle` CSS selectors key on (rename drift would silently disable the
  pause).

## 2. Hook: `useIdleFx`

- [ ] 2.1 NEW `packages/client/src/hooks/useIdleFx.ts`: mount-time listener set
  (`pointerdown`, `wheel`, `keydown`, `touchstart`, `focusin`, `focus`; capture)
  on `window` — deliberately NOT `pointermove`/`scroll` (resting-hand
  micro-moves; streaming auto-scroll's trusted scroll events); any event clears
  `fx-idle` and re-arms a `setTimeout(IDLE_FX_DELAY_MS)`; when the timer fires
  it sets `fx-idle` on `document.documentElement`. Cleanup clears timer +
  listeners + class. `IDLE_FX_DELAY_MS = 5000` exported. JSDoc: why only
  decorative FX are paused (liveness indicators keep running); see change:
  pause-decorative-fx-when-idle.
- [ ] 2.2 §1.1 green.

## 3. CSS: idle pause block

- [ ] 3.1 `packages/client/src/index.css`: `:root.fx-idle *`,
  `:root.fx-idle *::before`, `:root.fx-idle *::after` set
  `animation-play-state: paused !important` (wildcard, mirrors the `app-hidden`
  block). Comment records the trace numbers (1423 ms/14.6 s trio-only; 3268 ms/
  13.3 s background-stripes-only; 8 ms when paused) + the finding that one tiny
  animation costs the same as three giant ones.
- [ ] 3.2 `App.tsx`: call `useIdleFx()` next to `useAppHidden()`.

## 4. Off-screen freeze

Already covered: `SessionCard`'s `<li>` carries `useFxVisibility` (toggles
`.fx-offscreen`, whose CSS pauses descendants and pseudo-elements) — when a
card scrolls out of the sidebar it freezes via that path. No new hook.

## 5. Verify

- [ ] 5.1 Targeted: `npx vitest run packages/client/src/hooks/__tests__/useIdleFx.test.tsx packages/client/src/components/__tests__/SessionCard.test.tsx`
- [ ] 5.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` (grep summary);
  `npx biome check` on changed files (diagnostic parity with HEAD — ratchet).
- [ ] 5.3 Manual/live (deploy per §5.4, then on localhost:8000): idle 10 s with
  a selected card AND a background session streaming on its card → trace shows
  CrGpuMain ≤ ~2% (measured after: 3268 ms → 8 ms per ~13 s window); pointer
  press resumes everything within a frame; interacting normally shows stripes/
  pulses unchanged.
- [ ] 5.4 Deploy: `npm run build && rm -rf $DEST/assets && cp -r packages/client/dist/. $DEST/ && curl -X POST http://localhost:8000/api/restart`
  (global-install dist per deploy-topology memory).

## 6. Spec + docs

- [ ] 6.1 `specs/ui-animation-energy/spec.md` delta: ADDED "All animations
  pause while the UI is idle" requirement + scenarios (idle pause after settle
  window incl. background-streaming cards, resume on first input, pointer
  drift/programmatic scroll don't count, static state colors while idle,
  hidden state still wins).
- [ ] 6.2 AGENTS.md rows: `hooks/AGENTS.md` (`useIdleFx.ts`), `src/AGENTS.md`
  (`index.css` fx-idle block; `App.tsx` row: idle-FX wiring).
