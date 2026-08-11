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

Read `data` from the envelope. The fields you act on: `runMode`, `needsProject`, `candidates`, `ask`, `derived`, `cloneBinding`, `projectDir`, `next`, `notices`, and — on `unknown` — `reason`.

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

- **`launch`** — a fresh session will be launched into the project's workspace folder. Ask **one** combined `askUserQuestion` containing only what `data.ask` flags (nothing flagged → ask nothing):
  - **Launch flavor** — include only if `data.ask.launchFlavor` is set, offering exactly three choices: *Claude Code*, *Copilot CLI*, *VS Code*.
  - **auto_commit** — include the sub-question only if `data.ask.autoCommit` is set.
  - **auto_pr** — include the sub-question only if `data.ask.autoPr` is set.

  Plan approval is conferred by the `execute prepare` command in `data.next` when one is present, and otherwise by the session that resumes inside the workspace folder — either way the plan gate is already cleared by the time a session drives the pipeline.

- **`in-place`** — you will drive the pipeline in the **current** session. Ask **one** combined `askUserQuestion` containing only what `data.ask` flags (a side-project flags nothing → ask nothing):
  - if `data.ask.bindClone` → confirm the binding to the operator's own clone in a single combined question:
    - **what is being adopted** — report the repo and branch as what the project will run on: *"this project will run on `<data.cloneBinding.repo>`'s `<data.cloneBinding.branch>` branch — bind to it?"*
    - **what is uncommitted** — when `data.cloneBinding.dirtyCount` is non-zero, list `data.cloneBinding.dirtyPaths` (say how many more when `dirtyCount` exceeds the listed entries); say nothing about it when `dirtyCount` is `0`. This reports the dirty state — it never offers to stash or commit first, and it never opens a second question. An operator who wants a clean tree declines and runs again after cleaning up.
    - **the pull-request target** — report `data.cloneBinding.proposedBase` as the value that will be used. This is the **only** editable element in the question: accept a free-form answer to change it, and treat every other part as accept-or-decline.
  - else if `data.ask.reuseWorktree` → confirm reuse: *"you're in `<data.derived.worktreeName>`'s worktree on `<data.derived.branch>` — reuse it for `<data.project>`?"* If `data.derived.missingRepos` is non-empty, fold into the **same** question: *"it also needs `<data.derived.missingRepos>`, which aren't in this worktree — add them?"*
  - else if `data.ask.confirmHere` → confirm location: *"you're in `<data.project>`'s worktree on `<data.derived.branch>` — run here?"*
  - **auto_commit / auto_pr** — include in the same question only when `data.ask.autoCommit` / `data.ask.autoPr` is set.

  If the operator declines a clone-binding / reuse / location confirm, stop. (No approval beat here either — `execute prepare` in `data.next` confers it.)

- **`unknown`** — stop. Relay `data.reason` to the operator verbatim and ask how to proceed. Do not guess a run mode or run any `next` command.

## Step 4: Run the next commands
Run every command in `data.next` **in order**, each as:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" <command from data.next>
```

Before running any command in `data.next`, relay every string in `data.notices` to the operator verbatim.

The resolver already substituted everything it knows; substitute only the placeholders it left for your answers — change nothing else:
- `{ac}` / `{ap}` → `always` for a "yes" answer, `never` for "no" (present only when you asked).
- `{base}` → the operator's pull-request target answer, or `data.cloneBinding.proposedBase` when they did not change it (present only when you asked the clone-binding question). Substitute **inside** the double quotes the resolver left; never strip them.
- `{flavor}` (launch only, present only when you asked the launch-flavor question) → map the chosen launch flavor:

  | Launch flavor | `{flavor}` | `--prompt` |
  |---|---|---|
  | Claude Code | `claude` | keep |
  | Copilot CLI | `copilot` | keep |
  | VS Code | `vscode` | drop `--prompt` |

  On Windows, prefix the Claude/Copilot launch line with `MSYS_NO_PATHCONV=1` so the worktree path is not mangled.

### Announcing a terminal launch
When a command in `data.next` is a `worktree launch` command, relay exactly one line immediately before running it, naming `data.derived.launchDir` — not a paragraph, not a bulleted list, not a preamble followed by the line, and not a summary of the project, the plan, the settings, or what happens next.
- If every entry in `data.derived.repos` has a `worktreePath` equal to `data.derived.launchDir`, that folder *is* the repository — name the folder and stop there.
- Otherwise the project's repos sit in their own folders underneath `data.derived.launchDir` — say so; that layout is the surprising part.
- This is narration, not a beat: it never waits for an answer and never becomes another thing to clear.
- Say nothing on the two paths where the operator stays put — continuing in a location they are already standing in, and binding to their own branch. Nothing moved and no terminal opened, so there is nothing to announce.

After a **launch** you are done: the fresh session re-enters `/rad-execute`, resolves to `resume` against the now-settled state, and drives the pipeline. For **in-place** / **resume**, the final `pipeline signal --event start` returns the current pending action — continue driving the pipeline through the `rad-orchestration` skill. Plan approval is conferred for you before `start` (by `execute prepare` on launch/in-place, or a `gate approve plan` step on resume), so `start` advances past the plan gate without a prompt. Commit and PR are governed by the already-sealed `always` / `never` values through the DAG's conditionals; never re-ask or describe them.

## Step 5: Errors
If any command errors, use the `rad-log-error` skill to record it. Do not try to fix pipeline code — work around it with a clear, actionable message that names the failure point.
