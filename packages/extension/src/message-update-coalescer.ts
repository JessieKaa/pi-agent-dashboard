/**
 * Split-flow coalescing for pi `message_update` events.
 *
 * Every streaming token ships a `message_update` whose `message` carries the
 * FULL accumulated text snapshot. Forwarding each one synchronously (bridge
 * shares pi's single-threaded event loop) is O(n²) JSON stringify + ws.send
 * per turn and janks the TUI. This state machine replaces the flood with a
 * single-slot fixed-window coalesce:
 *
 *   - TEXT-family sub-events (text_start/text_delta/text_end + any other
 *     snapshot-carrying update) → single-slot pending, LAST wins, flushed
 *     after a fixed 50 ms window (fixed window, NOT debounce — long streams
 *     never starve because the window is anchored at the first pending event,
 *     not reset per event).
 *   - THINKING-family sub-events (thinking_start/delta/end), toolcall events,
 *     and unknown update types → flush any preceding text snapshot, then
 *     forward immediately. This preserves source order while keeping thinking
 *     deltas lossless.
 *
 * `flush()` must run at the entry of every NON-update handler so a pending
 * update lands on the wire BEFORE its message_end/user-message_start. The
 * messageStart/messageEnd lifecycle also prevents a closed message's late
 * update from re-filling the client's cleared streaming text.
 * Stale-drop: the bridge stamps an incrementing generation on every
 * `message_start` and supplies a stable role/timestamp key from the message.
 * `messageStart(gen, key)` opens the stream; `messageEnd(gen, key)` closes it
 * after the bridge flushes the final snapshot. Updates from an older generation,
 * a different message key, or a closed message are dropped. Pi clones `message`
 * refs per event and `message.id` only exists after persistence, so the stable
 * key avoids relying on object identity or early ids.
 *
 * Why the split matters: `assistantMessageEvent` carries the thinking
 * sub-events. Coalescing them to the last snapshot would lose the
 * intermediate thinking_delta accumulations.
 *
 * Design: single-slot (only one assistant message streams at a time in pi).
 * Ownership lives in bridge.ts; this class is transport-agnostic (the
 * bridge supplies the send callback).
 */

export type UpdateSend = (event: Record<string, unknown>) => void;
export type MessageKey = string;

export const TEXT_UPDATE_TYPES = new Set(["text_start", "text_delta", "text_end"]);

export const THINKING_UPDATE_TYPES = new Set([
  "thinking_start",
  "thinking_delta",
  "thinking_end",
]);

/** Fixed window: NOT reset per event (debounce) so long streams stay ≤50 ms behind. */
export const COALESCE_WINDOW_MS = 50;

export interface MessageUpdateCoalescerOptions {
  /** Async-safe function that actually puts the event on the wire. */
  send: UpdateSend;
  /** Schedule the window timer. Defaults to setTimeout; injectable for fake timers. */
  scheduleTimer?: (fn: () => void, ms: number) => unknown;
  /** Cancel a scheduled timer. Defaults to clearTimeout. */
  cancelTimer?: (timer: unknown) => void;
  /** Current epoch ms. Defaults to Date.now(). */
  now?: () => number;
}

export class MessageUpdateCoalescer {
  private readonly send: UpdateSend;
  private readonly scheduleTimer: (fn: () => void, ms: number) => unknown;
  private readonly cancelTimer: (timer: unknown) => void;
  private readonly now: () => number;

  /** Single-slot pending: the LAST text-snapshot update received. */
  private pending: Record<string, unknown> | null = null;
  private timer: unknown = null;
  /** Timestamp at which the pending slot was armed (fixed-window anchor). */
  private armedAt = 0;
  /** Generation of the message currently streaming — the stale-drop barrier. */
  private currentGen = 0;
  /** Generation of the message currently open for updates. */
  private openGen: number | null = null;
  /** Stable identity of the message currently open for updates. */
  private openKey: MessageKey | undefined;
  /** Generation of the message the current pending event belongs to. */
  private pendingGen = 0;
  /** Stable identity of the message the current pending event belongs to. */
  private pendingKey: MessageKey | undefined;

  constructor(options: MessageUpdateCoalescerOptions) {
    this.send = options.send;
    this.scheduleTimer = options.scheduleTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelTimer = options.cancelTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
    this.now = options.now ?? (() => Date.now());
  }

  /** True while a text update is parked awaiting the window. */
  get isPending(): boolean {
    return this.pending !== null;
  }

  /**
   * Call at the entry of EVERY non-message_update handler. Sends the parked
   * update synchronously (it belongs to the message that is about to end /
   * be superseded) so it lands on the wire before the incoming event.
   */
  flush(): void {
    if (this.pending === null) return;
    if (!this.isCurrentMessage(this.pendingGen, this.pendingKey)) {
      this.pending = null;
      this.pendingKey = undefined;
      this.clearTimer();
      return;
    }
    const ev = this.pending;
    this.pending = null;
    this.pendingKey = undefined;
    this.clearTimer();
    this.send(ev);
  }

  /**
   * Call on every message_start before any update for it. Opens the message
   * and advances the stale-drop barrier.
   */
  messageStart(gen: number, key?: MessageKey): void {
    if (gen < this.currentGen) return;
    if (gen > this.currentGen) this.currentGen = gen;
    this.openGen = gen;
    this.openKey = key;
  }

  /**
   * Call after the bridge has flushed the pending snapshot at message_end.
   * Closing prevents a same-generation late update or timer from refilling
   * the client's cleared streaming text.
   */
  messageEnd(gen: number, key?: MessageKey): void {
    if (!this.isCurrentMessage(gen, key)) return;
    this.openGen = null;
    this.openKey = undefined;
  }

  /**
   * Session switch/shutdown/reconnect: drop any parked update, cancel the
   * timer, and raise the barrier to `gen` so events older than the boundary
   * are never delivered into the new session.
   */
  clear(gen: number): void {
    this.pending = null;
    this.pendingKey = undefined;
    this.clearTimer();
    this.openGen = null;
    this.openKey = undefined;
    if (gen > this.currentGen) this.currentGen = gen;
  }

  /**
   * Route one message_update event. `gen` is the assistant message generation
   * (bridge stamps it at message_start). Returns "coalesced" (parked),
   * "forwarded" (ordered immediate send), or "dropped" (stale/closed).
   */
  update(
    event: Record<string, unknown>,
    gen: number,
    key?: MessageKey,
  ): "coalesced" | "forwarded" | "dropped" {
    if (!this.isCurrentMessage(gen, key)) return "dropped";

    const sub = (event as any).assistantMessageEvent as { type?: string } | undefined;
    const subType = sub?.type ?? "";

    if (THINKING_UPDATE_TYPES.has(subType) || !TEXT_UPDATE_TYPES.has(subType)) {
      // A non-text update is an ordering boundary. Do not let it overtake a
      // preceding text snapshot that is waiting in the fixed window.
      this.flush();
      this.send(event);
      return "forwarded";
    }

    this.pending = event;
    this.pendingGen = gen;
    this.pendingKey = key;
    if (this.timer === null) {
      const start = this.now();
      this.armedAt = start;
      this.timer = this.scheduleTimer(() => {
        this.timer = null;
        // Fixed window: flush when the window has elapsed since the slot was
        // armed, regardless of when the timer actually fired. Refreshing the
        // deadline per event would turn this into a debounce and starve long
        // streams. If the window has NOT elapsed yet (early fire), re-arm for
        // the remaining delta so the flush is never lost.
        const elapsed = this.now() - this.armedAt;
        if (elapsed >= COALESCE_WINDOW_MS) {
          this.flush();
        } else {
          this.timer = this.scheduleTimer(() => {
            this.timer = null;
            this.flush();
          }, COALESCE_WINDOW_MS - elapsed);
        }
      }, COALESCE_WINDOW_MS);
    }
    return "coalesced";
  }

  private isCurrentMessage(gen: number, key?: MessageKey): boolean {
    if (gen !== this.currentGen || this.openGen !== gen) return false;
    return this.openKey === undefined || key === this.openKey;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.cancelTimer(this.timer);
      this.timer = null;
    }
  }
}
