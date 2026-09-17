/**
 * Build declaration for the served web-client artifact.
 *
 * A production client build writes `pi-dashboard-build.json` next to
 * `index.html`, recording the same deterministic plugin registry hash that is
 * embedded in the bundle as `PLUGIN_REGISTRY_HASH`. The dashboard server reads
 * this declaration from the static directory it actually serves and reports
 * whether it matches its runtime plugin set, closing the blind spot where a
 * freshly built workspace `dist` and the served installed-package `dist` drift
 * apart silently.
 *
 * Deterministic by construction: no timestamps, no paths, no environment data —
 * two builds over the same plugin set produce byte-identical files.
 *
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0).
 */
import fs from "node:fs";
import path from "node:path";

export const BUILD_METADATA_FILENAME = "pi-dashboard-build.json";
export const BUILD_METADATA_SCHEMA_VERSION = 1;

export interface BuildMetadata {
  schemaVersion: number;
  pluginRegistryHash: string;
}

/** Deterministic serialization (fixed key order, trailing newline). */
export function serializeBuildMetadata(pluginRegistryHash: string): string {
  const metadata: BuildMetadata = {
    schemaVersion: BUILD_METADATA_SCHEMA_VERSION,
    pluginRegistryHash,
  };
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

/**
 * Parse a declaration. Returns `null` for malformed JSON, a wrong schema
 * version, or a missing/blank hash — callers treat every failure uniformly as
 * "no usable declaration".
 */
export function parseBuildMetadata(raw: string): BuildMetadata | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== BUILD_METADATA_SCHEMA_VERSION) return null;
  if (typeof record.pluginRegistryHash !== "string" || record.pluginRegistryHash.trim() === "") {
    return null;
  }
  return {
    schemaVersion: BUILD_METADATA_SCHEMA_VERSION,
    pluginRegistryHash: record.pluginRegistryHash,
  };
}

/** Read a declaration from a build output directory; `null` when absent/unusable. */
export function readBuildMetadata(dirPath: string): BuildMetadata | null {
  try {
    return parseBuildMetadata(
      fs.readFileSync(path.join(dirPath, BUILD_METADATA_FILENAME), "utf8"),
    );
  } catch {
    return null;
  }
}
