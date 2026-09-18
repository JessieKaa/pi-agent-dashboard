import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CachedEvent, createReplayCache, type ReplayCache } from "../replay/replay-cache.js";
import { createReplayPersister } from "../replay/replay-persist.js";

/** Server key for these tests; the persister reads it at flush time. */
const KEY = "a:8000";

function evt(seq: number): CachedEvent {
  return {
    seq,
    event: { sessionId: "s", eventType: "message_end", timestamp: seq, data: {} } as unknown as DashboardEvent,
  };
}

/** Spy wrapper so provenance tests can assert on put/delete CALLS, not just
 *  the resulting store state (D2: a skip must never issue a delete). */
function spyCache(inner: ReplayCache) {
  const put = vi.fn(inner.put);
  const del = vi.fn(inner.delete);
  const cache: ReplayCache = { get: inner.get, put, delete: del };
  return { cache, put, del };
}

describe("replay-persist", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it("records events and flushes the buffer to the cache with the right maxSeq", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("s1", [evt(1), evt(2)], "replay");
    p.record("s1", [evt(3)], "live");
    await p.flush("s1");

    const hit = await cache.get("s1", KEY);
    expect(hit?.maxSeq).toBe(3);
    expect(hit?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("dedups events already in the buffer by seq", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("s1", [evt(1), evt(2)], "replay");
    p.record("s1", [evt(2), evt(3)], "replay"); // seq 2 is a duplicate
    await p.flush("s1");
    expect((await cache.get("s1", KEY))?.payload.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("seed replaces the buffer wholesale", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("s1", [evt(1), evt(2), evt(3)], "replay");
    p.seed("s1", [evt(10)]);
    await p.flush("s1");
    expect((await cache.get("s1", KEY))?.payload.map((e) => e.seq)).toEqual([10]);
  });

  it("drop clears the buffer and deletes the persisted entry", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("s1", [evt(1)], "replay");
    await p.flush("s1");
    expect(await cache.get("s1", KEY)).not.toBeNull();

    await p.drop("s1");
    // Buffer cleared: a later flush writes nothing back.
    await p.flush("s1");
    expect(await cache.get("s1", KEY)).toBeNull();
  });

  // --- Provenance (change: fix-replay-cache-partial-payload-cursor) ---

  it("never persists a broadcast-only buffer (test-plan #E1)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("X", [evt(250)], "live");
    await p.flush("X");

    expect(put).not.toHaveBeenCalled();
    expect(await cache.get("X", KEY)).toBeNull();
  });

  it("persists a seeded buffer (test-plan #E2)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.seed("X", [evt(1), evt(2), evt(3)]);
    await p.flush("X");

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 3 });
    expect(put.mock.calls[0]?.[1].payload).toHaveLength(3);
  });

  it("persists a cold replay that starts past seq 1 (test-plan #E3)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("X", [evt(5), evt(6)], "replay");
    await p.flush("X");

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 6 });
  });

  it("keeps live appends onto a descended buffer persistable (test-plan #E4)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("X", [evt(5), evt(6)], "replay");
    await p.flush("X");
    put.mockClear();

    p.record("X", [evt(7)], "live");
    await p.flush("X");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 7 });
  });

  it("treats the just-contiguous live boundary as no gap (test-plan #E5)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.seed("X", [evt(9), evt(10)]);
    await p.flush("X");
    put.mockClear();

    p.record("X", [evt(11)], "live");
    await p.flush("X");
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 11 });
  });

  it("voids the cursor when a live frame is lost (test-plan #E6)", async () => {
    const { cache, put, del } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.seed("X", [evt(9), evt(10)]);
    await p.flush("X");
    put.mockClear();

    p.record("X", [evt(12)], "live"); // 11 never arrived
    await p.flush("X");
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("restores provenance when a voided buffer is re-seeded (test-plan #E7)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.seed("X", [evt(9), evt(10)]);
    await p.flush("X");
    p.record("X", [evt(12)], "live"); // voids provenance
    await p.flush("X");
    put.mockClear();

    p.seed("X", [evt(1), evt(2), evt(3)]);
    await p.flush("X");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("tolerates gaps on the replay path (compaction) (test-plan #E8)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.record("X", [evt(3), evt(7), evt(9)], "replay");
    await p.flush("X");

    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toMatchObject({ maxSeq: 9 });
  });

  it("does not destroy a sibling tab's entry from a broadcast observer (test-plan #X1)", async () => {
    const inner = createReplayCache({ factory });
    // Tab 1: a legitimately descended entry.
    const p1 = createReplayPersister(inner, 0, () => KEY);
    p1.seed("X", [evt(199), evt(200)]);
    await p1.flush("X");
    expect((await inner.get("X", KEY))?.maxSeq).toBe(200);

    // Tab 2: only ever saw a broadcast for X.
    const { cache, del } = spyCache(inner);
    const p2 = createReplayPersister(cache, 0, () => KEY);
    p2.record("X", [evt(500)], "live");
    await p2.flush("X");

    expect(del).not.toHaveBeenCalled();
    expect((await inner.get("X", KEY))?.maxSeq).toBe(200);
  });

  it("does not let a replay batch re-authorize a live-contaminated buffer", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    // A stray broadcast lands first.
    p.record("X", [evt(250)], "live");
    // A compacted replay of 5..250 then arrives: every row is <= the buffered
    // max, so the dedup drops them all and the buffer is STILL just the stray
    // row. Marking it descended here would persist the original poison.
    p.record("X", [evt(5), evt(120), evt(250)], "replay");
    await p.flush("X");

    expect(put).not.toHaveBeenCalled();
  });

  it("does not let a replay batch restore provenance across a live gap", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    const p = createReplayPersister(cache, 0, () => KEY);
    p.seed("X", [evt(9), evt(10)]);
    p.record("X", [evt(12)], "live"); // 11 lost → provenance voided
    // Appending above the hole must not make the gapped buffer persistable;
    // only a wholesale seed() can restore it.
    p.record("X", [evt(13)], "replay");
    await p.flush("X");

    expect(put).not.toHaveBeenCalled();
  });

  it("stays silent on non-descended flushes (test-plan #X2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const cache = createReplayCache({ factory });
      const p = createReplayPersister(cache, 0, () => KEY);
      for (const id of ["a", "b", "c", "d", "e"]) p.record(id, [evt(42)], "live");
      await Promise.all(["a", "b", "c", "d", "e"].map((id) => p.flush(id)));

      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  // --- Server-scoped attribution (change: purge-replay-cache-on-reset-paths) ---

  it("stamps the flush-time server key, not the record-time one (test-plan #F8)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    let key = "a:8000";
    const p = createReplayPersister(cache, 0, () => key);

    p.seed("X", [evt(1), evt(2)]);
    // Server switch happens before the debounce fires.
    key = "b:8000";
    await p.flush("X");

    // Attribution is ALWAYS the key current at flush time. This is the accepted
    // bound from design D4: a late straggler can produce wrong *content*, but
    // never wrong *attribution* that could be served to another server later.
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[2]).toBe("b:8000");
  });

  it("resetBuffers discards previous-server buffers so they cannot be re-attributed (test-plan #F4)", async () => {
    const { cache, put, del } = spyCache(createReplayCache({ factory }));
    let key = "a:8000";
    const p = createReplayPersister(cache, 0, () => key);

    // Descended buffers accumulated against server A, not yet flushed.
    p.seed("s1", [evt(1), evt(2)]);
    p.seed("s2", [evt(7)]);

    // Server switch: in-memory buffers are dropped, key flips to B.
    p.resetBuffers();
    key = "b:8000";

    await p.flush("s1");
    await p.flush("s2");

    // Nothing from server A may be persisted under server B's identity.
    expect(put).not.toHaveBeenCalled();
    // And a reset is not an invalidation: a sibling tab's entries survive.
    expect(del).not.toHaveBeenCalled();
  });

  it("resetBuffers cancels pending debounce timers (test-plan #F4)", async () => {
    vi.useFakeTimers();
    try {
      const { cache, put } = spyCache(createReplayCache({ factory }));
      const p = createReplayPersister(cache, 50, () => "a:8000");
      p.seed("s1", [evt(1)]); // schedules a debounced flush

      p.resetBuffers();
      await vi.advanceTimersByTimeAsync(200);

      // A surviving timer would re-persist the discarded buffer after the switch.
      expect(put).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resetBuffers clears provenance so a post-switch live straggler is unpersistable (test-plan #F4)", async () => {
    const { cache, put } = spyCache(createReplayCache({ factory }));
    let key = "a:8000";
    const p = createReplayPersister(cache, 0, () => key);

    p.seed("s1", [evt(1), evt(2)]); // descended against A
    p.resetBuffers();
    key = "b:8000";

    // A late frame from the old socket, arriving before any server-B replay.
    p.record("s1", [evt(3)], "live");
    await p.flush("s1");

    expect(put).not.toHaveBeenCalled();
  });

  // --- Buffer lifetime bound (change: fix-archive-feedback-and-sidebar-perf C3) ---

  it("trims the buffer to the tail bound after a successful flush", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0, () => KEY, 50);
    const events = Array.from({ length: 100 }, (_, i) => evt(i + 1));
    p.seed("s1", events);
    await p.flush("s1");

    // Persisted payload is the TAIL: the cursor (maxSeq) is what a reload
    // resumes from, and the reduced state re-derived from a fresh-load-sized
    // tail matches the cache-miss experience.
    const hit = await cache.get("s1", KEY);
    expect(hit?.maxSeq).toBe(100);
    expect(hit?.payload.map((e) => e.seq)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 51),
    );
  });

  it("keeps appending after a trim with dedup and contiguity intact", async () => {
    const cache = createReplayCache({ factory });
    const p = createReplayPersister(cache, 0, () => KEY, 50);
    p.seed("s1", Array.from({ length: 100 }, (_, i) => evt(i + 1)));
    await p.flush("s1");

    p.record("s1", [evt(101), evt(102)], "live");
    await p.flush("s1");
    const hit = await cache.get("s1", KEY);
    expect(hit?.maxSeq).toBe(102);
    expect(hit?.payload.map((e) => e.seq)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 53),
    );
  });

  it("a never-descended session schedules no flush work (test-plan C3)", async () => {
    vi.useFakeTimers();
    try {
      const { cache, put } = spyCache(createReplayCache({ factory }));
      const p = createReplayPersister(cache, 50, () => KEY);
      // Live broadcast only — the buffer can never be persisted, so the
      // debounce is pure waste. (The client now unsubscribes sessions it is
      // not viewing; this bounds the stragglers between deselect and stop.)
      p.record("X", [evt(1)], "live");
      expect(vi.getTimerCount()).toBe(0);

      // A descended session (this tab's own replay) schedules as before.
      p.record("Y", [evt(1), evt(2)], "replay");
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(50);
      expect(put).toHaveBeenCalledTimes(1);
      expect(put.mock.calls[0]?.[0]).toBe("Y");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an append during a pending flush survives the post-flush trim", async () => {
    const inner = createReplayCache({ factory });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const cache: ReplayCache = {
      get: inner.get,
      delete: inner.delete,
      put: async (id, entry, key) => {
        await gate;
        return inner.put(id, entry, key);
      },
    };
    const p = createReplayPersister(cache, 60_000, () => KEY, 50);
    p.seed("s1", Array.from({ length: 100 }, (_, i) => evt(i + 1)));

    const flushP = p.flush("s1"); // the write is now in flight
    p.record("s1", [evt(101)], "live"); // a live frame lands during the await
    release();
    await flushP;

    // Were 101 dropped by the trim, the NEXT live frame (102) would read as a
    // dropped-frame gap (buffered max 100 → 102) and void provenance for the
    // session until a reseed — the contamination failure this module exists
    // to prevent.
    p.record("s1", [evt(102)], "live");
    await p.flush("s1");
    const hit = await cache.get("s1", KEY);
    expect(hit?.maxSeq).toBe(102);
    expect(hit?.payload[hit.payload.length - 1]?.seq).toBe(102);
    p.resetBuffers(); // drop the 60 s debounce timer
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
