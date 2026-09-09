# Amendment Document

You author an **amendment** — a document that changes what an already-approved
Master Plan scopes: adding a phase or task it did not originally carry,
restating one of its existing tasks or phases in place, or dropping one
outright. Ground against the current project and author the content the
amendment needs. Nothing already executed or already judged is available to
touch — an amendment moves only within the plan's still-open frontier.

This is a **delta reference**: it covers only what differs from authoring a
Master Plan. Every other authoring judgment — density, sizing posture,
complexity, one repo per task, testing by judgment, the self-check — is the
same call the Master Plan makes; see
[the authoring standard](../authoring-standard.md) and apply it here unchanged.

## Output

**Filename**: `{NAME}-AMENDMENT-{NN}.md` at the project root, with a zero-padded
two-digit index — a project's first amendment is `-01`, its second `-02`, and
so on.

**Frontmatter**:

```yaml
---
project: "{PROJECT-NAME}"
type: amendment
amendment: {N}
created: "{YYYY-MM-DD}"
adds_phases: [P04]
adds_tasks: [P02-T05, P04-T01]
revises_tasks: [P03-T02]
drops_tasks: [P03-T04]
drops_phases: [P05]
---
```

`amendment` is the amendment's own 1-based index, matching the number in its
filename. The five keys below declare what the amendment does to the plan it
amends — omit any key whose list would be empty (an amendment that drops
nothing carries no `drops_tasks:` at all, and likewise for the other four).
Each is explained by what it resolves, not by symmetry with its neighbors:

| Key | Why it exists |
|---|---|
| `adds_phases` | Insert-and-push versus restate — identical blocks, opposite outcomes |
| `adds_tasks` | A true discriminator now revise exists: an occupied task id could mean splice-and-push or replace-in-place |
| `revises_tasks` | The other side of that ambiguity; position cannot infer it, because an occupied id legitimately means "insert here" |
| `drops_tasks` | A drop carries no block; nothing exists to infer from |
| `drops_phases` | Invisible in the document, and the most destructive outcome available — asserted, not inferred |

**There is no `revises_phases:`.** A restated phase block is visible in the
document with its new text, `adds_phases`'s presence or absence already
discriminates insert from restate, and nothing is destroyed — it would encode
a state that already has an encoding. Do not add it for symmetry with
`revises_tasks:` — that is exactly the mistake `revises_tasks:` invites now
that it exists. The rule this makes explicit: **including a phase block whose
id is not declared in `adds_phases` means rewriting that phase's own
description.** That has always been the behaviour; it has only ever been
implicit, and it needs saying now that `revises_tasks:` exists to be mistaken
for its counterpart.

**No `repos:` key** — deliberately. The Master Plan parser enforces a
two-way equality between the sealed `repos:` set and the union of every
task's `**Target repo:**` line; run against a document that holds only part
of the plan, that equality always fails. Leaving the key out of an
amendment's frontmatter skips the check here — the merged result's repo
scope is guarded once the amendment is folded into the plan, not before.

**Body**: a `## Rationale` section, in the operator's own terms, followed
directly by the phase and/or task blocks the amendment carries, in exactly
the Master Plan's anchor form (`## P{NN}: {Title}`, `### P{NN}-T{MM}: {Title}`).
The Master Plan parser reads an amendment directly — the rationale lands in
its preamble, the blocks land in its phases — so there is no second grammar to
learn: write these blocks exactly as the worked example in the authoring
standard shows.

## The positional contract

The numeric id in a block's heading is the only signal the merge reads — it
is what tells the merge "insert here" from "replace here":

- Ordering follows the numeric id in the block heading. Numbering within a
  phase is continuous and positional.
- An id one past the end appends.
- An id held by editable content splices in, displacing that content and
  everything after it upward.
- An id held by frozen content, or beyond one past the end, is a merge-level
  error.
- `revises_tasks` and `drops_tasks` name ids **in the plan as it stands
  today**. Added block positions are read against the plan **after** the
  revises and drops have been applied. That is the resolution order: revise,
  then drop, then add.
- A drop closes the gap behind it — the tasks after a dropped one shift up.
- A phase the amendment empties of tasks is removed, and that removal must
  be declared in `drops_phases:`.
- A task that only moves keeps the handoff document it already has, under
  its original filename. Only a revised task's handoff is rewritten; only a
  dropped task's handoff is removed.

**A worked example**, over one phase holding both executed and unstarted
tasks:

```
P03 before:  T01 completed   T02 completed   T03 not started   T04 not started

revises_tasks: [P03-T03]   → T03 keeps its id; its block is restated in full
drops_tasks:   [P03-T04]   → T04 is gone; nothing shifts, it was last
adds_tasks:    [P03-T04]   → the new block lands at T04, the slot the drop freed

P03 after:   T01 completed   T02 completed   T03 revised       T04 new
```

A revise or a drop aimed at `T01` is refused: it is completed, and something
already references it.

## Repo scope arrives pre-confirmed

By the time you author, `/rad-amend`'s reasoning step has already checked every repo this amendment reaches against the project's registered set and confirmed it with the operator — the same discipline the Master Plan and Requirements workflows apply to their own `repos:` frontmatter, one step earlier in this chain. Write each task's `**Target repo:**` from that confirmed set.

This is not only a courtesy: `amendment validate` and `amendment apply` already refuse a task whose `**Target repo:**` is neither in the plan's sealed set nor registered on the project, so an unconfirmed repo surfaces as a merge-level error regardless. The front-door check exists so that error is never the operator's first signal — catch it in conversation, not at validation. If a task you're about to write needs a repo nobody confirmed, the amendment's shape has changed since that step; stop and return to it rather than writing the task.

A phase's own declared repos never need separate handling: the Execution Map is regenerated from the merged tasks on every apply, so it is always the union of what its tasks actually declare — never something to hand-maintain or re-confirm here.

## Grounding is fresh

Ground every task the amendment authors against the **current working tree** —
never against the original plan's pinned signatures or resolved shapes. The
project has already changed the files the original plan pinned, so its
External surface may be stale; carrying it forward unchecked plants a broken
contract in a document nobody re-verifies.

## Sizing is inherited, not re-chosen

An amendment should read like the same project, not a fresh sizing decision.
The Requirements doc's frontmatter already carries the sealed `template` tier
and the operator's `task-size` answer verbatim — including a free-form sizing
criterion, when that's what was given — so read both from there and size the
amendment's tasks to match. Nothing new is persisted here, and an amendment
never alters the tier.

## Phase briefs

A phase gaining a task, a phase losing one to a drop, and a phase holding a
revised task all change what "done" means for that phase — and phase review
judges the phase against its stated Intent, Exit criteria, and Integration
seams alone, not against the task set it happened to have when those were
written. Whichever of the three touches a phase, restate that phase's brief
in full.

A drop carries no block of its own to carry a restated brief. To restate the
brief of a phase you are dropping a task from, include that phase's block
with its revised body anyway — exactly as a phase gaining a task does.

## The retry loop

Blocks parse under the same parser the explosion uses. On a structured parse
error, fix only the flagged issue and leave the rest of the amendment intact —
re-authoring a whole amendment over one malformed heading is how a small
mistake becomes a different amendment than the one the operator approved.
**The cap is 3 retries**, matching the explosion recovery loop's cap in the
master-plan workflow; past it, the failure goes to the operator with the
structured detail rather than looping further.
