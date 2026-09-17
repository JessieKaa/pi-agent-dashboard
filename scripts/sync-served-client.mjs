/**
 * Deploy the freshly built workspace client to the static directory the
 * dashboard server actually SERVES, and verify both sides agree before the
 * caller is allowed to restart/reload anything.
 *
 * Why this exists: `npm run build` writes `packages/client/dist`, but the
 * server prefers the resolved `@blackbelt-technology/pi-dashboard-web/dist`
 * (installed-package-first). Without this sync step a rebuild silently fails
 * to reach the served artifact — the browser keeps loading the old bundle
 * while the server computes a new plugin-registry hash, so the staleness
 * banner never clears. See change:
 * optimize-client-bootstrap-and-bundle-coherence (P0 D2/D3).
 *
 * The web-package identity + declaration contract come from the runtime
 * package's `build-declaration-sdk.ts` / `build-metadata.ts` (loaded via
 * jiti) so the repo script and the installed server can never drift apart.
 *
 * Exported as a pure async function taking explicit paths — the CLI wrapper
 * at the bottom is the only piece that touches process.cwd() / global
 * package resolution.
 *
 * Usage:
 *   node scripts/sync-served-client.mjs            # build → sync → verify
 *   node scripts/sync-served-client.mjs --dry-run  # report the plan only
 *   node scripts/sync-served-client.mjs --build    # run `npm run build` first
 *   node scripts/sync-served-client.mjs --source <dir> --dest <dir>  # test hook
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

/**
 * The one dev server that may hold a live dependency on the served dist.
 * Deleting files inside a watched directory under a live Vite dev server
 * throws EBUSY-class errors on Windows, so a mismatch with a VITE dev
 * server on this port aborts with instructions instead of racing the
 * watcher. A non-Vite listener on the same port (other apps use 3000
 * constantly) is ignored — the probe below checks for the Vite client
 * marker, not mere liveness.
 */
export const DEV_SERVER_PORT = 3000;

const EXCLUDE_FROM_SYNC = new Set(["node_modules", ".vite", "AGENTS.md"]);
/** Root-level marker files whose presence means "not a client dist". */
const REFUSED_DEST_NAMES = new Set(["package.json", "src", "vite.config.ts"]);

async function loadContracts() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const [sdk, metadata] = await Promise.all([
    jiti.import(path.join(repoRoot, "packages/dashboard-plugin-runtime/src/server/build-declaration-sdk.ts")),
    jiti.import(path.join(repoRoot, "packages/dashboard-plugin-runtime/src/server/build-metadata.ts")),
  ]);
  return { repoRoot, sdk, metadata };
}

/** True when a VITE dev server answers on the port (client-marker probe). */
async function isViteDevServerUp(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    const body = await res.text();
    return body.includes("/@vite/client");
  } catch {
    return false;
  }
}

/** True when the directory is absent or empty (a safe sync destination). */
function isAbsentOrEmpty(dir) {
  if (!existsSync(dir)) return true;
  return readdirSync(dir).length === 0;
}

/** A declared dist must not look like a package source tree. */
function looksLikePackageSource(dir) {
  return readdirSync(dir).some((name) => REFUSED_DEST_NAMES.has(name));
}

/**
 * Copy `sourceDir` into `destDir` (replace semantics: absent/empty dirs are
 * filled, a declared dist is cleared first), then verify both sides carry the
 * SAME parsed declaration. Throws on any failure — the caller must not
 * restart when this rejects.
 */
export async function syncServedClient({ sourceDir, destDir, devServerPort = DEV_SERVER_PORT }) {
  const { metadata } = await loadContracts();
  const { BUILD_METADATA_FILENAME, readBuildMetadata } = metadata;

  const sourceDeclaration = readBuildMetadata(sourceDir);
  if (sourceDeclaration === null) {
    throw new Error(
      `source client build is missing a readable ${BUILD_METADATA_FILENAME} — build the workspace client first (npm run build)`,
    );
  }

  const wasAbsentOrEmpty = isAbsentOrEmpty(destDir);
  if (!wasAbsentOrEmpty && looksLikePackageSource(destDir)) {
    throw new Error(
      `refusing to sync into ${destDir}: it looks like a package source tree, not a build output`,
    );
  }

  if (!wasAbsentOrEmpty) {
    if (await isViteDevServerUp(devServerPort)) {
      throw new Error(
        `a Vite dev server is listening on port ${devServerPort} and may be watching ${destDir} — ` +
          `stop it before syncing the served client artifact`,
      );
    }
    rmSync(destDir, { recursive: true, force: true });
  }
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceDir, destDir, {
    recursive: true,
    filter: (src) => !EXCLUDE_FROM_SYNC.has(path.basename(src)),
  });

  const destDeclaration = readBuildMetadata(destDir);
  if (destDeclaration === null) {
    throw new Error(
      `sync verification failed: ${destDir} has no readable ${BUILD_METADATA_FILENAME} after copy`,
    );
  }
  if (
    destDeclaration.pluginRegistryHash !== sourceDeclaration.pluginRegistryHash ||
    destDeclaration.schemaVersion !== sourceDeclaration.schemaVersion
  ) {
    throw new Error(
      `sync verification failed: declaration hash mismatch (source=${sourceDeclaration.pluginRegistryHash} dest=${destDeclaration.pluginRegistryHash})`,
    );
  }
  return { declaration: destDeclaration, wasAbsentOrEmpty };
}

function parseArgs(argv) {
  const opts = { dryRun: false, build: false, source: null, dest: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--build") opts.build = true;
    else if (arg === "--source") opts.source = argv[++i];
    else if (arg === "--dest") opts.dest = argv[++i];
    else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

/** Realpath of the first `commandName` found on PATH, or null. */
function firstOnPath(commandName) {
  for (const entry of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    try {
      return realpathSync(path.join(entry, commandName));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Resolve the served destination through the GLOBAL `pi-dashboard` binary's
 * module graph — the identity a later `pi-dashboard restart` imports from,
 * and the same identity the server uses. Returns null (with an explanatory
 * line) for the workspace-only layout, which is an explicit no-op success.
 */
function resolveServedDest(repoRoot, sdk) {
  const binPath = firstOnPath("pi-dashboard");
  if (binPath === null) {
    console.log("served-client: no pi-dashboard binary on PATH — workspace-only layout; nothing to sync");
    return null;
  }
  const destDir = sdk.resolveInstalledWebDist(path.dirname(binPath), { requireBuilt: false });
  if (destDir === null) {
    console.log("served-client: no installed @blackbelt-technology/pi-dashboard-web — workspace-only layout; nothing to sync");
    return null;
  }
  // Guard against the repo's own bin dir (linked workspace): syncing the
  // workspace dist into the workspace web package is a no-op by definition.
  try {
    const destPkgDir = realpathSync(path.dirname(destDir));
    const webSrcDir = realpathSync(path.join(repoRoot, "packages", "client"));
    if (destPkgDir === webSrcDir) {
      console.log("served-client: resolved web package IS the workspace client — workspace-only layout; nothing to sync");
      return null;
    }
  } catch {
    // realpath failures fall through to the plain sync path
  }
  return destDir;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { repoRoot, sdk } = await loadContracts();
  const sourceDir = opts.source
    ? path.resolve(opts.source)
    : path.join(repoRoot, "packages", "client", "dist");
  const destDir = opts.dest ?? resolveServedDest(repoRoot, sdk);
  if (!destDir) return; // workspace-only layout (reason already printed)

  if (opts.build) {
    console.log("=== Building web client ===");
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  }

  console.log(`=== Syncing served client ===\n  source: ${sourceDir}\n  dest:   ${destDir}`);
  if (opts.dryRun) {
    console.log("dry-run: no files changed");
    return;
  }

  const { declaration, wasAbsentOrEmpty } = await syncServedClient({ sourceDir, destDir });
  console.log(
    `✓ served client synced (${wasAbsentOrEmpty ? "initial fill" : "replaced"}), pluginRegistryHash=${declaration.pluginRegistryHash}`,
  );
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
