/**
 * A4 — archive reliability after long/failed runs
 * (change: fix-archive-feedback-and-sidebar-perf).
 *
 * Two defects share one file because both are exercised through a real
 * in-process server boot:
 *  1. Sticky `live:true`: a crash row that survived cold-start normalization
 *     keeps the in-memory flag, permanently failing `reject-live` and skipping
 *     the sweeper. After normalization the row MUST be archivable.
 *  2. The end-then-archive intent was consumed only at the `unregister` seam,
 *     so an end that lands via `update({status:"ended"})` (force-kill /
 *     session-moved) leaked it to the 60 s TTL. It must be consumed at the
 *     shared `ended` transition.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Seed {
  id: string;
  live?: boolean;
  status?: string;
  closedReason?: string;
}

function seedSession(sessionsDir: string, cwdName: string, s: Seed): void {
  const cwdDir = path.join(sessionsDir, cwdName);
  mkdirSync(cwdDir, { recursive: true });
  const stamp = "2026-06-30T10-00-00-000Z";
  const jsonl = path.join(cwdDir, `${stamp}_${s.id}.jsonl`);
  writeFileSync(jsonl, `${JSON.stringify({ type: "session", id: s.id, cwd: cwdDir })}\n`);
  const meta: Record<string, unknown> = {
    source: "cli",
    cwd: cwdDir,
    status: s.status ?? "streaming",
    startedAt: Date.now(),
    cachedAt: Date.now() + 60_000, // future → scanner trusts cache, no re-extract
  };
  if (s.live !== undefined) meta.live = s.live;
  if (s.closedReason !== undefined) meta.closedReason = s.closedReason;
  writeFileSync(jsonl.replace(/\.jsonl$/, ".meta.json"), JSON.stringify(meta, null, 2));
}

describe("A4 — crash-row livability + intent seam", () => {
  let sessionsDir: string;
  let server: any;

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(os.tmpdir(), "pi-a4-"));
  });

  afterEach(async () => {
    try { await server?.stop(); } catch { /* ignore */ }
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("a crash row keeps memory live:false after normalization and ARRIVES archivable", async () => {
    // The crash signature: live:true + non-ended status.
    seedSession(sessionsDir, "proj", { id: "crash-1111-2222-3333-444444444444", live: true });
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    await wait(50);

    const id = "crash-1111-2222-3333-444444444444";
    const row = server.sessionManager.get(id);
    // Normalized to ended, and the sticky in-memory flag is cleared so the
    // user can actually archive what the crash left behind.
    expect(row?.status).toBe("ended");
    expect(row?.live).not.toBe(true);

    const res = server.sessionArchive.archiveSession(id, "manual");
    expect(res.ok).toBe(true);
    expect(server.sessionArchive.has(id)).toBe(true);
  });

  it("consumes a pending archive intent on the update({status:'ended'}) seam", async () => {
    seedSession(sessionsDir, "proj", { id: "ok-1111-2222-3333-444444444444", live: false, status: "ended" });
    vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", sessionsDir);
    vi.resetModules();
    const { createServer } = await import("../server.js");
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    await wait(50);

    const id = "ok-1111-2222-3333-444444444444";
    // Simulate the idle-alive archive flow: intent recorded, process still up.
    server.sessionManager.update(id, { status: "idle" });
    server.pendingArchiveIntents.record(id);
    expect(server.pendingArchiveIntents.size()).toBe(1);

    // The force-kill / session-moved seam ends the session WITHOUT unregister.
    server.sessionManager.update(id, { status: "ended", closedReason: "manual" });
    await wait(20);

    expect(server.sessionArchive.has(id)).toBe(true);
    expect(server.pendingArchiveIntents.size()).toBe(0);
  });
});
