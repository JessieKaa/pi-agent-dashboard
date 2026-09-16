# chat-selection-preservation Delta

## MODIFIED Requirements

### Requirement: Selection in a finished card survives transcript churn

The chat view SHALL NOT collapse a selection anchored in a finished
(non-streaming) transcript card due to selected-session updates, another
session's streaming updates, new card arrivals, auto-scroll, or virtual-window
recomputation. Renderers that consume contextual helpers SHALL preserve their
component types when an equivalent helper context receives a new object
identity, so reconciled transcript DOM nodes remain mounted. Rows the selection
intersects SHALL remain mounted for the lifetime of the selection, even if they
drift outside the normal viewport + overscan band. Retention SHALL be proactive:
the selection's row span SHALL be tracked from selection start (while the anchor
row is mounted) and kept mounted so that no intersected row is ever unmounted —
a reactive path that re-mounts after churn is insufficient, because DOM Range
endpoints are moved synchronously and irreversibly when their row unmounts.

#### Scenario: New card arrives while a finished card is selected
- **WHEN** the user holds a selection in a finished card AND a new message or tool card is appended to the transcript
- **THEN** the existing selection SHALL remain intact and copyable

#### Scenario: Streaming continues while a finished card is selected
- **WHEN** the user holds a selection in a finished card AND the assistant continues streaming into the tail card
- **THEN** the existing selection SHALL remain intact and copyable

#### Scenario: Background session streams while a finished card is selected
- **WHEN** the user holds a selection in a finished card of the selected session AND another session receives SSE or thinking updates
- **THEN** the selected card's transcript DOM nodes SHALL remain mounted
- **AND** the selection SHALL remain intact and copyable

#### Scenario: Multi-card selection spanning rows near the window edge
- **WHEN** the user selects text spanning multiple cards AND transcript churn would otherwise unmount one endpoint row
- **THEN** every row the selection intersects SHALL stay mounted and the selection SHALL remain intact

#### Scenario: Very large selection is bounded, not a full mount
- **WHEN** the user performs Select-All (or selects a row span exceeding the retained-row ceiling) on a long transcript
- **THEN** the transcript SHALL NOT force-mount every row
- **AND** past the ceiling the selection MAY collapse on churn (a visible outcome), and the view SHALL NOT mount only the endpoints and hand back a silently truncated copy
