---
name: rad-init
description: "Use this skill whenever the user wants to see or change how much the session-start ambient-awareness banner shows — when they ask to preview today's session context on demand, find the banner too chatty, too quiet, or missing outright, or want it turned up, down, silenced, or off. Use it whenever the user runs `/rad-init`, asks what the four verbosity levels mean, or asks how to configure ambient awareness."
user-invocable: true
disable-model-invocation: true
---

# rad-init

Ambient awareness is the project/work-state banner injected at the start of a session. This skill previews it on demand and controls how much of it loads on *future* sessions. Route on `$1`.

## No argument — bare `/rad-init`

Run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session-context --verbosity verbose
```

Relay `data.preamble` to the user verbatim as your reply — this is the full banner, shown on demand regardless of the persisted level. State plainly that this is a one-shot pull for preview only: it never changes the persisted setting.

## `/rad-init help` — and anything `$1` doesn't match below

No CLI call is required for this text. As a courtesy you may also run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" config get
```

and mention `data.ambientVerbosity` as the currently-configured level — this is optional, skip it if you'd rather answer directly. Cover, in your own words:

- **The four levels**, and what each shows at session start:
  - `verbose` — the full banner: project state, active work, everything.
  - `minimal` — a single one-line breadcrumb: the project you're standing in and, when it's an
    iteration of an active portfolio, the portfolio too.
  - `silent` — nothing visible in the transcript, but the agent still loads the full context underneath.
  - `off` — nothing loaded at all; the session starts with zero ambient context.
- **The two configuration paths**:
  - The dashboard's gear-icon config panel → **Ambient Awareness**.
  - Editing `ambient_awareness.verbosity` directly in your `orchestration.yml`.
  - Both persist the level for future sessions. You can also change it right here with `/rad-init <level>` (see below), which persists through the same underlying CLI.

## `/rad-init verbose|minimal|silent|off`

Run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" config set-verbosity --level <level>
```

substituting `$1` for `<level>`. On success, confirm to the user: "Ambient awareness set to `<level>` — effective from your next session onward."

## Anything else

`$1` didn't match a known level — fall back to the `help` behavior above.
