# `lib/telemetry/`

Dependency-free, harness-neutral engine that captures token-usage telemetry from agent transcripts,
ingests the transcripts themselves, and serves both to the CLI and the dashboard. It is a leaf: it
depends on no other workspace package, and both `cli/` and `ui/` consume it by name.

## How it works

The areas, each consumed only through the `src/index.ts` barrel:

- **Capture (write)** — `adapter/` parses a harness transcript into `TelemetryRecord`s;
  `collector.ts` orchestrates lock → `seen` → capture → sink → commit; `sink/` appends NDJSON;
  `checkpoint/` holds the per-session `seen` set and the lock.
- **Usage read** — `read/usage-reader.ts` loads and dedups day partitions, `read/observability-row.ts`
  narrows to the UI row shape, `read/effective-tokens.ts` + `read/pricing.ts` carry the cost
  weighting and the published rate table, and `read/active-time.ts` derives elapsed active time from
  request timestamps.
- **Transcripts** — `transcript-parser.ts`, `transcript-model.ts`, and `transcript-tree.ts` parse and
  shape a transcript; `transcript-ingestor.ts` writes the durable copy; `read/transcript-reader.ts`
  reads it back per agent.
- **Session bookkeeping** — `saved-sessions.ts` (the starred-session index) and `project-index.ts`
  (session → project, the map that keeps an attributed session's telemetry alive through retention).
- **Retention** — `retention.ts` sweeps aged usage partitions and everything orphaned by them.

**The barrel is the list of what is public.** Do not restate the export set here; read
`src/index.ts`. Anything not exported there is internal, whatever its path suggests.

### The capture trigger

A harness hook (`harness-installers/shared/hooks/telemetry-capture.mjs`) fires on `PostToolUse`,
`Stop`, and `SessionEnd`, gated **default-off**, and invokes `radorch telemetry capture`.
`PostToolUse` fires on **every** tool, not just subagent completions, so main-agent spend is
harvested mid-turn rather than only at `Stop` — a regular tool's fire carries no token data itself
and is only a cheap trigger to re-sweep the transcript. To keep that fire rate off the agent's
critical path, capture is **non-blocking**: `PostToolUse` and `Stop` detach a background worker,
while `SessionEnd` runs inline so the final flush completes before the session process exits.

## On-disk store

**This library never resolves the root itself** — every entry point takes it as a parameter, which
is what keeps the module home-directory-blind (see the convention below). Callers resolve it as
`$RADORC_TELEMETRY_ROOT ?? ~/.radorc/telemetry`; `ui/lib/path-resolver.ts#getTelemetryRoot` is the
reference. The layout that root contains:

| Path | Contents |
|---|---|
| `usage/usage-<day>-<sessionId>.ndjson` | One `TelemetryRecord` per assistant request, partitioned by UTC day and session |
| `transcripts/<sessionId>/` | The durable ingested transcript, one file per agent |
| `checkpoints/<sessionId>.json` | The per-session `seen` requestId set, and the lock |
| `.saved-sessions.json` | The starred-session index |
| `.project-sessions-index.json` | `sessionId → project`, read on every capture for retention exemption |

## Conventions

- **Consumed only through `src/index.ts`.** Never import `sink/*`, `read/*`, `adapter/*`,
  `collector.js`, or `checkpoint/*` from outside this library. Tests inside the library may import
  internals directly.
- **Path-injected.** Every entry point takes a `root`, or explicit file paths. **No global
  `~/.radorc` lookup ever happens inside this module** — the hook, the CLI, and the route supply it.
  This is what makes the library testable against a temp root.
- **Dependency-free runtime.** Node built-ins only. It runs inside a hook-triggered spawn that must
  stay fast and safe to kill, so it must never acquire a third-party runtime dependency.
- **`schemaVersion` is the record discriminant.** Bump `SCHEMA_VERSION` in `src/types.ts` on any
  breaking `TelemetryRecord` change. Readers tolerate unknown extra fields; they do not tolerate a
  field whose meaning changed underneath them.
- **An absent or malformed index reads as a valid empty index.** `readSavedIndex` and
  `readProjectIndex` never throw. Capture runs on a hook — a throw here degrades a user's session.

## Hazards

### Nothing here may write to stdout

Anything this package prints on stdout corrupts the `radorch` envelope, and nothing here will catch
it — send diagnostics to stderr. Detail:
[`AGENTS.md`](../../AGENTS.md#stdout-is-the-envelope-channel)

### Adding a path to the store means teaching retention about it

`pruneAgedPartitions` keys off surviving **usage** partitions: a checkpoint or a
`transcripts/<sessionId>/` directory whose session has no surviving partition is an orphan and is
removed. A new store path that retention does not know about accumulates forever on the user's
disk, and nothing will report it.

The inverse is the coupling that matters: `cli/src/commands/telemetry/capture.ts` reads
`.project-sessions-index.json` on **every** capture and passes each listed session as
`exemptSessionIds`, which is what keeps a project-attributed session's usage *and* its transcript
alive past the retention window. Weaken that exemption and session tracking silently loses history.

### Cost weighting lives here now

`effectiveTokens` and the pricing table are exports of this library, not of the dashboard. Older
notes claiming the weighting lives in `ui/` are wrong. `scripts/audit-session.mjs` deliberately
mirrors the derivation rather than calling it, so it stays an independent oracle — if you change
the weighting, change the mirror too or the audit silently stops being a check.

### Dedup is layered, and each layer matters

The same `requestId` is deduped at capture (`byKey`), at the checkpoint (`seen`), and at read
(`sessionId\x00usageId`, last-wins). Concurrent background workers serialize on the per-session
lock, so only new ids are ever written. Removing any one layer looks harmless in a single-session
test and double-counts in the field.

## When a change here ripples

- **Changed a public export, or the `TelemetryRecord` shape?** `cli/` and `ui/` both import this
  package **by name** and resolve against the compiled `dist/`, so a source change is invisible to
  both until `npm run build` runs here. A shape change with no `SCHEMA_VERSION` bump leaves readers
  parsing old rows as if they were new. Rebuild, and bump. Detail:
  [`cli/AGENTS.md`](../../cli/AGENTS.md), [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Changed the on-disk layout, or the project index?** Session tracking spans this library, the
  CLI's `session` commands, and the dashboard's journey routes — all three read these files
  directly, and the index is what exempts an attributed session from the retention sweep. Walk all
  three before changing a filename or a record shape. Detail:
  [`docs/internals/session-tracking.md`](../../docs/internals/session-tracking.md)

- **Changed cost weighting, the pricing table, or the row shape?** The dashboard's observability
  route renders these values as money. `scripts/audit-session.mjs` mirrors the derivation
  independently and must be updated in the same change. Detail:
  [`docs/observability.md`](../../docs/observability.md)

- **Changed capture triggering or its blocking behavior?** The hook fires on the agent's critical
  path. Anything that makes `PostToolUse` capture synchronous, or slow, is felt as latency in every
  tool call of every session. Detail:
  [`harness-installers/shared/hooks/AGENTS.md`](../../harness-installers/shared/hooks/AGENTS.md)

## Commands

```
npm run build
npm test
```

`build` runs `tsc` and emits a compiled ESM `dist/` tree plus declarations; the `package.json`
`exports` map resolves `@rad-orchestration/telemetry` to it. **Consumers read `dist/`, never
source** — the CLI bundle and the UI both break confusingly if you skip the build.

`npm test` runs the vitest suites in `tests/`.

### `scripts/audit-session.mjs`

A read-only three-way reconciliation for one session: it re-parses the raw transcript
independently, reads the NDJSON store, and applies its own mirror of the cost derivation and
pricing table. It reports capture parity, raw versus effective versus dollars, and a per-model
identity check.

```
node lib/telemetry/scripts/audit-session.mjs --list
node lib/telemetry/scripts/audit-session.mjs --session <id-or-prefix>
```

Reach for it when the dashboard's spend numbers look wrong, after touching the adapter, sink, or
reader, or to confirm fidelity on a new harness version. It is not part of the published surface.

## Further reading

- [`docs/internals/session-tracking.md`](../../docs/internals/session-tracking.md) — the two-store
  architecture this library's project index is half of
- [`docs/observability.md`](../../docs/observability.md) — what the captured data becomes
- [`docs/research/token-spend-and-cost-accounting.md`](../../docs/research/token-spend-and-cost-accounting.md)
  — the pricing tables and accounting semantics behind the weighting
- [`AGENTS.md`](../../AGENTS.md) — the repo map, and why nothing here may write to stdout
