---
portfolio: "{PORTFOLIO}"
doc: ROOT
description: "The portfolio map — what this initiative is, where it stands, and which document answers what."
status: active            # active | on-hold | done
created: "{DATE}"
updated: "{DATE}"
---

> **Template guidance — delete this block when instantiating.**
>
> This is the first and often the only document an agent reads. The description paragraph and
> *Where We Are* are written to be **lifted** — they become the orientation announcement without
> rewriting.

# {PORTFOLIO} — Portfolio Root

{One or two sentences: what this initiative is and why it exists. This is the text the agent
speaks when orienting, so write it to be said aloud. No "this document describes" — just what
the thing is.}

| | |
|---|---|
| **Group** | `group:{portfolio}` |
| **Root project** | `{PORTFOLIO}-ROOT` |
| **Status** | `active` · `on-hold` · `done` |
| **Started** | {DATE} |
| **Last worked** | {DATE} |
| **Repos changing** | `{repo}` |
| **Repos read for reference** | `{repo}` — or none |
| **Ticket** | [{TICKET}]({url}) — or none |
| **Related portfolios** | `group:{other}` — how it relates |

---

## Where We Are

> A **frontier, not a position** — several things may be in flight and several more startable at
> once, so understating that hides available work. Keep it to what's true *now*; the full arc
> belongs in [Iterations](./{PORTFOLIO}-ITERATIONS.md).

**Done**
- {Iteration or milestone} — {one line on what it delivered} ({DATE})

**In flight**
- {Name} — {what is actually being worked on, and what "done" looks like}

**Ready** *(nothing blocks these — any of them could start today)*
- {Name} — {why it might be worth picking up}

**Waiting on**
- {What is blocked and by what — or "nothing"}

---

## The Map

> `Open it when` is the whole mechanism — an agent reads that column and nothing else before
> deciding, so a description that only labels the document ("the decisions doc") makes it
> invisible. Each row mirrors that document's frontmatter `description`; change one, change both.

### Guaranteed documents

| Document | What it holds | Open it when |
|---|---|---|
| [Iterations](./{PORTFOLIO}-ITERATIONS.md) | The delivery timeline — what shipped, what is active, what is proposed, and what each depends on | You need more than the current position: the full arc, what an iteration actually delivered, or where a piece of scope landed |
| [Decisions](./{PORTFOLIO}-DECISIONS.md) | The record of what we have discussed, what we settled and why, what is still open, and what we are assuming — so nothing said once has to be argued twice | You are about to decide something, or you suspect it was already decided and want the reasoning before reopening it |
| [Technical](./{PORTFOLIO}-TECHNICAL.md) | The architecture at portfolio altitude, organized by concern | You need the intended shape of a part of the system — how a concern is meant to work, not how it is coded |
| [Ground Truth](./{PORTFOLIO}-GROUND-TRUTH.md) | What is verifiably true about the code today, with citations — verified fact and nothing else | You are about to investigate the codebase. Read it first — most of what you would go find has been found already |

### Portfolio documents

> Documents the operator added. Same shape, same rules. Add the row in the same pass as the
> document.

| Document | What it holds | Open it when |
|---|---|---|
| [{Name}](./{PORTFOLIO}-{NAME}.md) | {what it holds} | {the concrete trigger} |

---

## Working In This Portfolio

> Anything specific to *this* portfolio that would otherwise be rediscovered every session — a
> repo that is not obvious, a command that must run before tests, a convention written nowhere
> else. Delete the section if there is nothing.

- {Note}
