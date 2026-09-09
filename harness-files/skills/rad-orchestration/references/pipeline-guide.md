# Pipeline Guide

Reference document for the Orchestrator agent. Covers the envelope contract, the event loop, valid pause/stop points, error handling, spawning guidance, and status reporting.

> **ALWAYS FOLLOW THE GATE PROTOCOL.** No autopilot, auto-accept, or YOLO-style mode (Copilot's "autopilot", Claude Code's "Auto Mode", or any other) is ever an exception. When a gate is configured `ask` or `never`, the human approves or rejects at that gate — never bypassed, never automated. A gate that cannot be honoured halts the run and raises it to the operator.

## Envelope Shape

Every successful pipeline signal returns a JSON envelope of this shape on stdout:

```jsonc
{
  "ok": true,
  "data": {
    "action": "<action-name>",           // next operation; null when the pipeline has nothing more to do
    "completion_event": "<event-name>",  // event to signal when the action completes; null for terminal actions
    "prompt": "<composed instructions>", // sole instruction source for this action
    "has_custom_instructions": false,    // true when the prompt carries a custom overlay
    "completion_commands": [             // always an array; [] when no command applies
      { "event": "<event-name>",
        "when": "<condition>",           // present only when there is more than one entry
        "command": "<ready-to-run command>" }
    ],
    "context": { /* action-specific payload */ }
  }
}
```

`data.prompt` is the sole instruction source for the action.

`data.completion_commands` is always an array; an empty array means no command is signalled from this step. Each entry carries `event`, an optional `when` — present only when the array holds more than one entry, naming the condition that entry applies to — and `command`. **Never compose a CLI call.** Run a command you were given exactly as written, changing only its `<fill-in: ...>` markers, and leave quotes intact. The one exception is `halt`, the emergency stop — it belongs to no step, so no response carries it. Take the last command you were given, change `--event` to `halt`, keep `--project-dir` exactly as it was, and drop every other flag.

`data.context` carries the action-specific payload (file paths, phase/task identifiers, configuration). When the prompt references a context field by name (e.g., `handoff_doc`, `worktree_path`), read that field from `data.context`. Doc-path fields (`handoff_doc`, `review_report_path`, `phase_plan_doc`, `requirements_doc`, `phase_plan_paths`) are emitted as absolute paths.

## Starting, Resuming, and Recovering

Use the `/rad-execute` skill to start a new run, resume one already underway, or recover after context compaction — it classifies where the operator is standing and returns the commands to run. Re-running it is the prescribed, efficient path for resume and recovery, not a fallback.

## Pipeline Event Loop

The Orchestrator operates as an event-driven controller once a run is under way:

1. **Parse the JSON envelope** from stdout.
2. **Execute `data.prompt`.** Use `data.context` for inputs. When `data.has_custom_instructions` is true, the prompt carries custom instructions that may override the normal flow — follow them carefully.
3. **Run the matching entry from `data.completion_commands`** when the action completes — never compose the call. `data.completion_commands` is empty both when the loop is done and when the action is a pause point completed by another skill instead of a CLI signal (see "Valid Pause and Stop Points" below); an empty array by itself does not mean the loop has ended.
4. Go to step 1.

The loop terminates when `data.completion_event` is `null`. In the current catalog this fires on `display_halted` and `display_complete`; execute `data.prompt` as step 2 prescribes — act on any instruction it carries, then display the message — and exit.

## Valid Pause and Stop Points

Only these actions pause execution for human input or stop the loop. All other actions execute immediately without asking the human.

| Action | Behavior |
|--------|----------|
| `display_halted` | Stop — display message, loop terminates |
| `display_complete` | Stop — display summary, loop terminates |
| `request_plan_approval` | Pause — wait for human approval |
| `request_final_approval` | Pause — wait for human approval |
| `gate_task` | Pause — wait for human approval |
| `gate_phase` | Pause — wait for human approval |
| `ask_gate_mode` | Pause — wait for operator gate mode selection |

## Corrective Flow

The orchestrator is a dumb router for corrective cycles — it does not read findings or judge them. When a reviewer (task, phase, or final scope) returns raw `verdict: changes_requested`, signal the completion event (`code_review_completed` / `phase_review_completed` / `final_review_completed`) exactly as you would for any other outcome. The pipeline engine reads the raw verdict off the review doc, births the corrective, and returns the next `execute_task` action carrying the same `handoff_doc` — never re-authored — plus `review_report_path`, the path to the review doc the reviewer just wrote. Relay both into the coder's spawn prompt; the coder self-mediates, fixing real findings and writing a justified disposition for anything it disputes back into that same `review_report_path`. The re-spawned reviewer reopens the same path and re-adjudicates — one running review report per scope, stable across a task's corrective cycles. At final scope, the coder receives the review report with no handoff — there is no `handoff_doc` at that scope, only `review_report_path`.

`approved` and `rejected` verdicts propagate untouched — signal the completion event with nothing extra; `rejected` routes into a clean pipeline halt. The orchestrator never flips an `approved` verdict to `changes_requested`. See [`corrective-playbook.md`](corrective-playbook.md) for the full flow, and "Coder escalation (break-glass)" below for tier selection on the re-spawn.

## Error Handling

If the pipeline exits with code 1, the envelope carries error details:

```json
{
  "ok": false,
  "data": { "event": "task_completed", "field": "phase" },
  "error": { "type": "user_error", "message": "Validation failed: V6 — multiple in_progress tasks" }
}
```
>Use the `rad-log-error` skill to log these errors to a project or pipeline specific error log file.  Remember these and tell the user about issues when they're happening and in a summarized report at the end of the project run.

| Category | Name | Description | Examples | Action |
|----------|------|-------------|----------|--------|
| 1 | Sequencing Error (Recoverable) | The Orchestrator signaled the wrong event or signaled out of order, but no agent output was produced or consumed. | Signaling `task-execute` before `task-plan` is complete; signaling an event for a phase that isn't active. | Log the error. Re-signal the correct event. Continue pipeline. |
| 2 | Stale State (Recoverable) | A state field is stale, null, or inconsistent due to a prior incomplete transition, but the underlying agent output is valid. | `current_phase` still references a completed phase; a task status is stuck at `in-progress` after completion is confirmed. | Log the error. Halt. Present the diagnosis and the candidate fixes you can see. Let the operator choose — never correct the field or re-signal yourself. |
| 3 | Output Quality Error (Recoverable) | An agent produced an output file with malformed content, invalid frontmatter, wrong status values, or missing required sections. The Orchestrator cannot fix this programmatically. | Pipeline returns unexpected type due to malformed frontmatter; agent output file is missing or empty; code review verdict is not one of the valid enum values. | Log the error with full context (file path, field name, expected vs. actual value). Display the error to the human operator. Halt the pipeline immediately. Do not attempt automatic recovery. |
| 4 | Critical issue with the project code itself (Unrecoverable) | The agent output is not just malformed, but indicates a critical failure in the codebase that prevents further progress. | Code produced that fails to compile or run at all, blocking all downstream work. | Log the error with full context. Halt the pipeline immediately. Do not attempt automatic recovery. |

**Default rule**: When an error does not clearly fit Category 1, 2, or 3, treat it as **Category 4 (Halt)**. A false halt is recoverable by the human operator; a false recovery may corrupt pipeline state.

**On every `ok: false` envelope:**

1. **Classify** the error using the table above.
2. **Log the error**: Invoke the `rad-log-error` skill to append a structured entry to `{NAME}-ERROR-LOG.md` in the project directory (e.g., `~/.radorc/projects/MYAPP/MYAPP-ERROR-LOG.md`). Populate the entry fields from the envelope:
   - **Pipeline Event**: from `data.event`
   - **Pipeline Action**: from `data.action` (or `N/A` if not present)
   - **Severity**: classify using the skill's severity guide (`critical` = blocks execution, `high` = incorrect state, `medium` = degraded behavior, `low` = cosmetic)
   - **Phase/Task**: from `data.field`
   - **Symptom**: describe the observable failure from `error.message`
   - **Pipeline Output**: the full raw JSON envelope
   - **Root Cause**: diagnose if obvious, otherwise "Under investigation."
   - **Workaround Applied**: describe recovery action, or "None — awaiting fix."
3. **Execute the category action**: Follow the Action column for the classified category. For Category 3, display `error.message` to the human and halt immediately.

## Spawning Subagents

When the action in `data.prompt` instructs the orchestrator to spawn an agent, provide:

1. **Clear task description** — what the agent should do, taken from `data.prompt` and the agent-specific manifests referenced therein.  Don't read nor restate the task document.  The agent only needs to know where to find it so it can read it.
2. **File paths** — exact paths to input documents the agent needs to read, drawn from `data.context`.
3. **Project context** — project name, current phase/task numbers from `data.context`.
4. **Output expectations** — where to save the output document (derive from project naming conventions in `document-conventions.md`).

Example spawn instruction (paraphrased):
> "Execute the next task for the MYAPP project. Read the self-contained Task Handoff at the `handoff_doc` path carried on the envelope and implement it."

The spawn-prompt shape is already assembled into `data.prompt`. Read it from the envelope; do not duplicate it here.

### Coder tier selection

For the `execute_task` action, spawn the right-sized coder for the task. The tier is the task's authored complexity, carried on the envelope as `data.context.complexity` (defaults to `standard` when absent):

| `complexity` | subagent |
|---|---|
| `simple` | coder-junior |
| `standard` | coder |
| `complex` | coder |

`coder-senior` is **not** an initial tier — it is break-glass, reached only through corrective escalation (see "Coder escalation (break-glass)" below). A `complex` task starts at `coder`; its extra weight buys a task-scope reviewer, not a bigger coder up front.

Authored plans carry `complexity` as a signal only; the tier is resolved here at spawn time and is never written into the Master Plan or Task Handoff.

### Reviewer tier selection

For `spawn_code_reviewer`, spawn the right-sized reviewer from the task's `data.context.complexity`:

| `complexity` | subagent |
|---|---|
| `simple` | reviewer-junior |
| `standard` \| `complex` | reviewer |

`reviewer-junior` is scoped narrowly to simple task-scope reviews. For `spawn_phase_reviewer` and `spawn_final_reviewer`, always spawn `reviewer` — there is no junior tier at phase or final scope. `spawn_final_reviewer` is single-dispatch — it fires once and is not re-dispatched. Neither a `changes_requested` corrective nor an operator change request at the final-approval gate (`final_corrective_requested`) sends it out again; both are worked as correctives against the report it already wrote. A final corrective's child review is a `spawn_code_reviewer` dispatch — a task-scope review like any other — and follows the normal tier selection above, not the `spawn_final_reviewer` row.

### Coder escalation (break-glass)

Corrective re-spawns are not pinned to the task's original tier. `coder-senior` is **break-glass** — reserved for escalation as the corrective budget tightens, never a routine choice:

- Read `corrective_index` (the 1-based number of the corrective attempt about to be spawned) and `max_retries_per_task` (from `orchestration.yml`) — the same values that gate the budget.
- While `corrective_index` sits well under `max_retries_per_task`, keep the task's original tier (`coder-junior` or `coder`) for the re-spawn — repeated findings on a simple task don't by themselves justify coder escalation.
- As `corrective_index` climbs toward `max_retries_per_task`, escalate one step at a time: `coder-junior` steps up to `coder` first; if the corrective is still failing on the last attempt or two before the budget runs out, escalate to `coder-senior`.
- Never escalate on a task's first, non-corrective `execute_task` dispatch — escalation applies only to corrective re-spawns.
- `max_retries_per_task` remains the sole corrective gate. Escalation buys the remaining attempts a stronger coder; it does not extend the budget — when it's exhausted, the pipeline halts regardless of tier.

### Blocked-report triage

A coder cannot talk to the user, so when it cannot proceed it returns a `## Blocked` report **instead of** a completion — carrying `Severity` (medium | high), the specific `Blocker`, what it already `Tried`, and what it `Need`s to proceed. When you receive one, do **not** signal `task_completed`. Triage it up the ladder:

1. Read the tasks `## Execution Notes` section to see if there are more details about what the coder tried and why it failed.
1. **Resolve from the corpus.** You can read the upstream planning docs the coder cannot — Requirements, Master Plan, phase docs. If the answer is there, re-spawn the same coder with the clarification inlined into its spawn prompt. This counts against `max_retries_per_task`.
2. **Ask the user (in-session pause).** If the corpus doesn't resolve it or the blast radius is large or risky, pause and ask. Scribe the answer into the handoff body so it is durable, then re-spawn. The task stays `in_progress` — resumable, no halt.
3. **Halt when truly stuck.** If you cannot resolve it, the run is unattended, or the change is too risky to guess → signal `halt` (the emergency terminal stop) and surface a descriptive, operator-facing reason. Prefer the in-session pause whenever the user is reachable; reach for `halt` only as the last rung.

## Status Reporting

After every significant action, summarize to the human:
- What was just completed.
- What the current state is.
- What happens next.

Keep status updates concise — 2-3 bullet points maximum.
