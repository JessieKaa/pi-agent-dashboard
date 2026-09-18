/**
 * Single shared `GET /api/git/worktree/init-status` probe for a row.
 *
 * The row's `FolderInitScope` calls this once and feeds the result to BOTH the
 * tier-0 `FolderActionBanner` (setup / init / re-trust / failure rungs) and the
 * folder actions menu's Project setup tally, avoiding a double probe per row.
 * `refetch` re-issues the probe (after a hook run flips the gate, or a spawned
 * project-init session ends). Fail-open: `fetchWorktreeInitStatus` returns
 * `hasHook:false` on error.
 *
 * Module-level cache + in-flight dedup: folder rows remount on every
 * workspace/tier move and page reload, and each uncached mount costs a
 * synchronous git probe chain server-side — the sidebar's dominant reload
 * cost. A resolved answer is served synchronously to every later mount of the
 * same cwd; concurrent mounts share one request. Rejections are NOT cached
 * (`fetchWorktreeInitStatus` normally fail-opens rather than rejecting), and
 * `refetch` always bypasses and repopulates the cache — which is how a
 * changed gate reaches future remounts.
 * See changes: distinguish-initialize-actions, add-folder-action-banner,
 * fix-archive-feedback-and-sidebar-perf (A5).
 */
import { useCallback, useEffect, useState } from "react";
import { fetchWorktreeInitStatus, type WorktreeInitStatus } from "../lib/git/git-api.js";
import { initStatusCache, initStatusInflight } from "../lib/git/init-status-cache.js";
import { logRejection } from "../lib/report-error.js";

function fetchOnce(cwd: string): Promise<WorktreeInitStatus> {
  const existing = initStatusInflight.get(cwd);
  if (existing) return existing;
  const p = fetchWorktreeInitStatus(cwd).then(
    (s) => {
      initStatusCache.set(cwd, s);
      initStatusInflight.delete(cwd);
      return s;
    },
    (err) => {
      initStatusInflight.delete(cwd);
      throw err;
    },
  );
  initStatusInflight.set(cwd, p);
  return p;
}

export function useInitStatus(cwd: string): { status: WorktreeInitStatus | null; refetch: () => void } {
  const [status, setStatus] = useState<WorktreeInitStatus | null>(() => initStatusCache.get(cwd) ?? null);

  const refetch = useCallback(() => {
    void fetchOnce(cwd).then(setStatus);
  }, [cwd]);

  useEffect(() => {
    const cached = initStatusCache.get(cwd);
    if (cached) {
      setStatus(cached);
      return;
    }
    let alive = true;
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void fetchOnce(cwd)
      .then((s) => { if (alive) setStatus(s); })
      .catch(logRejection("useInitStatus.fetch"));
    return () => { alive = false; };
  }, [cwd]);

  return { status, refetch };
}
