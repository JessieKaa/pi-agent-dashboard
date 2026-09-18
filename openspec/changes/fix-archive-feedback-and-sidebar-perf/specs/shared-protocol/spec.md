## MODIFIED Requirements

### Requirement: Sessions snapshot message (server to browser)

The server SHALL define a `SessionsSnapshotMessage` in the browser protocol with shape:

```ts
interface SessionsSnapshotMessage {
  type: "sessions_snapshot";
  sessions: DashboardSession[];
  orders: Record<string, string[]>;      // cwd → ordered session ids (windowed)
  endedTotals: Record<string, number>;   // session group key → ended-session count, capped to the top-25 groups by most recent ended activity
  endedTotalsOverflow?: number;          // total ended sessions in groups dropped by the cap; omitted when none
}
```

This message SHALL be a member of the `ServerToBrowserMessage` union. Capped-out groups SHALL remain fully pageable through `sessions_page`.

#### Scenario: Snapshot type is recognized
- **WHEN** a `ServerToBrowserMessage` with `type: "sessions_snapshot"` is received by a TypeScript-typed consumer
- **THEN** the discriminated union SHALL narrow to `SessionsSnapshotMessage` exposing `sessions`, `orders`, and `endedTotals` fields

#### Scenario: Snapshot carries every known session
- **WHEN** the server constructs a snapshot for a browser connect
- **THEN** `sessions` SHALL contain every non-ended entry returned by `sessionManager.listAll()` at construction time
- **AND** `sessions` SHALL contain each cwd's ended entries that fall inside the snapshot window, and no others
- **AND** `orders` SHALL contain, for every cwd whose persisted order is non-empty, that order restricted to ids present in `sessions`
- **AND** every group with at least one ended session SHALL be accounted for: either listed in `endedTotals` with the group's full ended count, or counted by `endedTotalsOverflow` when dropped by the top-N cap
- **AND** no row in `sessions` SHALL carry `notifyLog`

#### Scenario: `endedTotals` is capped to the most recently active groups
- **GIVEN** more than 25 groups with ended sessions
- **WHEN** the server constructs a snapshot
- **THEN** `endedTotals` SHALL contain at most 25 entries, the groups with the most recent ended activity
- **AND** `endedTotalsOverflow` SHALL equal the total ended sessions in the dropped groups
- **AND** a dropped group SHALL still page its ended sessions through `sessions_page`

#### Scenario: Overflow is omitted when nothing was capped
- **GIVEN** at most 25 groups with ended sessions
- **WHEN** the server constructs a snapshot
- **THEN** `endedTotals` SHALL list every such group's full ended count
- **AND** `endedTotalsOverflow` SHALL be absent
