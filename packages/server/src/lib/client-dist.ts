/**
 * Serve-side identity of the built web client.
 *
 * One resolver, one served directory: the directory returned here is the one
 * Fastify serves AND the one `/api/health.clientBuild` reports on, so the
 * reported artifact can never diverge from the served artifact. Resolution
 * order is installed-package-first (module resolution of
 * `@blackbelt-technology/pi-dashboard-web/package.json`, sibling `dist`) with
 * the workspace sibling `packages/client/dist` as fallback when the web
 * package has not been linked (checked-out dev workspace).
 *
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0).
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolvedClientDist {
  /** Absolute path to the directory to serve, or `null` (API-only mode). */
  dir: string | null;
  /**
   * Whether the installed `@blackbelt-technology/pi-dashboard-web` package
   * supplied the directory (`false` also covers API-only mode). Decides which
   * side of the workspace/dev split a rebuild should synchronize into.
   */
  fromInstalledPackage: boolean;
}

export interface ResolveClientDistOptions {
  /**
   * Directory whose module graph anchors the package resolution (a real
   * descendant file is synthesized under it). Defaults to this module's dir.
   */
  anchor?: string;
  /** Workspace-sibling `dist` fallback. Defaults to `../../client/dist`. */
  workspaceFallback?: string;
}

/**
 * Resolve the client static directory. Never throws: any resolution failure
 * degrades to the workspace fallback, then to `null` (API-only mode).
 */
export function resolveClientDist(opts?: ResolveClientDistOptions): ResolvedClientDist {
  const anchor = path.join(opts?.anchor ?? path.dirname(fileURLToPath(import.meta.url)), "__client_dist_anchor__.js");
  const workspaceFallback = opts?.workspaceFallback
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");
  try {
    const webPkgJson = createRequire(anchor).resolve(
      "@blackbelt-technology/pi-dashboard-web/package.json",
    );
    const candidate = path.join(path.dirname(webPkgJson), "dist");
    if (existsSync(path.join(candidate, "index.html"))) {
      return { dir: candidate, fromInstalledPackage: true };
    }
  } catch {
    // Web package not resolvable — fall through to the workspace sibling.
  }
  if (existsSync(path.join(workspaceFallback, "index.html"))) {
    return { dir: workspaceFallback, fromInstalledPackage: false };
  }
  return { dir: null, fromInstalledPackage: false };
}
