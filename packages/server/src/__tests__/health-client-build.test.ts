/**
 * Tests for `/api/health.clientBuild` — served-artifact coherence states.
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0).
 *
 * Drives `registerSystemRoutes` directly with fake `clientDist` snapshots so
 * the four states (matched / mismatched / metadata-missing / not-served) are
 * each exercised against a real declaration on disk. The runtime registry
 * hash is computed in-test over a STUBBED discovery (two fake plugin
 * manifests): real repo discovery would be order-dependent in shared CI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BUILD_METADATA_FILENAME, pluginRegistryHash } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSystemRoutes } from "../routes/system-routes.js";

const FAKE_PLUGINS = [
  { manifest: { id: "alpha-plugin", claims: [] }, packageName: "alpha", packageDir: "/fake/alpha" },
  { manifest: { id: "beta-plugin", claims: [] }, packageName: "beta", packageDir: "/fake/beta" },
] as never;

vi.mock("@blackbelt-technology/dashboard-plugin-runtime/server", async (importActual) => {
  const actual = await importActual<typeof import("@blackbelt-technology/dashboard-plugin-runtime/server")>();
  return { ...actual, discoverPlugins: vi.fn() };
});

import { discoverPlugins } from "@blackbelt-technology/dashboard-plugin-runtime/server";

const RUNTIME_HASH = pluginRegistryHash(FAKE_PLUGINS as never);

function makeDeps(clientDist?: { dir: string | null; fromInstalledPackage: boolean }) {
  return {
    sessionManager: { listActive: () => [], listAll: () => [] } as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: (async () => {}) as never,
    version: "test",
    clientDist: clientDist as never,
  };
}

async function getClientBuild(app: FastifyInstance) {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).clientBuild;
}

describe("GET /api/health — clientBuild", () => {
  let app: FastifyInstance;
  let distDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(discoverPlugins).mockReturnValue(FAKE_PLUGINS);
    distDir = fs.mkdtempSync(path.join(os.tmpdir(), "client-build-health-"));
  });

  afterEach(async () => {
    if (app) await app.close();
    fs.rmSync(distDir, { recursive: true, force: true });
  });

  function writeDeclaration(hash: string): void {
    fs.writeFileSync(
      path.join(distDir, BUILD_METADATA_FILENAME),
      JSON.stringify({ schemaVersion: 1, pluginRegistryHash: hash }),
      "utf8",
    );
  }

  it("matched when the served declaration equals the runtime registry hash", async () => {
    writeDeclaration(RUNTIME_HASH);
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeDeps({ dir: distDir, fromInstalledPackage: true }) as never);
    await app.ready();

    expect(await getClientBuild(app)).toEqual({
      pluginRegistryHash: RUNTIME_HASH,
      status: "matched",
    });
  });

  it("mismatched when the served declaration differs from the runtime registry hash", async () => {
    writeDeclaration("f".repeat(64));
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeDeps({ dir: distDir, fromInstalledPackage: true }) as never);
    await app.ready();

    expect(await getClientBuild(app)).toEqual({
      pluginRegistryHash: "f".repeat(64),
      status: "mismatched",
    });
  });

  it("metadata-missing when the served dir has no declaration", async () => {
    app = Fastify({ logger: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerSystemRoutes(app, makeDeps({ dir: distDir, fromInstalledPackage: true }) as never);
    await app.ready();

    expect(await getClientBuild(app)).toEqual({
      pluginRegistryHash: null,
      status: "metadata-missing",
    });
    // The diagnostic names the declaration file but never a filesystem path.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(BUILD_METADATA_FILENAME),
    );
    for (const call of warn.mock.calls) {
      expect(call.join(" ")).not.toContain(distDir);
    }
    warn.mockRestore();
  });

  it("metadata-missing when the declaration is malformed", async () => {
    fs.writeFileSync(path.join(distDir, BUILD_METADATA_FILENAME), "not json", "utf8");
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeDeps({ dir: distDir, fromInstalledPackage: true }) as never);
    await app.ready();

    expect(await getClientBuild(app)).toEqual({
      pluginRegistryHash: null,
      status: "metadata-missing",
    });
  });

  it("not-served in API-only mode (null dir)", async () => {
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeDeps({ dir: null, fromInstalledPackage: false }) as never);
    await app.ready();

    expect(await getClientBuild(app)).toEqual({
      pluginRegistryHash: null,
      status: "not-served",
    });
  });

  it("not-served when no clientDist dep is supplied", async () => {
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeDeps() as never);
    await app.ready();

    expect(await getClientBuild(app)).toEqual({
      pluginRegistryHash: null,
      status: "not-served",
    });
  });

  it("exposes no filesystem path anywhere in the clientBuild payload", async () => {
    writeDeclaration(RUNTIME_HASH);
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeDeps({ dir: distDir, fromInstalledPackage: true }) as never);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.body).not.toContain(distDir);
  });
});
