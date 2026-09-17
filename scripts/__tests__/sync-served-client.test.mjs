/**
 * Tests for `scripts/sync-served-client.mjs` — the deploy-time bridge between
 * the workspace client build and the static artifact the server serves.
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0 D2).
 *
 * Everything runs against temp directories; the real global install is never
 * touched. `syncServedClient` takes explicit source/dest/devServerPort paths,
 * so no PATH or package resolution is exercised here (that half is covered by
 * the resolver tests in the runtime + server packages). Tests pin a reserved
 * free port so they never depend on the real 3000.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncServedClient } from "../sync-served-client.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let root;
let sourceDir;
let destDir;
/** Port guaranteed to answer neither HTTP nor a Vite marker. */
let freePort;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-served-client-"));
  sourceDir = path.join(root, "workspace-client-dist");
  destDir = path.join(root, "installed-web-dist");
  // Reserve + release an ephemeral port (the real 3000 is occupied by
  // unrelated dev apps on many machines).
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  freePort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeBuild(dir, hash, extra = {}) {
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><html></html>");
  fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");
  fs.writeFileSync(
    path.join(dir, "pi-dashboard-build.json"),
    JSON.stringify({ schemaVersion: 1, pluginRegistryHash: hash }),
  );
  for (const [name, content] of Object.entries(extra)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
}

function readDeclarationHash(dir) {
  return JSON.parse(
    fs.readFileSync(path.join(dir, "pi-dashboard-build.json"), "utf8"),
  ).pluginRegistryHash;
}

describe("syncServedClient", () => {
  it("fills an absent destination and reports the declaration", async () => {
    writeBuild(sourceDir, HASH_A);
    const { declaration, wasAbsentOrEmpty } = await syncServedClient({
      sourceDir,
      destDir,
      devServerPort: freePort,
    });
    expect(declaration.pluginRegistryHash).toBe(HASH_A);
    expect(wasAbsentOrEmpty).toBe(true);
    expect(readDeclarationHash(destDir)).toBe(HASH_A);
    expect(fs.existsSync(path.join(destDir, "assets", "app-abc123.js"))).toBe(true);
  });

  it("replaces a stale destination (no leftover assets) and verifies the new hash", async () => {
    writeBuild(sourceDir, HASH_B);
    writeBuild(destDir, HASH_A, { "stale-only.js": "old" });

    const { declaration, wasAbsentOrEmpty } = await syncServedClient({
      sourceDir,
      destDir,
      devServerPort: freePort,
    });
    expect(wasAbsentOrEmpty).toBe(false);
    expect(declaration.pluginRegistryHash).toBe(HASH_B);
    expect(readDeclarationHash(destDir)).toBe(HASH_B);
    expect(fs.existsSync(path.join(destDir, "stale-only.js"))).toBe(false);
  });

  it("rejects a source without a declaration and leaves the destination untouched", async () => {
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "index.html"), "<html></html>");
    writeBuild(destDir, HASH_A);

    await expect(
      syncServedClient({ sourceDir, destDir, devServerPort: freePort }),
    ).rejects.toThrow(/source client build is missing a readable/);
    expect(readDeclarationHash(destDir)).toBe(HASH_A);
  });

  it("rejects a source with a malformed declaration", async () => {
    writeBuild(sourceDir, HASH_A);
    fs.writeFileSync(path.join(sourceDir, "pi-dashboard-build.json"), "not json");
    await expect(
      syncServedClient({ sourceDir, destDir, devServerPort: freePort }),
    ).rejects.toThrow(/source client build is missing a readable/);
  });

  it("refuses a destination that looks like a package source tree", async () => {
    writeBuild(sourceDir, HASH_A);
    writeBuild(destDir, HASH_A);
    fs.writeFileSync(path.join(destDir, "package.json"), "{}");
    await expect(
      syncServedClient({ sourceDir, destDir, devServerPort: freePort }),
    ).rejects.toThrow(/looks like a package source tree/);
  });

  it("excludes node_modules and .vite from the copy", async () => {
    writeBuild(sourceDir, HASH_A);
    fs.mkdirSync(path.join(sourceDir, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, "node_modules", "dep", "x.js"), "x");
    fs.mkdirSync(path.join(sourceDir, ".vite"), { recursive: true });

    await syncServedClient({ sourceDir, destDir, devServerPort: freePort });
    expect(fs.existsSync(path.join(destDir, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(destDir, ".vite"))).toBe(false);
  });

  it("a fresh sync over an already-synced destination stays verifiable (idempotent)", async () => {
    writeBuild(sourceDir, HASH_A);
    await syncServedClient({ sourceDir, destDir, devServerPort: freePort });
    const { declaration } = await syncServedClient({
      sourceDir,
      destDir,
      devServerPort: freePort,
    });
    expect(declaration.pluginRegistryHash).toBe(HASH_A);
  });

  it("aborts when a Vite dev server holds the configured port", async () => {
    writeBuild(sourceDir, HASH_B);
    writeBuild(destDir, HASH_A);

    // A listener that SERVES the Vite client marker, like a real dev server.
    const viteLike = http.createServer((_req, res) => {
      res.end('<!doctype html><script type="module" src="/@vite/client"></script>');
    });
    await new Promise((resolve) => viteLike.listen(0, "127.0.0.1", resolve));
    const port = viteLike.address().port;
    try {
      await expect(
        syncServedClient({ sourceDir, destDir, devServerPort: port }),
      ).rejects.toThrow(new RegExp(`Vite dev server is listening on port ${port}`));
      // Destination left untouched.
      expect(readDeclarationHash(destDir)).toBe(HASH_A);
    } finally {
      await new Promise((resolve) => viteLike.close(resolve));
    }
  }, 10_000);

  it("does NOT abort when a non-Vite app occupies the port", async () => {
    writeBuild(sourceDir, HASH_B);
    writeBuild(destDir, HASH_A);

    const unrelated = http.createServer((_req, res) => res.end("hello from app.js"));
    await new Promise((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
    const port = unrelated.address().port;
    try {
      const { declaration } = await syncServedClient({
        sourceDir,
        destDir,
        devServerPort: port,
      });
      expect(declaration.pluginRegistryHash).toBe(HASH_B);
    } finally {
      await new Promise((resolve) => unrelated.close(resolve));
    }
  }, 10_000);
});
