import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../persistence/memory-event-store.js";
import { selectReplayWindow } from "../replay-window.js";

function stored(seq: number, event: DashboardEvent): StoredEvent {
  return { seq, event };
}

function messageStart(seq: number, role: "user" | "assistant", timestamp = seq): StoredEvent {
  return stored(seq, {
    eventType: "message_start",
    timestamp,
    data: { message: { role, timestamp, content: role === "user" ? `user-${seq}` : [] } },
  });
}

function messageEnd(seq: number, timestamp: number): StoredEvent {
  return stored(seq, {
    eventType: "message_end",
    timestamp: seq,
    data: { message: { role: "assistant", timestamp, content: [] } },
  });
}

function toolStart(seq: number, id = `tool-${seq}`): StoredEvent {
  return stored(seq, {
    eventType: "tool_execution_start",
    timestamp: seq,
    data: { toolCallId: id, toolName: "bash", args: {} },
  });
}

function toolEnd(seq: number, id: string): StoredEvent {
  return stored(seq, {
    eventType: "tool_execution_end",
    timestamp: seq,
    data: { toolCallId: id, result: "ok", isError: false },
  });
}

describe("selectReplayWindow", () => {
  it("returns all retained events when the logical history fits", () => {
    const events = [messageStart(1, "user"), messageStart(2, "assistant"), messageEnd(3, 2)];

    const selected = selectReplayWindow(events, 200);

    expect(selected.events).toEqual(events);
    expect(selected.metadata).toEqual({
      requestedMessages: 200,
      effectiveMessages: 2,
      startSeq: 1,
      endSeq: 3,
      hasOlder: false,
    });
  });

  it("selects a cumulative tail from the nearest user boundary", () => {
    const events = [
      messageStart(1, "user"),
      messageStart(2, "assistant"),
      messageEnd(3, 2),
      messageStart(4, "user"),
      messageStart(5, "assistant"),
      toolStart(6, "t1"),
      toolEnd(7, "t1"),
      messageEnd(8, 5),
      messageStart(9, "user"),
      messageStart(10, "assistant"),
      messageEnd(11, 10),
    ];

    const selected = selectReplayWindow(events, 3);

    expect(selected.events.map((event) => event.seq)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(selected.metadata.startSeq).toBe(4);
    expect(selected.metadata.endSeq).toBe(11);
    expect(selected.metadata.hasOlder).toBe(true);
    expect(selected.metadata.effectiveMessages).toBe(5);
  });

  it("does not split an open tool-heavy turn", () => {
    const events = [
      messageStart(10, "user"),
      messageStart(12, "assistant"),
      toolStart(15, "t1"),
      toolEnd(20, "t1"),
      toolStart(25, "t2"),
      toolEnd(30, "t2"),
    ];

    const selected = selectReplayWindow(events, 1);

    expect(selected.events.map((event) => event.seq)).toEqual([10, 12, 15, 20, 25, 30]);
    expect(selected.metadata.hasOlder).toBe(false);
  });

  it("uses retained indexes rather than sequence arithmetic", () => {
    const events = [
      messageStart(100, "user"),
      messageStart(130, "assistant"),
      messageEnd(170, 130),
      messageStart(250, "user"),
      messageStart(300, "assistant"),
      messageEnd(400, 300),
    ];

    const selected = selectReplayWindow(events, 2);

    expect(selected.events.map((event) => event.seq)).toEqual([250, 300, 400]);
    expect(selected.metadata.hasOlder).toBe(true);
  });

  it("does not claim evicted sequence numbers are loadable", () => {
    const events = [messageStart(7500, "user"), messageStart(7501, "assistant"), messageEnd(7502, 7501)];

    const selected = selectReplayWindow(events, 1);

    expect(selected.metadata.startSeq).toBe(7500);
    expect(selected.metadata.hasOlder).toBe(false);
  });

  it("returns terminal metadata for an empty session", () => {
    expect(selectReplayWindow([], 200)).toEqual({
      events: [],
      metadata: {
        requestedMessages: 200,
        effectiveMessages: 0,
        startSeq: null,
        endSeq: 0,
        hasOlder: false,
      },
    });
  });
});
