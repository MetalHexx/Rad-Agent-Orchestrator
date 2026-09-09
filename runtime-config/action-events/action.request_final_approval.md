---
kind: action
name: request_final_approval
title: Display final approval gate
description: Present the final review to the operator and wait for approval before the pipeline concludes.
category: gate
completion_event: final_approved
completion_when: The operator approves the final review.
alternate_outcomes:
  - event: final_corrective_requested
    when: The operator asks for changes to the delivered work.
  - event: final_rejected
    when: The operator rejects the final review.
---

Record this before presenting the review — the presentation blocks on the operator, and the run needs an ending on the session's record whether or not they answer — by running `radorch.mjs session save` with `--project`, `--session`, `--harness`, `--cwd`, `--name`, `--type execution-complete`, and a `--description` of what the run delivered and that it is now awaiting approval. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.

Present the final review document to the operator. For each `source_control.repos[]` entry that has a non-null `pr_url`, include a `PR: {pr_url}` line so they can navigate directly to that pull request. Omit the PR lines entirely when no repo has a PR — do not show an empty placeholder.

Before the operator chooses, state a recommendation that reports cost: what the change invalidates (already-built work the change now contradicts) and what it reopens (what has to run again to absorb it) — matching the cost report `/rad-amend` itself gives, so the gate and the skill can never contradict each other. Do not test whether the original requirements are still the right ones, and do not recommend a follow-up project on the strength of that answer — that question isn't this gate's to answer.

Then present exactly two choices, weighed against that recommendation: **Approve** and **Request changes**. Approve is a signalled event (`final_approved`). Request changes asks the operator to describe what's wrong, in their own words — there is no second question about which lane it belongs to, and they never choose between a corrective and an amendment. You route the objection yourself.

Route it from documents you already hold, on three checks:
- Is "fix these findings" a sufficient spec, or must the work be planned before it can be built?
- Will it converge in a round or two? The cycle iterates by design, so the test is convergence, not single-pass completion — but each round costs a coder and a review, and the ceiling is five.
- When it is done, does a code review suffice, or does the whole delivery need re-judging at final scope?

Any "no" routes to an amendment; otherwise it is a corrective. Bias toward the corrective, and hold that bias even if this file is later rewritten: mis-routing down is recoverable and merely costs rounds — the coder commits what it finished, the reviewer keeps the report open, the next round continues, and an unconverged cycle halts cleanly at the budget ceiling. Mis-routing up costs a phase and a full re-review.

`/rad-amend` applies this same routing when the operator reaches it directly and its reported stopping point places the project at this gate, rather than through this action's own flow — a later edit to either surface should keep the two in sync.

The corrective route exists only at this gate: `final_corrective_requested` is the sole operator-initiated corrective trigger in the system — task- and phase-scope correctives fire from a reviewer's verdict and nothing else. An operator-initiated change mid-run is always an amendment.

State the route to the operator in one line, as a consequence rather than a mechanism — what will happen next and what will re-judge it when it's done — with no verb name and no event name in it. When the convergence check reads as more than a round or two, say so in that same line, before the request goes anywhere: the operator learns the request is expensive before they've committed to it. No separate beat, no extra question for stating the route itself. The operator can redirect the call in a word; if they do, restate the one line to match and proceed on their say.

- A corrective grounds the objection first — investigating enough that the diagnosis has substance, proportionate to a corrective, not an amendment's full grounding pass — then writes it up as one physical line with bold run-in labels:
  ```
  **Observed:** <the operator's own words, preserved> **Diagnosis:** <what the conversation established is actually wrong> **Fixed when:** <the observable condition that closes it>
  ```
  (Shown wrapped for legibility only — it is authored and passed as a single physical line.) Keep it short — a few sentences, not a document — and avoid characters the host shell would treat as syntax: it travels as one double-quoted `--reason` argument, and there is no unescaping on the CLI side, so a literal newline would land in the report as the characters it was written with. **The operator's own words are preserved inside it, never replaced or paraphrased away** — a paraphrase loses what the operator actually said. For a final-scope corrective the review report is the coder's whole contract — the sole document it is given — so this write-up is the entire brief; an echo of the operator's sentence is the brief. Show the write-up to the operator and get their explicit confirmation before signalling — a synthesized brief is not assumed correct. Only once confirmed, run `radorch.mjs pipeline signal` with `--event final_corrective_requested`, `--project-dir`, and `--reason` carrying the confirmed write-up, which turns it into corrective work against the running final review. Once the signal succeeds, record the corrective by running `radorch.mjs session save` with `--project`, `--session`, `--harness`, `--cwd`, `--name`, `--type corrective`, and a `--description` of what the operator asked for. `--description` is 1–2 sentences, high-level — see rad-session's Save section. If the response carries a conflict, relay the message to the operator verbatim and do not retry against a different project.
- An amendment is a skill handoff, not a signalled event — unlike `final_approved`, `final_rejected`, and `final_corrective_requested`: invoke `/rad-amend` and let it carry the operator's request forward.

Reject lives in the conversation, not the menu: its event (`final_rejected`) and halt behaviour are unchanged, only its placement moved. Ending a project costs the operator a sentence, not a click — if their own words say so, take it as a rejection and signal accordingly.

This is a workflow-required operator decision routed through the harness's question tool. Hold here until they respond — no autopilot, auto-accept, or gate-mode setting bypasses it; the standing gate protocol holds regardless of session mode.

Close with a nudge of one to three sentences, never more: tell the operator that if their own read of the work, or comments left on the pull request, turned up problems, they can request changes rather than approve and live with it. Approving is the path of least resistance, and the nudge's whole job is putting the other path in view while it is cheapest to take — keep to it; heavier prose here trains operators to skip the gate text entirely.
