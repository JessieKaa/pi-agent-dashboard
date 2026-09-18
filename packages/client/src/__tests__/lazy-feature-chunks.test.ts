/**
 * CI bootstrap guard for the lazily-loaded terminal + Diff feature chunks.
 *
 * Two layers:
 *  1. SOURCE tripwire (always runs): the files in `LAZY_READERS` must reach
 *     their feature module via a dynamic `import("...")`, never a static
 *     `from "..."`. A static edge silently re-pins the feature into the
 *     landing graph while every runtime test stays green.
 *  2. BUILD assertions (skipped when no `dist`): the built output must EMIT
 *     the `xterm` and `git-diff-view` vendor chunks, the cold `index.html`
 *     must NOT modulepreload either one, and the served-build declaration
 *     must agree with the embedded `PLUGIN_REGISTRY_HASH` in the entry chunk
 *     actually referenced by `index.html`. Renames/merges fail loudly instead
 *     of silently disabling the guard, mirroring `monaco-chunk-size.test.ts`.
 *
 * See change: optimize-client-bootstrap-and-bundle-coherence (P1).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLUGIN_REGISTRY_HASH } from "../generated/plugin-registry.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "../..");
const distDir = path.resolve(clientRoot, "dist");
const assetsDir = path.join(distDir, "assets");
const indexHtmlPath = path.join(distDir, "index.html");

/** Vendor chunks that must stay lazy: `[manualChunkName, why]`. */
const LAZY_VENDOR_CHUNKS: Array<[name: string, why: string]> = [
  ["xterm", "terminal layer (EditorPane lazy boundary + InlineTerminalCard)"],
  ["git-diff-view", "Diff route/tab + EditToolRenderer RichDiff lazy boundaries"],
  ["markdown", "markdown payload (LazyMarkdownContent boundary)"],
];

/** Files that must keep their dynamic import of the feature module. */
const LAZY_READERS: Array<[file: string, specifier: string]> = [
  ["src/components/editor-pane/EditorPane.tsx", "./TerminalPaneLayer.js"],
  ["src/components/chat/ChatView.tsx", "../terminal/InlineTerminalCard.js"],
  ["src/App.tsx", "./components/diff/FileDiffView.js"],
  ["src/components/editor-pane/pseudo-tab-registry.tsx", "./DiffViewer.js"],
  ["src/components/tool-renderers/EditToolRenderer.tsx", "../diff/RichDiff.js"],
  // Payload-family boundaries (change: trim-cold-start-transfer-and-config-fanout ③).
  ["src/components/preview/LazyMarkdownContent.tsx", "./MarkdownContent.js"],
  ["src/components/interactive-renderers/LazyInteractiveRenderer.tsx", "./registry.js"],
  ["src/components/tool-renderers/LazyToolRenderer.tsx", "./index.js"],
];

/** Payload chunks that must stay lazy: `[manualChunkName, emitted]`. */
const LAZY_PAYLOAD_CHUNKS: Array<[name: string, emitted: boolean]> = [
  ["markdown", true],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("lazy feature chunks — source tripwire", () => {
  it.each(LAZY_READERS)("%s imports %s dynamically, not statically", (file, specifier) => {
    const source = readFileSync(path.join(clientRoot, file), "utf8");
    const spec = escapeRegExp(specifier);
    if (!new RegExp(`import\\(\\s*"${spec}"\\s*\\)`).test(source)) {
      expect.fail(
        `${file} no longer dynamically imports "${specifier}" — the lazy boundary moved or was removed.`,
      );
    }
    if (new RegExp(`^import[^\\n]*from "${spec}"`, "m").test(source)) {
      expect.fail(
        `${file} statically imports "${specifier}" — this re-pins the feature into the landing bundle. Use React.lazy(() => import("${specifier}")) instead.`,
      );
    }
  });
});

describe("lazy feature chunks — built output", () => {
  it("emits the feature vendor chunks and keeps them out of the cold preload graph", () => {
    if (!existsSync(assetsDir)) {
      // No build output — the source tripwire above still ran. CI builds first.
      return;
    }
    const html = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, "utf8") : null;
    expect(html, "dist/assets exists but dist/index.html is missing").not.toBeNull();

    for (const [name, why] of LAZY_VENDOR_CHUNKS) {
      const chunks = readdirSync(assetsDir).filter(
        (f) => f.startsWith(`${name}-`) && f.endsWith(".js"),
      );
      if (chunks.length === 0) {
        expect.fail(
          `dist/assets exists but no ${name} chunk was emitted — the lazy chunk was renamed or merged into another asset, which would break the ${why}.`,
        );
      }
      expect(
        html,
        `cold index.html preloads a ${name} chunk — the feature re-entered the landing graph.`,
      ).not.toContain(`/assets/${name}-`);
    }

    for (const [name] of LAZY_PAYLOAD_CHUNKS) {
      const chunks = readdirSync(assetsDir).filter(
        (f) => f.startsWith(`${name}-`) && f.endsWith(".js"),
      );
      if (chunks.length === 0) {
        expect.fail(
          `dist/assets exists but no ${name} chunk was emitted — the payload chunk was renamed or merged into another asset.`,
        );
      }
      expect(
        html,
        `cold index.html preloads the ${name} chunk — the payload re-entered the landing preload graph.`,
      ).not.toContain(`/assets/${name}-`);
    }
  });

  it("declaration hash agrees with the embedded registry hash of the served entry", () => {
    if (!existsSync(assetsDir)) return;
    const declaration = JSON.parse(
      readFileSync(path.join(distDir, "pi-dashboard-build.json"), "utf8"),
    ) as { schemaVersion: number; pluginRegistryHash: string };
    expect(declaration.schemaVersion).toBe(1);
    expect(
      declaration.pluginRegistryHash,
      "served-build declaration disagrees with the freshly generated registry — rebuild the client (npm run build).",
    ).toBe(PLUGIN_REGISTRY_HASH);

    const html = readFileSync(indexHtmlPath, "utf8");
    const entryMatch = html.match(/<script type="module"[^>]*src="([^"]+)"/);
    expect(entryMatch, "dist/index.html has no module entry script").not.toBeNull();
    const entryFile = path.join(distDir, entryMatch?.[1]?.replace(/^\//, "") ?? "");
    const entrySource = readFileSync(entryFile, "utf8");
    expect(
      entrySource,
      "the entry chunk referenced by index.html does not embed PLUGIN_REGISTRY_HASH.",
    ).toContain(PLUGIN_REGISTRY_HASH);
  });
});
