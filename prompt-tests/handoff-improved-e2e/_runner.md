# Handoff-Improved E2E — Runner Prompt

> **Arm B of an A/B pair.** This drives `@coder` against the **improved** P02-T01 handoff (engine
> contracts inlined, gotchas pre-stated, "don't spelunk" fence). Arm A (`../handoff-original-e2e/`)
> drives the *same* task with the **original** handoff. The sandbox and task are identical across both
> arms — the **only** variable is `fixtures/handoff.md`. Compare token/read spend across the two with
> your own benchmarking tool.

> **Token cost.** One real `@coder` (Opus-tier) invocation. No reviewer / planner / orchestrator.

---

## Mission

Simulate the orchestrator at `execute_task`: dispatch one coder against the handoff, against an
**isolated sandbox** copy of the graph engine + graph-service host. You are not scoring anything here —
you reproduce a faithful, isolated coder run so an external harness can measure its telemetry.

## Setup

1. Pick a run folder: `output/run-<LABEL>/` (your benchmark harness may set `<LABEL>`; otherwise use
   today's date). All paths below are relative to this behavior folder unless noted.
2. Assemble a **fresh** isolated workspace (copy — never symlink; wipe any stale run folder first so
   every run starts byte-identical to the pristine template — never reuse a dirtied copy):
   ```
   rm -rf   output/run-<LABEL>
   mkdir -p output/run-<LABEL>/tasks
   cp -r ../_handoff-sandbox  output/run-<LABEL>/workspace
   cp fixtures/handoff.md      output/run-<LABEL>/tasks/HANDOFF.md
   ```
3. Record two absolute paths:
   - `handoff_doc` = `<abs>/output/run-<LABEL>/tasks/HANDOFF.md`
   - repo path     = `<abs>/output/run-<LABEL>/workspace`  (the workspace root; the coder works in `graph-service/`)

> The sandbox is source-only and self-contained. If your harness validates builds, run
> `npm install` at the workspace root first (links the `lib/*` + `graph-service` workspaces); otherwise
> the coder resolves its own environment when a command fails, exactly as in a real run.

## Drive the coder

Spawn `@coder` (the `rad-execute-coding-task` skill) **once**, with a spawn prompt mirroring what
`runtime-config/action-events/action.execute_task.md` inlines. Pass:

1. `handoff_doc` (absolute) — the coder's **sole** doc input. No Requirements / Master Plan / phase docs.
2. The `repos[]` array, inlined verbatim:
   ```
   repos:
     - name: graph-service
       path: <abs>/output/run-<LABEL>/workspace
       branch: main
   ```
3. **No commit directive** — this arm measures the implementation, not the commit contract. The coder
   implements and leaves its changes uncommitted.
4. **Isolation fence (include verbatim in the spawn prompt):**
   > "Work ONLY inside the workspace path above and the handoff. Do NOT read anything under any
   > `output/run-*` folder, the sibling `handoff-original-e2e/` behavior, or anything outside your
   > workspace. Do NOT look at prior runs or reference solutions — implement the task fresh from the
   > handoff and the code in your workspace."

Do **not** signal any pipeline event or advance any state — the harness is the only invoker.

## Exit

When the coder returns, its produced files live under `output/run-<LABEL>/workspace/graph-service/`.
Hand off to your benchmarking tool to capture telemetry (turns, cache-read, Read count, distinct files
read, peak context). Surface the run-folder path to the operator.
