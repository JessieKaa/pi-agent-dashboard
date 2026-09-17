# lazy-feature-bootstrap Delta

## ADDED Requirements

### Requirement: Terminal feature code is not part of the cold landing graph

The editor pane SHALL load the terminal layer through a dynamic import rendered only
once at least one `term:<id>` tab is open. A cold landing page (no session, no editor
interaction) SHALL NOT fetch the terminal feature chunk. The keep-alive contract is
unchanged: `TerminalPaneLayer` remains the single `TerminalView` mount point — one
mounted instance per open terminal id, hidden while a file tab is active, never
unmounted by tab switches, and torn down only when its terminal tab closes.

#### Scenario: Cold landing does not fetch the terminal chunk
- **WHEN** the dashboard loads with no terminal tab open
- **THEN** no request for the terminal feature chunk is issued

#### Scenario: Opening a terminal loads the chunk once
- **WHEN** the user opens the first terminal tab
- **THEN** the terminal chunk is fetched and the layer mounts exactly one `TerminalView` for that terminal id

#### Scenario: Switching tabs never remounts a terminal
- **WHEN** a terminal tab is open AND the user switches to a file tab and back
- **THEN** the `TerminalView` instance is hidden rather than unmounted
- **AND** no WebSocket re-connect occurs for that terminal

#### Scenario: Closing the terminal tab tears down its instance
- **WHEN** the terminal tab is closed
- **THEN** its `TerminalView` unmounts (the only teardown path)

### Requirement: Diff feature code loads only at diff surfaces

The file-diff view (`/session/:id/diff`) and the editor-pane pseudo-tab diff viewer
SHALL be dynamically imported at their render boundaries, so a cold landing page
followed by chat usage SHALL NOT fetch the diff feature chunk. The D3 registry
boundary is preserved: the file-kind viewer registry and the capped-viewer gate SHALL
NOT import a pseudo-tab viewer, and the diff viewer registration remains owned by the
pseudo-tab registry. Lazy loading SHALL NOT change diff behavior: virtual `diff:` path
resolution, the unavailable message outside a session diff provider, and the
loading/no-changes states render as before.

#### Scenario: Chat-only usage does not fetch the diff chunk
- **WHEN** the user browses sessions and chats without opening any diff surface
- **THEN** no request for the diff feature chunk is issued

#### Scenario: Opening the diff route loads it on demand
- **WHEN** the user navigates to `/session/:id/diff`
- **THEN** the diff chunk is fetched and the file diff view renders with its resolved file

#### Scenario: Opening a diff pseudo-tab loads it on demand
- **WHEN** the user opens a `diff:<rel>` tab in the editor pane
- **THEN** the diff chunk is fetched and the diff viewer renders the resolved file

### Requirement: Build output pins the landing preload boundary

A build-output regression test SHALL assert that the emitted entry `index.html` does
not module-preload the terminal or diff feature chunks, and that both chunks are still
emitted for their feature routes. The test SHALL skip when no production build is
present and SHALL fail when a guarded chunk is renamed or merged away, following the
existing chunk-size guard convention.

#### Scenario: Landing preload does not include lazy features
- **WHEN** the production build output is inspected
- **THEN** the entry HTML references neither the terminal nor the diff feature chunk in its preloads

#### Scenario: Feature chunks still exist
- **WHEN** the production build output is inspected
- **THEN** terminal and diff chunks are present in the emitted assets

#### Scenario: Renamed or merged chunk fails loudly
- **WHEN** the guarded chunk cannot be found in a present build output
- **THEN** the guard fails instead of silently passing
