/**
 * Server-side entry point for dashboard-plugin-runtime.
 * Import from @blackbelt-technology/dashboard-plugin-runtime/server
 */

// dependency-graph is pure TS (no JSX/React). Re-export here so server-side
// callers can import it without pulling the React-y main barrel.
// See change: add-plugin-activation-ui (Layer 2 — dependency graph).
export * from "../dependency-graph.js";
export * from "./build-declaration-sdk.js";
// Served-artifact build declaration (emit at build time, read by the server).
// See change: optimize-client-bootstrap-and-bundle-coherence (P0).
export * from "./build-metadata.js";
export * from "./config-validator.js";
export * from "./loader.js";
export * from "./plugin-status-store.js";
export * from "./requirement-probes.js";
export * from "./server-context.js";
export * from "./service-probes/pi-model-proxy.js";
