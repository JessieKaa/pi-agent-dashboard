/**
 * Module-level cache + in-flight dedup for the worktree init-status probe.
 *
 * Lives in its own module with NO runtime imports so the client test setup can
 * reset it per test WITHOUT importing `useInitStatus.js` — importing the hook
 * from a setup file would bind its `git-api` import before the per-test
 * `vi.mock("…/git-api.js")` registration and silently break every mocked fetch.
 *
 * See change: fix-archive-feedback-and-sidebar-perf (A5).
 */
import type { WorktreeInitStatus } from "./git-api.js";

export const initStatusCache = new Map<string, WorktreeInitStatus>();
export const initStatusInflight = new Map<string, Promise<WorktreeInitStatus>>();

/** @internal test seam — drop all cached + in-flight probes. */
export function __resetInitStatusCache(): void {
  initStatusCache.clear();
  initStatusInflight.clear();
}
