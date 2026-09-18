## MODIFIED Requirements

### Requirement: Durable replay cursor survives page reload

The client SHALL persist a per-session replay cursor (`maxSeq`) and the RAW event
tail (`{ seq, event }[]`, NOT a reduced chat-message snapshot) to IndexedDB, and
SHALL rehydrate on page load by re-reducing those raw events so an already-seen
session resubscribes with a non-zero `lastSeq`, triggering a delta replay rather
than a full replay.

The client's in-memory raw-event buffer SHALL be trimmed to a bounded tail
after every successful flush. The tail bound SHALL equal the server's
full-stream replay window (floored by the minimum replay window), so the
retained suffix is the same amount of history a cache-miss fresh load would
replay — a cache hit therefore never rehydrates materially less state than a
fresh load. The persisted entry's cursor SHALL remain the maximum seq across
the FULL buffer, not the trimmed tail: the cursor is what a reload resumes
from, so it must stay monotonic past the trim. Events appended while a flush is
in flight (after the payload was captured) SHALL survive the post-flush trim;
dropping them would make the next live frame read as a dropped-frame gap,
voiding provenance.

A session whose buffer descends from no replay batch SHALL schedule no flush
debounce: its buffer can never be persisted (the provenance requirement above),
so the debounce is pure waste. Without the tail bound, a buffer grows with tab
lifetime for every session ever viewed, and every flush re-serializes that
whole history into IndexedDB.

#### Scenario: Reload of a seen session delta-replays

- **WHEN** a session was previously subscribed (cache holds `maxSeq = N`) and the
  page is reloaded
- **THEN** the client SHALL send `subscribe { sessionId, lastSeq: N }`
- **AND** the server SHALL replay only events with `seq > N`
- **AND** the client SHALL NOT request a full replay (`lastSeq: 0`) for that
  session

#### Scenario: Reload of a never-seen session full-replays

- **WHEN** the page is reloaded and no cache entry exists for a session
- **THEN** the client SHALL send `subscribe { sessionId, lastSeq: 0 }`
- **AND** the server SHALL perform a full replay (unchanged behavior)

#### Scenario: Rehydrated state renders before the delta arrives

- **WHEN** a cache entry exists on load
- **THEN** the client SHALL render the rehydrated chat as provisional state
  before the `event_replay` delta arrives
- **AND** SHALL reconcile it against the first replay batch via the existing
  `firstSeq <= maxSeq` reset rule

#### Scenario: The buffer is trimmed to the tail bound after a flush

- **GIVEN** a descended session whose buffer holds more events than the tail
  bound
- **WHEN** a flush succeeds
- **THEN** the in-memory buffer SHALL hold at most the tail bound of most
  recent events
- **AND** the persisted entry's `maxSeq` SHALL be the maximum seq of the FULL
  buffer
- **AND** the persisted payload SHALL be the tail, so the next load
  delta-replays from the same cursor

#### Scenario: An append during a pending flush survives the trim

- **GIVEN** a flush whose durable write has not yet resolved
- **WHEN** new events for that session are recorded while the write is in
  flight
- **THEN** those events SHALL remain in the buffer after the flush resolves
- **AND** the next flush SHALL persist them
- **AND** the next live frame SHALL NOT be interpreted as a dropped-frame gap

#### Scenario: A non-descended session schedules no debounce

- **GIVEN** a client that has only ever received live broadcast events for a
  session
- **WHEN** a live event for that session is recorded
- **THEN** no flush debounce SHALL be scheduled for that session
