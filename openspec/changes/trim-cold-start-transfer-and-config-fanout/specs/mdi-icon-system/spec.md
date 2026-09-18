# mdi-icon-system Delta

## ADDED Requirements

### Requirement: Dynamic mdi keys resolve through a generated table, not a namespace import

The client SHALL NOT use namespace imports (`import * as mdi`) of `@mdi/js`.
Icon resolution for dynamic keys (extension/plugin-provided names) SHALL read a
generated key→path JSON table (`packages/shared/src/dynamic-mdi-keys.json`), kept in
sync by a repository generator that scans `packages/*/src` plus test fixtures for
quoted `mdi…` literals and verifies each against the installed `@mdi/js`. Unknown
keys — absent from the table or from `@mdi/js` — SHALL resolve to `null`, preserving
today's unknown-key behavior. **Accepted contract change:** a third-party plugin key
that appears in no source literal and no manual table entry now resolves to `null`;
adding such keys requires a generator run.

#### Scenario: A known dynamic key resolves to its path
- **WHEN** a component resolves `mdiRefresh` through the dynamic lookup
- **THEN** it receives the same path string as the named `@mdi/js` export

#### Scenario: An unknown key resolves to null
- **WHEN** any key not present in the table is resolved
- **THEN** the lookup returns `null` (no exception, no fallback icon)

#### Scenario: Every table entry exists in the installed icon set
- **WHEN** the generator's verification runs against the installed `@mdi/js`
- **THEN** a table key with no corresponding export fails loudly

#### Scenario: The source tree contains no namespace import
- **WHEN** the tree-shaking tripwire scans the three resolver files
- **THEN** none of them contains `import * as mdi`

#### Scenario: The mdi chunk reflects tree-shaking
- **WHEN** the production build output is inspected
- **THEN** the emitted `mdi` chunk stays under its gzipped size cap and the entry chunk does not embed the full icon table
