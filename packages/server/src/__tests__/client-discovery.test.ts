/**
 * Tests for the ONE client static-dir resolver (`lib/client-dist.ts`) that
 * backs both Fastify static serving and `/api/health.clientBuild`.
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveClientDist } from "../lib/client-dist.js";

let root: string;
/** Anchor dir inside a fake install whose node_modules holds the web pkg. */
let anchorDir: string;
let installedDist: string;
let workspaceDist: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "client-dist-"));
  anchorDir = path.join(root, "server", "src");
  installedDist = path.join(root, "node_modules", "@blackbelt-technology", "pi-dashboard-web", "dist");
  workspaceDist = path.join(root, "packages", "client", "dist");
  fs.mkdirSync(anchorDir, { recursive: true });
  fs.mkdirSync(workspaceDist, { recursive: true });
  fs.writeFileSync(path.join(workspaceDist, "index.html"), "<html></html>");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function installWebPackage(): void {
  const pkgDir = path.dirname(installedDist);
  fs.mkdirSync(installedDist, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name: "@blackbelt-technology/pi-dashboard-web", version: "0.0.0" }),
  );
  fs.writeFileSync(path.join(installedDist, "index.html"), "<html></html>");
}

describe("resolveClientDist", () => {
  it("prefers the installed package when it resolves and contains index.html", () => {
    installWebPackage();
    const resolved = resolveClientDist({ anchor: anchorDir, workspaceFallback: workspaceDist });
    expect(resolved).toEqual({ dir: installedDist, fromInstalledPackage: true });
  });

  it("falls back to the workspace sibling when the package does not resolve", () => {
    const resolved = resolveClientDist({ anchor: anchorDir, workspaceFallback: workspaceDist });
    expect(resolved).toEqual({ dir: workspaceDist, fromInstalledPackage: false });
  });

  it("falls back to the workspace sibling when the installed package has no dist", () => {
    const pkgDir = path.dirname(installedDist);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "@blackbelt-technology/pi-dashboard-web", version: "0.0.0" }),
    );
    const resolved = resolveClientDist({ anchor: anchorDir, workspaceFallback: workspaceDist });
    expect(resolved).toEqual({ dir: workspaceDist, fromInstalledPackage: false });
  });

  it("returns null (API-only) when neither location has a build", () => {
    fs.rmSync(path.join(workspaceDist, "index.html"));
    const resolved = resolveClientDist({ anchor: anchorDir, workspaceFallback: workspaceDist });
    expect(resolved).toEqual({ dir: null, fromInstalledPackage: false });
  });

  it("never throws on an anchor with no runnable module graph", () => {
    const resolved = resolveClientDist({
      anchor: path.join(root, "does", "not", "exist"),
      workspaceFallback: workspaceDist,
    });
    expect(resolved).toEqual({ dir: workspaceDist, fromInstalledPackage: false });
  });
});
