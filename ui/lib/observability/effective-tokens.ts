/**
 * Re-exported from the telemetry library — the single source of truth for spend weighting (AD-4).
 * Imported from the package's client-safe leaf subpath rather than the barrel so the server-only
 * modules behind the barrel (e.g. retention.js's `node:path`) never reach the browser bundle.
 */
export { effectiveTokens } from "@rad-orchestration/telemetry/read/effective-tokens";
