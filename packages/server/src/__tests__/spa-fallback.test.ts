/**
 * SPA fallback tests — validates that client-side routes return index.html.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let piPort: number;
let server: DashboardServer;

// Ensure dist/client/index.html exists for the test
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, "../../../dist/client");
const indexPath = path.join(clientDir, "index.html");

describe("SPA fallback", () => {
  beforeAll(async () => {
    // Create the minimal index.html the SPA fallback serves. The boot below
    // pins this dir explicitly, so a real build elsewhere never masks it.
    // See change: optimize-client-bootstrap-and-bundle-coherence (P0).
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(indexPath, "<!doctype html><html><body>SPA</body></html>");

    // Boot with an ISOLATED static dir holding ONLY the minimal index.html
    // created above, overriding both the installed-package resolution and the
    // workspace `packages/client/dist` fallback (either may carry a real build
    // on dev machines and carry away the SPA fallback assertions).
    // See change: optimize-client-bootstrap-and-bundle-coherence (P0).
    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: false, // production mode enables static serving + SPA fallback
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    }, { clientDistOverride: clientDir });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;
  });

  afterAll(async () => {
    if (server) await server.stop();
    fs.rmSync(indexPath);
  });

  it("returns index.html for /session/:id route", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/session/abc-123`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("html");
  });

  it("returns index.html for unknown client routes", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/some/unknown/path`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("html");
  });

  it("still serves API routes normally", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/api/sessions`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});
