# lazy-feature-bootstrap Delta

## ADDED Requirements

### Requirement: Markdown and renderer payloads are not part of the cold landing graph

`MarkdownContent`, the interactive-renderer registry, and the tool-renderer registry
SHALL be reached only through dynamic imports at their render boundaries
(`LazyMarkdownContent`, `LazyInteractiveRenderer`, `LazyToolRenderer` — module-level
`React.lazy` with a null fallback and a mount-time prefetch). A cold landing page
SHALL NOT fetch the markdown payload chunk or the boundary chunks, and the emitted
entry `index.html` SHALL NOT module-preload them. Interactive and tool results SHALL
render as soon as their boundary resolves; the boundaries SHALL NOT be placed on
content outside those registries (status ticks, retry affordances, plugin-claimed
renderer paths stay eager).

#### Scenario: Cold landing does not fetch the markdown payload
- **WHEN** the dashboard loads and renders the session list
- **THEN** no request for the markdown payload chunk is issued
- **AND** the entry HTML module-preloads only `index`, `util`, `diff`, `dnd`, `mdi`, `react-vendor` and the CSS

#### Scenario: A chat message renders markdown once its boundary resolves
- **WHEN** a chat message with markdown content mounts
- **THEN** the boundary resolves and the rendered markdown appears (after the first frame)

#### Scenario: A tool card renders through the lazy registry
- **WHEN** a completed tool-call card mounts
- **THEN** the mapped renderer mounts after the boundary resolves
- **AND** a plugin-claimed renderer path is unaffected

#### Scenario: The preload helper never lands in a lazy chunk
- **WHEN** the production build output is inspected
- **THEN** the `vite/preload-helper` virtual module is emitted in a preloaded chunk (`util`), NOT in a lazy chunk
- **AND** the entry chunk has no static import of any lazy chunk

### Requirement: Build output pins the payload lazy boundary

A build-output regression test SHALL assert that the markdown chunk is emitted, that
`index.html` does not module-preload it, and that the three boundary host files keep
their dynamic import of the feature module (source tripwire). The test SHALL skip
when no production build is present and SHALL fail loudly when a guarded chunk is
renamed or merged away.

#### Scenario: Landing preload excludes the markdown payload
- **WHEN** the production build output is inspected
- **THEN** `index.html` references no `/assets/markdown-` URL

#### Scenario: The markdown chunk still exists
- **WHEN** the production build output is inspected
- **THEN** a `markdown-*.js` chunk is present in the emitted assets

#### Scenario: Boundary hosts keep their dynamic import
- **WHEN** any boundary host file statically imports its feature module instead
- **THEN** the source tripwire fails and names the file and specifier
