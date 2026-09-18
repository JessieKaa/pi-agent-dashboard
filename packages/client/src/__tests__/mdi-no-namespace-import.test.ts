/**
 * Build tripwire: the three dynamic-icon resolvers must NOT namespace-import
 * `@mdi/js` (`import * as mdi`). A namespace import defeats Rollup
 * tree-shaking and re-inflates the eager `mdi` chunk to the full ~2.8 MB icon
 * set; the resolvers query the generated `dynamic-mdi-keys.json` table
 * instead. See change: trim-cold-start-transfer-and-config-fanout (②).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

const RESOLVER_FILES = [
  "packages/client/src/lib/preview/mdi-icon-lookup.ts",
  "packages/client-utils/src/StatusPill.tsx",
  "packages/client-utils/src/ActionList.tsx",
];

describe("@mdi/js namespace-import tripwire", () => {
  for (const rel of RESOLVER_FILES) {
    it(`${rel} does not namespace-import @mdi/js`, () => {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(src).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+["']@mdi\/js["']/);
    });
  }
});
