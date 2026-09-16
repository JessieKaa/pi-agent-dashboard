# chat-scroll-lock Delta

## MODIFIED Requirements

### Requirement: Auto-scroll robust to multi-batch event replay
When the chat view scrolls programmatically (on session switch in the "near bottom" branch, or when new content arrives while the user is at the bottom), the resulting `onScroll` event SHALL NOT cause the view to register that the user has scrolled away from the bottom. The auto-scroll chase SHALL continue across every subsequent `event_replay` batch until either replay completes or the user performs a real scroll gesture. The auto-scroll bottom-pin (both the `stickToBottom` follow effect and the virtualizer `onChange` re-pin) SHALL additionally be suspended while an active transcript selection is held, and SHALL resume on selection collapse without clearing the underlying at-bottom follow state.

The follow SHALL also survive a MEASUREMENT CLAMP of a programmatic bottom-pin: the pin writes `el.scrollTop = el.scrollHeight` clamped to the maximum that exists at write time, so rows below the viewport measuring in before the pin's own scroll event dispatches make that event read `nearBottom = false` with no user gesture involved. The follow SHALL be held exactly when the event matches the recorded pin snapshot — the view still sits at (or below) the `scrollTop` the pin ACHIEVED, the content is taller than at write time, and the pin landed with real content; any other event (view moved above the pinned position, or no growth) SHALL fall through to the position rules, so a real escape still releases. A RELOCATING programmatic write (scrollToBottom, scrollToTurn, restore, splice correction) SHALL leave the follow state and button state to its own writer when its event arrives.

#### Scenario: Programmatic scroll-to-bottom races a replay batch
- **GIVEN** the user has switched to a session whose events are not cached on the server
- **AND** the chat view has called `scrollTo` to land at the current bottom
- **WHEN** another `event_replay` batch arrives and grows `scrollHeight` before the previous `scrollTo` has produced its `onScroll` event
- **THEN** `isNearBottom` SHALL remain true
- **AND** the floating scroll-to-bottom button SHALL NOT appear
- **AND** the next render SHALL scroll to the new bottom

#### Scenario: Real user scroll during replay still wins
- **GIVEN** event replay is in progress
- **WHEN** the user actively scrolls upward (e.g. wheel, touch, drag the scrollbar)
- **THEN** within at most 150 ms of the user's scroll, `isNearBottom` SHALL be set to false
- **AND** the floating scroll-to-bottom button SHALL appear
- **AND** subsequent replay batches SHALL NOT pull the view back to the bottom

#### Scenario: Final position is the latest message after replay
- **GIVEN** the user switched to an uncached session and did not scroll
- **WHEN** all `event_replay` batches have been processed
- **THEN** the chat view SHALL be scrolled to the latest message
- **AND** the floating scroll-to-bottom button SHALL NOT be visible

#### Scenario: Auto-scroll suspended while selecting, resumed on collapse
- **GIVEN** the user was at the bottom following a live stream
- **WHEN** the user holds an active transcript selection while new content streams in
- **THEN** the view SHALL NOT auto-scroll to the bottom for the lifetime of the selection
- **AND** when the selection collapses the view SHALL resume following the bottom

#### Scenario: Measurement clamp holds the follow
- **GIVEN** the user is at the bottom following a replay, and the follow effect
  pinned the view to the then-current bottom
- **WHEN** rows below the viewport measure in and grow `scrollHeight` before the
  pin's induced scroll event dispatches, so the event reads `nearBottom = false`
  while `scrollTop` still equals the value the pin achieved
- **THEN** the at-bottom follow SHALL remain armed
- **AND** the floating scroll-to-bottom button SHALL NOT appear
- **AND** the next growth SHALL scroll the view to the new bottom

#### Scenario: Position moved above the pin still releases
- **GIVEN** the follow is armed and a pin snapshot is the most recent write
- **WHEN** the view moves above the pinned position with no wheel/touch gesture
  (scrollbar drag or keyboard)
- **THEN** the follow SHALL be cleared, the scroll-to-bottom button SHALL
  appear, and subsequent growth SHALL NOT pull the view back to the bottom

#### Scenario: A pin on an empty container proves nothing
- **GIVEN** the follow effect pinned an empty container (pre-measure mount)
- **WHEN** the first rows measure in and the view later reads as not-at-bottom
  with no gesture
- **THEN** the event SHALL fall through to the position rules, so an escape is
  never swallowed by a zero-height pin snapshot

#### Scenario: A relocating write is not judged by position
- **GIVEN** a relocating programmatic write (scrollToBottom, scrollToTurn, a
  restore, or a splice correction) has just moved the view
- **WHEN** its induced scroll event arrives inside the suppression window
- **THEN** the event SHALL NOT alter the follow state or the button state —
  the writer owns the outcome it chose
