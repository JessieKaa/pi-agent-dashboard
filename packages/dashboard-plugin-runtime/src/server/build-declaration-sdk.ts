/**
 * Read-side half of the served-client build declaration
 * (`pi-dashboard-build.json`, see `build-metadata.ts`).
 *
 * Lives in the runtime package (beside the declaration's schema and its
 * build-time writer) so the sync script in THIS repo and the installed
 * dashboard server share one identity contract for locating the
 * `@blackbelt-technology/pi-dashboard-web` dist directory: module resolution
 * of the web package's `package.json`, sibling `dist`. The runtime package
 * must never depend on the server package (the dependency runs the other
 * way), which is why this resolver is not the server's `lib/client-dist.ts` —
 * that one adds the workspace fallback used at serve time.
 *
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0).
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { BUILD_METADATA_FILENAME } from "./build-metadata.js";

/**
 * Resolve the installed `@blackbelt-technology/pi-dashboard-web` dist
 * directory anchored at a directory inside the consuming project
 * (a package root, `scripts/`, or any nested dir). Returns `null` when the
 * package does not resolve, or — with `requireBuilt` (default) — when its
 * `dist/index.html` is missing. Pass `requireBuilt: false` from build
 * tooling that wants the destination path even before the first build.
 */
export function resolveInstalledWebDist(
  anchorDir: string,
  opts?: { requireBuilt?: boolean },
): string | null {
  const anchorFile = path.join(anchorDir, "__pi_dashboard_anchor__.js");
  try {
    const webPkgJson = createRequire(anchorFile).resolve(
      "@blackbelt-technology/pi-dashboard-web/package.json",
    );
    const candidate = path.join(path.dirname(webPkgJson), "dist");
    if (opts?.requireBuilt === false) return candidate;
    return existsSync(path.join(candidate, "index.html")) ? candidate : null;
  } catch {
    return null;
  }
}

/** Raw contents of a directory's declaration file, or `null` when absent/unreadable. */
export function readBuildDeclarationRaw(dirPath: string): string | null {
  try {
    return readFileSync(path.join(dirPath, BUILD_METADATA_FILENAME), "utf8");
  } catch {
    return null;
  }
}
