# Coder-Commit E2E — **Pipeline-mode** Runner Prompt

> **Token cost.** This drives the **real `radorch.mjs` pipeline engine** from a pre-built
> Requirements + Master Plan, through the plan gate, into the **execution/commit tier**. It spawns
> `@coder` **once** (real Opus-tier spend). No planner / reviewer subagents are spawned — the coder
> is the only live agent; the Master Plan is seeded, not authored.
>
> **This runner WRITES INTO THE REAL `~/.radorc`** and **tears it down afterward.** Read the Safety
> section before you start. Every artifact it creates lives under two distinctly-named dirs
> (`~/.radorc/projects/CODER-COMMIT-PIPE-E2E` and `~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E`)
> that are removed at the end. **Never delete anything outside those two dirs.**

---

## Why this mode exists (vs the isolated `_runner.md`)

The sibling [`_runner.md`](./_runner.md) is the **isolated** harness: it hand-rolls a sandbox git
repo under `output/`, hand-writes the coder spawn prompt, and asserts the coder's commit *contract*.
It is fast and hermetic but it **cannot** exercise the pipeline glue PLANNING-OVERHAUL-3 rewrote.

This **pipeline mode** fills that gap. It drives the production engine so that:

- the **real explosion** generates the handoff (no hand-authored handoff → no staleness risk);
- the **engine composes the coder spawn prompt** — `context-enrichment` builds `repos[]` and
  `should_commit` — instead of the runner hand-writing it;
- the **`task_completed` mutation records the commit hash** into `state.json` and enforces
  `assertReposOnBranch` — the core PO-3 glue the isolated harness can't reach;
- the pipeline **advances cleanly** to `spawn_final_reviewer` (the LOW-tier halt point).

Keep both runners. They are complementary — isolated = fast contract check, pipeline = integration.

---

## Mission

You are a **simulated orchestrator** driving the real engine via `radorch pipeline signal`. You do
**not** hand-edit `state.json` and you do **not** fabricate envelopes. After each signal you parse
the JSON envelope on stdout, act on `data.action` / `data.prompt`, and follow the embedded `Signal:`
line as authoritative for the next event. The only live subagent is `@coder`, dispatched by executing
the engine's own `execute_task` spawn prompt.

The routing reference lives at
`~/.claude/skills/rad-orchestration/references/pipeline-guide.md`; the commit contract the coder
follows lives at `~/.claude/skills/rad-source-control/references/creating-commits.md`.

**`radorch` invocation (every call):**
```
node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs <args>
```

---

## Names (hold constant)

| Thing | Value |
|---|---|
| Project name == project-dir basename == repo name == doc filename prefix | `CODER-COMMIT-PIPE-E2E` |
| `DIR` (planning docs + `state.json`) | `~/.radorc/projects/CODER-COMMIT-PIPE-E2E` |
| `SIDEREPO` (the code repo the coder commits into) | `~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E` |
| Generated handoff | `DIR/tasks/CODER-COMMIT-PIPE-E2E-TASK-P01-T01-SLUGIFY.md` |
| Task branch (side-project seal default) | `main` |

The distinctive name is deliberate: an orphaned run is instantly recognizable in `~/.radorc`, and the
teardown globs can't collide with a real project.

---

## Inputs

| Input | Value | Notes |
|-------|-------|-------|
| Fixture | `pipeline-sideproject` | `fixtures/pipeline-sideproject/` — `REQUIREMENTS.md` + `MASTER-PLAN.md`, new `R{n}` / current master-plan shape. |
| Tier | `low` | `--template low` — simplest execution DAG (`task_loop = [task_executor]`); after the one `task_completed` the engine returns `spawn_final_reviewer` (clean halt). |
| Run folder (for `run-notes.md` only) | `output/pipeline-sideproject/baseline-pipeline-sideproject-<YYYY-MM-DD>/` | The **repo itself** lives in `~/.radorc` and is torn down — the run-notes are the durable artifact. Folder must start with `baseline-` for the `.gitignore` exception to re-include `run-notes.md`. |

All `prompt-tests/...` paths are relative to the repo root.

---

## Step 0 — Preflight (and idempotent pre-clean)

1. Confirm `~/.radorc` exists and `radorch` runs:
   `node ~/.claude/skills/rad-orchestration/scripts/radorch.mjs --help` (any zero-exit is fine).
2. **Read the machine's gate policy:** open `~/.radorc/orchestration.yml` and note
   `human_gates.execution_mode`. The shipped default is `autonomous` (→ `gate_mode_selection`
   auto-approves → `execute_task` appears directly). If it is `ask`, an `ask_gate_mode` action will
   appear before `execute_task` — you will answer it in Step 6.
3. **Idempotent pre-clean.** If a prior run was orphaned, `side-project init` (git init) will fail on
   an existing repo. So, before creating anything, remove any stale run:
   ```
   rm -rf ~/.radorc/projects/CODER-COMMIT-PIPE-E2E
   rm -rf ~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E
   ```
   (Same two paths as teardown. **Never** touch anything else under `~/.radorc`.)
4. Scaffold the project dir the explosion writes into, then stage the two fixtures **renamed** to the
   project convention:
   ```
   mkdir -p ~/.radorc/projects/CODER-COMMIT-PIPE-E2E/phases
   mkdir -p ~/.radorc/projects/CODER-COMMIT-PIPE-E2E/tasks
   mkdir -p ~/.radorc/projects/CODER-COMMIT-PIPE-E2E/backups

   cp prompt-tests/coder-commit-e2e/fixtures/pipeline-sideproject/REQUIREMENTS.md \
      ~/.radorc/projects/CODER-COMMIT-PIPE-E2E/CODER-COMMIT-PIPE-E2E-REQUIREMENTS.md
   cp prompt-tests/coder-commit-e2e/fixtures/pipeline-sideproject/MASTER-PLAN.md \
      ~/.radorc/projects/CODER-COMMIT-PIPE-E2E/CODER-COMMIT-PIPE-E2E-MASTER-PLAN.md
   ```
   Do **not** pre-seed `state.json`, `template.yml`, or `orchestration.yml` — the engine creates
   those lazily on the first signal.

> `$DIR` below = `~/.radorc/projects/CODER-COMMIT-PIPE-E2E`, `$SIDEREPO` =
> `~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E`. Expand them literally in the commands you run.

---

## The runbook (drive the real engine; follow each envelope's `Signal:` line)

After each `pipeline signal`, parse the JSON envelope and act on `data.action` / `data.prompt`. The
sequence below is the **expected** path; if an envelope diverges, follow the envelope, not this list.

**1. `start` (cold-start, seeds state from `low.yml`).** Returns action `spawn_master_plan`.
```
radorch.mjs pipeline signal --event start --project-dir "$DIR" --template low
```

**2. Master Plan is already on disk — do NOT author it.** The `spawn_master_plan` envelope asks for a
Master Plan; you already staged it in Step 0. Confirm it exists, then signal completion (returns
action `explode_master_plan`):
```
radorch.mjs pipeline signal --event master_plan_completed --project-dir "$DIR" \
  --doc-path CODER-COMMIT-PIPE-E2E-MASTER-PLAN.md
```

**3. Explode (subcommand — no agent spawn).** Run exactly what the `explode_master_plan` envelope's
`data.prompt` specifies (it carries the right flags). Shape:
```
radorch.mjs plan explode --project-dir "$DIR" \
  --master-plan "$DIR/CODER-COMMIT-PIPE-E2E-MASTER-PLAN.md" \
  --project-name CODER-COMMIT-PIPE-E2E
```
On exit 0, read `data.emittedPhases` / `data.emittedTasks` (expect 1 / 1) and confirm the handoff
exists at `DIR/tasks/CODER-COMMIT-PIPE-E2E-TASK-P01-T01-SLUGIFY.md`. This also sets
`state.project.project_type = side-project` and seeds
`…task_loop.iterations[0].repos[0].commit_hash = null`. On exit 2 (parse failure) signal
`explosion_failed --parse-error '<json>'` and surface; on exit 1, halt and surface.

**4. `explosion_completed`.** Returns action `request_plan_approval` (the plan gate).
```
radorch.mjs pipeline signal --event explosion_completed --project-dir "$DIR"
```

**5. Approve + seal the side-project (shell — this is the operator standing in for `/rad-execute`).**
`execute prepare` provisions the side-project's local repo (`git init -b main` + seed commit at
`$SIDEREPO`), **seals** `pipeline.source_control` with `auto_commit: always`, `auto_pr: never`,
`repos: [{name, branch: main, base_branch: main, remote_url: null}]`, and confers `plan_approved`:
```
radorch.mjs execute prepare --project CODER-COMMIT-PIPE-E2E
```
> **Do NOT pass `--auto-commit never`.** Omitting the flag resolves to `always` — the load-bearing
> setting that makes `should_commit` true. Passing `never` would silence the commit and defeat the
> whole test.
>
> Decomposed equivalent, only if `execute prepare` misbehaves:
> `side-project init --project CODER-COMMIT-PIPE-E2E` →
> `source-control init --project CODER-COMMIT-PIPE-E2E` →
> `pipeline signal --event plan_approved --project-dir "$DIR"`.

**6. Re-signal `start` to resolve the next execution action.** `start` is always safe (loads state,
applies no mutation). Returns action **`execute_task`** with `data.context.repos = [{name, path:
$SIDEREPO, branch: main}]`, `data.context.should_commit: true`, `data.context.complexity: simple`,
and `handoff_doc` = the generated handoff.
```
radorch.mjs pipeline signal --event start --project-dir "$DIR"
```
> **If instead you get `ask_gate_mode`** (machine's `execution_mode: ask`): answer it, then re-poll.
> ```
> radorch.mjs pipeline signal --event gate_mode_set --gate-mode autonomous --project-dir "$DIR"
> radorch.mjs pipeline signal --event start --project-dir "$DIR"
> ```
>
> **Capture the `execute_task` envelope verbatim** into `run-notes.md` — it is pass-criterion #2
> evidence (proof the engine composed the spawn prompt, not the runner).

**7. Spawn `@coder` by executing the envelope's `data.prompt` as written.** It already inlines the
`repos[]` array and the commit directive — do **not** hand-write a spawn prompt. The coder:
reads only the handoff; creates `src/slugify.js` + `src/__tests__/slugify.test.js` in `$SIDEREPO`;
runs `node --test`; runs its on-branch gate (`git -C $SIDEREPO symbolic-ref --short -q HEAD` ==
`main`); stages its two files by explicit path; commits `{prefix}(P01-T01): {title}`; probes for an
`origin` (finds none → skips push); and returns its per-repo row
`[{ name: "CODER-COMMIT-PIPE-E2E", committed: true, commitHash: "<sha>", pushed: false }]` plus the
branch (`main`).

**8. Relay the coder's result on `task_completed`.** Pass the per-repo array **unchanged** via
`--repos` and the branch via `--branch`. The mutation records the hash against the task iteration,
enforces `assertReposOnBranch` (rejects an off-branch commit), and refuses to overwrite a finalized
hash. Returns action **`spawn_final_reviewer`**.
```
radorch.mjs pipeline signal --event task_completed --project-dir "$DIR" \
  --repos '[{"name":"CODER-COMMIT-PIPE-E2E","committed":true,"commitHash":"<sha>","pushed":false}]' \
  --branch main
```

**9. HALT at `spawn_final_reviewer`.** Do **not** spawn the reviewer. The execution/commit tier — the
whole point of this harness — is done. Gather evidence, write `run-notes.md`, then run **teardown**.

---

## Gather evidence (into `run-notes.md`, BEFORE teardown)

The `$SIDEREPO` git repo is deleted at teardown, so capture everything first. Record verbatim:

1. The **`execute_task` envelope** (`data.context.repos`, `should_commit`, `handoff_doc`) — criterion #2.
2. The **generated handoff** frontmatter + its `**Files for CODER-COMMIT-PIPE-E2E:**` section — criterion #1.
3. The coder's reported per-repo JSON row + branch, and the real `node --test` output it captured.
4. Git state of `$SIDEREPO` (run before teardown):
   ```
   git -C "$SIDEREPO" symbolic-ref --short HEAD          # expect: main
   git -C "$SIDEREPO" log --oneline                      # expect: seed + exactly one new commit
   git -C "$SIDEREPO" log -1 --pretty=%s                 # the commit subject
   git -C "$SIDEREPO" rev-parse --short HEAD             # the real hash
   git -C "$SIDEREPO" remote                             # expect: empty
   git -C "$SIDEREPO" show --stat --oneline HEAD         # expect: only src/slugify.js + src/__tests__/slugify.test.js
   ```
5. The **recorded hash** from `state.json`:
   `state.graph.nodes.phase_loop.iterations[0].nodes.task_loop.iterations[0].repos[0].commit_hash`
   — must equal `rev-parse --short HEAD` and the coder's reported hash (criterion #6).
6. The **post-`task_completed` envelope's** `data.action` — must be `spawn_final_reviewer` (criterion #7).
7. Re-run `node --test src/__tests__/slugify.test.js` in `$SIDEREPO` yourself (don't trust the coder's
   capture) and record the output (criterion #8).

Then evaluate each pass criterion and mark it green or red. **If any red, STOP and surface — never
hide a red under a green report.** Run teardown regardless.

---

## Pass criteria — 8 checks (pipeline mode)

1. **Real explosion produced a current-shape handoff** at
   `DIR/tasks/CODER-COMMIT-PIPE-E2E-TASK-P01-T01-SLUGIFY.md` with frontmatter `type: task_handoff`,
   `complexity: simple`, `repos: ["CODER-COMMIT-PIPE-E2E"]`, and a
   `**Files for CODER-COMMIT-PIPE-E2E:**` section. (No hand-authoring; no staleness.)
2. **Engine composed the spawn prompt** — the captured `execute_task` envelope carries
   `context.should_commit: true`, `context.repos = [{name, path: $SIDEREPO, branch: "main"}]`, and a
   `handoff_doc` pointing at the generated handoff.
3. **On-branch commit on `main`** — `git -C $SIDEREPO symbolic-ref --short HEAD` == `main`; exactly
   one new commit beyond the seed; the gate was honored (not detached, not off-branch).
4. **Message format** — subject matches `^(feat|fix|refactor|test|docs|chore)\(P01-T01\): .+`.
5. **No-remote path** — coder reported `pushed: false` **and** `git -C $SIDEREPO remote` is empty.
6. **`task_completed` recorded the hash** — the `state.json` `…repos[0].commit_hash` ==
   `git -C $SIDEREPO rev-parse --short HEAD` == the coder's reported hash. **(The core PO-3 glue.)**
7. **Pipeline advanced correctly** — the post-`task_completed` envelope's `data.action` ==
   `spawn_final_reviewer` (clean halt; no reviewer spawned).
8. **Staging discipline + engineering** — the commit contains **only** `src/slugify.js` +
   `src/__tests__/slugify.test.js`; `slugify` is a named ESM export satisfying the `Done when` cases
   (`slugify('Hello, World!') === 'hello-world'`, `slugify('  Foo   Bar  ') === 'foo-bar'`, no default
   export); the suite passes under real `node --test` (output captured, independently re-run).

All 8 green → clean baseline. Any red → STOP, surface, **and still run teardown.**

---

## Teardown (MANDATORY — on success AND on failure/halt)

Because this wrote into the real `~/.radorc`, teardown is not optional:
```
rm -rf ~/.radorc/projects/CODER-COMMIT-PIPE-E2E
rm -rf ~/.radorc/side-projects/CODER-COMMIT-PIPE-E2E
```
- **Leave `~/.radorc/.gitignore` alone** (its shared `side-projects/` line is idempotent and used by
  other side-projects).
- Side-projects are discovered by directory scan — no `install.json` / registry entry is created, so
  the two `rm -rf`s fully de-register the run. No `~/.radorc/worktrees/<P>` is created for a
  side-project.
- Confirm both dirs are gone. Then, at the repo root, `git status` should show only
  `output/pipeline-sideproject/baseline-*/run-notes.md` as a trackable change.

---

## Safety / preflight notes (read first)

- **Token cost:** one real `@coder` (Opus) invocation; no planner / reviewer subagents.
- **Writes to the real `~/.radorc`** during the run — the distinctive project name
  `CODER-COMMIT-PIPE-E2E` makes an orphaned run recognizable. **Never delete anything outside the two
  `CODER-COMMIT-PIPE-E2E` dirs.**
- **Config-adaptive:** read `orchestration.yml` `execution_mode`; insert the `gate_mode_set` step iff
  an `ask_gate_mode` action appears. Follow each envelope's `Signal:` line as authoritative.
- **Do NOT** hand-edit `state.json`, fabricate envelopes, or pass `--auto-commit never`.
- `execute prepare`'s `side-project init` seeds a commit, so a committable git identity already exists
  in `$SIDEREPO`. If a commit ever fails on missing identity, set local `user.name` / `user.email` in
  `$SIDEREPO` (mirrors the isolated runner) and note it.

---

## Exit

Once `run-notes.md` is written **and teardown has run**, surface to the operator:
- the run-notes path (`output/pipeline-sideproject/baseline-pipeline-sideproject-<DATE>/run-notes.md`);
- the 8-criteria summary (green/red);
- confirmation that both `~/.radorc/...CODER-COMMIT-PIPE-E2E` dirs are gone.

The committed `run-notes.md` — envelopes + `state.json` slice + git evidence — **is** the durable
artifact; the repo it describes lived in `~/.radorc` and is intentionally gone.

> Scope: this covers the coder's fold-in commit contract **through the pipeline** for the
> side-project (no-remote) case. The push-to-remote half (`pushed: true`, via a local bare `origin`)
> and the PR node remain out of scope — see the behavior [`README.md`](./README.md).
