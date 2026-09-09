# Repo-Skill-Discovery E2E — Runner Prompt

> **Token cost.** This run invokes the `@planner` subagent **twice** (Requirements, then Master Plan). That is real Opus-tier spend. Do not loop the harness without intent. If a previous run's output is still valid for your purpose, reuse it.

---

## Mission

You are driving the `default.yml` pipeline end-to-end against the `skill-disco-fixture` brainstorming — a rainbow color validator library with multi-package structure — so the project gets a regression signal on repo-skill discovery (FR-15 through FR-17, NFR-5).

Behave as a **simulated orchestrator**. Signal events via `radorch pipeline signal`, read `data.action` from stdout JSON, route exactly per the Action Routing Table, do not make planning decisions yourself, do not edit state.json, do not skip the two-step `_started` → action return protocol. The only differences from a production run: you spawn no agents beyond `@planner`, and you **halt when the pipeline returns `action: "request_plan_approval"`** rather than presenting the gate to a human.

Full routing reference lives at `.claude/skills/rad-orchestration/references/pipeline-guide.md` and `action-event-reference.md` — load them if you are not already carrying that context.

---

## Inputs

| Input | Default | Notes |
|-------|---------|-------|
| Fixture name | `skill-disco-fixture` | Matches `prompt-tests/repo-skill-discovery-e2e/fixtures/skill-disco-fixture/BRAINSTORMING.md` |
| Project name | `baseline-skill-disco-fixture-<YYYY-MM-DD>` | For inaugural/tracked baseline runs, use `baseline-skill-disco-fixture-<YYYY-MM-DD>` — this pattern is **required** for the `.gitignore` exception to re-include `lint-report.md` + `run-notes.md`. For ad-hoc re-runs, the project-name shape is flexible; whatever you pick becomes `state.project.name`. |
| Run folder | `prompt-tests/repo-skill-discovery-e2e/output/skill-disco-fixture/<project-name>/` | The engine sets project name to `path.basename(--project-dir)`, so the run-folder name IS the project name. |

> **How project name is passed to the engine.** There is no `--name` CLI flag. The engine reads `path.basename(--project-dir)` on the `start` event. All downstream doc filenames derive from that value.

All paths below are relative to the repo root unless noted.

---

## Setup (bootstrap)

Hand-roll the minimum project scaffold — do **NOT** invoke the installer and do **NOT** pre-seed `state.json` or `orchestration.yml`. The pipeline engine creates state.json lazily on the first event.

1. Choose a project name. For inaugural baseline runs (tracked, committed), use `baseline-skill-disco-fixture-<YYYY-MM-DD>`. For ad-hoc re-runs, use any stable identifier. This name doubles as the run-folder basename and becomes `state.project.name`.

2. Create the run folder and the three subdirs the explosion script will write into:
   ```
   prompt-tests/repo-skill-discovery-e2e/output/skill-disco-fixture/<PROJECT-NAME>/
     ├── phases/
     ├── tasks/
     └── backups/
   ```

3. Copy the fixture brainstorming doc into the run folder, renaming it to match project naming conventions (`<PROJECT-NAME>-BRAINSTORMING.md`):
   ```
   prompt-tests/repo-skill-discovery-e2e/fixtures/skill-disco-fixture/BRAINSTORMING.md
     → prompt-tests/repo-skill-discovery-e2e/output/skill-disco-fixture/<PROJECT-NAME>/<PROJECT-NAME>-BRAINSTORMING.md
   ```
   The `@planner` agent in Requirements mode discovers this file by convention.

4. **Register the fixture as a scratch repo, then generate the skill manifest.** `skill list` resolves `--repo <name>` through the repo registry rather than a raw path (the old `--repo-root` flag is gone). The fixture lives inside this monorepo's own working tree, so copy it to a scratch location outside that tree, give the copy its own throwaway git identity, register + bind it under a scratch name, scan it, then tear the registration down:
   ```
   FIXTURE_SCRATCH="$(mktemp -d)/skill-disco-fixture"
   cp -r prompt-tests/repo-skill-discovery-e2e/fixtures/skill-disco-fixture "$FIXTURE_SCRATCH"
   cd "$FIXTURE_SCRATCH"
   git init -q
   git remote add origin https://example.invalid/skill-disco-fixture.git
   git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" repo add --path "$(pwd)" --name skill-disco-fixture-scratch --description "skill-discovery e2e fixture (scratch, torn down after this run)"
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" skill list --repo skill-disco-fixture-scratch
   ```
   Expected envelope: `{ "ok": true, "data": { "skills": [...] } }` where `data.skills` is a JSON array of exactly two entries — `foo-test-runner` and `rainbow-lint-conventions` — in alphabetical order, each with an absolute `path` ending in `SKILL.md`. Confirm `scaffold-only` and `rad-decoy` are absent from `data.skills` and that no stderr warnings appear. If this check fails, stop — the fixture is malformed and the run will produce invalid signal.

   The JSON envelope above is the manifest content — stdout IS the output. Capture the `data.skills` array to a local file (e.g., `manifest.json`) in the run folder if you need it for later assertions, but do NOT commit it — `manifest.json` is not a baseline artifact.

   Tear the scratch registration down once the manifest is captured — this run must not leave a stray entry in the operator's real repo registry:
   ```
   node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" repo remove --name skill-disco-fixture-scratch
   rm -rf "$(dirname "$FIXTURE_SCRATCH")"
   ```

Do NOT create `state.json`, `orchestration.yml`, or `template.yml` yourself. The engine writes `state.json` on the first `start` event and snapshots `template.yml` from the global templates folder.

---

## Drive the pipeline

Invoke `radorch pipeline signal` from the repo root. The run folder you created is `--project-dir` for every call.

Initial call — use `--event start` to scaffold state. The engine rejects any non-`start` event when `state.json` does not yet exist.

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" pipeline signal \
  --event start \
  --project-dir prompt-tests/repo-skill-discovery-e2e/output/skill-disco-fixture/<PROJECT-NAME> \
  --template default
```

The first `start` scaffolds `state.json` + snapshots `template.yml` into the run folder and returns `action: "spawn_requirements"`. From there proceed per the two-step protocol (signal `requirements_started`, get `spawn_requirements` back, spawn the planner, signal `requirements_completed --doc-path <path>`). The two-step protocol is documented on each action row of the routing table.

When spawning `@planner` for the Master Plan step, the orchestrator must include the skill manifest in the spawn prompt. The manifest output from Step 4 of Setup gives you the eligible skill list. Include it under a `## Repository Skills Available` heading in the planner spawn prompt, exactly as the production orchestrator would.

Loop per the Action Routing Table:

- On `spawn_requirements` / `spawn_master_plan` — spawn `@planner` with the action's context. The agent writes the output doc per `rad-create-plans`; capture the `doc_path` from its return. Then signal the paired `*_completed` event with `--doc-path <absolute-path>`.
- On `explode_master_plan` — shell out to the explosion script per action #2a in the routing table. On exit 0 signal `explosion_completed`; on exit 2 signal `explosion_failed --parse-error '<json>'` (same structured payload the script emits). On exit 1 **halt and surface to the operator** — do not invent a recovery.
- The two-step `_started` → action-return protocol is mandatory. Do not short-circuit it even though you are simulating.

**Halt signal**: `data.action === "request_plan_approval"`. Do not signal `plan_approved`. The run has produced everything the harness needs — requirements, master plan, and exploded phase/task files — before the gate.

---

## Assert pass criteria

When the loop halts at `request_plan_approval`, verify the five FR-17 assertions and then write two artifacts into the run folder.

### FR-17 assertion checks

Before writing `run-notes.md`, verify each assertion independently:

**Assertion 1 — Spawn prompt contains `## Repository Skills Available`.**
Confirm that the Master Plan planner-spawn prompt you composed (or that the orchestrator's action payload contained) includes a `## Repository Skills Available` heading and lists at least `foo-test-runner` and `rainbow-lint-conventions`. This verifies FR-15 (the section header shape) and FR-16 (both eligible skills present).

**Assertion 2 — Manifest contains exactly `rainbow-lint-conventions` and `foo-test-runner`; excludes `scaffold-only` and `rad-decoy`.**
The manifest output from Setup Step 4 is the authoritative check. Re-confirm: exactly two entries, names are `foo-test-runner` and `rainbow-lint-conventions`, no others. If the fixture was modified during setup, re-run the manifest script.

**Assertion 3 — Every `path` field is absolute and resolves to a real `SKILL.md`.**
For each entry in the manifest, verify `path.isAbsolute(entry.path)` and that the file exists on disk. Both must be true for each of the two eligible skills.

**Assertion 4 — No skill-discovery Grep/Glob by the planner.**
Review the planner's read log for the Master Plan spawn. Confirm there is no `Grep` or `Glob` tool call whose pattern resembles `SKILL.md`, `skills/`, or an eligible-skill name (`rainbow-lint-conventions`, `foo-test-runner`). The planner should have consumed the manifest via a `Read` of the skill files — receiving a structured list, not discovering skills independently. (DD-6 mechanic: discovery is delegated to the manifest script, not re-done by the model.)

**Assertion 5 — Master Plan body contains at least one distinctive marker.**
Open the emitted Master Plan doc and search for at least one of: `npm run rainbow-lint`, `assertRainbow`, `npm run foo:vitest`, `__foo__`. These markers appear in the eligible `SKILL.md` bodies; if the planner correctly inlined skill context into the plan, at least one should appear in a step body. (DD-5 mechanic: skill content is surfaced in the plan, not just listed.)

Record each assertion as PASS or FAIL in `run-notes.md`.

### `lint-report.md`

Run both linters and capture their stdout verbatim:

```
node prompt-tests/tools/lint-requirements.mjs <run-folder>/<PROJECT-NAME>-REQUIREMENTS.md
node prompt-tests/tools/lint-master-plan.mjs <run-folder>/<PROJECT-NAME>-MASTER-PLAN.md
```

Also run both linters in self-test mode and confirm they exit 0 and surface their expected errors:

```
node prompt-tests/tools/lint-requirements.mjs --self-test
node prompt-tests/tools/lint-master-plan.mjs --self-test
```

`lint-report.md` should contain: both doc-lint outputs (including the JSON summary line), both self-test outputs, and one sentence summarizing overall pass/fail.

### `run-notes.md`

Short, high-signal. Include:

- Run folder path + timestamp + project name
- Fixture used
- Pipeline final `data.action` + `state.graph.nodes.plan_approval_gate.gate_active` (read from state.json, do not edit it)
- Counts: phases emitted (= `state.graph.nodes.phase_loop.iterations.length`), tasks emitted (sum of per-phase task_loop iterations), requirement count (from Requirements frontmatter)
- FR-17 assertion results (all five, each marked PASS or FAIL)
- A short human-review checklist for the operator to eyeball the planner output (1–2 sentences per phase/task — are titles coherent, are requirement IDs cited sensibly, does the plan match the brainstorming scope, does the Master Plan reference the rainbow-lint and foo:vitest conventions where appropriate)

---

## Exit

**Do not approve the gate.** The run ends when `lint-report.md` and `run-notes.md` are written. If a baseline run, surface the two file paths to the operator so they can commit them — the `.gitignore` exception rules only re-include those two filenames under `baseline-*` folders; everything else (`state.json`, emitted phase/task docs, brainstorming copy, `manifest.json` if captured) stays untracked and regenerates on the next run.

If any step halted or surfaced unexpectedly (non-zero pipeline exit, linter errors on otherwise-valid output, unfamiliar action name, any FR-17 assertion FAIL), stop and surface to the operator — do not silently paper over a broken run with a green report.
