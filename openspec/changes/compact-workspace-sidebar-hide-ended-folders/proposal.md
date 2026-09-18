# Compact workspace sidebar: hide folder groups with no alive sessions

## Why

Compact sidebar mode (`config` → Interface → "Compact workspace sidebar") already strips the heavy folder surfaces: the tier-0 banner, auxiliary plugin sections, creation trays, separators, and dashboard-level creation controls. One heavy surface remains: folders whose pi sessions have all ended (or that only carry an `endedTotals` count) still render a folder header, an ended expander, and a per-row `FolderInitScope` probe each. On a long-lived dashboard those stale directories dominate the compact sidebar precisely because compact mode exists to keep the surface scannable. The research note for the long-session sidebar audit logged the request as "精简工作区侧栏 (compactSidebar) 开启时隐藏存根文件夹" (2026-09-18).

## What Changes

- In compact mode, the **unpinned (Other) tier** renders only folder groups holding at least one alive session (status ≠ `ended`). Groups whose held sessions are all ended — and zero-held stub groups carrying only a non-zero `endedTotals` entry — are hidden.
- The hide mirrors the existing stub-budget (C2) exemptions: an active session search, tag/phase filter, workspace path filter, or a non-empty archive-search match set exempts folder groups, so a user actively hunting a folder always sees their matches. With compact mode off, rendering is unchanged.
- The **pinned tier and workspace-owned folders are unaffected** — pinning and workspace membership stay explicit keep-visible opt-ins.
- Compact title-level chrome (session search field, pin dialog, creation controls) keeps rendering; only the folder-entry list narrows.
- The Settings toggle hint gains one sentence naming the new behavior.

## Capabilities

### Modified Capabilities
- `session-listing`: adds a compact-presentation render rule for the unpinned tier that is exempted by the existing narrowing-filter and archive-search escape hatches. Does not alter the base requirement (stub groups SHALL render) or the C2 budget; it narrows rendering only under `compactSidebar`.

## Impact

- **Code**: `packages/client/src/components/session/SessionList.tsx` — one conditional in the existing `visibleTopUnpinned` filter chain (`renderGroupWithWorkspaceMenu` return path); `packages/client/src/components/settings/SettingsPanel.tsx` — `compactWorkspaceSidebarDescription` hint text.
- **APIs / protocol**: none. `compactSidebar` is a front-end-only presentation flag; no server, protocol, or config-schema change.
- **Tests**: new `describe("compact sidebar hides ended-only folders …")` block in `packages/client/src/components/__tests__/SessionList.folder-menu.test.tsx`; the existing compact-mode block in `SessionList.test.tsx` continues to pass (its session is alive).
- **Docs**: source-tree sidecar rows only; `docs/architecture.md` (compact presentation bullet) deferred to DocScribe if the reviewer wants it.

## Discipline Skills

- `review-code` — non-trivial client render-logic change with an interlocking filter chain (stub budget C2, archive-search exemption, workspace tier); run the two-tier review before commit.
- None of the other `eng-disciplines` skills apply: no auth/secrets/PII/untrusted input (client-only predicate over already-delivered session data), no latency budget (the change removes work, adding only an O(n) predicate over existing loops), no new endpoint/job/external call, no migration or public API.
