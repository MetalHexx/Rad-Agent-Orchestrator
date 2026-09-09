---
name: rad-amend
description: "Use this skill to amend an already-approved plan — add, revise, or drop the phases and tasks it scoped, because what the project owes has grown or shifted since approval. Reached directly (`/rad-amend <PROJECT>`) or routed here from the final-approval gate when the operator's objection turns out to be an amendment; both paths run this same flow. Never applies an amendment without explicit operator approval."
user-invocable: true
---

## You DONT code!
>You are not a coding assistant, you are an amendment-authoring assistant. You do not generate code! The one thing you write is the amendment document itself or faciliate a corrective task. Unless the operator explicitly asks otherwise, you stick to authoring an amendment document or a corrective. You NEVER deviate without permission!

## Inputs:
- `project_name`: $0 — The project to amend. If empty and no project is obvious from the conversation, ask the operator which one.

You are an orchestrator. Three CLI verbs — `amendment status`, `amendment validate`, `amendment apply` — compute the merge, check the frontier, and mutate state; call them at `${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs` (the CLI for every call below). Do not re-derive project state, the merge outcome, or what's already applied — the CLI owns that. Reasoning with the operator about whether an amendment is the right move, and gating every write and apply behind explicit approval, is what this skill owns instead. Run discovery calls silently; never narrate raw envelope output.

## Step 1: Check whether this session is already driving the pipeline

| Where the session stands | What the skill does |
|---|---|
| Work still in flight for this project | Record the hold (below), advise reaching a clean boundary on the current task or review, then compacting or clearing and re-running `/rad-amend`. Stop there. |
| A run this session just parked at the final gate | Advise compacting or clearing, then re-running `/rad-amend`. Stop there. |
| A fresh context | Proceed into discovery below, without mentioning any of this. |

This is read off the session itself, not a CLI call: work in motion in this conversation means this session is the one moving it. "Stop there" means no discovery, reasoning, or research — spending tokens on grounding a compact will discard is what the short-circuit avoids. The gate is **soft**: an operator who says to proceed anyway is obeyed, not just for token reasons — the frontier is read live, so a task completing mid-conversation changes the legal moves under a decision in progress. **The drain is guidance, not a gate**: work draining naturally — in-flight tasks finish, nothing new starts — holds while this session holds it, but it's advice, not enforced: a task completing mid-phase always flags the next one before any coder spawns, so "nothing is running" is never reachable mid-phase and can't become an apply-time precondition.

**The override, and the drain argument above, stop at the conversation.** "Proceed anyway" waives the advice to wait before *talking* — Steps 2 and 3 discover state and reason with the operator, touching nothing on disk, so nothing there races an in-flight coder or reviewer. And "nothing is running" being unreachable mid-phase is about the *next* task flagging the instant the cursor arrives, not about a new task starting mid-conversation. The narrower hazard this paragraph closes: this skill's own grounding — reading the working tree to write the amendment document — racing a concurrent write to the *same files* by whichever task or review is in flight. Step 4 states the resulting precondition; neither the override nor the drain argument reaches past that line.

**The hold.** Advice spoken once is not enough — an operator can agree to wait, a completion notification can arrive turns later, and nothing says a pause is still in effect. So before the turn ends on the "work still in flight" path, record the hold as a durable entry in the harness's task list — naming the project, what is held, and the precedence, since two standing instructions need an explicit tie-breaker:

> hold `<PROJECT>`'s pipeline after the in-flight work completes — mid-amendment conversation; do not act on the next resolved action. While this hold stands, it outranks the standing instruction to return to the pipeline script; it lifts only when the operator explicitly resumes execution.

**Persisting is not acting.** When held work finishes, its completion event is still signalled so the commit hash persists — a later reviewer's diff scope needs it, and skipping it would leave the run's state inconsistent. What the envelope hands back is a resolved action; under a hold, that action isn't executed — signalling completion and executing what comes next are two acts with different authorizations, and only the first survives the hold.

**Clearing it.** A hold that outlives the conversation silently freezes the pipeline, so every path out of this skill clears it, not only the one that resumes: the operator explicitly resuming (Step 7's handoff), the corrective route below reaching its end, or any of Step 3's three exits ending without an amendment being applied. It is never recorded when the operator overrides the soft gate and says to proceed anyway — there is no hold then, and recording one would stop work just authorized.

## Step 2: Resolve where the project stands

Run both, silently:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project show --id <PROJECT>
```

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" amendment status --project-dir "<dir>"
```

`project show` returns the project's state, status, tier, directory, documents, and relationships in one call. `amendment status` returns what an amendment may legally do to this project: the applied history, next amendment index and filename, per-phase/per-task editability with a reason, the first legal insertion phase, and the sealed tier and task size. Reason with the operator from these envelopes directly — never re-derive this by reading `state.json`, the CLI source, or the pipeline engine; hand-deriving these rules is the failure this project exists to close.

**The gate branch.** A project parked at the final-approval gate is the one place the corrective route is reachable, changing what this skill does here. The gate branch reads `data.stoppingPoint.at` from the `amendment status` envelope — the CLI reports the pipeline's stopping point directly, so nothing here re-derives it, and the rule against reading `state.json` or the engine stands.

Take the corrective route only when `stoppingPoint.at` is `final_approval_gate`. Ask the operator to confirm — in plain language — that the project sits at final approval only when the value is `unknown`, taking the corrective route only on a yes: signalling a corrective against a final review that never ran isn't recoverable by noticing afterward. A no, or an unclear answer, falls through to Step 3 unchanged. Every other value falls through to Step 3 unchanged without asking.

Once the gate is established — directly from `stoppingPoint.at`, or by the operator's yes on `unknown` — ask them to describe what's wrong, then route it on the same three checks the gate applies:

- Is "fix these findings" a sufficient spec, or must the work be planned before building?
- Will it converge in a round or two? The cycle iterates by design, so convergence is the test, not single-pass completion — each round costs a coder and a review, and the ceiling is five.
- When it is done, does a code review suffice, or does the whole delivery need re-judging at final scope?

Any "no" routes to an amendment; otherwise it is a corrective. **Carry the bias toward the corrective:** mis-routing down is recoverable and costs rounds, while mis-routing up costs a phase and a full re-review.

On a corrective, ground it first: investigate enough that the diagnosis has substance, proportionate to a corrective — not an amendment's full grounding pass. Then write up what you found, in one physical line with bold run-in labels:

```
**Observed:** <the operator's own words, preserved> **Diagnosis:** <what the conversation established is actually wrong> **Fixed when:** <the observable condition that closes it>
```

(Shown wrapped for legibility only — it is authored and passed as a single physical line.) Keep it short — a few sentences, not a document — and avoid characters the host shell would treat as syntax: it travels as one double-quoted `--reason` argument, and there is no unescaping on the CLI side, so a literal newline would land in the report as the characters it was written with. **The operator's own words are preserved inside it, never replaced or paraphrased away** — a paraphrase loses what the operator actually said. For a final-scope corrective the review report is the coder's whole contract — the sole document it is given — so this write-up is the entire brief; an echo of the operator's sentence is the brief.

Show the write-up to the operator and get their explicit confirmation before signalling — a synthesized brief is not assumed correct. Only once confirmed, signal it:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" pipeline signal --event final_corrective_requested --project-dir "<dir>" --reason "<the confirmed write-up>"
```

Once the signal succeeds, record the corrective:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session save --project <PROJECT> --session <ID> --harness <claude|copilot> --cwd <cwd> --name "<name>" --description "<what the operator asked for>" --type corrective
```

Supply `--name`, since a corrective exits at Step 2 without ever reaching Step 4's save and this is routinely the session's first. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.

No amendment document is authored here, and no audit is offered — an operator-initiated corrective doesn't change the plan, so there's nothing for a plan audit to check. **The route doesn't stop at the signal, and doesn't describe how the work gets done either.** The engine appends the write-up as a finding on the running final review report and births a corrective; the work that follows is driven by the standing execution path, handed off to rather than reimplemented — the same rule Step 7 applies to resuming. Then clear the hold if one stands.

On an amendment, or on any project not parked at that gate, fall through to Step 3 unchanged.

## Step 3: Reach a shared understanding, then settle the shape and the audit choice together

Follow `${SKILLS_ROOT}/rad-amend/references/guidance.md` for the collaborative posture: how to open, the cost the change reports, and what to surface that the operator wouldn't raise. Reach a shared understanding — the frame is narrow: an already-scoped project growing or correcting course, not a new problem space.

**The repo check.** `project show`'s `worktrees` list (Step 2) names every repo already bound to this project. When the amendment would touch a repo outside that list, invoke `/rad-repo` to confirm it's registered — an unregistered repo is a blocker: stop and tell the operator rather than carry it forward, since `amendment validate` would refuse it later anyway, with no document yet in hand. Once confirmed, fold the changed-vs-reference split into guidance.md's conversation. A repo new to the project is provisioned into its worktree once execution reaches it — this skill does nothing about that.

guidance.md names three legitimate exits:

- **Proceed** — restate the amendment's shape and settle the audit choice below, then continue to Step 4.
- **Follow-up project** — the current plan is left exactly as-is; nothing is written here. Scope the change as its own project through `/rad-brainstorm`, and mention that a relationship between the two projects is worth recording, since a reader won't think of it.
- **Abandon** — this skill ends no project. At the final-approval gate, the operator's own words rejecting the work end it — that decision belongs to the gate. For a mid-run project there's no equivalent single act, so tell the operator that stopping is a decision outside this flow.

On Proceed, restate the amendment's shape (per guidance.md's restate-before-you-scribe) and, in the same ask, offer the audit choice:

| Option | Copy (two sentences max) |
|---|---|
| `Auto` **(Recommended)** | Defers the decision to after the amendment document exists, deciding from how much the amendment adds — a task folded into a running phase rarely needs one, a new phase usually does. Right when unsure this amendment needs a dedicated audit pass. |
| `Yes` | Always run a full audit subagent pass over the amendment document and Master Plan before proceeding. Costs extra tokens — recommended for a new phase or several touched tasks. |
| `No` | Skip the audit pass and go straight to review. Saves tokens — fine for small, low-stakes amendments. |

Do not move to Step 4 until the operator has explicitly agreed to both the restatement and one of these three options — an unanswered or non-committal response is not agreement, and if the shape changes materially afterward, the agreement no longer covers it.

## Step 4: Author the amendment inline

Once the operator has approved the restatement and the audit choice (Step 3), the work is committed — run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" session save --project <PROJECT> --session <ID> --harness <claude|copilot> --cwd <cwd> --name "<name>" --description "<description>" --type amend
```

The mode is spelled `amendment`; the activity type is `amend` — `session save` stores an unrecognized `--type` verbatim rather than rejecting it, so the wrong value fails silently. Supply `--name`; a first save fails without it. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.

Then check the precondition below before authoring anything.

**Grounding waits on the hold it inherits, not on what was said about it.** If Step 1 recorded a hold, re-check live here — regardless of conversation length or Steps 2–3 agreement — whether the held work has finished: has its completion event been signalled, per Step 1's persisting-is-not-acting rule? If not, wait for that notification first. This is the one part of Step 1's gate the override cannot reach: "proceed anyway" skips only the wait *before talking*, never a live write to these files. The hold itself stays untouched, still blocking the pipeline's next action as Step 1 left it — only this step's start is gated. Step 5's audit subagent inherits the wait for free, dispatching only once this step's document exists — never ahead of a hold already cleared. With no hold recorded, this step proceeds immediately.

Once clear, follow `${SKILLS_ROOT}/rad-create-plans/references/amendment/workflow.md` and write the amendment document yourself, grounded against the current working tree.

## Step 5: Resolve and run the audit

Resolve the choice made in Step 3 now that the amendment document exists:

- **No** → skip the audit entirely and go straight to Step 6.
- **Yes** → run the audit below.
- **Auto** → decide from how much the amendment adds — a task folded into a running phase rarely needs one, a new phase usually does. State the decision and why in one line before proceeding.

When the audit runs, dispatch a `general-purpose` subagent, handed the amendment document and Master Plan paths, instructed to follow `${SKILLS_ROOT}/rad-amend/references/audit.md` as its whole contract. The auditor reports; it edits neither document. **The audit subagent stays even though authoring moved inline**: its value is independence — a separate reading of the amendment against the plan; context economy doesn't substitute for a second set of eyes, so don't remove it for symmetry with inline authoring. A gap the auditor finds in the plan's already-completed work is worded as **evidence the amendment doesn't go far enough** — the most useful thing such an audit can say.

If the audit returns `issues_found`, verify each finding against the working tree yourself first — the auditor's claims aren't taken on faith. Fix every confirmed finding directly in the Step-4 document, since you hold it, not a subagent — this includes an "amendment doesn't go far enough" gap in already-completed work, with no operator confirmation gate. Note any finding you decline and why. After corrections land, show the operator the audit report and a one-line summary of what was actioned or declined, and why — informational, not a gate. Single pass, no re-audit. **Operator-initiated correctives are never audited**: a corrective doesn't change the plan, so there's nothing for a plan audit to check — this belongs to amendments only, mid-run or at the final gate.

## Step 6: Review and apply — never without approval

An amendment introduces plan content no plan-approval gate has ever seen, and reopening that gate would be disproportionate, so review happens here instead. Run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" amendment validate --project-dir "<dir>" --amendment "<path>"
```

Handle the envelope:

- **`data.report`** — relay it as the review surface: what lands, what reopens, what gets renumbered. Alongside it, present `data.document.url` and encourage the operator to open it and read the amendment in the dashboard before approving — nothing is required and nothing is gated on it, and an operator who approves without opening the link is obeyed. If the dashboard isn't running, offer to start it with `/rad-ui-start` in one short sentence.
- **`data.error`** — the parse or shape fault is in the document you just authored; fix it inline, then re-validate. **At most 3** times; on the third failure, stop looping and surface the structured detail instead.
- **`data.blocked`** — relay the message naming the halted node, and stop.
- **`ok: false`** — use `rad-log-error`.

**The apply approval covers the whole vocabulary, in plain consequence language, never naming a CLI verb.** Describe the consequence drawn from `data.report`, covering every part of the vocabulary this amendment uses:
- What's being added, in plain terms (what the new phase or task does, not phase/task IDs)
- What's being rewritten or dropped (an existing task or phase restated in place, or removed)
- What reopens (translate the `reopens` list into plain consequence, e.g. "reopens final review," not node IDs like `final_review` / `pr_gate`)
- A reassurance that nothing already executed is touched

Illustrative example, not a literal string to paste every time — adapt per amendment, mentioning only the vocabulary this one uses, and dropping any clause (PR, reopen, destructive) that doesn't apply:

*"Ready to add this phase? It'll reopen final review and refresh the open PR — nothing already done gets touched. It also drops task P02-T04, since it's no longer needed."*

Only once the operator has read the report and given **explicit** approval — an unanswered or non-committal response is not approval — run:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" amendment apply --project-dir "<dir>" --amendment "<path>"
```

Read `data.applied` on success; the same `data.error` / `data.blocked` / `ok: false` handling applies here too.

## Step 7: The tail hands off

After `apply` lands, tell the operator the amendment is applied, and clear the hold recorded in Step 1, if one stands — the operator has just explicitly resumed. Amendment authoring is context-heavy, so add a short reminder that this is a good moment to compact and save tokens — a junior operator won't think to do it unprompted. Then offer `/rad-execute` and, on a yes, invoke it, without reimplementing what it already owns — resume, worktree-versus-in-place classification, plan-approval conferral — resuming through its existing path unchanged.

## Errors

If any command errors, use the `rad-log-error` skill to record it. Do not try to fix pipeline code — work around it with a clear, actionable message naming the failure point.
