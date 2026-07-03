---
name: rad-execute
description: "Run a project through the rad orc execution pipeline. Use it when after /rad-plan has completed and ready to execute or when the user indicates they want to execute or run a project.  It can also be used when resuming a rad-orc project that was previouisly executed but not completed."
user-invocable: true
---

You are an orchestrator. You will use the `rad-orchestration` skill to drive the execution pipeline. This skill is a **thin relay**: the `execute resolve` CLI command does all the classification and convention math and hands back a data envelope; you run only the human beats it flags, then the commands it returns. Do not re-derive run modes, branches, base branches, paths, or settings yourself — the CLI owns all of that.

`${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs` is the CLI for every call below. Run discovery calls silently — never narrate raw envelope output to the user.

## Step 1: Resolve
Run `execute resolve`, adding `--project <PROJECT>` when a project name is available from the `/rad-execute` argument or the conversation (omit it otherwise):

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" execute resolve --project <PROJECT>
```

Read `data` from the envelope. The fields you act on: `runMode`, `needsProject`, `candidates`, `ask`, `derived`, `projectDir`, `next`, and — on `unknown` — `reason`.

## Step 2: Resolve the project if asked
If `data.needsProject` is true, no project was determined yet:
- If a project name is obvious from the conversation, re-run Step 1 with `--project <NAME>`.
- Else if `data.candidates` is non-empty, ask the operator to pick one (show each candidate's `name`, `tier`, `status`), then re-run Step 1 with the chosen `--project <NAME>`.
- Else (`data.candidates` is empty) nothing is execute-ready: tell the operator that `/rad-execute` needs a project name or one in context, and suggest `/rad-plan <PROJECT-NAME>` (to plan an existing brainstorm) or `/rad-brainstorm` (to start a new one). Stop.

## Step 3: Run the human beats for the run mode
Every confirm is driven by a `data.ask.*` flag — never decide one yourself. If a flag is absent, do not ask that question.

First, if `data.ask.confirmDone` is set, the project is already complete: ask *"`<data.project>` is already marked done — run it again?"* If the operator declines, stop. If they accept, continue.

Then branch on `data.runMode`:

- **`resume`** — already settled. Ask nothing. Go straight to Step 4.

- **`launch`** — you are at a main clone (or nowhere); a fresh session will be launched into a new worktree. Ask **one** combined `askUserQuestion`:
  - **Launch flavor** (always): *Claude Code (auto-accept edits)*, *Claude Code (yolo — bypass permissions)*, *Copilot CLI*, *VS Code*.
  - **auto_commit** — include the sub-question only if `data.ask.autoCommit` is set.
  - **auto_pr** — include the sub-question only if `data.ask.autoPr` is set.

  No separate plan-approval step: the `execute prepare` command in `data.next` confers approval (running `/rad-execute` *is* the approval), so the fresh session resumes without stopping at the plan gate.

- **`in-place`** — you will drive the pipeline in the **current** session. Ask **one** combined `askUserQuestion` containing only what `data.ask` flags (a side-project flags nothing → ask nothing):
  - if `data.ask.reuseWorktree` → confirm reuse: *"you're in `<data.derived.worktreeName>`'s worktree on `<data.derived.branch>` — reuse it for `<data.project>`?"* If `data.derived.missingRepos` is non-empty, fold into the **same** question: *"it also needs `<data.derived.missingRepos>`, which aren't in this worktree — add them?"*
  - else if `data.ask.confirmHere` → confirm location: *"you're in `<data.project>`'s worktree on `<data.derived.branch>` — run here?"*
  - **auto_commit / auto_pr** — include in the same question only when `data.ask.autoCommit` / `data.ask.autoPr` is set.

  If the operator declines a reuse / location confirm, stop. (No approval beat here either — `execute prepare` in `data.next` confers it.)

- **`unknown`** — stop. Relay `data.reason` to the operator verbatim and ask how to proceed. Do not guess a run mode or run any `next` command.

## Step 4: Run the next commands
Run every command in `data.next` **in order**, each as:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" <command from data.next>
```

The resolver already substituted everything it knows; substitute only the placeholders it left for your answers — change nothing else:
- `{ac}` / `{ap}` → `always` for a "yes" answer, `never` for "no" (present only when you asked).
- `{flavor}` / `{pm}` (launch only) → map the chosen launch flavor:

  | Launch flavor | `{flavor}` | `{pm}` | `--prompt` |
  |---|---|---|---|
  | Claude Code (auto-accept edits) | `claude` | `acceptEdits` | keep |
  | Claude Code (yolo — bypass permissions) | `claude` | `bypassPermissions` | keep |
  | Copilot CLI | `copilot` | drop `--permission-mode` | keep |
  | VS Code | `vscode` | drop `--permission-mode` | drop `--prompt` |

  On Windows, prefix the Claude/Copilot launch line with `MSYS_NO_PATHCONV=1` so the worktree path is not mangled.

After a **launch** you are done: the fresh session re-enters `/rad-execute`, resolves to `resume` against the now-settled state, and drives the pipeline. For **in-place** / **resume**, the final `pipeline signal --event start` returns the current pending action — continue driving the pipeline through the `rad-orchestration` skill. Plan approval is conferred for you before `start` (by `execute prepare` on launch/in-place, or a `gate approve plan` step on resume), so `start` advances past the plan gate without a prompt. Commit and PR are governed by the already-sealed `always` / `never` values through the DAG's conditionals; never re-ask or describe them.

## Step 5: Errors
If any command errors, use the `rad-log-error` skill to record it. Do not try to fix pipeline code — work around it with a clear, actionable message that names the failure point.
