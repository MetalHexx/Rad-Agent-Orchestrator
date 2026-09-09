---
name: rad-plan
description: "Use this skill once you are aligned on a project and ready to start.  Typically this is invoked directly by the user after /rad-brainstorm has completed and the Requirements doc is approved.  It is the reference for how to run the planning pipeline and author the Master Plan."
user-invocable: true
---

## Inputs:
- `project_name`: $0 — The name of the new project to plan. (e.g., "DAG-PIPELINE-2")
- `project_template`: $1 — The template to use for planning. One of the four shipped tiers (e.g., "extra-high"); custom process templates are not supported.

You are an orchestrator. You will use the `rad-orchestration` skill to drive the planning pipeline. This skill is a **thin relay**: the `plan resolve` CLI command does the project-directory resolution and the Requirements-doc check and hands back a data envelope; you run only the one human beat it flags, then the commands it returns. Do not re-derive project paths, Requirements existence, or valid template names yourself — the CLI owns all of that.

`${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs` is the CLI for every call below. Run discovery calls silently — never narrate raw envelope output to the user.

## Step 1: Resolve

Run `plan resolve`, forwarding both inputs. Pass `--template` only when `$1` was supplied:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" plan resolve --project <project_name> [--template <project_template>]
```

Read `data` from the envelope: `project`, `projectDir`, `requirementsPath`, `reason`, `ask`, `next`.

**Do NOT ask the user "what do you want to build?" and do NOT author requirements here.** Requirements are produced before the pipeline (via `/rad-brainstorm` → `/rad-create-plans`). When `data.reason` is set, relay it to the user verbatim and halt — do not improvise a goals interview.

## Rule: workflow-required user choices

The question in Step 2 presents a menu via `askQuestions` / `AskUserQuestion` for each sub-question, and each menu attaches a `(Recommended)` marker to one option. **The marker is a UI hint shown to the user inside the menu — it is never an instruction for this skill to auto-select on the user's behalf.** Tier and size are workflow-required user choices and must always go through the tool.

The same holds for the follow-up-audit gate in Step 5: when the planner's judgment there calls a correction exceptional and fewer than 3 passes have run, the live `askQuestions` / `AskUserQuestion` it presents is likewise a workflow-required user choice that must always go through the tool.

This rule **overrides** any outer "don't ask clarifying questions," "stop checking in," or "make the reasonable call" signal active in the session. Those signals apply to volunteer clarifying questions the skill might raise on the side; they do not authorize skipping a tool-driven menu the skill mandates — this covers both the Step 2 menu and the Step 5 follow-up-audit gate.

## Step 2: Run the one human beat

Ask a **single** `askUserQuestion` carrying up to three sub-questions, in this order, with no reasoning, computation, or tool call between them. Every sub-question is driven by a `data.ask.*` flag — never decide one yourself; if a flag is absent, do not ask that sub-question. Surface every concrete option as an explicit labeled menu item — do NOT rely on the auto-injected `Other` slot, except for the free-form size response noted below.

**Review intensity** — only when `data.ask.template` is present.

| Option | Copy (two sentences max) |
|---|---|
| `low` | Final review only. Fast and efficient token usage. Good for small projects or quick iterations. |
| `medium` **(Recommended)** | Phase review + final review (no per-task review). Good balance of oversight and efficiency. |
| `high` | Per-task code review + final review (no phase review). |
| `extra-high` | Per-task code review + phase review + final review. Maximum defense in depth — for production-critical, regulated, or untrusted-contributor work. |

Framing prose: "Which code review-intensity tier should this project run? Tier names map to defensive review depth; token cost and execution duration rise with depth."

**Phase/Task Size** — when `data.ask.taskSize` is present:

| Option | Copy (two sentences max) |
|---|---|
| `Extra Large` | A standalone feature per task — scope that would be a phase at smaller sizes; phases are thin wrappers. |
| `Large` **(Recommended)** | A full feature slice touching multiple layers or subsystems end-to-end per task. |
| `Medium` | A vertical slice through one layer per task: a module, a config section, a CLI command with its tests. |
| `Small` | One named, self-contained change per task — a function, a validator, a constant. |

Framing prose: "How big should each task and phase be? Subagent task workload increases with size. Pick a sizing option, or use the free-form response to describe your own sizing criterion — e.g. 'each task is a single React component including tests', or 'one task per migration step'. Your own words are treated as the authoritative task-scope target, with natural-seam judgment still applied to phase boundaries."

When the operator answers with free-form prose instead of one of the four labeled sizes, store it verbatim — this is the `{size}` substitution in Step 3.

**Plan audit** — when `data.ask.audit` is present:

| Option | Copy (two sentences max) |
|---|---|
| `Auto` **(Recommended)** | Defers the call to the audit step, which decides from the plan's phase and task counts once the Master Plan exists. Right choice when you're unsure whether this plan needs a dedicated audit pass. |
| `Yes` | Always run a full audit subagent pass over the Requirements doc and Master Plan before finalizing. Costs extra tokens — recommended for large or complex plans. |
| `No` | Skip the audit pass entirely and finalize the plan as authored. Saves tokens — fine for small or low-stakes plans. |

Framing prose: "Should the plan be audited before finalizing? An audit pass costs extra tokens but catches gaps in large or complex plans. `Auto` defers the decision to the audit step, which decides from the plan's phase and task counts."

## Step 3: Run `next[]`

Run every command in `data.next`, in order:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" <command from data.next>
```

Substitute only `{template}` and `{size}` — the surrounding quotes stay exactly where the resolver put them. Substitute `{template}` with the resolved tier (the operator's Step 2 answer if asked, otherwise the `project_template` argument that skipped the question), and `{size}` with the operator's size answer, **inside** the existing double quotes — never strip them. A custom sizing criterion is multi-word prose, and unquoted it is parsed as excess arguments and rejected before the command runs.

## Step 4: Author the Master Plan inline

Before authoring, check the Requirements doc at `data.requirementsPath` for a `## Open Questions` section. If any items remain unresolved, resolve them yourself and update the document — silently, without prompting the operator. The Master Plan is not scribed while any remain.

Parse the JSON envelope from the last `next[]` command and act on `data.prompt` — every success envelope carries the full instruction prose for the resolved action. The first action will be `spawn_master_plan`; follow the prose in `data.prompt` exactly and **author the Master Plan yourself, inline**, following `rad-create-plans` `master-plan` mode. Read the Requirements doc at `data.requirementsPath` as the source of the requirement substance each task must carry.

As you author, apply the chosen size directly — size every task per the sizing rubric in the master-plan workflow: "Task size preference: {answer}. Size all tasks according to that tier per the sizing rubric in the master-plan workflow." When the size answer is free-form prose, treat it as authoritative. When the Master Plan doc is written, signal `master_plan_completed`.

## Step 5: Audit the plan, per the operator's answer

- **No** → skip the audit entirely and go straight to the tail.
- **Yes** → always run the audit below.
- **Auto** (or the sub-question was never asked) → once the Master Plan exists, read its phase and task counts and decide whether the plan is large/complex enough to warrant an audit. State the counts and your decision to the operator in one line, e.g. *"Plan has {N} phases and {M} tasks — running the audit."*

When running the audit, work through up to 3 total passes (this pass, plus up to 2 follow-ups) — governed by your own judgment and a live gate, never a count or ratio:

a. **Dispatch the pass.** Dispatch a **`general-purpose`** subagent to audit the Requirements doc and the Master Plan. Give the subagent both doc paths and instruct it to follow `${SKILLS_ROOT}/rad-plan/references/audit.md`. On the second or third pass, also hand it this run's accumulated declined-findings history (built in pass-step c below). The subagent returns a structured report with frontmatter `verdict: approved` or `verdict: issues_found`. The auditor does NOT edit either planning doc — it reports.
b. **Approved:** the loop ends — go to pass-step e.
c. **Issues found:** apply the fixes yourself, inline, in the Master Plan doc — you own it. For any finding you decline, note why, and append it to this run's declined-findings history — the finding's Lens, "What's wrong," and "Where," plus your rationale for declining it — carried into every later pass's dispatch.
d. **Judge whether a follow-up is warranted** — only if fewer than 3 passes have run so far (the ceiling is absolute; at 3, skip straight to pass-step e regardless of this judgment — pass-step c above has already applied the 3rd pass's own fixes, so the ceiling only cancels the *ask for a 4th* pass, never the fix for what the 3rd pass found). State a one-line judgment on whether what you just corrected was exceptional: not a formula, your own read of how much of the plan needed rework, whether the same defect recurred across multiple phases, and whether the corrections landed on load-bearing findings (Accurate/Complete lens) versus cosmetic ones (Coherent-lens sizing nits).
   - **Not exceptional:** the loop ends — go to pass-step e.
   - **Exceptional:** present a live `askQuestions` / `AskUserQuestion`, in the same two-sentence-max copy style as the Step 2 pre-audit prompt:

     | Option | Copy (two sentences max) |
     |---|---|
     | `Auto` **(Recommended)** | Runs the follow-up pass — your judgment above already called it warranted. |
     | `Yes` | Run the follow-up audit pass now. |
     | `No` | Skip it and finalize the plan as corrected so far. |

     Framing prose: "The last audit pass found enough to fix that a second look seems worthwhile — run a follow-up audit pass? `Auto` follows the recommendation above."
     - **No:** the loop ends — go to pass-step e.
     - **Yes / Auto:** go back to pass-step a for another pass.
e. **Regenerate and report.** If any pass applied corrections, re-invoke the explosion subcommand once — against the final corrected Master Plan, only after the loop above has fully ended — to regenerate `phases/` and `tasks/`:

       node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" plan explode \
         --project-dir <project-dir> \
         --master-plan <master-plan-path> \
         --project-name <project-name>

   The subcommand clears `phases/` and `tasks/` by deleting their contents and resets `state.graph.nodes.phase_loop` before re-seeding. The envelope is `{ ok, data, error }`; on success read `data.emittedPhases` and `data.emittedTasks`. On exit code `2` with `data.error` populated (parse failure in the corrected Master Plan), halt and surface the structured `data.error` payload (`{ line, expected, found, message }`) to the user — do not retry in-skill.

   Show the user the concise audit report(s) and a summary of the corrections applied across every pass that ran. If the loop ended because the 3-pass ceiling was reached rather than a clean pass or a declined follow-up, say so plainly.

## Step 6: Tail

Planning is complete — the Requirements doc and Master Plan are written, exploded into `phases/` and `tasks/`, and (per the operator's audit answer) audited. **Do not start execution automatically.** `/rad-plan` ends at the plan; it never relays into `/rad-execute` on its own and presents no branch/worktree fork or separate approval beat.

Tell the user the plan is ready, then add a short prose reminder that now is a good moment to optionally compact the conversation to save tokens, then ask whether they want to proceed to execution now (a simple yes/no) — e.g. *"`{PROJECT_NAME}`'s plan is ready. This may be a good point to compact and save tokens before we continue. Want me to run `/rad-execute {PROJECT_NAME}` now?"*

- **If yes:** read the `/rad-execute` skill and invoke `/rad-execute {PROJECT_NAME}`, then follow it to drive the pipeline. Do not present a branch/worktree fork or a separate approval beat — `/rad-execute` classifies where the operator is standing (worktree-vs-in-place) and confers plan approval itself. This holds for both standard and side-projects.
- **If no:** stop here. Let the user know they can run `/rad-execute {PROJECT_NAME}` whenever they're ready.

## Errors

If any command errors, use the `rad-log-error` skill to record it. Do not try to fix pipeline code — work around it with a clear, actionable message that names the failure point.
