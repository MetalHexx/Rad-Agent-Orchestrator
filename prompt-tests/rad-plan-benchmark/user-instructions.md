# rad-plan-benchmark — How to Run

A friendly walkthrough for baselining the `/rad-plan` planning pipeline. No prior
knowledge of the orchestration internals required.

## What this is

A **stopwatch + tape measure** for `/rad-plan`. It runs the real planning skill against a
small fixed project (a rainbow ASCII "HELLO WORLD" CLI) and stops at the plan-approval
gate. It does **not** judge whether the output is correct — it captures **how much the
planning pipeline cost** (tokens + time, via observability) and **what it produced** (the
full set of planning documents, saved under a numbered `run-N/` folder).

Use it to baseline the pipeline today, refactor `/rad-plan`, run it again, and compare.

## What a run produces

1. **An observability session** — the complete token/time spend for the run, viewable and
   comparable in the dashboard.
2. **A `run-N/` artifact folder** — Requirements, Master Plan, and the exploded
   phase/task files, so you can diff the *output* across refactors.

## Prerequisites

- Node.js 20+ and the repo cloned, terminal at the repo root.
- Orchestration scripts installed once:
  `cd .claude/skills/rad-orchestration/scripts && npm install && cd -`
- The dashboard running if you want the session link to resolve — start it with
  `/rad-ui-start` (check with `/rad-ui-status`). It serves on a configurable port (default 1337, via `ui.port` in `orchestration.yml`).

## Run it

1. Open a **fresh** Claude Code session at the repo root. "Fresh" matters: leftover
   context from other work inflates the spend you're trying to measure.
2. Copy the entire contents of `prompt-tests/rad-plan-benchmark/_runner.md`.
3. Paste it as your first message.
4. The session will:
   - Pick the next `run-N` folder and stage the fixture into it.
   - Invoke `/rad-plan RAD-PLAN-BENCH`.
   - Answer the **tier** menu with `extra-high` and the **size** menu with `Small`
     (pinned for comparability — don't change them).
   - Drive Requirements → Master Plan (+ audit) → explosion.
   - **Stop at the plan-approval gate without approving.**
5. When it halts it prints:
   - the run folder path,
   - a one-line census (requirement / phase / task counts),
   - the **observability session URL**:
     `http://localhost:1337/observability/session/<your-session-id>` (the dashboard's
     configurable default port, per `ui.port` in `orchestration.yml`).

Typical duration: a few minutes (two planner calls + audit + explosion).

## Compare two runs

**Spend** — open both session URLs in the dashboard and compare the summary cards
(tokens in/out/cache, wall-clock). This is your speed + efficiency delta.

**Artifacts** — diff the folders:

```
diff -r prompt-tests/rad-plan-benchmark/output/run-1/RAD-PLAN-BENCH \
        prompt-tests/rad-plan-benchmark/output/run-2/RAD-PLAN-BENCH
```

Filenames are identical between runs (the project name is fixed), so the diff is clean.

> **Mind the noise.** Planner output is non-deterministic by design, so two runs of the
> *same* pipeline won't be byte-identical and their spend will vary. For a marginal
> delta, do **3 runs per side** and compare medians before concluding a refactor helped
> or hurt.

## If something looks wrong

If the session errors out, the pipeline returns `ok: false`, or it tries to spawn an
execution-tier agent before the plan-approval gate — stop and surface it. Include the run
folder path. A broken benchmark run is worth catching, not papering over.
