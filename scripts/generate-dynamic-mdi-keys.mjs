/**
 * Generate packages/shared/src/dynamic-mdi-keys.json — the key-to-path table
 * that lets dynamic icon resolvers (mdi-icon-lookup, StatusPill, ActionList)
 * answer "mdiX" string lookups WITHOUT a namespace import of the @mdi/js
 * package (which defeats tree-shaking and ships all ~7,000 icons).
 *
 * Harvest rule: every quoted "mdiX" string literal in packages source and
 * test files is a candidate dynamic key. Union-merged into the existing JSON
 * so hand-appended keys survive regeneration; every harvested key is
 * validated against the installed @mdi/js and a stale key fails loudly
 * instead of shipping a broken table.
 *
 * Run: node scripts/generate-dynamic-mdi-keys.mjs
 * See change: trim-cold-start-transfer-and-config-fanout (②).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = process.env.PI_DASHBOARD_REPO_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_REL = "packages/shared/src/dynamic-mdi-keys.json";
const KEY_RE = /"mdi([A-Z][A-Za-z0-9]*)"/g;

// The mdi-chunk-size guard's marker constant is a quoted mdi literal but is
// NOT a dynamic key — and it must never enter any shipped bundle, because the
// guard asserts the eager entry chunk does not contain this string.
const EXCLUDED_KEYS = new Set(["mdiZodiacAquarius"]);

/** Directories scanned for quoted dynamic keys (index.ts(x) files included). */
function candidateFiles(root) {
  const out = [];
  const packagesDir = path.join(root, "packages");
  for (const pkg of fs.readdirSync(packagesDir)) {
    const src = path.join(packagesDir, pkg, "src");
    if (!fs.existsSync(src)) continue;
    walk(src, out);
  }
  return out;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/** Extract every quoted "mdiX" key from one file's source. */
export function harvestKeys(source) {
  const keys = new Set();
  for (const m of source.matchAll(KEY_RE)) keys.add(`mdi${m[1]}`);
  return keys;
}

/**
 * Union the harvested keys (plus any existing JSON keys) into a table of
 * key → @mdi/js path.
 *
 * Validation split: a key ALREADY committed to the JSON that no longer
 * resolves means real version drift (an @mdi/js rename) — throw loudly. A
 * freshly harvested key that does not resolve is a negative test fixture or
 * doc example (deliberately-unresolvable keys assert the null contract), so
 * it is skipped.
 */
export function buildTable(existing, harvested, mdi) {
  const resolvable = (key) => typeof mdi[key] === "string" && mdi[key].length > 0;
  const stale = Object.keys(existing).filter((key) => !resolvable(key));
  if (stale.length > 0) {
    throw new Error(
      `committed dynamic MDI keys no longer exist in installed @mdi/js (rename or bump the dep, then rerun): ${stale.join(", ")}`,
    );
  }
  const table = {};
  for (const key of [...new Set([...Object.keys(existing), ...harvested])].sort()) {
    if (EXCLUDED_KEYS.has(key)) continue;
    if (resolvable(key)) table[key] = mdi[key];
  }
  return table;
}

function main() {
  const mdi = require("@mdi/js");
  const outPath = path.join(ROOT, OUT_REL);
  const existing = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, "utf8"))
    : {};

  const harvested = new Set();
  for (const file of candidateFiles(ROOT)) {
    for (const key of harvestKeys(fs.readFileSync(file, "utf8"))) harvested.add(key);
  }

  const table = buildTable(existing, harvested, mdi);
  const serialized = `${JSON.stringify(table, null, 2)}\n`;
  const before = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  fs.writeFileSync(outPath, serialized);
  const added = Object.keys(table).length - Object.keys(existing).length;
  console.log(
    `[dynamic-mdi-keys] ${Object.keys(table).length} keys (+${added}) → ${OUT_REL}${before === serialized ? " (unchanged)" : ""}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
