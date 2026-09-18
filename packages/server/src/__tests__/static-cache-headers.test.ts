/**
 * Static-serving cache policy — content-hashed files under /assets/ are
 * immutable (long-lived, no revalidation); the HTML entry stays no-store so
 * a new build is picked up on the next load.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (①).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let server: DashboardServer;
let clientDir: string;

const indexHtml = "<!doctype html><html><body>CACHE</body></html>";

// A build-shaped fixture: Vite emits `assets/<name>-<8-char-hash>.js` plus a
// pre-compressed `.gz` sibling. The body is a fixed string so both encodings
// decode to the same bytes.
const assetBody = "export const marker = \"cache-fixture\";\n";
const assetFile = "cache-fixture-abc12345.js";

describe("static asset cache policy", () => {
  beforeAll(async () => {
    // Private temp dir (mkdtemp) — never the shared `dist/client` fixture
    // used by spa-fallback.test.ts: vitest runs files in parallel and both
    // write a fixture `index.html`, so sharing the path clobbers the SPA
    // assertions whichever file writes second.
    clientDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-static-cache-"));
    fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(clientDir, "index.html"), indexHtml);
    const assetPath = path.join(clientDir, "assets", assetFile);
    fs.writeFileSync(assetPath, assetBody);
    fs.writeFileSync(`${assetPath}.gz`, gzipSync(Buffer.from(assetBody)));

    server = await createServer({
      port: 0,
      piPort: 0,
      host: "127.0.0.1",
      dev: false,
      autoShutdown: false,
      shutdownIdleSeconds: 999,
      tunnel: false,
    }, { clientDistOverride: clientDir });
    await server.start();
    httpPort = server.httpPort()!;
  });

  afterAll(async () => {
    if (server) await server.stop();
    if (clientDir) fs.rmSync(clientDir, { recursive: true, force: true });
  });

  it("serves a hashed /assets file with immutable, one-year cache", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/assets/${assetFile}`);
    expect(res.status).toBe(200);
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("immutable");
    expect(cc).toContain("max-age=31536000");
    expect(cc).not.toContain("no-store");
    expect(await res.text()).toBe(assetBody);
  });

  it("applies the same immutable policy when serving the precompressed twin", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/assets/${assetFile}`, {
      headers: { "Accept-Encoding": "gzip" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc).toContain("immutable");
    expect(cc).toContain("max-age=31536000");
    expect(await res.text()).toBe(assetBody);
  });

  it("serves the root HTML with no-store", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(await res.text()).toBe(indexHtml);
  });

  it("keeps no-store on the SPA fallback for unknown routes", async () => {
    const res = await fetch(`http://127.0.0.1:${httpPort}/session/abc-123`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(await res.text()).toBe(indexHtml);
  });
});
