# mobile-shell Specification

## ADDED Requirements

### Requirement: The mobile root bounds itself to the viewport

The App's mobile branch SHALL render a root element bounded to the viewport
(`100dvh` high, `overflow-hidden`). In-flow chrome (plugin-staleness banner,
connection-status banner) SHALL stack ABOVE the shell inside that bound, and the
shell SHALL flex into the remaining space rather than claiming a viewport unit of
its own. The document SHALL NOT be scrollable: no visible banner may add height
on top of a viewport-tall shell.

Rationale: a `100dvh` shell plus an in-flow banner makes the document
`banner + 100dvh` tall, so entering a session or focusing the composer scrolls
the page and shifts the whole shell — header included — out of the viewport.

#### Scenario: No banner, no document scroll

- **WHEN** the mobile shell is mounted at a phone viewport with no banners visible
- **THEN** `document.scrollHeight` SHALL equal the viewport height
- **AND** the shell SHALL fill the viewport

#### Scenario: A visible banner does not make the page scroll

- **WHEN** the plugin-staleness (or connection-status) banner is visible in the
  mobile branch
- **THEN** `document.scrollHeight` SHALL still equal the viewport height
- **AND** the banner SHALL occupy the top of the viewport with the shell filling
  the remainder beneath it

#### Scenario: Session entry does not shift the header

- **WHEN** the user opens a session (or focuses the composer) on mobile with a
  banner visible
- **THEN** `document.scrollTop` SHALL remain 0
- **AND** the session header SHALL stay pinned at the top of the viewport
