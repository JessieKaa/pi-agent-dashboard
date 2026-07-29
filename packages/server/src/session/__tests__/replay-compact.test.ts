import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import type { StoredEvent } from "../../persistence/memory-event-store.js";
import { compactReplayEvents } from "../replay-compact.js";

function stored(seq: number, eventType: string, data: Record<string, unknown> = {}): StoredEvent {
  return { seq, event: { eventType, timestamp: seq, data } as DashboardEvent };
}

function message(role: string, timestamp: number) {
  return { role, timestamp, content: [{ type: "text", text: "final" }] };
}

function update(seq: number, role: string, timestamp: number, type?: string): StoredEvent {
  return stored(seq, "message_update", {
    message: message(role, timestamp),
    ...(type ? { assistantMessageEvent: { type } } : {}),
  });
}

function end(seq: number, role: string, timestamp: number): StoredEvent {
  return stored(seq, "message_end", { message: message(role, timestamp) });
}

describe("compactReplayEvents", () => {
  it("drops pure text paint updates for completed messages", () => {
    const events = [
      stored(1, "message_start", { message: message("assistant", 100) }),
      update(2, "assistant", 100, "text_start"),
      update(3, "assistant", 100, "text_delta"),
      update(4, "assistant", 100, "text_end"),
      end(5, "assistant", 100),
    ];

    expect(compactReplayEvents(events).map((event) => event.seq)).toEqual([1, 5]);
  });

  it("drops toolcall deltas but preserves toolcall boundaries", () => {
    const events = [
      update(1, "assistant", 100, "toolcall_start"),
      update(2, "assistant", 100, "toolcall_delta"),
      update(3, "assistant", 100, "toolcall_end"),
      end(4, "assistant", 100),
    ];

    expect(compactReplayEvents(events).map((event) => event.seq)).toEqual([1, 3, 4]);
  });

  it("preserves thinking updates for completed messages", () => {
    const events = [
      update(1, "assistant", 100, "thinking_start"),
      update(2, "assistant", 100, "thinking_delta"),
      update(3, "assistant", 100, "thinking_end"),
      end(4, "assistant", 100),
    ];

    expect(compactReplayEvents(events)).toBe(events);
  });

  it("preserves paint updates for messages still streaming", () => {
    const events = [
      update(1, "assistant", 100, "text_delta"),
      update(2, "assistant", 100, "toolcall_delta"),
    ];

    expect(compactReplayEvents(events)).toBe(events);
  });

  it("preserves unknown and malformed update shapes", () => {
    const events = [
      stored(1, "message_update"),
      stored(2, "message_update", { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta" } }),
      stored(3, "message_update", { message: { role: "assistant", timestamp: "100" }, assistantMessageEvent: { type: "text_delta" } }),
      update(4, "assistant", 100),
      update(5, "assistant", 100, "future_delta"),
      end(6, "assistant", 100),
    ];

    expect(compactReplayEvents(events).map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("isolates messages by role and timestamp", () => {
    const events = [
      update(1, "assistant", 100, "text_delta"),
      update(2, "assistant", 200, "text_delta"),
      update(3, "user", 100, "text_delta"),
      end(4, "assistant", 100),
    ];

    expect(compactReplayEvents(events).map((event) => event.seq)).toEqual([2, 3, 4]);
  });

  it("keeps a later streaming occurrence when messages share the same identity", () => {
    const events = [
      stored(1, "message_start", { message: message("assistant", 100) }),
      update(2, "assistant", 100, "text_delta"),
      end(3, "assistant", 100),
      stored(4, "message_start", { message: message("assistant", 100) }),
      update(5, "assistant", 100, "text_delta"),
    ];

    expect(compactReplayEvents(events).map((event) => event.seq)).toEqual([1, 3, 4, 5]);
  });

  it("does not mutate the input or retained events", () => {
    const dropped = update(1, "assistant", 100, "text_delta");
    const retained = end(2, "assistant", 100);
    const events = [dropped, retained];
    const snapshot = structuredClone(events);

    const compacted = compactReplayEvents(events);

    expect(events).toEqual(snapshot);
    expect(compacted).not.toBe(events);
    expect(compacted[0]).toBe(retained);
  });
});
