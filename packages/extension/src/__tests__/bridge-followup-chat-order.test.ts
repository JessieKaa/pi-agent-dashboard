/**
 * Bridge wire-ordering invariant for drained queued user messages.
 *
 * Applies to BOTH drain boundaries:
 *   - Steer drain at `turn_end`     (Enter while streaming)
 *   - Follow-up drain at `agent_end` (Alt+Enter while streaming)
 *
 * Pi emits four events synchronously back-to-back at the drain boundary:
 *
 *   1. message_end   (assistant — the final response of the just-completed turn)
 *   2. turn_end OR agent_end (the drain boundary)
 *   3. message_start (user — the drained steer or follow-up text, e.g. "asd")
 *   4. message_end   (user — same text)
 *
 * Pre-fix bug: the bridge defers `message_end` sends via `setTimeout(0)`
 * (for entryId capture per `fix-per-message-fork`) but sends `message_start`
 * synchronously. The drained user `message_start` therefore lands on the
 * wire BEFORE the preceding assistant `message_end`. The client's reducer
 * appends the user message to `state.messages[]` at `message_start`, then
 * the assistant message at the (later) `message_end` — so the chat shows
 * the follow-up "asd" ABOVE the assistant's final response.
 *
 * Fix: defer user `message_start` sends via the same `setTimeout(0)`. All
 * user-role messages are queued in the timer FIFO behind any pending
 * `message_end` deferrals, preserving pi's emit order on the wire.
 *
 * Assistant `message_start` MUST stay sync — `message_update` events fire
 * sync and depend on the reducer having seen `message_start` first (to
 * reset `streamingTextFlushed`).
 *
 * See change: add-followup-edit-and-steer-cancel (chat-order scenario).
 */

import { describe, it, expect } from "vitest";

interface WireEvent {
  eventType: string;
  role?: "user" | "assistant";
  content?: string;
}

/**
 * Simulates the bridge's event-forwarding pipeline with the new
 * deferral rule applied to USER message_start. Runs everything in
 * a single synchronous tick to mirror pi's emit cadence, then drains
 * the macrotask queue to capture the final wire order.
 */
class BridgeSim {
  readonly wire: WireEvent[] = [];

  onMessageStart(role: "user" | "assistant", content: string): void {
    if (role === "user") {
      // FIX: defer user message_start to match message_end's deferral.
      setTimeout(() => {
        this.wire.push({ eventType: "message_start", role, content });
      }, 0);
      return;
    }
    // Assistant message_start sent sync (message_update depends on it).
    this.wire.push({ eventType: "message_start", role, content });
  }

  onMessageEnd(role: "user" | "assistant", content: string): void {
    // Existing behaviour: ALL message_end sends are deferred via setTimeout(0)
    // for entryId capture (fix-per-message-fork).
    setTimeout(() => {
      this.wire.push({ eventType: "message_end", role, content });
    }, 0);
  }

  onAgentEnd(): void {
    // Sent sync.
    this.wire.push({ eventType: "agent_end" });
  }

  onTurnEnd(): void {
    // Sent sync (mirrors agent_end).
    this.wire.push({ eventType: "turn_end" });
  }

  /** Flush pending setTimeout(0) callbacks. */
  async flush(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // Two extra ticks in case any callback re-queues.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * Wire-order scenario for the message_update coalescer (change:
 * coalesce-message-update-text-snapshots): the assistant message_end is
 * deferred via setTimeout(0) while the coalescer parks the last text
 * snapshot until the 50ms sweep. The BRIDGE's forced flush at the
 * message_end handler entry guarantees the parked update lands BEFORE the
 * deferred message_end — the invariant is at the FLUSH point, not the
 * deferral (both deferrals below share the macrotask FIFO).
 */
class CoalescerOrderSim {
  readonly wire: Array<{ eventType: string; role: string; content: string }> = [];
  private pendingText: { role: string; content: string } | null = null;
  private generation = 0;
  private open = false;

  /** Mirrors the bridge's assistant message_start: advance + set the barrier. */
  onAssistantMessageStart(content: string): void {
    this.generation++;
    this.pendingText = null;
    this.open = true;
    this.wire.push({ eventType: "message_start", role: "assistant", content });
  }

  /** Mirrors the bridge's message_update branch: park (single slot, last wins). */
  onTextUpdate(content: string): void {
    if (!this.open) return;
    this.pendingText = { role: "assistant", content };
  }

  /** Mirrors the bridge's forced flush at every non-update handler entry. */
  flushPending(): void {
    if (!this.open || !this.pendingText) return;
    const ev = this.pendingText;
    this.pendingText = null;
    this.wire.push({ eventType: "message_update", role: ev.role, content: ev.content });
  }

  onMessageEnd(role: "user" | "assistant", content: string): void {
    // The bridge flushes the parked update and closes its generation before
    // scheduling the deferred message_end send.
    this.flushPending();
    this.open = false;
    setTimeout(() => {
      this.wire.push({ eventType: "message_end", role, content });
    }, 0);
  }

  onUserMessageStart(content: string): void {
    // User message_start send is deferred; the bridge flushes the parked
    // update before scheduling it.
    this.flushPending();
    setTimeout(() => {
      this.wire.push({ eventType: "message_start", role: "user", content });
    }, 0);
  }

  onAgentEnd(): void {
    this.flushPending();
    this.wire.push({ eventType: "agent_end", role: "-", content: "" });
  }

  /** Drain setTimeout(0) deferrals. */
  async drain(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("Bridge drained-followup chat-order invariant", () => {
  it("user message_start for drained follow-up lands AFTER preceding assistant message_end", async () => {
    const sim = new BridgeSim();

    // Pi's sync emit order at agent_end with a queued follow-up:
    //   1. assistant message_end (the weather report)
    //   2. agent_end
    //   3. user message_start ("asd" — the drained follow-up)
    //   4. user message_end ("asd")
    sim.onMessageEnd("assistant", "weather report");
    sim.onAgentEnd();
    sim.onMessageStart("user", "asd");
    sim.onMessageEnd("user", "asd");

    await sim.flush();

    const types = sim.wire.map((e) => `${e.eventType}:${e.role ?? "-"}`);
    // Expected wire order after the fix:
    //   1. agent_end                 (sync, fires first)
    //   2. assistant message_end     (deferred, FIFO #1)
    //   3. user message_start        (deferred, FIFO #2 — after the fix)
    //   4. user message_end          (deferred, FIFO #3)
    expect(types).toEqual([
      "agent_end:-",
      "message_end:assistant",
      "message_start:user",
      "message_end:user",
    ]);

    // Critical invariant: the drained user message_start MUST NOT come
    // before the preceding assistant message_end.
    const userStartIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_start" && e.role === "user"
    );
    const assistantEndIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_end" && e.role === "assistant"
    );
    expect(assistantEndIdx).toBeGreaterThanOrEqual(0);
    expect(userStartIdx).toBeGreaterThan(assistantEndIdx);
  });

  it("assistant message_start stays SYNC (message_update relies on reducer seeing it first)", () => {
    const sim = new BridgeSim();
    sim.onMessageStart("assistant", "hello");
    // No flush — the event must already be on the wire.
    expect(sim.wire).toEqual([
      { eventType: "message_start", role: "assistant", content: "hello" },
    ]);
  });

  it("multiple drained follow-ups preserve their relative pi emit order", async () => {
    const sim = new BridgeSim();

    // Pi delivers two queued follow-ups in order ["a", "b"].
    sim.onMessageEnd("assistant", "final");
    sim.onAgentEnd();
    sim.onMessageStart("user", "a");
    sim.onMessageEnd("user", "a");
    sim.onMessageStart("user", "b");
    sim.onMessageEnd("user", "b");

    await sim.flush();

    const summary = sim.wire.map((e) =>
      e.eventType === "agent_end"
        ? "agent_end"
        : `${e.eventType}:${e.role}:${e.content}`
    );
    expect(summary).toEqual([
      "agent_end",
      "message_end:assistant:final",
      "message_start:user:a",
      "message_end:user:a",
      "message_start:user:b",
      "message_end:user:b",
    ]);
  });

  it("drained STEER at turn_end lands AFTER preceding assistant message_end (same bug, different drain boundary)", async () => {
    const sim = new BridgeSim();

    // Pi's sync emit order at turn_end with a queued steer:
    //   1. assistant message_end (the weather report)
    //   2. turn_end
    //   3. user message_start ("asd" — the drained steer)
    //   4. user message_end ("asd")
    // (Identical to the follow-up case but the drain boundary is turn_end
    // instead of agent_end. The fix is uniform: defer USER message_start.)
    sim.onMessageEnd("assistant", "weather report");
    sim.onTurnEnd();
    sim.onMessageStart("user", "asd");
    sim.onMessageEnd("user", "asd");

    await sim.flush();

    const types = sim.wire.map((e) => `${e.eventType}:${e.role ?? "-"}`);
    expect(types).toEqual([
      "turn_end:-",
      "message_end:assistant",
      "message_start:user",
      "message_end:user",
    ]);

    const userStartIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_start" && e.role === "user"
    );
    const assistantEndIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_end" && e.role === "assistant"
    );
    expect(userStartIdx).toBeGreaterThan(assistantEndIdx);
  });

  it("idle user send (no preceding deferred message_end) still arrives intact", async () => {
    const sim = new BridgeSim();

    // No pending deferrals in flight — a fresh user prompt.
    sim.onMessageStart("user", "hi");
    sim.onMessageEnd("user", "hi");

    await sim.flush();

    expect(sim.wire.map((e) => `${e.eventType}:${e.role}`)).toEqual([
      "message_start:user",
      "message_end:user",
    ]);
  });
});

describe("message_update coalescer wire order (coalesce-message-update-text-snapshots)", () => {
  it("parks text updates and flushes the LAST snapshot before the deferred assistant message_end", async () => {
    const sim = new CoalescerOrderSim();
    sim.onAssistantMessageStart("hello");
    // Pi's sync emit order at message_end:
    //   message_update (last delta, "hello world") … message_end
    sim.onTextUpdate("hello ");
    sim.onTextUpdate("hello world");
    sim.onMessageEnd("assistant", "hello world");

    await sim.drain();

    expect(sim.wire.map((e) => e.eventType)).toEqual([
      "message_start",      // sync
      "message_update",     // flushed at message_end handler entry (sync)
      "message_end",        // deferred send
    ]);
    expect(sim.wire[1].content).toBe("hello world"); // last snapshot won
  });

  it("flushes the parked update before a drained user message_start", async () => {
    const sim = new CoalescerOrderSim();
    sim.onAssistantMessageStart("report");
    sim.onTextUpdate("the weather");
    // Drain boundary: message_end → agent_end → user message_start.
    sim.onMessageEnd("assistant", "the weather");
    sim.onAgentEnd();
    sim.onUserMessageStart("asd");

    await sim.drain();

    const types = sim.wire.map((e) => `${e.eventType}:${e.role}`);
    expect(types).toEqual([
      "message_start:assistant", // sync at turn start
      "message_update:assistant", // flushed at agent_end entry (before the deferred message_end)
      "agent_end:-",
      "message_end:assistant",
      "message_start:user",
    ]);
    const updateIdx = sim.wire.findIndex((e) => e.eventType === "message_update");
    const endIdx = sim.wire.findIndex((e) => e.eventType === "message_end");
    const userIdx = sim.wire.findIndex((e) => e.eventType === "message_start" && e.role === "user");
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeLessThan(endIdx); // update BEFORE its message_end
    expect(userIdx).toBeGreaterThan(endIdx); // user start after assistant end
  });

  it("the parked update never survives past the next assistant message_start (stale-drop barrier)", () => {
    const sim = new CoalescerOrderSim();
    sim.onAssistantMessageStart("first");
    sim.onTextUpdate("first text");
    sim.onAssistantMessageStart("second"); // next message begins — barrier advances
    // A straggler update from the first message must be dropped, not flushed.
    expect(sim.wire.some((e) => e.eventType === "message_update")).toBe(false);
  });
});
