# Instructions-Reach E2E — Runner Prompt

> **Token cost.** This run invokes `@planner` **twice** (Requirements + Master Plan) at Opus tier and `@coder` **once** at Sonnet tier. That is real spend. Do not loop the harness without intent. If a previous run's output is still valid for your purpose, reuse it.

---

## Mission

You are measuring whether project-level instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) placed at the project root reach the `@planner` and `@coder` subagents the orchestration pipeline spawns. The fixture plants three distinctive marker tokens — one per file — inside scoped rules that, if a subagent reads the file, MUST cause the marker to surface in that subagent's output.

You drive two phases:

- **Phase A** — Drive the `default.yml` planning chain via `radorch pipeline signal`. Halt at `request_plan_approval`. Then grep the emitted Master Plan for the CLAUDE.md marker.
- **Phase B** — Spawn `@coder` directly against a pre-baked handoff (the executor-isolation pattern from `execute-coding-task-e2e`). Then grep the resulting source files for the AGENTS.md and copilot-instructions.md markers.

Behave as a **simulated orchestrator** during Phase A. Signal events via `radorch pipeline signal`, read `data.action` from stdout JSON, route exactly per the Action Routing Table at `.claude/skills/rad-orchestration/references/action-event-reference.md`, do not make planning decisions yourself, do not edit `state.json`, do not skip the two-step `_started` → action-return protocol. The only differences from a production run: you spawn no agents beyond `@planner` in Phase A, and you halt when the pipeline returns `action: "request_plan_approval"` rather than presenting the gate to a human.

**Critical constraint — do not seed reach.** The Phase A planner spawn prompts must mirror the production orchestrator exactly: only the `## Repository Skills Available` manifest, no inlined CLAUDE.md / AGENTS.md / copilot-instructions.md content, no mention of the marker tokens. The Phase B coder spawn prompt must contain only the handoff path per the `rad-execute-coding-task` contract, no other doc paths, no marker references. We are measuring native reach, not seeded reach.

---

## Inputs

| Input | Default | Notes |
|-------|---------|-------|
| Fixture name | `instructions-canary` | Matches `prompt-tests/instructions-reach-e2e/fixtures/instructions-canary/` |
| Project name | `baseline-instructions-canary-<YYYY-MM-DD>` | For inaugural/tracked baseline runs use this exact pattern — the `.gitignore` exception requires `baseline-*` for `lint-report.md` + `run-notes.md` to be re-included. For ad-hoc re-runs, the project-name shape is flexible; whatever you pick becomes `state.project.name` (the engine reads `path.basename(--project-dir)` on the `start` event). |
| Run folder | `prompt-tests/instructions-reach-e2e/output/instructions-canary/<PROJECT-NAME>/` | The run-folder basename IS the project name. |

All paths below are relative to the repo root unless noted.

---

## Setup (bootstrap)

Hand-roll the minimum project scaffold. The pipeline engine creates `state.json` lazily on the first `start` event — do **NOT** invoke the installer and do **NOT** pre-seed `state.json` or `orchestration.yml`.

1. Choose a project name. For inaugural baseline runs (tracked, committed), use `baseline-instructions-canary-<YYYY-MM-DD>`. For ad-hoc re-runs, use any stable identifier.

2. Create the run folder and the three subdirs the explosion script writes into:
   ```
   prompt-tests/instructions-reach-e2e/output/instructions-canary/<PROJECT-NAME>/
     ├── phases/
     ├── tasks/
     └── backups/
   ```

3. Copy the fixture's instruction files, brainstorming doc, package.json, and source seeds into the run folder. The run folder must end up looking like a real project root with the canary files at the top:
   ```
   prompt-tests/instructions-reach-e2e/output/instructions-canary/<PROJECT-NAME>/
     ├── CLAUDE.md                                 ← copy of fixture
     ├── AGENTS.md                                 ← copy of fixture
     ├── .github/
     │   └── copilot-instructions.md               ← copy of fixture
     ├── package.json                              ← copy of fixture
     ├── <PROJECT-NAME>-BRAINSTORMING.md           ← renamed copy of fixture's BRAINSTORMING.md
     ├── src/
     │   ├── reverse.js                            ← copy of fixture seed (empty scaffold)
     │   └── __tests__/
     │       └── reverse.test.js                   ← copy of fixture seed (empty scaffold)
     ├── tasks/
     │   └── INSTRUCTIONS-CANARY-TASK-P01-T01-REVERSE.md   ← copy of fixture handoff
     ├── phases/
     └── backups/
   ```
   The brainstorming doc gets renamed in transit: `BRAINSTORMING.md` → `<PROJECT-NAME>-BRAINSTORMING.md`. The `@planner` agent in Requirements mode discovers it by convention.

4. **Register the run folder as a scratch repo, then generate the skill manifest.** The orchestrator's planner spawn requires the `## Repository Skills Available` heading even if empty. `skill list` resolves `--repo <name>` through the repo registry rather than a raw path (the old `--repo-root` flag is gone), so give the run folder its own throwaway git identity, register + bind it under a scratch name, scan it, then tear the registration down:
   ```
   cd prompt-tests/instructions-reach-e2e/output/instructions-canary/<PROJECT-NAME>
   git init -q
   git remote add origin https://example.invalid/instructions-canary.git
   git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" repo add --path "$(pwd)" --name instructions-canary-scratch --description "instructions-reach e2e run folder (scratch, torn down after this run)"
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" skill list --repo instructions-canary-scratch
   ```
   The fixture has no `.claude/skills/` or `packages/*/skills/` of its own, so the expected envelope is `{ "ok": true, "data": { "skills": [] } }`. Capture the empty `data.skills` array (or just confirm it's empty) — you will inline `## Repository Skills Available` (with no entries) into the planner spawn per the standard contract.

   Tear the scratch registration down once the manifest is captured — this run must not leave a stray entry in the operator's real repo registry, and the run folder must not carry its own `.git` into the rest of the pipeline:
   ```
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" repo remove --name instructions-canary-scratch
   rm -rf .git
   ```

Do NOT create `state.json`, `orchestration.yml`, or `template.yml` yourself. The engine writes `state.json` on the first `start` event and snapshots `template.yml` from the global templates folder.

---

## Phase A — Drive the planner via `radorch pipeline signal`

Invoke `radorch pipeline signal` from the repo root. The run folder you created is `--project-dir` for every call.

Initial call — use `--event start` to scaffold state. The engine rejects any non-`start` event when `state.json` does not yet exist.

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" pipeline signal \
  --event start \
  --project-dir prompt-tests/instructions-reach-e2e/output/instructions-canary/<PROJECT-NAME> \
  --template default
```

The first `start` scaffolds `state.json` + snapshots `template.yml` into the run folder and returns `action: "spawn_requirements"`. From there proceed per the two-step protocol (signal `requirements_started`, get `spawn_requirements` back, spawn the planner, signal `requirements_completed --doc-path <path>`).

Loop per the Action Routing Table:

- On `spawn_requirements` / `spawn_master_plan` — spawn `@planner` with the action's context. Compose the spawn prompt exactly as the production orchestrator would: include the `## Repository Skills Available` heading (empty list, since the fixture has no eligible repo skills) and any other action-payload context. **Do not** mention `CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`, or the marker tokens. The agent writes the output doc per `rad-create-plans`; capture the `doc_path` from its return. Then signal the paired `*_completed` event with `--doc-path <absolute-path>`.
- On `explode_master_plan` — shell out to the explosion script per the routing table. On exit 0 signal `explosion_completed`; on exit 2 signal `explosion_failed --parse-error '<json>'`. On exit 1 halt and surface to the operator — do not invent a recovery.
- The two-step `_started` → action-return protocol is mandatory. Do not short-circuit it.

**Capture the planner's read log** for both spawns — specifically, whether the planner issues any `Read`, `Grep`, or `Glob` for `CLAUDE.md`, `AGENTS.md`, or `copilot-instructions.md` paths. You will need this for the cross-check in `run-notes.md`.

**Halt signal**: `data.action === "request_plan_approval"`. Do not signal `plan_approved`. The run has produced everything Phase A needs — Requirements, Master Plan, and exploded phase/task files — before the gate.

---

## Phase B — Spawn `@coder` directly against the pre-baked handoff

This phase exercises the executor in isolation, mirroring the pattern from `prompt-tests/execute-coding-task-e2e/_runner.md`. You do **NOT** drive `radorch pipeline signal`, do not signal events, do not advance `state.json`. The coder is given exactly one input: the handoff path.

1. Confirm the pre-baked handoff is present at:
   ```
   prompt-tests/instructions-reach-e2e/output/instructions-canary/<PROJECT-NAME>/tasks/INSTRUCTIONS-CANARY-TASK-P01-T01-REVERSE.md
   ```
   (It was copied during Setup step 3.)

2. Spawn `@coder` (default Sonnet variant — `subagent_type: "coder"`, NOT `coder-junior` or `coder-senior`) once with that handoff path. Pass exactly one input: the handoff path. **Do not** pass the Requirements doc, Master Plan doc, or any other upstream doc — handoff-only is the contract under test. **Do not** mention `CLAUDE.md`, `AGENTS.md`, `copilot-instructions.md`, or any marker token.

3. The coder should:
   - Read **only** `tasks/INSTRUCTIONS-CANARY-TASK-P01-T01-REVERSE.md`. No reads of `<PROJECT-NAME>-BRAINSTORMING.md`, the Requirements/Master Plan docs, or `phases/*`.
   - Execute the four RED-GREEN steps in order: failing test first, run it, implement, re-run.
   - Overwrite `src/__tests__/reverse.test.js` and `src/reverse.js` with real content.
   - Run `node --test src/__tests__/reverse.test.js` from the run folder; final run should pass.
   - Append an `## Execution Notes` section to the END of the handoff doc body (per `rad-execute-coding-task`).
   - Emit `task_completed` (in this harness: print a completion block to chat with the appended handoff path).

4. **Capture the coder's read log** — specifically, whether the coder issues any `Read`, `Grep`, or `Glob` for `CLAUDE.md`, `AGENTS.md`, or `copilot-instructions.md` paths. You will need this for the cross-check in `run-notes.md`.

5. After the coder returns, do NOT signal any pipeline event. Do NOT advance `state.json`.

---

## Phase C — Assertions and reports

Write the two committed baseline artifacts into the run folder.

### Marker greps

For each of the three markers, run a one-line `grep` against the appropriate output and capture the count. All paths below are relative to the run folder.

```
# CLAUDE.md marker — emitted by @planner if seen, into the Master Plan
grep -c "MARKER-CLAUDEMD-7G3K9P" <PROJECT-NAME>-MASTER-PLAN.md

# AGENTS.md marker — emitted by @coder if seen, into the source files
grep -c "MARKER-AGENTSMD-5Q8L2N" src/reverse.js
grep -c "MARKER-AGENTSMD-5Q8L2N" src/__tests__/reverse.test.js

# copilot-instructions.md marker — emitted by @coder if seen, into the source files
grep -c "MARKER-COPILOT-4R6T1J" src/reverse.js
grep -c "MARKER-COPILOT-4R6T1J" src/__tests__/reverse.test.js
```

A non-zero count for a marker in any of its target files means the corresponding instruction file was visible to that subagent.

For each subagent's read log, record whether the canary file paths appeared in any `Read` / `Grep` / `Glob` tool call. This is the cross-check column.

### `lint-report.md`

Write `lint-report.md` in the run folder. Include:

1. **Doc lint** — capture stdout verbatim from both linters:
   ```
   node prompt-tests/tools/lint-requirements.mjs <run-folder>/<PROJECT-NAME>-REQUIREMENTS.md
   node prompt-tests/tools/lint-master-plan.mjs <run-folder>/<PROJECT-NAME>-MASTER-PLAN.md
   ```
   Both must return `ok: true` for the run to be valid.

2. **Self-test** — capture stdout verbatim from both linters in self-test mode (proves the linters themselves are functioning):
   ```
   node prompt-tests/tools/lint-requirements.mjs --self-test
   node prompt-tests/tools/lint-master-plan.mjs --self-test
   ```

3. **Marker greps** — for each of the five `grep -c` invocations above, record the command and its numeric result on its own line.

4. **One-sentence summary** — overall pass/fail of the doc lints (orthogonal to the reach matrix).

### `run-notes.md`

Short, high-signal. Include:

- Run folder path + timestamp + project name.
- Fixture used.
- Pipeline final `data.action` + `state.graph.nodes.plan_approval_gate.gate_active` (read from `state.json`, do not edit it).
- Counts: phases emitted, tasks emitted, requirements count (from Requirements frontmatter).
- **Reach matrix** — the core artifact:

  | Subagent | CLAUDE.md marker | AGENTS.md marker | copilot-instructions.md marker | Read log shows file? |
  |---|---|---|---|---|
  | `@planner` | ✓ / ✗ | n/a | n/a | per file: ✓ / ✗ |
  | `@coder` | n/a | ✓ / ✗ | ✓ / ✗ | per file: ✓ / ✗ |

  Fill each cell with `✓` (marker found / file appeared in read log) or `✗` (absent). For the read-log column, list each canary file path that did appear; if none, write "none".

- One-line conclusion per subagent (e.g., "Planner did not see CLAUDE.md — marker absent in Master Plan and no Read of CLAUDE.md in planner's read log").

- Phase B coder integrity check (independent of reach):
  - Coder read log contained the handoff path and no upstream planning docs (`✓` / `✗`).
  - `node --test src/__tests__/reverse.test.js` passed in the run folder (`✓` / `✗`).
  - Handoff doc has a single `## Execution Notes` heading appended at the end (`✓` / `✗`).

---

## Exit

**Do not approve the gate. Do not advance `state.json` after Phase B.** The run ends when `lint-report.md` and `run-notes.md` are written.

If a baseline run, surface the two file paths to the operator so they can commit them — the `.gitignore` exception rules only re-include those two filenames under `baseline-*` folders; everything else (`state.json`, emitted docs, brainstorming copy, copied instruction files, generated source, manifest output if captured) stays untracked and regenerates on the next run.

If any step halted or surfaced unexpectedly (non-zero pipeline exit, linter `ok: false` on otherwise-valid output, unfamiliar action name, coder failed to produce source files, coder read upstream planning docs), stop and surface to the operator — do not silently paper over a broken run with a green report. Hard fails are independent of the reach matrix outcome; the reach matrix itself is descriptive and is whichever truth the run produced.
