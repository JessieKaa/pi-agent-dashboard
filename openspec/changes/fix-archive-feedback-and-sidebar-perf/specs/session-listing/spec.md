## MODIFIED Requirements

### Requirement: Browser pages older ended sessions on demand

In this requirement `cwd` on `sessions_page` / `sessions_page_result` and the keys of `endedTotals` denote the session group key the sidebar already groups by (pinned directory, else worktree main path, else session cwd), so a worktree session pages within its parent group. The client SHALL render a folder group for every group key that has a non-zero `endedTotals` entry even when it holds no session for that cwd (a stub group whose only content is the ended expander). When a folder group's ended list is expanded and `endedTotals[cwd]` exceeds the number of ended sessions the client holds for that cwd, the client SHALL request `sessions_page { cwd, offset }` where `offset` is the number of non-window (paged) ended sessions it already holds for that cwd, and SHALL issue at most one page request per cwd at a time (released on reply, on a 15-second timeout, or when the socket opens). The server SHALL reply to that browser only with `sessions_page_result { cwd, sessions, order, hasMore }` containing the next batch, taken at `offset` from the cwd's ended sequence (persisted order restricted to ended ids, then ended ids without a persisted position by `startedAt` descending) with the snapshot-window ids excluded, and `hasMore` true when further entries remain. The client SHALL ignore order ids it does not hold when applying any order, and SHALL keep held ids absent from an incoming `sessions_reordered` at the tail rather than evicting them.

In the default (unfiltered) view the client SHALL render at most 8 stub groups in the unpinned tier; stub groups beyond that budget SHALL be replaced by a single summary row carrying the hidden-stub count, and activating that row SHALL materialize every remaining stub group. Groups holding sessions (ended included) SHALL NOT consume the budget, pinned stub groups SHALL always render, and an active narrowing filter (session search, tag/phase, or workspace path) SHALL render every matching stub group uncapped. See change: fix-archive-feedback-and-sidebar-perf (C2).

#### Scenario: Expanding the ended list pages in the next batch
- **GIVEN** a cwd group with `endedTotal` of 500 and 20 ended sessions held by the client
- **WHEN** the user expands the ended list
- **THEN** the client SHALL send one `sessions_page` for that cwd
- **AND** on `sessions_page_result` the ended list SHALL grow by the page's sessions in order
- **AND** a "more" affordance SHALL be shown while `endedTotals[cwd]` exceeds the ended sessions held for that cwd

#### Scenario: Stub group for a cwd outside the window
- **GIVEN** a snapshot with `endedTotals["/old/wt"]` of 3 and no session for `/old/wt`
- **WHEN** the sidebar renders
- **THEN** a folder group for `/old/wt` SHALL be shown with an ended expander labelled from `endedTotals`
- **AND** expanding it SHALL send `sessions_page { cwd: "/old/wt", offset: 0 }

#### Scenario: Stub rows beyond the budget collapse into a summary row
- **GIVEN** 12 unpinned stub groups with no held session and no active filter
- **WHEN** the sidebar renders
- **THEN** exactly 8 stub folder rows SHALL be rendered
- **AND** a single summary row SHALL carry "+4 more folders"

#### Scenario: Expanding the summary materializes the hidden stubs
- **GIVEN** the budgeted sidebar with a "+N more folders" summary row
- **WHEN** the user activates the summary row
- **THEN** every remaining stub group SHALL render and the summary row SHALL disappear

#### Scenario: Session-bearing groups do not consume the budget
- **GIVEN** 6 groups each holding a session and a further 6 zero-session stub groups
- **WHEN** the sidebar renders
- **THEN** all 6 stub rows SHALL render with no summary row
- **AND** the session-bearing groups SHALL render their normal folder bodies

#### Scenario: Sequential paging per cwd
- **WHEN** a page request for a cwd is in flight
- **THEN** a further expand on the same cwd SHALL NOT send a second `sessions_page` until the first reply arrives

#### Scenario: No paging when everything is held
- **GIVEN** a cwd group whose `endedTotal` equals the ended sessions the client holds
- **WHEN** the user expands the ended list
- **THEN** no `sessions_page` SHALL be sent

#### Scenario: Unknown ids in an order are ignored
- **WHEN** a `sessions_reordered` or `sessions_page_result` order contains an id the client does not hold
- **THEN** the client SHALL apply the order without that id and without error

#### Scenario: Live reorder keeps paged ids
- **GIVEN** the client holds paged ended ids `p1`, `p2` for `/repoA` after `a`, `b`
- **WHEN** a `sessions_reordered { cwd: "/repoA", order: ["b","a"] }` arrives
- **THEN** `sessionOrderMap.get("/repoA")` SHALL equal `["b","a","p1","p2"]`

#### Scenario: Ended-count stays live between snapshots
- **GIVEN** `endedTotals["/repoA"]` of 2
- **WHEN** a `session_updated` transitions a held `/repoA` session to `ended`
- **THEN** the expander label for `/repoA` SHALL reflect 3
