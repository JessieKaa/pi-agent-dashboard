/**
 * Gateway owner identity regressions: stale sockets must not end or delete the
 * current bridge for the same session id. See change: reload-resume-lifecycle.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", resolve);
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

let portCounter = 19720;

describe("pi gateway session owner identity", () => {
  let gateway: ReturnType<typeof createPiGateway>;

  afterEach(() => {
    gateway?.stop();
    vi.restoreAllMocks();
  });

  it("ignores stale unregister from a replaced socket", async () => {
    const sm = createMemorySessionManager();
    const onEvent = vi.fn();
    gateway = createPiGateway(sm, { heartbeatTimeout: 5000 });
    gateway.onEvent = onEvent;
    const port = portCounter++;
    gateway.start(port);

    const a = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(a);
    a.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/a", source: "tui", pid: 123 }));
    await delay(100);

    const b = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(b);
    b.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/b", source: "tui", pid: 123 }));
    await delay(100);

    a.send(JSON.stringify({ type: "session_unregister", sessionId: "same", reason: "quit" }));
    await delay(100);

    expect(sm.get("same")?.status).toBe("active");
    expect(sm.get("same")?.cwd).toBe("/b");
    expect(gateway.isSessionConnected("same")).toBe(true);
    expect(onEvent).not.toHaveBeenCalledWith(
      "same",
      expect.objectContaining({ type: "session_unregister" }),
    );

    a.close();
    b.close();
  }, 10000);

  it("ignores stale close from a replaced socket", async () => {
    const sm = createMemorySessionManager();
    const onDisconnect = vi.fn();
    gateway = createPiGateway(sm, { heartbeatTimeout: 5000 });
    gateway.onDisconnect = onDisconnect;
    const port = portCounter++;
    gateway.start(port);

    const a = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(a);
    a.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/a", source: "tui", pid: 123 }));
    await delay(100);

    const b = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(b);
    b.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/b", source: "tui", pid: 123 }));
    await delay(100);

    gateway.contention.record("same", 123, 456);
    expect(gateway.contention.isContended("same")).toBe(true);
    a.close();
    await delay(200);

    expect(sm.get("same")?.status).toBe("active");
    expect(sm.get("same")?.cwd).toBe("/b");
    expect(gateway.isSessionConnected("same")).toBe(true);
    expect(onDisconnect).not.toHaveBeenCalledWith("same");
    expect(gateway.contention.isContended("same")).toBe(true);

    b.close();
  }, 10000);

  it("stale heartbeat timers do not end a re-registered owner", async () => {
    const sm = createMemorySessionManager();
    gateway = createPiGateway(sm, { heartbeatTimeout: 120, pingInterval: 60000 });
    const port = portCounter++;
    gateway.start(port);

    const a = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(a);
    a.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/a", source: "tui" }));
    await delay(40);
    a.close();
    await delay(40);

    const b = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(b);
    b.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/b", source: "tui" }));
    await delay(260);

    expect(sm.get("same")?.status).toBe("active");
    expect(sm.get("same")?.cwd).toBe("/b");
    expect(gateway.isSessionConnected("same")).toBe(true);

    b.close();
  }, 10000);

  it("current owner quit unregister still ends the session", async () => {
    const sm = createMemorySessionManager();
    gateway = createPiGateway(sm, { heartbeatTimeout: 5000 });
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "session_register", sessionId: "quit-me", cwd: "/tmp", source: "tui" }));
    await delay(100);
    ws.send(JSON.stringify({ type: "session_unregister", sessionId: "quit-me", reason: "quit" }));
    await delay(100);

    expect(sm.get("quit-me")?.status).toBe("ended");
    expect(gateway.isSessionConnected("quit-me")).toBe(false);
    ws.close();
  }, 10000);

  it("ignores stale register and messages from a replaced socket", async () => {
    const sm = createMemorySessionManager();
    const onEvent = vi.fn();
    gateway = createPiGateway(sm, { heartbeatTimeout: 5000 });
    gateway.onEvent = onEvent;
    const port = portCounter++;
    gateway.start(port);

    const a = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(a);
    a.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/a", source: "tui", pid: 123 }));
    await delay(100);

    const b = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(b);
    b.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/b", source: "tui", model: "new-model", pid: 123 }));
    await delay(100);

    a.send(JSON.stringify({ type: "session_register", sessionId: "same", cwd: "/a-late", source: "tui", model: "old-model", pid: 123 }));
    a.send(JSON.stringify({ type: "model_update", sessionId: "same", model: "old-model" }));
    a.send(JSON.stringify({ type: "event_forward", sessionId: "same", event: { eventType: "stale", timestamp: Date.now(), data: {} } }));
    await delay(100);

    expect(sm.get("same")?.status).toBe("active");
    expect(sm.get("same")?.cwd).toBe("/b");
    expect(sm.get("same")?.model).toBe("new-model");
    expect(gateway.isSessionConnected("same")).toBe(true);
    expect(onEvent).not.toHaveBeenCalledWith(
      "same",
      expect.objectContaining({ type: "model_update", model: "old-model" }),
    );
    expect(onEvent).not.toHaveBeenCalledWith(
      "same",
      expect.objectContaining({ type: "event_forward" }),
    );

    a.close();
    b.close();
  }, 10000);

  it("closeSession preserves the current-owner close lifecycle", async () => {
    const sm = createMemorySessionManager();
    const onDisconnect = vi.fn();
    const ended: string[] = [];
    sm.onUnregister = (sid) => ended.push(sid);
    gateway = createPiGateway(sm, { heartbeatTimeout: 5000 });
    gateway.onDisconnect = onDisconnect;
    const port = portCounter++;
    gateway.start(port);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(ws);
    ws.send(JSON.stringify({ type: "session_register", sessionId: "auto-close", cwd: "/tmp", source: "dashboard" }));
    await delay(100);
    sm.update("auto-close", { finalizeOnSocketClose: true });

    expect(gateway.closeSession("auto-close")).toBe(true);
    await delay(200);

    expect(onDisconnect).toHaveBeenCalledWith("auto-close");
    expect(ended).toContain("auto-close");
    expect(sm.get("auto-close")?.status).toBe("ended");
  }, 10000);

  it("releases owner generation state after a terminal unregister", async () => {
    const sm = createMemorySessionManager();
    gateway = createPiGateway(sm, { heartbeatTimeout: 5000 });
    const port = portCounter++;
    gateway.start(port);

    const first = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(first);
    first.send(JSON.stringify({ type: "session_register", sessionId: "reuse", cwd: "/one", source: "tui" }));
    await delay(100);
    first.send(JSON.stringify({ type: "session_unregister", sessionId: "reuse", reason: "quit" }));
    await delay(100);

    const second = new WebSocket(`ws://localhost:${port}`);
    await waitForOpen(second);
    second.send(JSON.stringify({ type: "session_register", sessionId: "reuse", cwd: "/two", source: "tui" }));
    await delay(100);

    expect(sm.get("reuse")?.status).toBe("active");
    expect(sm.get("reuse")?.cwd).toBe("/two");
    expect(gateway.isSessionConnected("reuse")).toBe(true);
    first.close();
    second.close();
  }, 10000);
});
