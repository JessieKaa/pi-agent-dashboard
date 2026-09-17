/**
 * Deterministic build-declaration contract for the served client artifact.
 * See change: optimize-client-bootstrap-and-bundle-coherence (P0).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_METADATA_FILENAME,
  BUILD_METADATA_SCHEMA_VERSION,
  parseBuildMetadata,
  readBuildMetadata,
  serializeBuildMetadata,
} from "../server/build-metadata.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe("serializeBuildMetadata / parseBuildMetadata", () => {
  it("round-trips a hash", () => {
    const raw = serializeBuildMetadata(HASH_A);
    expect(parseBuildMetadata(raw)).toEqual({
      schemaVersion: BUILD_METADATA_SCHEMA_VERSION,
      pluginRegistryHash: HASH_A,
    });
  });

  it("serializes identically for identical input (deterministic)", () => {
    expect(serializeBuildMetadata(HASH_A)).toEqual(serializeBuildMetadata(HASH_A));
  });

  it("carries no timestamp and no absolute path", () => {
    const raw = serializeBuildMetadata(HASH_A);
    expect(raw).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(raw).not.toMatch(/(^|["\s:])\/(?!\/)/);
    expect(raw).not.toMatch(/[A-Za-z]:\\/);
  });

  it("returns null for malformed JSON", () => {
    expect(parseBuildMetadata("{ not json")).toBeNull();
  });

  it("returns null for a wrong schema version", () => {
    expect(
      parseBuildMetadata(JSON.stringify({ schemaVersion: 99, pluginRegistryHash: HASH_A })),
    ).toBeNull();
  });

  it("returns null for a missing or non-string hash", () => {
    expect(parseBuildMetadata(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
    expect(
      parseBuildMetadata(JSON.stringify({ schemaVersion: 1, pluginRegistryHash: 42 })),
    ).toBeNull();
    expect(
      parseBuildMetadata(JSON.stringify({ schemaVersion: 1, pluginRegistryHash: "  " })),
    ).toBeNull();
  });

  it("returns null for a JSON non-object", () => {
    expect(parseBuildMetadata("null")).toBeNull();
    expect(parseBuildMetadata('"hash"')).toBeNull();
    expect(parseBuildMetadata("[]")).toBeNull();
  });
});

describe("readBuildMetadata", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "build-metadata-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a valid declaration from disk", () => {
    writeFileSync(
      path.join(dir, BUILD_METADATA_FILENAME),
      serializeBuildMetadata(HASH_B),
      "utf8",
    );
    expect(readBuildMetadata(dir)).toEqual({
      schemaVersion: BUILD_METADATA_SCHEMA_VERSION,
      pluginRegistryHash: HASH_B,
    });
  });

  it("returns null when the file is absent", () => {
    expect(readBuildMetadata(dir)).toBeNull();
  });

  it("returns null when the file is malformed", () => {
    writeFileSync(path.join(dir, BUILD_METADATA_FILENAME), "not json", "utf8");
    expect(readBuildMetadata(dir)).toBeNull();
  });
});
