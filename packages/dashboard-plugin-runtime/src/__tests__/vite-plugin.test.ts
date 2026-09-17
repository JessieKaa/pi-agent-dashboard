/**
 * Tests for the Vite plugin manifest scanning and registry generation.
 * We test the generation logic without spinning up a real Vite server.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearDiscoveryCache } from "../server/loader.js";

// We test the generation by importing the internal helpers via the vite-plugin module.
// Since the plugin is exported, we call buildStart directly.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vite-plugin-test-"));
  clearDiscoveryCache();
  // Write a fake packages dir
  fs.mkdirSync(path.join(tmpDir, "packages"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "packages", "client", "src", "generated"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
});

function writePlugin(name: string, manifest: Record<string, unknown>) {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, "pi-dashboard-plugin": manifest }),
  );
}

async function invokePlugin(isProd = false): Promise<string> {
  const oldEnv = process.env.NODE_ENV;
  if (isProd) process.env.NODE_ENV = "production";
  try {
    const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
    const plugin = viteDashboardPluginsPlugin(tmpDir);
    // Call buildStart manually
    await (plugin as { buildStart?: () => void }).buildStart?.();

    const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
    return fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
  } finally {
    process.env.NODE_ENV = oldEnv;
    clearDiscoveryCache();
  }
}

/** Drive the production path: configResolved → buildStart → closeBundle. */
async function invokePluginBuild(isProd = true): Promise<{
  registryContent: string;
  metadata: { schemaVersion: number; pluginRegistryHash: string } | null;
}> {
  const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
  const { readBuildMetadata } = await import("../server/build-metadata.js");
  const outDir = path.join(tmpDir, "client", "dist");
  const plugin = viteDashboardPluginsPlugin(tmpDir) as unknown as {
    configResolved?: (config: Record<string, unknown>) => void;
    buildStart?: () => void;
    closeBundle?: () => void;
  };
  const oldEnv = process.env.NODE_ENV;
  if (isProd) process.env.NODE_ENV = "production";
  try {
    plugin.configResolved?.({
      command: "build",
      root: tmpDir,
      build: { outDir },
    });
    await plugin.buildStart?.();
    plugin.closeBundle?.();

    const outPath = path.join(tmpDir, "packages", "client", "src", "generated", "plugin-registry.tsx");
    return {
      registryContent: fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "",
      metadata: readBuildMetadata(outDir),
    };
  } finally {
    process.env.NODE_ENV = oldEnv;
    clearDiscoveryCache();
  }
}

describe("viteDashboardPluginsPlugin", () => {
  it("generates registry with named imports for claimed components", async () => {
    writePlugin("openspec-plugin", {
      id: "openspec",
      displayName: "OpenSpec",
      priority: 100,
      client: "./dist/client/index.js",
      claims: [
        { slot: "session-card-badge", component: "OpenSpecBadge" },
        { slot: "settings-section", component: "OpenSpecSettings", tab: "general" },
      ],
    });

    const content = await invokePlugin();
    // Should use named imports, not import *
    expect(content).toContain("import { OpenSpecBadge, OpenSpecSettings }");
    expect(content).not.toContain("import * as");
    expect(content).toContain("PLUGIN_REGISTRY");
    expect(content).toContain('"openspec"');
  });

  it("skips fixture plugins in production", async () => {
    writePlugin("demo-plugin", {
      id: "demo",
      displayName: "Demo",
      fixture: true,
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "DemoBadge" }],
    });

    const content = await invokePlugin(true);
    // demo plugin should not appear in production bundle
    expect(content).not.toContain("demo");
    expect(content).not.toContain("DemoBadge");
  });

  it("does not regenerate when manifest content hasn't changed", async () => {
    writePlugin("stable-plugin", {
      id: "stable",
      displayName: "Stable",
      client: "./dist/client/index.js",
      claims: [],
    });

    // First generation
    const content1 = await invokePlugin();
    // Second generation — must produce same content
    const content2 = await invokePlugin();
    expect(content1).toBeTruthy();
    expect(content1).toBe(content2);
  });
});

describe("viteDashboardPluginsPlugin — served-artifact declaration (P0)", () => {
  it("writes a declaration whose hash matches the embedded PLUGIN_REGISTRY_HASH", async () => {
    writePlugin("alpha-plugin", {
      id: "alpha",
      displayName: "Alpha",
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "AlphaBadge" }],
    });

    const { registryContent, metadata } = await invokePluginBuild(true);

    expect(metadata).not.toBeNull();
    const embedded = registryContent.match(
      /export const PLUGIN_REGISTRY_HASH = "([0-9a-f]{64})"/,
    );
    expect(embedded, "generated registry must embed a 64-char hash").not.toBeNull();
    expect(metadata?.pluginRegistryHash).toBe(embedded?.[1]);
  });

  it("excludes fixture plugins from the declaration hash in production", async () => {
    writePlugin("real-plugin", {
      id: "real",
      displayName: "Real",
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "RealBadge" }],
    });
    writePlugin("demo-plugin", {
      id: "demo",
      displayName: "Demo",
      fixture: true,
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "DemoBadge" }],
    });

    const { registryContent, metadata } = await invokePluginBuild(true);
    const embedded = registryContent.match(
      /export const PLUGIN_REGISTRY_HASH = "([0-9a-f]{64})"/,
    );
    expect(registryContent).not.toContain("demo");
    expect(metadata?.pluginRegistryHash).toBe(embedded?.[1]);
  });

  it("embeds the runtime staleness hash, including server-only plugins without a client entry", async () => {
    // Regression: `mcp-server` has no `client` field. Import generation skips
    // it, but the server's `/api/health.bundleHash` (discoverPlugins minus
    // fixtures) includes it — if the embedded hash were computed over the
    // import entries, the staleness banner would show in production forever.
    writePlugin("server-only-plugin", {
      id: "server-only",
      displayName: "Server Only",
      claims: [],
    });
    writePlugin("alpha-plugin", {
      id: "alpha",
      displayName: "Alpha",
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "AlphaBadge" }],
    });

    const { registryContent, metadata } = await invokePluginBuild(true);
    const embedded = registryContent.match(
      /export const PLUGIN_REGISTRY_HASH = "([0-9a-f]{64})"/,
    );
    expect(embedded, "generated registry must embed a 64-char hash").not.toBeNull();

    const { discoverPlugins, pluginRegistryHash, clearDiscoveryCache: clear } = await import(
      "../server/loader.js"
    );
    clear();
    const runtimeSet = discoverPlugins(tmpDir).filter(p => p.manifest.fixture !== true);
    const runtimeHash = pluginRegistryHash(runtimeSet);

    expect(metadata?.pluginRegistryHash).toBe(runtimeHash);
    expect(embedded?.[1]).toBe(runtimeHash);
    // Guard the exact regression: dropping the client-less plugin changes the
    // hash — i.e. the assertion above is not vacuously true.
    expect(pluginRegistryHash(runtimeSet.filter(p => p.manifest.id !== "server-only"))).not.toBe(
      runtimeHash,
    );
  });

  it("writes no declaration on a dev serve (no configResolved build)", async () => {
    writePlugin("dev-plugin", {
      id: "dev",
      displayName: "Dev",
      client: "./dist/client/index.js",
      claims: [],
    });

    const { viteDashboardPluginsPlugin } = await import("../vite-plugin/index.js");
    const { readBuildMetadata } = await import("../server/build-metadata.js");
    const outDir = path.join(tmpDir, "client", "dist");
    const plugin = viteDashboardPluginsPlugin(tmpDir) as unknown as {
      configResolved?: (config: Record<string, unknown>) => void;
      buildStart?: () => void;
      closeBundle?: () => void;
    };
    plugin.configResolved?.({ command: "serve", root: tmpDir, build: { outDir } });
    await plugin.buildStart?.();
    plugin.closeBundle?.();

    expect(readBuildMetadata(outDir)).toBeNull();
  });

  it("overwrites a stale declaration rather than leaving a previously written one", async () => {
    writePlugin("swap-plugin", {
      id: "swap",
      displayName: "Swap",
      client: "./dist/client/index.js",
      claims: [{ slot: "session-card-badge", component: "SwapBadge" }],
    });

    const first = await invokePluginBuild(true);

    // Same plugin set, new claim → hash must differ, declaration must follow.
    writePlugin("swap-plugin", {
      id: "swap",
      displayName: "Swap",
      client: "./dist/client/index.js",
      claims: [
        { slot: "session-card-badge", component: "SwapBadge" },
        { slot: "settings-section", component: "SwapSettings", tab: "general" },
      ],
    });

    const second = await invokePluginBuild(true);
    expect(second.metadata?.pluginRegistryHash).not.toBe(first.metadata?.pluginRegistryHash);
    const embedded = second.registryContent.match(
      /export const PLUGIN_REGISTRY_HASH = "([0-9a-f]{64})"/,
    );
    expect(second.metadata?.pluginRegistryHash).toBe(embedded?.[1]);
  });
});
