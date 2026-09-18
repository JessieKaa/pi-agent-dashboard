/**
 * B1 — WS `archive_session` acknowledgment
 * (change: fix-archive-feedback-and-sidebar-perf).
 *
 * `handleArchiveSession` used to discard `requestArchive`'s outcome, so a
 * rejected archive (not-found / live / running / end-failure) was a silent
 * drop on the WS path — the user clicked Archive, nothing happened, no error.
 * The handler now sends an `archive_result` ACK back on the requesting socket.
 *
 * Drives the REAL gateway dispatch (`wss.emit("connection")` + `message`)
 * with the archive collaborators wired in as constructor args; `sendTo`
 * routes `archive_result` through the state path, which sends synchronously
 * on a fresh socket (buffer at 0), so no timing controls are needed
 * (precedent: browser-gateway-shutdown-reject.test.ts).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingArchiveIntentRegistry } from "../pending/pending-archive-intent-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { createSessionArchive, type SessionArchive } from "../session/session-archive.js";

function makeFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    OPEN: number;
    bufferedAmount: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  // An idle socket. Without this the state-class ACK would be deferred into
  // the pending-state queue (`undefined <= MAX_WS_BUFFER` is false) and only
  // land on the flush timer — real browser sockets start at 0.
  ws.bufferedAmount = 0;
  return ws;
}

function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

/** Parse the `archive_result` frames among a socket's recorded sends. */
function archiveResults(ws: ReturnType<typeof makeFakeWs>): Array<Record<string, unknown>> {
  return ws.send.mock.calls
    .map((c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>)
    .filter((m) => m.type === "archive_result");
}

async function flushDispatch(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("browser-gateway archive_session ACK (B1)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-b1-gw-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  interface Rig {
    gateway: ReturnType<typeof createBrowserGateway>;
    manager: ReturnType<typeof createMemorySessionManager>;
    archive: SessionArchive;
  }

  /** Archive wired with a real index row (sessionFile on disk), no emitter. */
  function buildRig(opts: { withArchive?: boolean } = {}): Rig {
    const manager = createMemorySessionManager();
    const metaPersistence = createMetaPersistence();
    const archive = createSessionArchive({
      sessionManager: manager,
      metaPersistence,
      getPinnedDirs: () => [],
    });
    const intents = createPendingArchiveIntentRegistry();
    const gateway = createBrowserGateway(
      manager,
      createMemoryEventStore(() => false),
      makeStubPiGateway(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      metaPersistence,
      undefined,
      undefined,
      undefined,
      opts.withArchive === false ? undefined : archive,
      intents,
    );
    return { gateway, manager, archive };
  }

  function connect(gateway: Rig["gateway"]) {
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});
    return ws;
  }

  function send(ws: ReturnType<typeof makeFakeWs>, msg: unknown): void {
    ws.emit("message", Buffer.from(JSON.stringify(msg)));
  }

  function seedEnded(
    manager: Rig["manager"],
    id: string,
    over: Partial<Parameters<Rig["manager"]["restore"]>[0]> = {},
  ): string {
    const dir = path.join(tmpDir, "repo");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id, cwd: "/repo" })}\n`);
    manager.restore({
      id,
      cwd: "/repo",
      source: "tui",
      status: "ended",
      startedAt: 1000,
      endedAt: 2000,
      sessionFile: file,
      ...over,
    } as Parameters<Rig["manager"]["restore"]>[0]);
    return file;
  }

  it("acks an ended session with ok:true (no pending)", async () => {
    const { gateway, manager, archive } = buildRig();
    seedEnded(manager, "s-ended");
    const ws = connect(gateway);

    send(ws, { type: "archive_session", sessionId: "s-ended" });
    await flushDispatch();

    // The archive really happened…
    expect(archive.has("s-ended")).toBe(true);
    // …and exactly one ACK landed on the requesting socket.
    const acks = archiveResults(ws);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toEqual({ type: "archive_result", sessionId: "s-ended", ok: true });
  });

  it("acks a not-found session with ok:false + a translatable code", async () => {
    const { gateway } = buildRig();
    const ws = connect(gateway);

    send(ws, { type: "archive_session", sessionId: "ghost" });
    await flushDispatch();

    expect(archiveResults(ws)[0]).toEqual({
      type: "archive_result",
      sessionId: "ghost",
      ok: false,
      error: "session not found",
      code: "archive.not_found",
    });
  });

  it("acks a running session with ok:false (the silent no-op the change removes)", async () => {
    const { gateway, manager } = buildRig();
    seedEnded(manager, "s-running", { status: "streaming", endedAt: undefined });
    const ws = connect(gateway);

    send(ws, { type: "archive_session", sessionId: "s-running" });
    await flushDispatch();

    const acks = archiveResults(ws);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ ok: false, code: "archive.reject_running" });
    expect(manager.get("s-running")).toBeDefined();
  });

  it("acks a live (interrupted) session with ok:false", async () => {
    const { gateway, manager } = buildRig();
    seedEnded(manager, "s-live", { live: true });
    const ws = connect(gateway);

    send(ws, { type: "archive_session", sessionId: "s-live" });
    await flushDispatch();

    expect(archiveResults(ws)[0]).toMatchObject({ ok: false, code: "archive.reject_live" });
  });

  it("acks an idle-alive session with ok:true + pending:true (receipt, archive lands on ended)", async () => {
    const { gateway, manager, archive } = buildRig();
    seedEnded(manager, "s-idle", { status: "idle", endedAt: undefined });
    const ws = connect(gateway);

    send(ws, { type: "archive_session", sessionId: "s-idle" });
    await flushDispatch();

    const acks = archiveResults(ws);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toEqual({ type: "archive_result", sessionId: "s-idle", ok: true, pending: true });
    // The real end path cannot run without a bridge; the archive is NOT yet
    // applied — `pending` is a receipt for "file it when it ends".
    expect(archive.has("s-idle")).toBe(false);
  });

  it("acks ok:false (unavailable) when no archive index is wired instead of dropping silently", async () => {
    const { gateway, manager } = buildRig({ withArchive: false });
    seedEnded(manager, "s-no-archive");
    const ws = connect(gateway);

    send(ws, { type: "archive_session", sessionId: "s-no-archive" });
    await flushDispatch();

    expect(archiveResults(ws)[0]).toMatchObject({ ok: false, code: "archive.unavailable" });
  });
});
