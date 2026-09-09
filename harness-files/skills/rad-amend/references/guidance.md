# Amendment: Collaborative Reasoning

This is the posture `rad-amend`'s SKILL.md hands off to for its reasoning step. It governs how you talk with the operator before anything exists on disk — not what to write down, but how the two of you reach a shared understanding of whether an amendment is the right move, and roughly what it would contain, before there is anything to approve.

## Open by working it out together, not by taking dictation

Open by helping the operator work out what is actually going on, not by asking what they want the amendment to say. State plainly, in your own words, what the project **delivered** against what it **owed** — draw this from `project show`'s state, status, and tier, from `amendment status`'s history of what's already landed, and from the project's Requirements and Master Plan documents that `project show` points you at. Give the operator that full picture before asking them to reason about it. The frame is narrow — an already-scoped project growing or correcting course, not a new problem space opening up — so reach a shared understanding quickly rather than drawing it out.

## Report the cost, don't gatekeep the intent

**Mid-run there is no corrective to weigh against.** An operator-initiated change mid-run is always an amendment. The corrective-versus-amendment routing belongs to the final-approval gate, not to a mid-run project — a project parked at that gate isn't mid-run, and this skill's own Step 2 runs that same routing when it finds one there.

Instead of asking whether the change qualifies as an amendment, tell the operator what it costs, on two dimensions:

- **How much already-built work it invalidates** — tasks that ran and delivered something the change now contradicts.
- **How much of the plan it reopens or rewrites to absorb it** — phases and tasks that must be revised, not just the new content being added.

From that cost, name the three legitimate exits and let the operator pick: **proceed as an amendment** (the change folds into the existing plan), **open a follow-up project** (the change is real but doesn't belong inside this project's already-sealed tier and sizing), or **abandon the current project** (when the change reads as a rewrite of what the project was for, not an addition to it). A change that invalidates nothing and reopens little is stated as such and proceeds with barely a conversation — do not make the cheap case pay for the expensive one's ceremony.

The cost report's concrete form, task by task:

| State of the task | What the amendment does |
|---|---|
| Not started | Revise it, or drop it |
| Executed and still correct | Leave it |
| Executed and now wrong | Add a superseding task — revision cannot reach it |

## Surface what the operator wouldn't raise on their own

Before any agreement is reached, put these on the table, even if the operator doesn't ask:

- **What reopens.** Which phase or task resets to re-run, and whether a halted node clears as a result.
- **What the amendment costs.** Roughly how much additional work — review passes, coder time, wall-clock — the addition represents, so the decision is made with that weighed in.
- **Whether the gap is one task or a phase.** A task folded into a phase that hasn't run yet is a light touch; a gap that needs its own Intent, Exit criteria, and Integration seams is a heavier one, and the operator should know which they're approving.
- **Whether an open PR is affected.** A project with commits already out for review is a different conversation than one still mid-flight — say so if `project show`'s relationships suggest it.
- **Whether the change reaches a repo the project hasn't already got.** Split the repos an amendment touches the way that check always does — which get changed, which are only read for reference — and say so plainly when one of them is new to the project.

## Never scribe without approval

The amendment document is written only after the operator has explicitly agreed to what it will say — and, in the same breath, to whether it gets an audit pass.

- **Restate before you scribe, audit choice included.** Say plainly what the amendment will add and what it will reopen, in concrete terms, and offer the audit choice alongside it — not "should I write this up?" but "this adds a task to P03 that does X, and reopens nothing because P03 hasn't run yet — write it, and do you want an audit pass first?" — so approval is given against something concrete, not a vague intention.
- **Keep reasoning if they're still thinking.** An operator working through the tradeoffs is not stalling; match their pace rather than pushing toward a decision.
- **Permission resets when the shape changes.** If the scope grows, shrinks, or moves to a different phase after approval was given, that approval no longer covers what would actually be written — restate the new shape and ask again.
