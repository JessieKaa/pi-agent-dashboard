/**
 * Dynamic MDI key table — the generated JSON that lets `resolveMdiIcon` /
 * StatusPill / ActionList resolve quoted `"mdiX"` icon keys WITHOUT a
 * namespace import (`import * as mdi`) that would defeat tree-shaking of the
 * 2.8 MB `@mdi/js` module.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (②).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { resolveMdiIcon } from "../mdi-icon-lookup.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.resolve(here, "../../../../../shared/src/dynamic-mdi-keys.json");

describe("dynamic-mdi-keys.json", () => {
  it("exists and maps every key to the @mdi/js named export's value", () => {
    expect(fs.existsSync(jsonPath), `missing generated file: ${jsonPath}`).toBe(true);
    const map = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, string>;
    const mdi = require("@mdi/js") as Record<string, unknown>;
    const keys = Object.keys(map);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key, "keys are mdi-prefixed export names").toMatch(/^mdi[A-Z][A-Za-z0-9]*$/);
      expect(mdi[key], `${key} is not a named export of @mdi/js`).toBeDefined();
      expect(map[key]).toBe(mdi[key]);
    }
  });

  it("covers the quoted dynamic keys used by tests and fixtures", () => {
    const map = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, string>;
    for (const key of ["mdiCheck", "mdiDelete", "mdiRefresh", "mdiContentSave", "mdiTableLarge"]) {
      expect(map[key], `${key} must be present (fixture-declared dynamic key)`).toBeTruthy();
    }
  });
});

describe("resolveMdiIcon against the key table", () => {
  it("resolves a table key to its exact @mdi/js path", () => {
    const map = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, string>;
    expect(resolveMdiIcon("mdiCheck")).toBe(map.mdiCheck);
  });

  it("returns null for unknown, empty, and non-mdi keys (unchanged contract)", () => {
    expect(resolveMdiIcon("mdiTotallyMadeUpName")).toBeNull();
    expect(resolveMdiIcon("")).toBeNull();
    expect(resolveMdiIcon(undefined)).toBeNull();
    expect(resolveMdiIcon(null)).toBeNull();
    expect(resolveMdiIcon("checkCircle")).toBeNull();
  });
});
