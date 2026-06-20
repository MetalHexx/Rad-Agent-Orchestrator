# telemetry

Dependency-free, harness-neutral engine that captures token-usage telemetry from agent transcripts and serves it to the observability dashboard. Node built-ins only — it runs inside a hard-timeout-bounded hook spawn, so it must never acquire a third-party runtime dependency.

## Capture pipeline (write)

1. **Hook trigger.** A harness hook ([`../../harness-installers/shared/hooks/telemetry-capture.mjs`](../../harness-installers/shared/hooks/telemetry-capture.mjs)) fires on `PostToolUse` / `Stop` / `SessionEnd` — gated **default-off** — and invokes the CLI `telemetry capture` with the `session_id`, `transcript_path`, and any subagent identity.
2. **Collector.** `TelemetryCollector.capture` (`src/collector.ts`) locks the session, loads the `seen` checkpoint, runs the adapter, writes results to the sink, then commits the union of `seen` + newly written ids. Lock contention returns `{ locked: true }` and writes nothing.
3. **Adapter.** `ClaudeCodeAdapter` (`src/adapter/claude-code-adapter.ts`) reads the main transcript plus sibling `…/<session>/subagents/agent-<id>.jsonl` (parsing in `src/adapter/transcript.ts`), emits **one `TelemetryRecord` per assistant API request** — deduped by `requestId` (last-wins, so streaming partials collapse) — mapping the four `usage.*` token classes and tagging `source: 'main-agent' | 'subagent'`. The main sweep skips `isSidechain` lines; subagent transcripts are read separately.
4. **Sink.** `NdjsonSink` (`src/sink/ndjson-sink.ts`) appends each record as one JSON line to `<root>/usage/usage-<YYYY-MM-DD>-<sessionId>.ndjson`.

## On-disk store

`root = $RADORC_TELEMETRY_ROOT ?? ~/.radorc/telemetry`

| Path | Contents |
|------|----------|
| `usage/usage-<day>-<sessionId>.ndjson` | One `TelemetryRecord` per assistant request; partitioned by UTC day + session |
| `checkpoints/<sessionId>.json` | The per-session `seen` requestId set + lock (`FileCheckpointStore`) |

`pruneAgedPartitions({ root, maxAgeDays, now })` (`src/retention.ts`) deletes usage partitions older than the cutoff and any checkpoint whose session has no surviving partition.

## Read path

- `readUsageForDates({ root, dates })` (`src/read/usage-reader.ts`) loads the requested day partitions and **dedups by `sessionId\x00usageId` (last-wins)**, so a record re-written across partitions or re-captured collapses to one.
- `toObservabilityUsageRow` (`src/read/observability-row.ts`) narrows a `TelemetryRecord` to the UI row shape (`ObservabilityUsageRow`).
- The dashboard API ([`../../ui/app/api/observability/usage/route.ts`](../../ui/app/api/observability/usage/route.ts)) is the only consumer; the **cost weighting** (`effectiveTokens`) and session aggregation live in the UI ([`../../ui/lib/observability/`](../../ui/lib/observability/)), **not here** — this library stays a neutral capture/store engine.

**Dedup is layered on `requestId` (= `usageId`) at three points** — capture `byKey`, checkpoint `seen`, and read `sessionId\x00usageId` — so a per-request double-count is well-defended (verified; see the audit below).

## Seam rules

- **Consumed only through `src/index.ts`** — never import `sink/*`, `read/*`, `adapter/*`, `collector.js`, or `checkpoint/*` from outside this library. Tests inside the library may import internals by their direct module path.
- **Path-injected.** Every entry point takes a `root` (or explicit file paths); no global `~/.radorc` lookups inside the module — the hook, CLI, and route supply the path.
- **Dependency-free runtime.** Built-ins only; keep it that way so the capture spawn stays fast and safe to kill.
- **`schemaVersion` is the record discriminant.** Bump `SCHEMA_VERSION` (`src/types.ts`) on any breaking `TelemetryRecord` change; readers tolerate unknown extra fields.

## Public API (the `src/index.ts` barrel)

```
import {
  // types (TelemetryRecord, HookEvent, HarnessAdapter, TelemetrySink, CheckpointStore, …)
  ClaudeCodeAdapter, subagentPathFor,
  TelemetryCollector, type CaptureResult,
  NdjsonSink, FileCheckpointStore,
  pruneAgedPartitions,
  readUsageForDates, type ReadUsageOptions,
  toObservabilityUsageRow, type ObservabilityUsageRow,
} from '@rad-orchestration/telemetry';
```

| Export | Role |
|--------|------|
| `TelemetryRecord` / `HookEvent` / `*` types | The captured-record shape + adapter/sink/checkpoint interfaces (`src/types.ts`); `SCHEMA_VERSION` |
| `ClaudeCodeAdapter` | Harness adapter: transcript(s) → `TelemetryRecord[]` |
| `subagentPathFor` | Resolves the deterministic subagent-transcript sibling of a session path |
| `TelemetryCollector` | Orchestrates lock → seen → capture → sink → commit |
| `NdjsonSink` | Append-only NDJSON writer, partitioned by day + session |
| `FileCheckpointStore` | `seen` / `commit` / `tryLock` / `unlock` over `checkpoints/` |
| `pruneAgedPartitions` | Retention sweep for aged usage partitions + orphan checkpoints |
| `readUsageForDates` | Reads + dedups day partitions for the dashboard |
| `toObservabilityUsageRow` | Narrows a record to the UI row shape |

## Scripts / tooling

### `scripts/audit-session.mjs` — three-way token reconciliation

A **read-only** diagnostic (Node built-ins only) that validates the whole chain for a single session: it re-parses the raw Claude Code transcript **independently** (not via the adapter) for ground truth, reads our NDJSON store, and applies an exact mirror of the UI's `effectiveTokens` plus the published per-model pricing table. It reports capture parity (requestId set diff + per-field mismatches), raw-vs-effective-vs-`$`, and a per-model `effective × base_rate` identity check.

```
node lib/telemetry/scripts/audit-session.mjs --list                 # auditable sessions (in store AND transcript)
node lib/telemetry/scripts/audit-session.mjs --session <id-or-prefix>
#   [--root <telemetryRoot>] [--projects <claudeProjectsDir>]
```

Use it whenever the dashboard's spend numbers look wrong, after touching the adapter/sink/reader, or to confirm capture fidelity on a new harness/Claude Code version. The pricing tables, accounting semantics, the `effectiveTokens` derivation, and the methodology behind this script are documented in [`../../docs/research/token-spend-and-cost-accounting.md`](../../docs/research/token-spend-and-cost-accounting.md). The script mirrors `effectiveTokens` ([`../../ui/lib/observability/effective-tokens.ts`](../../ui/lib/observability/effective-tokens.ts)) and the read-dedup intentionally, so it stays a self-contained oracle rather than re-running the code it audits.

## Build and distribution

```
npm run build
```

Runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` plus `.d.ts` declarations for every public export. The `package.json` `exports` map resolves `@rad-orchestration/telemetry` to `dist/index.js` (runtime) and `dist/index.d.ts` (types).

**Workspace consumption.** The root `package.json` declares this package as a workspace entry (`lib/telemetry`). After a root `npm install`, npm symlinks `node_modules/@rad-orchestration/telemetry` here. Consumers — the CLI (`cli/`) and the UI (`ui/`) — import by name and resolve against the compiled `dist/`; neither imports raw source. (The `scripts/` tooling is **not** part of the published surface — it's run directly with `node`.)

## Running tests

```
npm test
```

Runs the vitest suites in `tests/` — adapter, transcript parsing, collector/checkpoint, sink, usage-reader (incl. dedup / resilience / collision), observability-row, and retention.
