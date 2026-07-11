# _handoff-sandbox

Shared, pristine, **isolated** sandbox for the handoff A/B pair
([`handoff-original-e2e/`](../handoff-original-e2e/) and [`handoff-improved-e2e/`](../handoff-improved-e2e/)).
Both behaviors copy this tree into their own `output/run-<LABEL>/workspace/` per run — nothing here is
mutated by a run, and a run can never reach the live repo.

## What it is

The **P02-T01 starting state** of the steerable-DAG graph service — a source-only slice of the monorepo:

| Path | Role in the task |
|------|------------------|
| `lib/graph-engine/` | The engine barrel the coder consumes (`Result`, `ChangeDelta`, the 11 primitives, `validate`/`preview`, store seam). This is the contract surface the **original** handoff makes the coder rediscover by reading, and the **improved** handoff inlines. |
| `lib/graph-store-sqlite/` | Portfolio + execution stores (`createProject`, the cross-store seed anchor). |
| `lib/graph-node-types/` | Node-type registry the engine resolves against. |
| `graph-service/` | The Hono host the coder edits: `src/http/app.ts` (mount target), `src/compose.ts` (`GraphService`), `src/driver/{drive,outcome}.ts` (the `submit-event` cycle). |

## The task the coder builds

Create `graph-service/src/http/engine-graph.ts` + `steer.ts` and mount them in `app.ts` — i.e. the
`/engine-graph/*` RPC surface. Those solution files are **absent by design** so the coder builds them.

## Provenance & isolation

- Copied from the `STEERABLE-DAG-2.3` worktree of `rad-orc-source` (source-only: no `dist/`,
  `node_modules/`, `.git/`, or source maps).
- The P02-T01 solution was excised: `src/http/{engine-graph,steer,mutation-spec}.ts`,
  `tests/http/engine-graph.test.ts`, and `tests/functional/` (P04 tests that drive the solution over
  HTTP) were removed; `src/http/app.ts` was reverted to drop the `/engine-graph` import + mount.
- The root `package.json` declares the four workspaces so `npm install` links them. It is **not** built
  — a benchmark harness that validates builds should `npm install` (and, if it wants, `npm run build`)
  at the workspace root of a run copy; otherwise the coder resolves its own environment on first failure,
  exactly as in a real run.

## Refreshing

To re-pin against newer engine code, re-run the assembly (copy the four packages source-only from the
current `rad-orc-source`, excise the same solution files, revert the two `app.ts` lines). Keep the two
behaviors byte-identical — the whole benchmark rests on the sandbox being the same for both arms.
