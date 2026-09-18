/**
 * A5 — `useInitStatus` module cache + in-flight dedup
 * (change: fix-archive-feedback-and-sidebar-perf).
 *
 * The sidebar mounts one probe per folder row, and rows remount on every
 * workspace/tier move or reload. Each probe is a synchronous git spawnSync
 * chain server-side, so repeat mounts for a cwd must NOT re-issue the request
 * while a cached (even `needsInit`) answer stands.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetInitStatusCache } from "../../lib/git/init-status-cache.js";
import { useInitStatus } from "../useInitStatus.js";

const fetchWorktreeInitStatus = vi.hoisted(() => vi.fn());
vi.mock("../../lib/git/git-api.js", () => ({ fetchWorktreeInitStatus }));

beforeEach(() => {
  // Reset BEFORE each test, not after: the global setup's afterEach (registered
  // later, so run earlier than a file-local one) clears the cache between
  // tests anyway — resetting here keeps THIS file's tests order-independent.
  __resetInitStatusCache();
  fetchWorktreeInitStatus.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("A5: useInitStatus cache + dedup", () => {
  it("dedups concurrent mounts for the same cwd into ONE fetch", async () => {
    const d = deferred<{ hasHook: boolean }>();
    fetchWorktreeInitStatus.mockReturnValue(d.promise);

    const a = renderHook(() => useInitStatus("/repo-a5-1"));
    const b = renderHook(() => useInitStatus("/repo-a5-1"));
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(1);

    d.resolve({ hasHook: true });
    await d.promise;
    await act(async () => { await Promise.resolve(); });
    expect(a.result.current.status).toMatchObject({ hasHook: true });
    expect(b.result.current.status).toMatchObject({ hasHook: true });
  });

  it("serves a remount from cache with NO second fetch", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false, configured: true });
    const first = renderHook(() => useInitStatus("/repo-a5-2"));
    await act(async () => { await Promise.resolve(); });
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(1);
    expect(first.result.current.status).toMatchObject({ hasHook: false });
    first.unmount();

    const second = renderHook(() => useInitStatus("/repo-a5-2"));
    // Cache warm: the second mount never issues a request…
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(1);
    // …and the status is present synchronously on first paint.
    expect(second.result.current.status).toMatchObject({ hasHook: false, configured: true });
  });

  it("caches a negated needsInit answer (stub-folder storm case)", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, trusted: true, needsInit: false });
    const first = renderHook(() => useInitStatus("/repo-a5-3"));
    await act(async () => { await Promise.resolve(); });
    first.unmount();

    renderHook(() => useInitStatus("/repo-a5-3"));
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(1);
  });

  it("refetch bypasses the cache, re-issues once, and updates the cache", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, trusted: false });
    const { result } = renderHook(() => useInitStatus("/repo-a5-4"));
    await act(async () => { await Promise.resolve(); });
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(1);

    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: true, trusted: true, needsInit: false });
    await act(async () => { result.current.refetch(); await Promise.resolve(); });
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status).toMatchObject({ trusted: true, needsInit: false });

    // The refreshed answer is now what a remount reads.
    const { unmount } = renderHook(() => useInitStatus("/repo-a5-4"));
    unmount();
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(2);
  });

  it("a rejected probe is not cached — a remount retries", async () => {
    const d = deferred<never>();
    fetchWorktreeInitStatus.mockReturnValueOnce(d.promise);
    const first = renderHook(() => useInitStatus("/repo-a5-5"));
    d.reject(new Error("boom"));
    await act(async () => { await d.promise.catch(() => {}); });
    first.unmount();

    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false });
    renderHook(() => useInitStatus("/repo-a5-5"));
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(2);
  });
});

/**
 * C2 probe-count verification (change: fix-archive-feedback-and-sidebar-perf,
 * task 9.5): 14 unpinned stub groups on a COLD cache. Pre-change every stub
 * row mounts a `FolderInitScope` probe (14 requests on page load); the budget
 * must cap the mount to 8 rows → 8 probes, and expanding the summary
 * materializes the remaining 6.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../../components/session/SessionList.js";
import { ThemeProvider } from "../../components/settings/ThemeProvider.js";

describe("C2: stub budget bounds the init-status probe count", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    });
  });

  it("caps cold-cache probes to the rendered stub rows", async () => {
    fetchWorktreeInitStatus.mockResolvedValue({ hasHook: false });
    const totals = new Map<string, number>();
    for (let i = 0; i < 14; i += 1) totals.set(`/probe-g${i}`, 2);

    const { hook } = memoryLocation({ path: "/", static: true });
    render(
      <Router hook={hook}>
        <ThemeProvider>
          <SessionList sessions={[]} onSelect={() => {}} endedTotalsMap={totals} />
        </ThemeProvider>
      </Router>,
    );
    await act(async () => {});
    // 14 stubs, budget 8 → 8 rendered rows, 8 probes (pre-change: 14).
    expect(document.querySelectorAll('[data-testid^="folder-stub-body-"]').length).toBe(8);
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(8);

    fireEvent.click(screen.getByTestId("stub-budget-overflow"));
    await act(async () => {});
    expect(document.querySelectorAll('[data-testid^="folder-stub-body-"]').length).toBe(14);
    expect(fetchWorktreeInitStatus).toHaveBeenCalledTimes(14);
  });
});
