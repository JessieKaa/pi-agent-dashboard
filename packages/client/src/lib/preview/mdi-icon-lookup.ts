/**
 * MDI icon lookup helper for the Extension UI System (Phase 1).
 *
 * Extensions declare icons by MDI key string (e.g. `"mdiCheckCircle"`); the
 * dashboard resolves the key against the `@mdi/js` module exports at
 * runtime. Unknown keys render no icon — never an error — to keep the
 * surface XSS-safe and predictable. See change: add-extension-ui-modal,
 * design.md \u00a78.
 */
import dynamicMdiKeys from "@blackbelt-technology/pi-dashboard-shared/dynamic-mdi-keys.json";

// The generated dynamic-key table (union of every quoted "mdiX" literal in
// the repo + hand-appended keys). Replaces a former `import * as mdi` of the
// whole icon module, which defeated tree-shaking and shipped all ~7,000 icons
// in the eager bundle. See change: trim-cold-start-transfer-and-config-fanout (②).
const allowlist = dynamicMdiKeys as Record<string, string>;

/**
 * Resolve an MDI key string (e.g. `"mdiCheckCircle"`) to its SVG path,
 * or `null` if the key is missing, mistyped, or absent from the
 * dynamic-key table.
 *
 * Pure: no side effects, safe to call during render.
 */
export function resolveMdiIcon(key: string | undefined | null): string | null {
  if (!key || typeof key !== "string") return null;
  if (!key.startsWith("mdi")) return null;
  const path = Object.prototype.hasOwnProperty.call(allowlist, key) ? allowlist[key] : undefined;
  return typeof path === "string" && path.length > 0 ? path : null;
}
