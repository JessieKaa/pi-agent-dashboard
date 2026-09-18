# openspec-profile-config Delta

## ADDED Requirements

### Requirement: Config fetches are shared per cwd and failures are negative-cached

`useOpenSpecConfig` SHALL share one in-flight `GET /api/openspec/config` request per
cwd across concurrent hook instances. Unmounting a hook SHALL NOT abort a shared
request (a per-hook cancelled flag guards the setState, not the fetch). After a
failed fetch, remounts within `OPENSPEC_CONFIG_FAILURE_TTL_MS` (30 s) SHALL reuse
the failure without a new request; a successful fetch or the save-path cache reset
(`__resetOpenSpecConfigCache`) SHALL clear the failure entry. Cache-seed-then-refetch
semantics are unchanged: a remount with a cached success revalidates in the
background.

#### Scenario: Concurrent cards share one request
- **WHEN** three `SessionCard`s with the same cwd mount in the same tick
- **THEN** exactly one `/api/openspec/config` request is issued
- **AND** all three hooks receive the shared payload

#### Scenario: Unmount does not break a sibling's request
- **WHEN** one of several hooks sharing a request unmounts before it resolves
- **THEN** the request completes and the remaining hooks receive the payload

#### Scenario: A recent failure suppresses refetch
- **WHEN** a fetch for a cwd failed AND a new hook mounts within the TTL
- **THEN** no new request is issued and the hook returns the default/cached config

#### Scenario: TTL expiry revalidates
- **WHEN** the failure TTL has elapsed and a hook mounts
- **THEN** a fresh request is issued

#### Scenario: A save resets the negative cache
- **WHEN** `__resetOpenSpecConfigCache` runs (the save/epoch path) AND a hook mounts
- **THEN** a fresh request is issued regardless of the failure TTL
