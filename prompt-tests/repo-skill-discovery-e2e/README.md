# repo-skill-discovery-e2e

Prompt-harness regression for the repo-skill discovery feature (FR-15, FR-16, FR-17, NFR-5). Drives the `default.yml` planning chain against the `skill-disco-fixture` — a multi-package rainbow color validator library — and verifies that eligible repo-local skills are discovered, filtered, manifested, and inlined into the planner spawn prompt correctly.

## What it tests

The repo-skill discovery path from fixture root to planner spawn:

```
radorch skill list --repo <registered-repo-name>  (folded into the CLI; shared module reused by the pipeline runtime)
  → spawn_master_plan prompt contains ## Repository Skills Available
    → @planner inlines skill context into Master Plan steps
      → plan_approval_gate  ← HALT
```

Drift in any of these surfaces is caught:

- Manifest script filtering (rad-prefix exclusion, disable-model-invocation exclusion, absolute path resolution)
- Spawn-prompt skill-section injection (FR-15: `## Repository Skills Available` heading present)
- Planner skill-content inlining (FR-17: distinctive markers appear in plan steps)
- Absence of in-model skill discovery (DD-6: no Grep/Glob for SKILL.md from the planner)

## How to run

1. Open a fresh Claude Code session at the repo root.
2. Paste `_runner.md` into the session as the kickoff.
3. The session runs the manifest script against the fixture, drives the pipeline to the halt point, asserts the five FR-17 criteria, and writes two reports into the run folder.

The session must NOT approve the gate. The halt IS the success condition.

## Fixtures

| Fixture | Source | Shape |
|---------|--------|-------|
| `skill-disco-fixture` | `fixtures/skill-disco-fixture/BRAINSTORMING.md` | Multi-package rainbow color validator library. Contains four `SKILL.md` files: two eligible (`rainbow-lint-conventions` inside `.claude/`, `foo-test-runner` inside `packages/foo/`), one excluded by `disable-model-invocation: true` (`scaffold-only`), one excluded by `rad-` prefix (`rad-decoy`). The eligible skills carry distinctive markers (`npm run rainbow-lint`, `assertRainbow(...)`, `npm run foo:vitest -- <pattern>`, `__foo__` suffix) that should appear in any honest Master Plan. |

## Pass criteria

After the halt, all five FR-17 assertions must pass:

1. Master Plan planner-spawn prompt contains `## Repository Skills Available` with both eligible skills listed.
2. Manifest contains exactly `rainbow-lint-conventions` and `foo-test-runner`; `scaffold-only` and `rad-decoy` are absent.
3. Every manifest `path` field is absolute and resolves to a real `SKILL.md`.
4. Planner's run log shows no `Grep`/`Glob` call whose pattern resembles `SKILL.md` or an eligible-skill name — discovery is delegated to the manifest script, not re-done by the model (DD-6).
5. Master Plan body contains at least one distinctive marker (`npm run rainbow-lint`, `assertRainbow`, `npm run foo:vitest`, or `__foo__`) inside a step body (DD-5).

Additionally, the same state-graph pass criteria as `plan-pipeline-e2e` apply:

- `state.graph.nodes.requirements.status === "completed"`
- `state.graph.nodes.master_plan.status === "completed"` and `master_plan.parse_retry_count === 0`
- `state.graph.nodes.explode_master_plan.status === "completed"`
- `state.graph.nodes.plan_approval_gate.gate_active === true`
- Both linters return `ok: true` against the emitted docs

If any criterion fails, the run is a regression — stop, surface to the operator, do not hide it under a green report.

## Token cost

One `@planner` invocation per spawn, two spawns (Requirements + Master Plan) = same cost profile as `plan-pipeline-e2e`. Real Opus-tier spend per run.

## Inaugural baseline

To commit the inaugural baseline:

1. Run the harness with a project name of `baseline-skill-disco-fixture-<YYYY-MM-DD>`.
2. Confirm all five FR-17 assertions pass and both linters return `ok: true`.
3. Stage only `output/skill-disco-fixture/baseline-skill-disco-fixture-<YYYY-MM-DD>/lint-report.md` and `run-notes.md`.
4. Commit with a message describing the baseline date and fixture.

The `.gitignore` exception re-includes only `lint-report.md` and `run-notes.md` under `baseline-*` folders. All other run artifacts (`state.json`, emitted docs, brainstorming copy, `manifest.json`) stay untracked and regenerate on the next run.
