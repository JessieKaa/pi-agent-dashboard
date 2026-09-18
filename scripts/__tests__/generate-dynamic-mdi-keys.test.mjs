/**
 * Generator contract tests for `generate-dynamic-mdi-keys.mjs` — drives the
 * exported pure fns directly (check-conventions.test.mjs style) so each rule
 * is pinned independently of the committed JSON's current contents.
 *
 * See change: trim-cold-start-transfer-and-config-fanout (②).
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildTable, harvestKeys } from "../generate-dynamic-mdi-keys.mjs";

const require = createRequire(import.meta.url);
const mdi = require("@mdi/js");

describe("harvestKeys", () => {
  it("extracts quoted mdi-prefixed keys, ignoring unquoted identifiers", () => {
    const src = [
      'import { mdiCheck } from "@mdi/js";',
      'const a = { icon: "mdiRefresh" }, b = { icon: "mdiContentSave" };',
      'resolveMdiIcon("mdiNotAReal");',
      'const t = `mdiTemplate`;',
    ].join("\n");
    expect([...harvestKeys(src)].sort()).toEqual(["mdiContentSave", "mdiNotAReal", "mdiRefresh"]);
  });

  it("ignores quoted strings that are not mdi-prefixed or not pascal-case", () => {
    const src = 'const a = "mdi"; const b = "mdilower"; const c = "notmdiCheck";';
    expect([...harvestKeys(src)]).toEqual([]);
  });
});

describe("buildTable", () => {
  it("unions existing and harvested keys into a sorted key→path table", () => {
    const table = buildTable({ mdiCheck: mdi.mdiCheck }, new Set(["mdiRefresh"]), mdi);
    expect(Object.keys(table)).toEqual(["mdiCheck", "mdiRefresh"]);
    expect(table.mdiCheck).toBe(mdi.mdiCheck);
    expect(table.mdiRefresh).toBe(mdi.mdiRefresh);
  });

  it("keeps hand-appended existing keys that the harvest no longer finds", () => {
    const table = buildTable({ mdiContentSave: mdi.mdiContentSave }, new Set(), mdi);
    expect(table.mdiContentSave).toBe(mdi.mdiContentSave);
  });

  it("fails loudly when a committed key vanishes from the installed @mdi/js", () => {
    expect(() =>
      buildTable({ mdiTotallyMadeUpName: "/some/old/path" }, new Set(), mdi),
    ).toThrow(/mdiTotallyMadeUpName/);
  });

  it("skips freshly harvested unresolvable keys (negative test fixtures)", () => {
    const table = buildTable({}, new Set(["mdiNotAReal", "mdiRefresh"]), mdi);
    expect(Object.keys(table)).toEqual(["mdiRefresh"]);
  });
});
