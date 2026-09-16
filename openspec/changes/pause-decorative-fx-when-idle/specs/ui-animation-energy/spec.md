# ui-animation-energy (delta)

## ADDED Requirements

### Requirement: All animations pause while the UI is idle

The web client MUST pause ALL CSS animations while the document is visible but
the user has not interacted for a settle window (`IDLE_FX_DELAY_MS`, 5000 ms),
so a dashboard watched-and-untouched does not drive continuous compositor frame
production — including while background sessions stream or hold unread state.
The client SHALL set an `fx-idle` class on the document root when the settle
window elapses with no input, and MUST remove it synchronously on the first
input (pointer press, wheel, keyboard, touch, focus, or window focus — focus
resumes after an alt-tab return; `pointermove` and `scroll` MUST NOT count — a
resting hand emits micro-moves and streaming auto-scroll emits trusted scroll
events). While `fx-idle` is set, all elements and pseudo-elements MUST have
`animation-play-state: paused` (same wildcard technique as `app-hidden`). The
idle state is fully static: every animated element keeps a static color (card
stripes/dots at rest) that conveys the same state WITHOUT motion, and no
functionality may depend on animation completion. The `app-hidden` pause, the
off-screen `fx-offscreen` pause, and `prefers-reduced-motion` are unaffected
and take precedence independently.

#### Scenario: idle dashboard stops compositing even while a background session streams

- **GIVEN** a selected session is open, a DIFFERENT session is streaming (its
  sidebar card shows running/unread stripes and a pulsing status dot), and the
  document is visible
- **WHEN** no input event occurs for `IDLE_FX_DELAY_MS`
- **THEN** the document root SHALL carry `fx-idle`
- **AND** every animation SHALL be paused, including the background card's
  stripes and status-dot pulse
- **AND** the GPU-process CPU SHALL drop to near-idle within one frame
  (measured: 3268 ms → 8 ms of GPU-main activity per ~13 s window)

#### Scenario: first input resumes all animations

- **GIVEN** the document root carries `fx-idle` and every animation is paused
- **WHEN** any of pointer-press/wheel/key/touch/focus input (or a window
  `focus`, e.g. alt-tab return) occurs
- **THEN** the `fx-idle` class SHALL be removed before the next frame renders
- **AND** all animations SHALL resume animating

#### Scenario: activity within the window re-arms the settle timer

- **GIVEN** the idle settle timer is armed and has not yet fired
- **WHEN** an input event occurs at `t < IDLE_FX_DELAY_MS`
- **THEN** the timer SHALL restart from that input
- **AND** `fx-idle` SHALL NOT be set until `IDLE_FX_DELAY_MS` of silence after
  the last input

#### Scenario: pointer drift and programmatic scroll do not count as input

- **GIVEN** the settle timer is armed
- **WHEN** only `pointermove` micro-events (resting hand) or `scroll` events
  from streaming auto-scroll occur during the window
- **THEN** `fx-idle` SHALL still be set when the settle window elapses

#### Scenario: idle state conveys state without motion

- **GIVEN** `fx-idle` is set and session cards show running/unread status
- **WHEN** the idle state renders
- **THEN** the cards SHALL still show their status colors (static stripes /
  dots), not blank or neutral
- **AND** the selected card SHALL retain its static blue selection border/ring

#### Scenario: window hidden keeps overriding everything

- **GIVEN** `fx-idle` is set
- **WHEN** the document becomes hidden (`app-hidden` set) and then visible again
- **THEN** `app-hidden` SHALL pause all animations while hidden regardless of
  `fx-idle`
- **AND** on return to visible, `fx-idle` MAY still be set (no input occurred)
  so animations SHALL remain paused until input
