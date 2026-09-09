# Debrief — recording what an iteration landed

Records what an iteration **actually delivered** against what it was **scoped to deliver**.
You handle the updates; you do not open a design conversation. **Write first, ask second, and
never withhold the write — provided there is something to compare against.**

Usually invoked when a human approves a completed iteration. Also invoked by hand at any
point — including for work that happened entirely outside the pipeline, where there is no
approval to hang it on and no documents it produced.

## 1. Confirm this is a portfolio iteration

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" project show --id <PROJECT> --json
```

Read **`data.group`** — the group id with `group:` stripped (the slug, not the group node's
`name`). No group, or the call itself fails → **return quietly.** Then:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" portfolio show --portfolio <group>
```

Pass `group` through **verbatim** — `show` accepts a group name as well as a base name, so never
transform it. A `user_error` means the group is not a portfolio → **return quietly.**

The paths you need are in the response: each iteration row carries resolved paths for its
requirements, master plan, amendments, and final review. Never construct one.

**Returning quietly means saying nothing and writing nothing.** Most projects are not portfolio
iterations. A debrief that announces its own irrelevance is noise in someone else's session.

## 2. Read what the iteration produced

| Read | For |
|---|---|
| The iteration's **requirements** | What was promised |
| Its **amendments** | What was authorized to change mid-flight |
| Its **final review** | What actually shipped, and what was accepted |

**Never phases or tasks.** Too granular for this altitude, and the final review already
summarizes them. Reading them produces a report nobody asked for.

**Read whichever exist.** Work done outside the pipeline may have produced none of these. Then
the **operator is your source** — ask what landed before writing. This covers a missing
**produced document**; a timeline entry must still exist to compare against, or stop instead
(step 3) — the operator can supply what landed, not what was owed. Asking still comes first
here, since write-first assumes there is something to write — the missing-entry stop is the
other case where that isn't yet true.

## 3. Build the delta

No row in the timeline for this project → say so and stop, writing nothing and creating no
entry. Authoring one means stating what the iteration owed — a scoping conversation, out of
mode here. An entry created after the fact is marked **retroactive**: scope bullets written
once the outcome is known are self-confirming and can never show the drift this comparison
exists to catch.

Compare against the iteration entry's own **`Scope`** bullets and **`Explicitly out of scope`**
list — not against your own reading of what the iteration should have been.

| Case | Means | Weight |
|---|---|---|
| Scoped, shipped | Went as intended | Record |
| Scoped, did not ship | Cut or missed | **Flag** — and say which, if the review says |
| Shipped, was not scoped | Drifted | **Flag loudest.** This is the fell-off-track signal |
| Out of scope, shipped anyway | The boundary failed | **Flag loudest** |

**Check amendments before flagging drift.** An amendment converts *not scoped* into *scoped
later* — flagging authorized work as drift is the most likely way to get this wrong.

## 4. Write

Three destinations, in this order:

| Where | What |
|---|---|
| **Ground truth** | The delta as **present-tense fact**, with a citation |
| **Iterations** → the entry's *What actually landed* | Delivered versus scoped, including anything cut or added and what authorized it |
| **Root** → *Where We Are* | The iteration moves out of *In flight*; anything it unblocked moves into *Ready*. Rewritten, not appended |

Also set the iteration's **`Debriefed`** `Timeline` table cell to the date of the debriefing.

Mark your rows so a later reader knows they were written without a human in the room: a
ground-truth row authored here carries **`debrief {DATE}`** in its `Verified` column.

**Guards — these are hard:**

| Never | Why |
|---|---|
| Write to Decisions → *Settled* | The ledger records calls made in a conversation. You were not in one |
| Write to Technical | Intent is decided, not observed. A shipped detail is a fact, not a change of intent |
| Write a claim without a citation | You are writing unattended; the citation is the only thing making it checkable |

**Never gated.** A large delta does not stop the write. Withholding information when it matters
most leaves the drift undocumented *as well as* unresolved.

## 5. Reconcile, or name it

If what you wrote contradicts another document — fix it, or add it to **Decisions → `Open`** as
a question.

**A contradiction in Technical is always flagged, never fixed.** The guard above already
forbids writing there — you were not in the room when the design was decided, so you do not
rewrite it. Add it to Decisions → `Open` instead. What forces the actual correction is `SKILL.md`'s
scope gate — the one that holds a handoff to `/rad-brainstorm` until Technical is current for
the part being scoped — not this debrief.

**What you may never do is write something that contradicts another document and say nothing.**
A silent inconsistency is worse than the drift it came from, because the next reader trusts both
documents equally.

## 6. Summarize, then ask

A few lines: what changed, and where. Not a report, and not a tour of the delta you just built.

> Debriefed `PORTFOLIO-1` into `PORTFOLIO`. Two ground-truth facts added, iteration 1 marked
> shipped. **One flag:** the `--status` filter shipped but was not scoped — no amendment
> authorizes it.

Then ask — **only** about what is genuinely ambiguous and only after writing. An iteration whose
delta is clean needs no question at all.
