## ADDED Requirements

### Requirement: Compact sidebar hides unpinned folder groups with no alive session

When the compact sidebar presentation is active, the unpinned (Other) tier SHALL render only folder groups that hold at least one alive session (a session whose status is not `ended`); a group with zero held sessions but a non-zero `endedTotals` entry holds no alive session and SHALL be hidden as well. The hide SHALL apply only when no narrowing filter is active: a non-empty session search, an active tag/phase filter, a non-empty workspace path filter, or a folder with archive-search matches SHALL exempt folder groups from the hide (the user is actively hunting a folder, so its matches stay reachable). The pinned tier and workspace-owned folders SHALL be unaffected — pinning and workspace membership remain explicit keep-visible opt-ins. With compact mode off, rendering SHALL be unchanged. Compact title-level chrome (session search field, pin dialog, creation controls) SHALL keep rendering. See change: compact-workspace-sidebar-hide-ended-folders.

#### Scenario: Ended-only folder hides in compact mode
- **GIVEN** an unpinned folder whose held sessions are all `ended`
- **WHEN** `compactSidebar` is on
- **THEN** its folder group SHALL NOT be rendered

#### Scenario: Zero-session stub folder hides in compact mode
- **GIVEN** an unpinned cwd with a non-zero `endedTotals` entry and no held session
- **WHEN** `compactSidebar` is on
- **THEN** its stub row SHALL NOT be rendered, and the stub budget SHALL count only rendered stubs

#### Scenario: Alive folders keep rendering
- **GIVEN** an unpinned folder holding at least one non-`ended` session
- **WHEN** `compactSidebar` is on
- **THEN** its folder group SHALL render as today

#### Scenario: Compact off restores today's rendering
- **GIVEN** the same ended-only folders and stubs
- **WHEN** `compactSidebar` is off
- **THEN** every folder group SHALL render exactly as before this change

#### Scenario: Active narrowing filter exempts the hide
- **GIVEN** an ended-only unpinned folder
- **WHEN** `compactSidebar` is on and a session search, tag/phase filter, workspace path filter, or archive-search query is active with a match in that folder
- **THEN** the folder group SHALL render with its matches

#### Scenario: Pinned and workspace tiers are unaffected
- **GIVEN** a PINNED folder whose sessions are all `ended`
- **WHEN** `compactSidebar` is on
- **THEN** the pinned group SHALL render as today
