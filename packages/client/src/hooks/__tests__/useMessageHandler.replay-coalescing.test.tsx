import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { type MessageHandlerSetters, useMessageHandler } from "../useMessageHandler.js";

function toolStart(toolCallId: string, timestamp: number): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp,
    data: { toolCallId, toolName: "bash", args: { command: toolCallId } },
  };
}

function replay(
  sessionId: string,
  seqStart: number,
  events: DashboardEvent[],
  isLast = false,
): Extract<ServerToBrowserMessage, { type: "event_replay" }> {
  return {
    type: "event_replay",
    sessionId,
    events: events.map((event, index) => ({ seq: seqStart + index, event })),
    isLast,
  };
}

function live(
  sessionId: string,
  seq: number,
  event: DashboardEvent,
): Extract<ServerToBrowserMessage, { type: "event" }> {
  return { type: "event", sessionId, seq, event };
}

describe("useMessageHandler — replay coalescing", () => {
  let rafCallbacks: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let sessionStatesRef: { current: Map<string, SessionState> };
  let setSessionStates: ReturnType<typeof vi.fn>;
  let historyWindowsRef: { current: Map<string, any> };
  let setHistoryWindows: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rafCallbacks = new Map();
    nextRafId = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks.delete(id);
    });
    sessionStatesRef = { current: new Map() };
    setSessionStates = vi.fn((updater: any) => {
      sessionStatesRef.current =
        typeof updater === "function" ? updater(sessionStatesRef.current) : updater;
    });
    historyWindowsRef = { current: new Map() };
    setHistoryWindows = vi.fn((updater: any) => {
      historyWindowsRef.current =
        typeof updater === "function" ? updater(historyWindowsRef.current) : updater;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(initial?: Map<string, SessionState>) {
    if (initial) sessionStatesRef.current = initial;
    const maxSeqMap = new Map<string, number>();
    const replayPersister = {
      record: vi.fn(),
      seed: vi.fn(),
      drop: vi.fn(),
      flush: vi.fn(),
    };
    const setters = new Proxy({ setSessionStates, setHistoryWindows }, {
      get: (target, prop) => {
        if (prop === "setSessionStates") return target.setSessionStates;
        if (prop === "setHistoryWindows") return target.setHistoryWindows;
        return vi.fn();
      },
    }) as unknown as MessageHandlerSetters;
    const hook = renderHook(() => {
      const deps: any = {
        send: vi.fn(),
        navigate: vi.fn(),
        clearSpawningCwd: vi.fn(),
        spawningCwdsRef: useRef(new Set<string>()),
        subscribedRef: useRef(new Set<string>()),
        pendingTerminalCwdRef: useRef(null),
        lastCreatedTerminalIdRef: useRef(null),
        maxSeqMapRef: useRef(maxSeqMap),
        selectedSessionIdRef: useRef(undefined),
        pendingSpawnsRef: useRef(new Map()),
        loadingHistoryTimersRef: useRef(new Map()),
        replayInFlightTimersRef: useRef(new Map()),
        replayPersister,
      };
      return useMessageHandler(setters, deps);
    });
    return {
      dispatch: (message: ServerToBrowserMessage) => hook.result.current(message),
      maxSeqMap,
      replayPersister,
      unmount: hook.unmount,
    };
  }

  function flushFrame() {
    const callbacks = [...rafCallbacks.values()];
    rafCallbacks.clear();
    act(() => {
      for (const callback of callbacks) callback(performance.now());
    });
  }

  it("publishes multiple replay batches once in the next frame", () => {
    const { dispatch, maxSeqMap, replayPersister } = setup();

    dispatch(replay("s1", 1, [toolStart("t1", 1)]));
    dispatch(replay("s1", 2, [toolStart("t2", 2)]));
    dispatch(replay("s1", 3, [toolStart("t3", 3)], true));

    expect(setSessionStates).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(1);
    expect(maxSeqMap.get("s1")).toBe(3);
    expect(replayPersister.seed).toHaveBeenCalledTimes(1);
    expect(replayPersister.record).toHaveBeenCalledTimes(2);

    flushFrame();

    expect(setSessionStates).toHaveBeenCalledTimes(1);
    expect(
      sessionStatesRef.current
        .get("s1")!
        .messages.filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["t1", "t2", "t3"]);
  });

  it("records terminal history-window metadata without forcing replay state publication", () => {
    const { dispatch } = setup();
    const historyWindow = {
      requestedMessages: 200,
      effectiveMessages: 207,
      startSeq: 41,
      endSeq: 900,
      hasOlder: true,
    };

    dispatch({
      type: "event_replay",
      sessionId: "s1",
      events: [],
      isLast: true,
      historyWindow,
    });

    expect(historyWindowsRef.current.get("s1")).toEqual(historyWindow);
    expect(setSessionStates).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(0);
  });

  it("preserves history-window metadata across an unwindowed live catch-up replay", () => {
    const { dispatch } = setup();
    const historyWindow = {
      requestedMessages: 200,
      effectiveMessages: 207,
      startSeq: 41,
      endSeq: 900,
      hasOlder: true,
    };
    historyWindowsRef.current.set("s1", historyWindow);

    dispatch(replay("s1", 901, [toolStart("catch-up", 901)], true));
    flushFrame();

    expect(historyWindowsRef.current.get("s1")).toEqual(historyWindow);
  });

  it("clears history-window metadata when an unwindowed full replay starts", () => {
    const { dispatch } = setup();
    historyWindowsRef.current.set("s1", {
      requestedMessages: 200,
      effectiveMessages: 207,
      startSeq: 41,
      endSeq: 900,
      hasOlder: true,
    });

    dispatch(replay("s1", 1, [toolStart("full", 1)], true));
    flushFrame();

    expect(historyWindowsRef.current.get("s1")).toBeUndefined();
  });

  it("publishes once per frame when replay spans multiple frames", () => {
    const { dispatch } = setup();

    dispatch(replay("s1", 1, [toolStart("t1", 1)]));
    dispatch(replay("s1", 2, [toolStart("t2", 2)]));
    flushFrame();
    expect(setSessionStates).toHaveBeenCalledTimes(1);

    dispatch(replay("s1", 3, [toolStart("t3", 3)], true));
    flushFrame();
    expect(setSessionStates).toHaveBeenCalledTimes(2);
  });

  it("applies reset and continuation batches in arrival order while preserving pendingPrompt", () => {
    const initial = createInitialState();
    initial.pendingPrompt = { text: "keep me", imageCount: 1, status: "sent" };
    initial.messages.push({ id: "stale", role: "user", content: "stale", timestamp: 1 });
    const { dispatch } = setup(new Map([["s1", initial]]));

    dispatch(replay("s1", 1, [toolStart("t1", 10)]));
    dispatch(replay("s1", 2, [toolStart("t2", 20)], true));
    flushFrame();

    const state = sessionStatesRef.current.get("s1")!;
    expect(state.pendingPrompt?.text).toBe("keep me");
    expect(state.messages.some((message) => message.role === "user")).toBe(false);
    expect(
      state.messages
        .filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["t1", "t2"]);
  });

  it("replays an overlapping reset inside the same frame with sequential semantics", () => {
    const { dispatch } = setup();

    dispatch(replay("s1", 1, [toolStart("t1", 10), toolStart("t2", 20)]));
    dispatch(replay("s1", 2, [toolStart("t2", 20), toolStart("t3", 30)], true));
    flushFrame();

    expect(
      sessionStatesRef.current
        .get("s1")!
        .messages.filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["t2", "t3"]);
  });

  it("does not synchronously publish an isLast batch and ignores empty replay state work", () => {
    const { dispatch } = setup();

    dispatch(replay("s1", 1, [toolStart("t1", 1)], true));
    expect(setSessionStates).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(1);
    flushFrame();
    expect(setSessionStates).toHaveBeenCalledTimes(1);

    dispatch({ type: "event_replay", sessionId: "s1", events: [], isLast: false });
    dispatch({ type: "event_replay", sessionId: "s1", events: [], isLast: true });
    expect(rafCallbacks).toHaveLength(0);
    expect(setSessionStates).toHaveBeenCalledTimes(1);
  });

  it("flushes queued replay before a live event", () => {
    const { dispatch } = setup();

    dispatch(replay("s1", 1, [toolStart("replay", 1)]));
    dispatch(live("s1", 2, toolStart("live", 2)));

    expect(setSessionStates).toHaveBeenCalledTimes(1);
    expect(
      sessionStatesRef.current
        .get("s1")!
        .messages.filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["replay"]);

    flushFrame();
    expect(setSessionStates).toHaveBeenCalledTimes(2);
    expect(
      sessionStatesRef.current
        .get("s1")!
        .messages.filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["replay", "live"]);
  });

  it("does not flush another session's queued replay for an unrelated live event", () => {
    const { dispatch } = setup();

    dispatch(replay("replay-session", 1, [toolStart("replay", 1)]));
    dispatch(live("live-session", 1, toolStart("live", 2)));

    expect(setSessionStates).not.toHaveBeenCalled();
    flushFrame();
    expect(setSessionStates).toHaveBeenCalledTimes(2);
    expect(
      sessionStatesRef.current
        .get("replay-session")!
        .messages.filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["replay"]);
    expect(
      sessionStatesRef.current
        .get("live-session")!
        .messages.filter((message) => message.role === "toolResult")
        .map((message) => message.toolCallId),
    ).toEqual(["live"]);
  });

  it("flushes queued replay before a control message mutates state", () => {
    const { dispatch } = setup();

    dispatch(replay("s1", 1, [toolStart("replay", 1)]));
    dispatch({ type: "session_state_reset", sessionId: "s1" });

    expect(setSessionStates).toHaveBeenCalledTimes(2);
    expect(sessionStatesRef.current.get("s1")!.messages).toHaveLength(0);
  });

  it("uses a timer while hidden and discards queued replay on unmount", () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    const first = setup();

    first.dispatch(replay("s1", 1, [toolStart("t1", 1)]));
    expect(rafCallbacks).toHaveLength(0);
    expect(setSessionStates).not.toHaveBeenCalled();
    act(() => vi.runOnlyPendingTimers());
    expect(setSessionStates).toHaveBeenCalledTimes(1);

    const second = setup();
    second.dispatch(replay("s2", 1, [toolStart("t2", 2)]));
    second.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(sessionStatesRef.current.has("s2")).toBe(false);
  });
});
