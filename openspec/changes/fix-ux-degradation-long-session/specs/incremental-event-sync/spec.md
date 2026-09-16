# incremental-event-sync Delta

## ADDED Requirements

### Requirement: Reconcile diagnostic state is pruned

The stale running-tool reconcile's per-row diagnostic maps (`lastAttemptRef`,
`count404Ref`, keyed by `${sessionId}:${toolCallId}`) SHALL NOT grow without bound.
Each poll tick SHALL delete every key whose tool row no longer exists in the
current session states. Pruning a key of an absent row is lossless: the scan
predicates only ever read keys of rows that still exist (they guard on the row's
`running` status), so a pruned key can never be consulted again. The in-flight
set SHALL remain untouched — it is self-clearing on request settlement.

#### Scenario: Resolved or removed row keys are pruned

- **WHEN** a tool row that has an entry in `lastAttemptRef` / `count404Ref` is
  no longer present in the session states (its result arrived, the session was
  reset, or the session was removed) at the time of a poll tick
- **THEN** that row's key SHALL be deleted from both maps
- **AND** keys of rows that still exist SHALL be retained

#### Scenario: Pruning does not disturb active reconcile cycles

- **WHEN** a row is stale and being probed across ticks (in-flight, re-armed)
- **THEN** its `lastAttemptRef` / `count404Ref` entries SHALL survive pruning
  while the row still exists
- **AND** the re-arm window and the supersede 404 accounting SHALL behave
  exactly as before
