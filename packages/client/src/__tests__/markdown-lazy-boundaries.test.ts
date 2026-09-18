/**
 * Source tripwire for the markdown lazy boundaries.
 *
 * The markdown payload (react-markdown + plugin stack + syntax highlighter,
 * ~1 MB / 331 KB gz) must leave the landing graph: the only entry points are
 * three React.lazy hosts (LazyMarkdownContent, LazyInteractiveRenderer,
 * LazyToolRenderer) plus the overlay lazies in FilePreviewContext/FileLink.
 * A static import re-pins the payload into the eager bundle while every
 * runtime test stays green, so each edge is pinned here.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (③).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = path.resolve(here, "..");
const repoRoot = path.resolve(clientSrc, "../..");

function readClient(rel: string): string {
  return fs.readFileSync(path.join(clientSrc, rel), "utf8");
}

/** Files allowed to statically import the heavy markdown stack (the payload). */
const PAYLOAD_IMPORTER_ALLOWLIST = [
  "components/preview/MarkdownContent.tsx",
  "components/interactive-renderers/InlineMarkdown.tsx",
  "components/preview/FilePreviewOverlay.tsx",
  "components/tool-renderers/ReadToolRenderer.tsx",
  "components/tool-renderers/WriteToolRenderer.tsx",
  "components/tool-renderers/CtxToolRenderer.tsx",
  "components/diff/DiffPanel.tsx",
  "lib/theme/syntax-theme.ts",
];

const HEAVY_SPECIFIERS = [
  "react-markdown",
  "react-syntax-highlighter",
  "remark-gfm",
  "rehype-raw",
];

function importersOfClientSource(specifierRegex: RegExp): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
      const src = fs.readFileSync(full, "utf8");
      if (/^import[^\n]*from "((?:react-markdown|react-syntax-highlighter|remark-gfm|rehype-raw))"/m.test(src)) {
        hits.push(path.relative(clientSrc, full));
      }
    }
  };
  walk(clientSrc);
  return hits.sort();
}

describe("markdown payload stays behind lazy boundaries", () => {
  it("only allowlisted payload modules import the heavy markdown stack statically", () => {
    const offenders = importersOfClientSource(
      /(react-markdown|react-syntax-highlighter|remark-gfm|rehype-raw)/,
    ).filter((rel) => !PAYLOAD_IMPORTER_ALLOWLIST.includes(rel));
    expect(
      offenders,
      `statically imports a heavy markdown specifier (${HEAVY_SPECIFIERS.join(", ")}) outside the lazy payload: ` +
        "route it through LazyMarkdownContent / LazyInteractiveRenderer / LazyToolRenderer instead.",
    ).toEqual([]);
  });

  it("MarkdownContent is reached only via its lazy wrapper's dynamic import", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const src = fs.readFileSync(full, "utf8");
        if (/import \{[^}]*\bMarkdownContent\b[^}]*\} from "(?!.*LazyMarkdownContent).*MarkdownContent\.js"/.test(src)) {
          hits.push(path.relative(clientSrc, full));
        }
      }
    };
    walk(clientSrc);
    // Static importers: none (the impl itself has no self-import). The one
    // legitimate edge is the wrapper's dynamic import below.
    expect(hits.sort()).toEqual([]);
    const wrapper = readClient("components/preview/LazyMarkdownContent.tsx");
    expect(wrapper).toMatch(/import\(\s*"\.\/MarkdownContent\.js"\s*\)/);
  });

  it("the interactive-renderer registry is reached only via its lazy host", () => {
    const src = readClient("components/chat/ChatView.tsx");
    expect(src).not.toMatch(/import[^\n]*from "\.\.\/interactive-renderers\/registry\.js"/);
    const multiAsk = readClient("components/chat/MultiAskPanel.tsx");
    expect(multiAsk).not.toMatch(/import[^\n]*from "\.\.\/interactive-renderers\/registry\.js"/);
  });

  it("the tool-renderer registry is reached at render time only via its lazy host", () => {
    const src = readClient("components/chat/ToolCallStep.tsx");
    expect(src).not.toMatch(/import[^\n]*getToolRenderer[^\n]*from "\.\.\/tool-renderers\/index\.js"/);
    expect(src).toMatch(/LazyToolRenderer/); // the render site routes through the lazy host
  });
});
