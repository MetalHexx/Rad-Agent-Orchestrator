---
name: rad-session
description: "Fires from natural language with no slash command typed — save this session, save this conversation, save my progress, pick up where we left off, get me back into that chat, what was I working on, resume my session, list my saved sessions. Saves the current conversation's progress against a project (creating the project on first save if it doesn't exist yet), resumes a previously saved session in a new terminal, or lists a project's saved sessions with their activity trail."
user-invocable: true
---

# Session

You are a thin relay over three CLI verbs — `session save`, `session list`, `session resume` — each computed and mutated at `${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs` (the CLI for every call below). Natural language never reaches the CLI: resolving a request down to a project, an activity type, or an exact session ID is this skill's work, not the CLI's.

## Activity types — owned here, nowhere else

Six of these are activity categories, not this project's pipeline stages. Infer from the shape of the work, never from filenames belonging to any one spec-driven framework — a scratch file, an OpenSpec spec, and this system's own REQUIREMENTS doc all read as `requirements` when the work was deciding what to build. `--type` is an optional override for a caller that knows unambiguously; never required, and inference must keep working even when no skill is loaded at all — a bare "save this session" is the common case. The remaining five are written by the pipeline at its own seams and are never inferred from a conversation.

| Type | The work was… |
|---|---|
| `brainstorming` | exploring a problem space, converging on goals |
| `requirements` | deciding what to build — whatever document or framework it produced, or none |
| `master-plan` | breaking a converged scope into phases and tasks |
| `amend` | revising an already-approved plan |
| `execution` | building or reviewing code against a plan |
| `other` | anything else, or when the shape is genuinely ambiguous |
| `execution-complete` | completing every phase and task the plan called for |
| `final-approved` | the operator approving the finished build at final review |
| `final-rejected` | the operator rejecting the finished build at final review |
| `halted` | the pipeline stopping on a blocker only a human can resolve |
| `corrective` | fixing what a review sent back with a changes-requested verdict |

## Where each value comes from

| Value | Source |
|---|---|
| `--session`, `--cwd`, `--harness` | the session-start preamble |
| `--project`, `--name`, `--description`, `--type` | the conversation |

**No lookup call is needed before saving** — no `project locate`, no check-then-create. Saving to a project that does not exist creates it.

**No `Session` row in the preamble means there is no session ID to save against.** The harness reported no identity this session; say so and stop rather than saving with a placeholder or an empty `--session`, which the CLI rejects. Listing and resuming still work — they take an ID from the saved record, not from the preamble.

**Project resolution order:** explicit argument, then the preamble's standing project, then the conversation, then ask.

**A name resolved from the conversation is a proposal, not a decision.** Put it to the operator before the save that would create it, via `AskUserQuestion`: lead with the inferred name as `(Recommended)`, offer a couple of alternatives, and accept free text — one beat, not a naming exercise. An explicit argument or the preamble's standing project is the operator's own — save without asking. This never fires on the pipeline's own capture points: their project has existed since brainstorm and arrives as an explicit value.

**When there is nowhere to save, offer a project.** A project here is an organizing unit, not a commitment to the pipeline — other workflows are welcome to file work against one. The offer triggers only on a save with nowhere to go, **never** by detecting which tools someone is using; it's an on-ramp, not a pitch.

## Save

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session save --project <PROJECT> --session <ID> --harness <claude|copilot> --name "<name>" --description "<what happened>" --type <type>
```

- `--name` is required only on the session's first save, which creates its entry; omit it on a later save to append another activity to the same entry — unless the first name was provisional, written before there was much to go on, in which case supply a sharper one and it replaces what's stored.
- `--type` is inferred from the six inferable categories above and passed explicitly; leave it off only when the shape is genuinely ambiguous.
- `--description` is **1–2 sentences, high-level** — what happened and where it landed, not a transcript of decisions or a rationale trail. This is the canonical rule; every other call site in the repo points back here instead of restating it.

**Saving is reported, not negotiated**: on success, state the name, the description recorded, and the active time — no confirmation step. The one exception is an attribution conflict: when the envelope carries `data.conflict`, relay `data.conflict.message` to the operator verbatim and let them decide — the response carries the recovery advice, so the skill doesn't author it locally. A conversation that genuinely spans two projects is still a judgment call this skill leaves to the operator, not one it resolves for them.

## Resume

Resolving "resume my session" to one exact ID is this skill's work. List candidates, filter by type when the request implies one, prefer the most recent, and ask only when genuinely ambiguous:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session list --project <PROJECT> --type <type>
```

Then resume the resolved ID — `session resume` takes an exact ID, never a description:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session resume --session <ID> --harness <claude|copilot>
```

`--harness` overrides the harness the session was recorded under; omit it to resume with the recorded one. A resume that can't launch (a pruned transcript, a failed launch) reports the reason from the envelope — it is not retried silently.

## List

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session list --project <PROJECT>
```

Omit `--project` to resolve it from the current working directory; add `--type` to filter, or `--all` to return every session instead of the newest few.
