/**
 * B1 — `archive_result` client handling
 * (change: fix-archive-feedback-and-sidebar-perf).
 *
 * The WS archive path has exactly one failure signal: the `archive_result`
 * ACK. A rejection MUST toast (translated via the `err.archive.*` catalog),
 * a success MUST stay silent, and NEITHER may touch the `sessions` Map — a
 * failed archive leaves the session listed, and the success state change is
 * owned by the `session_archived` broadcast.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The `t()` language singleton is fixed at module load from localStorage /
// navigator. Pin a deterministic locale BEFORE the handler's import graph
// initializes — so the hook module is pulled in dynamically below, never by a
// static import that would load i18n first.
window.localStorage.setItem("pi-dashboard-language", "zh-CN");
const { useMessageHandler } = await import("../useMessageHandler.js");

function setup() {
  const showToast = vi.fn();
  const session = { id: "s1", cwd: "/tmp/repo", source: "tui", status: "ended", startedAt: 1 } as DashboardSession;
  const sessionsRef = { current: new Map([["s1", session]]) };
  const setSessions = vi.fn((updater: unknown) => {
    sessionsRef.current = typeof updater === "function" ? (updater as (m: unknown) => typeof sessionsRef.current)(sessionsRef.current) : (updater as typeof sessionsRef.current);
  });
  const setters: any = {
    setSessions, setSessionStates: vi.fn(), setSessionCommands: vi.fn(),
    setFileResults: vi.fn(), setChangedOnDisk: vi.fn(), setOpenspecMap: vi.fn(), setFolderGitMap: vi.fn(),
    setOpenspecGroupsMap: vi.fn(), setModelsMap: vi.fn(), setModelRefreshErrorsMap: vi.fn(),
    setRolesMap: vi.fn(), setSpawnResult: vi.fn(), setSessionOrderMap: vi.fn(),
    setPinnedDirectories: vi.fn(), setFavoriteModels: vi.fn(), setWorkspaces: vi.fn(), setTerminals: vi.fn(),
    setDiscoveredServers: vi.fn(), setSpawnErrors: vi.fn(), setResumeErrors: vi.fn(),
    setDisplayPrefs: vi.fn(), setLoadingHistory: vi.fn(), setReplayInFlight: vi.fn(), setCanvasMap: vi.fn(),
  };
  const deps: any = {
    send: vi.fn(), navigate: vi.fn(), clearSpawningCwd: vi.fn(),
    spawningCwdsRef: { current: new Set() }, subscribedRef: { current: new Set() },
    pendingTerminalCwdRef: { current: null }, lastCreatedTerminalIdRef: { current: null },
    maxSeqMapRef: { current: new Map() }, selectedSessionIdRef: { current: undefined },
    pendingSpawnsRef: { current: new Map() }, loadingHistoryTimersRef: { current: new Map() },
    replayInFlightTimersRef: { current: new Map() }, showToast,
  };
  const { result } = renderHook(() => useMessageHandler(setters, deps));
  return {
    dispatch: (message: ServerToBrowserMessage) => result.current(message),
    showToast,
    sessionsRef,
    setSessions,
  };
}

describe("useMessageHandler archive_result (B1)", () => {
  it("toasts a translated error on {ok:false} and leaves the session listed", () => {
    const { dispatch, showToast, sessionsRef } = setup();

    dispatch({
      type: "archive_result",
      sessionId: "s1",
      ok: false,
      error: "session is running",
      code: "archive.reject_running",
    } as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledTimes(1);
    // The err.archive.* catalog is wired (zh catalog is the test locale).
    expect(String(showToast.mock.calls[0][0])).toContain("正在运行");
    expect(showToast.mock.calls[0][1]).toBe("error");
    // No optimistic removal on failure.
    expect(sessionsRef.current.has("s1")).toBe(true);
  });

  it("falls back to the server message when the code is unmapped or absent", () => {
    const { dispatch, showToast } = setup();

    dispatch({
      type: "archive_result",
      sessionId: "s1",
      ok: false,
      error: "disk on fire",
      code: "archive.unknown_future_code",
    } as unknown as ServerToBrowserMessage);

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(String(showToast.mock.calls[0][0])).toBe("disk on fire");
  });

  it("stays quiet on {ok:true} and does not touch the sessions Map", () => {
    const { dispatch, showToast, setSessions, sessionsRef } = setup();

    dispatch({ type: "archive_result", sessionId: "s1", ok: true } as ServerToBrowserMessage);

    expect(showToast).not.toHaveBeenCalled();
    // The state change belongs to the `session_archived` broadcast alone —
    // the ack must not delete the row (it arrives BEFORE the broadcast).
    expect(setSessions).not.toHaveBeenCalled();
    expect(sessionsRef.current.has("s1")).toBe(true);
  });

  it("stays quiet on the pending receipt {ok:true, pending:true}", () => {
    const { dispatch, showToast, sessionsRef } = setup();

    dispatch({ type: "archive_result", sessionId: "s1", ok: true, pending: true } as ServerToBrowserMessage);

    expect(showToast).not.toHaveBeenCalled();
    expect(sessionsRef.current.has("s1")).toBe(true);
  });
});
