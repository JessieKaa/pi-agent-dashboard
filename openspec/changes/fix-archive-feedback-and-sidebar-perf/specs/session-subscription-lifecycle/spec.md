# session-subscription-lifecycle Specification

## Purpose

Bounds a browser tab's live-stream interest to the session it displays: a
subscription that loses selection is released instead of streaming for the
lifetime of the tab, with an explicit carve-out for plugin overlays that mount
their own subscription.

## ADDED Requirements

### Requirement: The client SHALL release a subscription when a session loses selection

When the selected session changes, or a selection is deselected, the client
SHALL send `unsubscribe { sessionId }` for the previous selection's session.
The client SHALL release a session's subscription at most once per selection
change, and SHALL NOT release the subscription of a session that remains
selected — the selection effect re-runs on unrelated dependency changes
(connection status, send identity) with the same selection, and a release
there would cut the stream of the session still being displayed.

Because the tab holds one WebSocket, every session the user ever selected
receives live frames until unsubscribed; without this release the server keeps
streaming them, and their buffers accumulate, for the lifetime of the tab.

A released session SHALL also be removed from the client's
subscribed-guard collection. The guard treats membership as "this socket has
an open subscription" and is consulted before sending `subscribe`; a stale
entry left by a release would make a later re-selection of that session skip
its `subscribe` entirely, leaving the view empty until a reconnect.

#### Scenario: Deselecting a session releases its subscription

- **GIVEN** the client is displaying session A
- **WHEN** the selection is cleared (the user navigates away from the session)
- **THEN** the client SHALL send `unsubscribe { sessionId: "A" }`

#### Scenario: Switching sessions releases the previous one

- **GIVEN** the client is displaying session A
- **WHEN** the user selects session B
- **THEN** the client SHALL send `unsubscribe { sessionId: "A" }`

#### Scenario: Re-selecting a released session re-subscribes

- **GIVEN** session A's subscription was released by a deselect
- **WHEN** the user re-selects session A
- **THEN** the client SHALL send `subscribe { sessionId: "A", lastSeq: <its cursor> }`
- **AND** SHALL NOT rely on the server still streaming A from the earlier
  subscription

#### Scenario: An unchanged selection is not released

- **WHEN** the selection effect re-runs with the same selected session (a
  status or send-identity change)
- **THEN** the client SHALL NOT send `unsubscribe` for the selected session

### Requirement: The release SHALL be held while a plugin overlay is matched

A plugin overlay route (for example the subagent popout) carries its own
session param, and the overlay's claim mounts its OWN subscription for a
session the selection effect never selected. Because the server gates live
frames on the subscription set, releasing the previous selection's
subscription while such an overlay is open would cut the overlay's stream.
While a plugin overlay route is matched, BOTH the release and the
prev-selection ref advance SHALL be held; freezing the ref is what keeps the
held session releasable once the overlay closes.

The held subscription is a bounded cost: it lasts exactly as long as the
overlay is open.

#### Scenario: Overlay open while the selection changes

- **GIVEN** the client is displaying session A and a plugin overlay route
  matching with the overlay's claim holding its own subscription
- **WHEN** the selection changes to session B behind the overlay
- **THEN** the client SHALL NOT send `unsubscribe` for session A

#### Scenario: Overlay close releases the held subscription

- **GIVEN** session A's release and ref advance were held while a plugin
  overlay was open, and the selection has since become session B
- **WHEN** the overlay route stops matching
- **THEN** the client SHALL send `unsubscribe { sessionId: "A" }`

### Requirement: No unload beacon; connection close bounds subscriptions

The client SHALL NOT send `unsubscribe` messages during page unload. Closing
the WebSocket already tears down all per-connection subscription state on the
server, so an unload send would be redundant; a send issued during unload is
also unreliable, which would make the behavior inconsistent across browsers.

The client's per-session live cursor (the max observed seq) SHALL survive the
unload in memory for the reconnect case, and the durable replay cache cursor
SHALL survive it for the reload case, so a page that comes back re-subscribes
from its cursor instead of forcing a full replay.

#### Scenario: A closed tab's subscriptions are torn down server-side

- **GIVEN** a tab subscribed to sessions A and B
- **WHEN** the tab closes without sending any `unsubscribe`
- **THEN** the server SHALL have removed the connection's subscriptions when
  the WebSocket closed
- **AND** no further live frames for A or B SHALL be produced for that
  connection
