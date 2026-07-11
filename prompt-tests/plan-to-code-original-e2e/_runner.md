# plan-to-code-original-e2e — Runner Prompt

> **Arm A of an A/B pair — the final leg.** This drives **one coder** against the task the
> **original** planner produced (`masterplan-original-e2e`'s exploded P01-T01 — contracts named but
> types left dangling), under the **original** `rad-execute-coding-task` skill (the pre-read-economy
> version). Arm B (`../plan-to-code-improved-e2e/`) drives the task the **improved** planner produced
> under the **improved** skill. Sandbox and scope are identical across both arms; the two things that
> move together are `fixtures/handoff.md` (frozen planner output) and `fixtures/skill/SKILL.md`
> (pinned coder skill) — because each is the matched output of the improved-vs-original plan→code
> chain. Compare coder token/read spend across the two.

> **This tests code execution only — the planner is not re-run.** Both tasks were authored in the
> earlier `masterplan-*-e2e` runs and are frozen here as fixtures. Compare against Arm B with your
> own benchmarking tool.

> **Token cost.** One real coding agent (Opus-tier) invocation. No reviewer / planner / orchestrator.

---

## Mission

Simulate the orchestrator at `execute_task`: dispatch one coder against the frozen handoff, over an
**isolated sandbox** copy of the graph engine + graph-service host. You are not scoring anything —
you reproduce a faithful, isolated coder run so an external harness can measure its telemetry.

The coder follows the skill **shipped in this fixture** (`fixtures/skill/SKILL.md`), **not** the
globally-deployed `rad-execute-coding-task` skill — that is what pins the skill version per arm.

## Setup

1. Pick a run folder: `output/run-<LABEL>/` (your harness may set `<LABEL>`; otherwise use today's
   date). All paths below are relative to this behavior folder unless noted.
2. Assemble a **fresh** isolated workspace (copy — never symlink; wipe any stale run folder first so
   every run starts byte-identical to the pristine template — never reuse a dirtied copy):
   ```
   rm -rf   output/run-<LABEL>
   mkdir -p output/run-<LABEL>/tasks
   cp -r ../_handoff-sandbox   output/run-<LABEL>/workspace
   cp fixtures/handoff.md      output/run-<LABEL>/tasks/HANDOFF.md
   ```
3. Record absolute paths:
   - `handoff_doc` = `<abs>/output/run-<LABEL>/tasks/HANDOFF.md`  (the coder's sole doc input)
   - repo path    = `<abs>/output/run-<LABEL>/workspace`  (the workspace root; the coder works in `graph-service/`)
   - skill        = `<abs>/fixtures/skill/SKILL.md`  (the pinned coder skill for this arm)

> The sandbox is source-only and self-contained. If your harness validates builds, run
> `npm install` at the workspace root first (links the `lib/*` + `graph-service` workspaces);
> otherwise the coder resolves its own environment when a command fails, exactly as in a real run.

## Drive the coder

Spawn **one `general-purpose` agent** (it has no built-in coder skill, so it can only follow the
skill you hand it — that is the point). Pass, verbatim:

1. **Your operating instructions** — "You are executing one coding task. Your **complete** operating
   instructions are the skill document at `<skill>`. Read it first and follow it exactly, as though
   it were your governing skill; use no other coding methodology."
2. **Task** — `handoff_doc` (absolute) is your **sole** doc input. Do **not** read any Requirements /
   Master Plan / phase docs — the handoff is self-contained.
3. **Repos** — the `repos[]` array, inlined verbatim:
   ```
   repos:
     - name: graph-service
       path: <abs>/output/run-<LABEL>/workspace
       branch: main
   ```
4. **No commit directive** — this arm measures the implementation, not the commit contract. Implement
   and leave the changes uncommitted; **skip the skill's commit step**.
5. **Isolation fence (include verbatim):**
   > "Work ONLY inside the workspace path above and the handoff. Do NOT read anything under any
   > `output/run-*` folder anywhere in `prompt-tests/`, the sibling `plan-to-code-improved-e2e/`
   > behavior, any `masterplan-*-e2e/` or `handoff-*-e2e/` behavior, or any prior run / reference
   > solution / existing implementation. Implement the task fresh from the handoff and the code in
   > your workspace."

Do **not** signal any pipeline event or advance any state — the harness is the only invoker.

## Exit

When the coder returns, its produced files live under `output/run-<LABEL>/workspace/graph-service/`.
Hand off to your benchmarking tool to capture the coder's telemetry (turns, cache-read, Read count,
distinct files read, peak/mean context, tools/turn). Surface the run-folder path to the operator.

> **Confound (same as the masterplan arms):** a `general-purpose` agent following a skill file has a
> broader toolset than the real `@coder` subagent, so **absolute** numbers won't match production.
> Both arms use the identical agent + toolset, so the A/B **delta** (original vs improved plan→code
> output) is still attributable. n=1 per arm.
