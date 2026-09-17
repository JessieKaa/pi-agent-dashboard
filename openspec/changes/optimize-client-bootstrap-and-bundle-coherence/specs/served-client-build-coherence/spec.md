# served-client-build-coherence Delta

## ADDED Requirements

### Requirement: Production client builds carry a served-artifact declaration

A production build of the web client SHALL emit `pi-dashboard-build.json` into the
build output directory containing `{ schemaVersion: 1, pluginRegistryHash }`, where
`pluginRegistryHash` is the same deterministic hash embedded in the generated
`PLUGIN_REGISTRY_HASH`. The file SHALL contain no timestamps, no machine-specific
paths, and no absolute directories. Dev/HMR registry generation SHALL NOT write the
declaration (it is not a production artifact).

#### Scenario: Production build writes a matching declaration
- **WHEN** the production client build completes
- **THEN** `dist/pi-dashboard-build.json` exists
- **AND** its `pluginRegistryHash` equals the `PLUGIN_REGISTRY_HASH` exported by the built bundle

#### Scenario: Dev generation writes no declaration
- **WHEN** the dev server regenerates the plugin registry from a manifest change
- **THEN** no declaration file is written to any build output directory

### Requirement: Declaration reading is resilient and never throws

The declaration reader SHALL return a parsed metadata object or `null` for a missing
file, unreadable file, malformed JSON, wrong schema version, or missing/blank hash
field. No consumer SHALL fail to start because the declaration is absent or invalid.

#### Scenario: Absent declaration degrades to null
- **WHEN** `readBuildMetadata` is called on a directory without a declaration
- **THEN** it returns `null` rather than throwing

#### Scenario: Malformed declaration degrades to null
- **WHEN** the declaration contains invalid JSON or a non-string hash
- **THEN** it returns `null` rather than throwing

### Requirement: Server resolves the static client directory once and serves that exact directory

The dashboard server SHALL resolve the client static directory through one helper
retaining the installed-package-first identity (module resolution of
`@blackbelt-technology/pi-dashboard-web/package.json`, sibling `dist`) with the
workspace sibling as fallback. The directory used for Fastify static serving SHALL be
the same resolved value reported in health, so the reported artifact cannot diverge
from the served artifact.

#### Scenario: Installed package wins
- **WHEN** the installed web package resolves and contains `index.html`
- **THEN** static serving uses that `dist` directory
- **AND** health reports on that same directory

#### Scenario: Workspace fallback
- **WHEN** the installed web package does not resolve but the workspace sibling client `dist` contains `index.html`
- **THEN** static serving uses the workspace directory

#### Scenario: API-only mode
- **WHEN** neither location contains `index.html`
- **THEN** the server starts in API-only mode
- **AND** health reports the `not-served` client-build status

### Requirement: Health reports served-artifact compatibility

`GET /api/health` SHALL include an additive `clientBuild` object:
`{ pluginRegistryHash: string | null, status: "matched" | "mismatched" | "metadata-missing" | "not-served" }`.
`matched` means the served declaration's hash equals the runtime plugin registry hash
computed from the same plugin set as the existing `bundleHash` field. The existing
`bundleHash` field and the browser `PluginStalenessBanner` comparison contract SHALL
remain unchanged. The health payload SHALL NOT expose filesystem paths. Startup SHALL
log a concise diagnostic for missing or mismatched metadata without printing a path.

#### Scenario: Served artifact matches the running server
- **WHEN** the served declaration hash equals the runtime registry hash
- **THEN** `clientBuild.status` is `matched`

#### Scenario: Served artifact drifted from the running server
- **WHEN** the served declaration hash differs from the runtime registry hash
- **THEN** `clientBuild.status` is `mismatched`
- **AND** the startup log names the mismatch without a filesystem path

#### Scenario: Served artifact predates the declaration mechanism
- **WHEN** the resolved static directory has no readable declaration
- **THEN** `clientBuild.status` is `metadata-missing`

#### Scenario: No static build is served
- **WHEN** the server runs in API-only mode
- **THEN** `clientBuild.status` is `not-served` and `pluginRegistryHash` is `null`

### Requirement: Local rebuild path verifies artifact coherence before restart

The repository's rebuild-and-restart script SHALL, between building the workspace
client and restarting the dashboard, resolve the served static destination through
the same identity as the server, synchronize the built output into it when the two
differ, and verify both sides carry identical declarations. It SHALL fail before any
restart or bridge reload when the source declaration is missing or the destination
cannot be verified to match. A workspace-only layout with no resolvable served
destination SHALL be reported explicitly and SHALL NOT be treated as an error.

#### Scenario: Stale destination is synchronized and verified
- **WHEN** the served destination carries an older declaration than the fresh workspace build
- **THEN** the script copies the fresh output into the destination
- **AND** verifies the destination declaration equals the source declaration before restarting

#### Scenario: Missing source declaration blocks the restart
- **WHEN** the fresh workspace build has no readable declaration
- **THEN** the script exits nonzero without restarting the dashboard or reloading bridges

#### Scenario: No served destination is an explicit success
- **WHEN** the workspace is the only client (no installed web package destination)
- **THEN** the script reports the workspace-only layout and proceeds
