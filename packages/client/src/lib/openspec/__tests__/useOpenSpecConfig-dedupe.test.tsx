/**
 * Request-dedupe + failure negative-cache for `useOpenSpecConfig`.
 *
 * One SessionCard per session all call the hook with their own cwd; multiple
 * cards sharing a cwd used to fire one `/api/openspec/config` request EACH on
 * every mount (and again per epoch bump). This suite pins the module-level
 * in-flight sharing (concurrent mounts → 1 request) and the 30 s failure
 * negative-cache (a failing cwd must not re-hammer the endpoint on every
 * remount), plus the unload-safety contract: a hook unmount no longer aborts
 * the shared request.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (④).
 */

import { DEFAULT_OPENSPEC_CONFIG } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetOpenSpecConfigCache,
  OPENSPEC_CONFIG_FAILURE_TTL_MS,
  useOpenSpecConfig,
} from "../openspec-config-api.js";

const CWD = "/repo/alpha";

function okResponse(config: object = { profile: "expanded", workflows: ["ship-it"] }) {
  return { ok: true, json: async () => ({ success: true, data: config }) } as Response;
}

function installFetch(impl: () => Promise<Response> | Response) {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** `fetch` init of the Nth call (vi.fn types the zero-arg mock's calls as []). */
function initOf(mock: { mock: { calls: unknown[][] } }, n = 0): RequestInit | undefined {
  return (mock.mock.calls[n]?.[1] as RequestInit | undefined) ?? undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __resetOpenSpecConfigCache();
});

describe("useOpenSpecConfig — in-flight dedupe (④)", () => {
  it("3 concurrent same-cwd hooks share one request", async () => {
    let resolve!: (r: Response) => void;
    const gate = new Promise<Response>((res) => { resolve = res; });
    const fetchMock = installFetch(() => gate);

    const a = renderHook(() => useOpenSpecConfig(CWD));
    const b = renderHook(() => useOpenSpecConfig(CWD));
    const c = renderHook(() => useOpenSpecConfig(CWD));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(okResponse());
    await waitFor(() => {
      expect(a.result.current.profile).toBe("expanded");
    });

    // All three hooks received the shared payload; still one network call.
    expect(b.result.current.profile).toBe("expanded");
    expect(c.result.current.profile).toBe("expanded");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("unmount of one hook does not abort or reject the shared request", async () => {
    let resolve!: (r: Response) => void;
    const gate = new Promise<Response>((res) => { resolve = res; });
    const fetchMock = installFetch(() => gate);

    const a = renderHook(() => useOpenSpecConfig(CWD));
    const b = renderHook(() => useOpenSpecConfig(CWD));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The deduped request is not tied to a per-hook AbortController.
    expect(initOf(fetchMock)?.signal).toBeUndefined();

    a.unmount();
    resolve(okResponse());
    await waitFor(() => {
      expect(b.result.current.profile).toBe("expanded");
    });

    // No unhandled rejection: the shared promise settled with a value.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useOpenSpecConfig — failure negative-cache (④)", () => {
  it("a failed fetch suppresses refetch on remount within the TTL", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    const fetchMock = installFetch(() => Promise.resolve({ ok: false, status: 500 } as Response));

    const first = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    // Failure keeps the DEFAULT config.
    expect(first.result.current).toBe(DEFAULT_OPENSPEC_CONFIG);
    first.unmount();

    // Remount well within the TTL — no new request. Effects flush inside
    // renderHook's act, so a TTL-bypassing refetch would already have fired.
    now.mockReturnValue(1_000_000 + OPENSPEC_CONFIG_FAILURE_TTL_MS - 1);
    const second = renderHook(() => useOpenSpecConfig(CWD));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.result.current).toBe(DEFAULT_OPENSPEC_CONFIG);
  });

  it("refetches after the TTL expires", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(2_000_000);
    const fetchMock = installFetch(() =>
      Promise.resolve(
        fetchMock.mock.calls.length === 1
          ? ({ ok: false, status: 500 } as Response)
          : okResponse(),
      ),
    );

    const first = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    now.mockReturnValue(2_000_000 + OPENSPEC_CONFIG_FAILURE_TTL_MS + 1);
    const second = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(second.result.current.profile).toBe("expanded");
    });
  });

  it("a successful fetch clears the failure entry", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(3_000_000);
    let fail = true;
    const fetchMock = installFetch(() =>
      Promise.resolve(fail ? ({ ok: false, status: 500 } as Response) : okResponse()),
    );

    const first = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    // TTL elapsed → refetch succeeds → the negative entry must be gone.
    now.mockReturnValue(3_000_000 + OPENSPEC_CONFIG_FAILURE_TTL_MS + 1);
    fail = false;
    const second = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    second.unmount();

    // A later remount revalidates normally (seed-then-refetch preserved).
    const third = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  it("__resetOpenSpecConfigCache clears the failure entry (epoch save path)", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(4_000_000);
    const fetchMock = installFetch(() => Promise.resolve({ ok: false, status: 500 } as Response));

    const first = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    first.unmount();

    // Save path: reset clears the negative cache even inside the TTL.
    now.mockReturnValue(4_000_000 + OPENSPEC_CONFIG_FAILURE_TTL_MS - 1);
    __resetOpenSpecConfigCache();
    const second = renderHook(() => useOpenSpecConfig(CWD));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
