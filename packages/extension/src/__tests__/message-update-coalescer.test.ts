/**
 * MessageUpdateCoalescer — split-flow message_update coalescing state machine.
 *
 * Covers the contract used by bridge.ts:
 *  - text sub-events coalesce into a single-slot pending (last wins), sent
 *    once after the fixed window
 *  - thinking sub-events forward immediately, never coalesced
 *  - flush() forces the parked update out synchronously (non-update handler
 *    entry invariant — must land BEFORE message_end/user-message_start)
 *  - stale-drop: an update with a generation older than the last flushed one
 *    is dropped (pi clones message refs per event, so generations are the
 *    only ordering signal)
 *  - clear() drops a parked update + cancels the timer (session switch /
 *    shutdown / reconnect)
 *  - fixed window (not debounce): rapid events keep the window anchored at
 *    the FIRST pending event, so long streams never starve
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  COALESCE_WINDOW_MS,
  MessageUpdateCoalescer,
} from "../message-update-coalescer.js";

function textEvent(delta: string, content = delta): Record<string, unknown> {
  return {
    type: "message_update",
    message: { role: "assistant", content },
    assistantMessageEvent: { type: "text_delta", delta, partial: { content } },
  };
}

function thinkingEvent(kind: "thinking_start" | "thinking_delta" | "thinking_end", delta?: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: { type: kind },
  };
  if (delta !== undefined) {
    (base.assistantMessageEvent as any).delta = delta;
  }
  return base;
}

function setup() {
  const sent: Array<{ event: Record<string, unknown>; at: number }> = [];
  let clock = 0;
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;
  const c = new MessageUpdateCoalescer({
    send: (event) => sent.push({ event, at: clock }),
    now: () => clock,
    scheduleTimer: (fn) => {
      const id = nextTimerId++;
      timers.set(id, fn);
      return id;
    },
    cancelTimer: (id) => timers.delete(id as number),
  });
  c.messageStart(1);
  const fireTimer = () => {
    for (const [id, fn] of [...timers]) {
      timers.delete(id);
      fn();
    }
  };
  return { c, sent, clock: { get: () => clock, set: (v: number) => (clock = v) }, fireTimer, timers };
}

/** Fresh setups for tests that exercise the stale-drop barrier after a flush. */
function newSessionSetup(initialGen: number) {
  const { c, sent, clock, fireTimer, timers } = setup();
  c.messageStart(initialGen);
  return { c, sent, clock, fireTimer, timers };
}

describe("MessageUpdateCoalescer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("text coalescing (single-slot, last wins)", () => {
    it("parks text_delta updates and sends only the last one after the window", () => {
      const { c, sent, clock, fireTimer } = setup();
      expect(c.update(textEvent("a"), 1)).toBe("coalesced");
      clock.set(10);
      expect(c.update(textEvent("b"), 1)).toBe("coalesced");
      expect(sent).toHaveLength(0);
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
      expect((sent[0].event.assistantMessageEvent as any).delta).toBe("b");
    });

    it("runs the inliner-worthy snapshot check on the SAME object as sent (bridge mutates in place)", () => {
      const { c, sent, clock, fireTimer } = setup();
      const ev1 = textEvent("a");
      const ev2 = textEvent("b");
      c.update(ev1, 1);
      c.update(ev2, 1);
      clock.set(50);
      fireTimer();
      expect(sent[0].event).toBe(ev2);
    });

    it("sends text_end (with final content) even when no deltas followed", () => {
      const { c, sent, clock, fireTimer } = setup();
      const end = {
        type: "message_update",
        message: { role: "assistant", content: "final" },
        assistantMessageEvent: { type: "text_end", contentIndex: 0, content: "final", partial: {} },
      };
      c.update(textEvent("par"), 1);
      c.update(end, 1);
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
      expect((sent[0].event.assistantMessageEvent as any).type).toBe("text_end");
      expect((sent[0].event.assistantMessageEvent as any).content).toBe("final");
    });
  });

  describe("thinking passthrough (never coalesced)", () => {
    it("forwards thinking_start/delta/end immediately with no window delay", () => {
      const { c, sent } = setup();
      expect(c.update(thinkingEvent("thinking_start"), 1)).toBe("forwarded");
      expect(c.update(thinkingEvent("thinking_delta", "think "), 1)).toBe("forwarded");
      expect(c.update(thinkingEvent("thinking_delta", "more"), 1)).toBe("forwarded");
      expect(c.update(thinkingEvent("thinking_end"), 1)).toBe("forwarded");
      expect(sent).toHaveLength(4);
    });

    it("flushes text before an interleaved unknown or toolcall update", () => {
      const { c, sent } = setup();
      c.update(textEvent("prefix"), 1);
      const tool = {
        type: "message_update",
        message: { role: "assistant", content: "prefix" },
        assistantMessageEvent: { type: "toolcall_delta", delta: "{\"x\":" },
      };
      expect(c.update(tool, 1)).toBe("forwarded");
      expect(sent.map((s) => (s.event.assistantMessageEvent as any).type)).toEqual([
        "text_delta",
        "toolcall_delta",
      ]);
    });

    it("coalesces only the contiguous text run around a thinking boundary", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("first"), 1);
      c.update(textEvent("first-final"), 1);
      c.update(thinkingEvent("thinking_delta", "reason"), 1);
      c.update(textEvent("second"), 1);
      clock.set(50);
      fireTimer();
      expect(sent.map((s) => (s.event.assistantMessageEvent as any).type)).toEqual([
        "text_delta",
        "thinking_delta",
        "text_delta",
      ]);
      expect((sent[0].event.assistantMessageEvent as any).delta).toBe("first-final");
      expect((sent[2].event.assistantMessageEvent as any).delta).toBe("second");
    });

  });

  describe("flush (non-update handler entry invariant)", () => {
    it("sends the parked update synchronously on flush()", () => {
      const { c, sent, clock } = setup();
      c.update(textEvent("a"), 1);
      clock.set(10);
      c.flush();
      expect(sent).toHaveLength(1);
      expect((sent[0].event.assistantMessageEvent as any).delta).toBe("a");
      expect(sent[0].at).toBe(10);
    });

    it("is idempotent — no-op when nothing is parked", () => {
      const { c, sent } = setup();
      c.flush();
      c.flush();
      expect(sent).toHaveLength(0);
    });

    it("cancels the window timer so the update is not sent twice", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("a"), 1);
      clock.set(10);
      c.flush();
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
    });

    it("re-arms the window for the NEXT message after a flush", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("first"), 1);
      clock.set(10);
      c.flush();
      c.messageStart(2); // next message begins
      c.update(textEvent("second"), 2);
      expect(sent).toHaveLength(1);
      clock.set(60);
      fireTimer();
      expect(sent).toHaveLength(2);
      expect((sent[1].event.assistantMessageEvent as any).delta).toBe("second");
    });
  });

  describe("stale-drop (generation ordering)", () => {
    it("drops a text update whose generation is older than the current streaming message", () => {
      const { c, sent, clock, fireTimer } = newSessionSetup(1); // first message is gen 1
      c.update(textEvent("gen1"), 1);
      clock.set(10);
      c.flush(); // gen 1 flushed
      c.messageStart(2); // next assistant message begins
      // a straggler from the flushed message is dropped
      expect(c.update(textEvent("late-gen1"), 1)).toBe("dropped");
      // gen 2 still coalesces normally
      expect(c.update(textEvent("gen2"), 2)).toBe("coalesced");
      clock.set(60);
      fireTimer();
      expect(sent.map((s) => (s.event.assistantMessageEvent as any).delta)).toEqual(["gen1", "gen2"]);
    });

    it("drops a thinking update older than the current streaming message", () => {
      const { c, sent, clock, fireTimer } = newSessionSetup(1);
      c.update(textEvent("text"), 1);
      clock.set(10);
      c.flush();
      c.messageStart(2);
      expect(c.update(thinkingEvent("thinking_delta", "stale"), 1)).toBe("dropped");
      expect(sent).toHaveLength(1);
    });
  });

  describe("message lifecycle barrier", () => {
    it("flushes before messageEnd and drops later same-generation updates", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("final"), 1);
      c.flush();
      c.messageEnd(1);
      expect(sent).toHaveLength(1);
      // The bridge flushes before calling messageEnd; a closed message cannot
      // emit another parked snapshot later.
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
      expect(c.update(textEvent("late"), 1)).toBe("dropped");
      expect(c.update(thinkingEvent("thinking_delta", "late"), 1)).toBe("dropped");
    });

    it("accepts a new message after closing the previous one", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.messageEnd(1);
      c.messageStart(2);
      expect(c.update(textEvent("fresh"), 2)).toBe("coalesced");
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
      expect((sent[0].event.assistantMessageEvent as any).delta).toBe("fresh");
    });

    it("rejects an update with a different stable message key", () => {
      const { c, sent } = setup();
      c.messageStart(1, "assistant:1");
      expect(c.update(textEvent("wrong"), 1, "assistant:2")).toBe("dropped");
      expect(sent).toHaveLength(0);
    });
  });

  describe("clear (session switch / shutdown / reconnect)", () => {
    it("drops the parked update and cancels the timer", () => {
      const { c, sent, clock, fireTimer, timers } = setup();
      c.update(textEvent("a"), 1);
      expect(timers.size).toBe(1);
      c.clear(3); // session boundary — new generation
      expect(timers.size).toBe(0);
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(0);
      // flush after clear is a no-op
      c.flush();
      expect(sent).toHaveLength(0);
    });

    it("keeps the generation barrier after clear", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("a"), 1);
      clock.set(10);
      c.flush();
      c.clear(3); // session boundary
      expect(c.update(textEvent("stale"), 1)).toBe("dropped");
      c.messageStart(3);
      expect(c.update(textEvent("fresh"), 3)).toBe("coalesced");
      clock.set(60);
      fireTimer();
      expect(sent).toHaveLength(2);
    });
  });

  describe("fixed window (not debounce)", () => {
    it("a single update fires after exactly the window, with no refresh-per-event", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("a"), 1);
      clock.set(49);
      fireTimer(); // early timer fire — window not elapsed, must NOT flush
      expect(sent).toHaveLength(0);
      expect(c.update(textEvent("b"), 1)).toBe("coalesced");
      // the timer was consumed by the early fire; the fixed-window guard uses
      // the ARM time (0), so it fires only once the window has actually
      // elapsed — re-fire at 50ms to trigger the flush.
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
      expect(sent[0].at).toBe(50);
    });

    it("keeps the window anchored at the FIRST pending event under a stream of updates", () => {
      const { c, sent, clock, fireTimer } = setup();
      c.update(textEvent("a"), 1);
      clock.set(20);
      c.update(textEvent("b"), 1);
      clock.set(40);
      c.update(textEvent("c"), 1);
      // 40ms of updates since the first event: a debounce would still be
      // waiting (40 < 50 from the LAST event), a fixed window flushes now.
      clock.set(50);
      fireTimer();
      expect(sent).toHaveLength(1);
      expect((sent[0].event.assistantMessageEvent as any).delta).toBe("c");
    });
  });

  describe("unknown sub-types", () => {
    it("forwards unknown assistantMessageEvent sub-types verbatim (fail-open)", () => {
      const { c, sent } = setup();
      const ev = {
        type: "message_update",
        message: { role: "assistant" },
        assistantMessageEvent: { type: "toolcall_delta", delta: "t" },
      };
      expect(c.update(ev, 1)).toBe("forwarded");
      expect(sent[0].event).toBe(ev);
    });
  });
});
