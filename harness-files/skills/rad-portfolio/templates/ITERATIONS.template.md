---
portfolio: "{PORTFOLIO}"
doc: ITERATIONS
description: "The delivery timeline — what shipped, what is active, what is proposed, and what each iteration depends on."
created: "{DATE}"
updated: "{DATE}"
---

# {PORTFOLIO} — Iterations

> **What this holds.** Every iteration this portfolio has shipped, is shipping, or intends to —
> with what each delivers and what it depends on.
>
> **It is not** an iteration's plan. Once an iteration becomes a project it owns its own
> requirements and master plan, and this document links to them.

---

## Timeline

| # | Iteration | Status | Depends on | Delivers | Project | Dates | Debriefed |
|---|---|---|---|---|---|---|---|
| 1 | {Name} | shipped | — | {one line} | `{PROJECT}` | {start} → {end} | {date} |
| 2 | {Name} | executing | 1 | {one line} | `{PROJECT}` | {start} → | — |
| 3 | {Name} | planned | 1 | {one line} | `{PROJECT}` | — | — |
| 4 | {Name} | proposed | — | {one line} | — | — | — |

**Statuses.** `proposed` — a slot with a rough shape, not yet committed · `planned` — has a
project and approved requirements · `executing` — running · `shipped` — delivered and verified ·
`folded` — absorbed into another iteration · `dropped` — abandoned, with the reason kept.

**Debriefed.** The date the debrief ran — empty until it has.

---

## {N} — {Iteration Name}

> One section per iteration. Proposed iterations get scope bullets only; shipped ones get
> rewritten to describe what actually landed.

**Status:** {status} · **Project:** `{PROJECT}` · **Ticket:** [{TICKET}]({url})

{One paragraph: what this iteration is for. For a proposed iteration, the smallest thing that
would be genuinely usable. For a shipped one, what it turned out to be.}

**Scope**
- {Bullet — coarse, but checkable after the fact}
- {Bullet}

**Explicitly out of scope**
- {What this iteration deliberately does not do, and where it went instead}

**Depends on:** {what must exist first, or "nothing"}
**Delivers to:** {what this unblocks}

**What actually landed** *(after it ships — and say where it diverged)*
- {What was delivered, including anything cut or added, with the decision that authorized it}

---

## Not Yet Scoped

> The parking lot — things that will probably become iterations but have not earned a slot.
> Keeping them here is what stops the numbered timeline becoming a wish list.

- **{Idea}** — {why it might matter, and what would trigger promoting it}

---

## Dropped and Folded

> Kept because "why isn't there an iteration for X" recurs, and the answer is expensive to
> reconstruct.

- **{Name}** — {folded into / dropped} {DATE}. {Why, with a link to the decision.}
