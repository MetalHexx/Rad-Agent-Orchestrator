---
name: rad-portfolio
description: "Create, orient in, and maintain a portfolio — a long-running initiative held as a root project's documents plus the iteration projects beneath it. Use when starting or continuing multi-iteration design work, walking into an existing portfolio to see where it stands, or recording what an iteration actually delivered. Trigger when the user talks about a portfolio, a long-running initiative spanning many sessions, an iteration timeline, or asks where ongoing multi-session work stands."
user-invocable: true
---

# Portfolio

A portfolio is how an initiative survives longer than any one session. Months of design, dozens
of conversations, many delivery iterations — none of it held in a context window, all of it held
in documents. This skill is what keeps those documents true: it orients you in seconds, and —
because the operator will never remember to ask — it detects when something has landed, offers
to write it, and files it once permission comes.

## Which mode are you in?
Resolve this first. The two modes have opposite contracts, and running one under the other's
instincts is the failure this section exists to prevent.

| Invoked as | Mode | Do this |
|---|---|---|
| `debrief <PROJECT>` | **One-shot.** Records what an iteration shipped versus what it was scoped to ship | [references/debrief.md](./references/debrief.md) is the whole workflow — follow it. **Nothing past the fence applies; do not read `collaboration.md`** |
| anything else | **Conversational.** Orient, design, scope, maintain | Read [references/collaboration.md](./references/collaboration.md) **before your first substantive reply** — not optional. It owns pushback, altitude, and when to scribe. Then continue below |

## What a portfolio is
Three things, always together:

| Piece | Shape |
|---|---|
| Project-group | `group:{base}` |
| Root project | `{BASE}-ROOT/` at `~/.radorc/projects/` — non-executing, all it holds is documents |
| Iterations | Ordinary projects, unprefixed, members of the group |

The documents *are* the system — no portfolio state lives anywhere else.

| Document | Holds |
|---|---|
| ROOT | The map — what this is, where it stands, and which document answers what |
| DECISIONS | The open questions, the assumptions not yet checked, and the ledger of what's been settled and why |
| TECHNICAL | The intended shape, organized by concern |
| GROUND TRUTH | What's verifiably true about the code, each claim cited |
| ITERATIONS | The delivery timeline, plus the parking lot for ideas that haven't earned a slot |

A directory is a portfolio iff `{BASE}-ROOT/{BASE}-ROOT.md` exists — no marker file, nothing in
frontmatter. `portfolio show` / `list` do this check; never derive it by hand.

## The calls
The CLI is how you find portfolios and where their documents live. Never guess a path, scan a
directory, or infer whether something is a portfolio — ask it. It computes every document path
from the naming convention, so the paths it hands back are correct by construction; reading a row
the CLI itself produced is not guessing, scanning, or inferring.

These are the whole vocabulary — no CLI reference, no mirrored surface.

**Which portfolios exist, and which are active** — answered by the preamble's Active Portfolios
row when present and the operator hasn't pointed past it; otherwise, use this call.

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" portfolio list [--status active]
```

**Everything about one portfolio, in a single call** — status, all five document paths with
whether each exists, every iteration with its derived status.

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" portfolio show --portfolio <BASE>
```

**Stand up a new one** — creates the directory, the group, and the edge, and returns the five
computed document paths. Writes no documents; you write those.

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" portfolio create --portfolio <BASE> --description "<one sentence>"
```

**Provision a newly named iteration** — creates its project folder, registers group membership,
and records a `depends-on` edge for each dependency already named. **Always ask first and wait
for an explicit yes**, right after scribing its timeline row.

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" portfolio provision --portfolio <BASE> --iteration <PROJECT> --depends-on "<PROJECT>,<PROJECT>"
```

`--iteration` and `--depends-on` both take the project id — the backticked `Project` cell the
timeline names (e.g. `PORTFOLIO-8`) — never the human-readable name in the timeline's `Iteration`
column; that name isn't a valid directory name and won't match an existing one.

`--depends-on` is optional — a comma-separated list, omitted when nothing is named yet. **A
dependency it could not record is normal, not a failure** — its target has no project yet to
link to; re-run the call once it exists and the edge records then.

`--portfolio` is case-insensitive — pass whatever casing you have, including a bare group name
straight off `project show`, with no transform of your own.

## Orient first
You cannot discuss or update a portfolio you have not looked up. Both modes start here.

1. **Resolve the portfolio.** A bare invocation with no portfolio named reads the Active
   Portfolios row the preamble delivered, or runs `portfolio list` when that row is absent or the
   operator points past it — or, standing inside an iteration project the preamble named, orients
   into that portfolio directly. Either way, `portfolio show` returns the whole composite in one
   call — lifecycle status, all five document paths, every iteration's derived status. `debrief`
   starts from a project name instead; see [references/debrief.md](./references/debrief.md).
2. **Read the root document.** It is the map: what this initiative is, where it stands, and
   which of the other four answers what. Open the others *because the map sent you there*, not
   on spec.
3. **No portfolio?** Conversational → [references/bootstrap.md](./references/bootstrap.md) to
   create one. `debrief` → return quietly; there is nothing to record.

---

**Everything below is the conversational default.** In `debrief` mode, stop here.

---

## Reconciliation on return
Three cross-references run against the iteration timeline — a shipped iteration never folded
back, a group member the timeline never learned of, a dependency the timeline names that the
graph does not hold — and catch whatever happened while nobody was here to update the documents.

Read the iterations document at the path `portfolio show` already returned (Orient first, step
1) — never construct it by hand. Only the timeline table; nothing below it, no project folder.

| Signal | Meaning | Move |
|---|---|---|
| An iteration whose `derivedStatus` is `shipped` and whose timeline row's `Debriefed` cell is empty | Shipped, never folded back | **Offer** `/rad-portfolio debrief <PROJECT>` |
| A group member with no row in the timeline at all | Started outside the skill; the portfolio never learned of it | **Ask** what it owed — there are no scope bullets to compare against, so no entry to propose |
| A timeline row's `Depends on` id, resolved through `#` to a `Project`, names a target that row's `dependsOn` (from `portfolio show`) does not include | Named as a dependency when scoped, but the edge never recorded — not provisioned yet, or provisioned before the target existed | **Offer** to re-run `portfolio provision` for that iteration, naming the still-missing dependency again |

**Join on `Project`, never `Iteration`** — the backticked id `portfolio show` returns; the human
name never matches it, and a wrong join looks identical to nothing outstanding. **The dependency
check needs an extra hop**: `Depends on` holds `#` identifiers, not project names — iteration 7's
row reads `Depends on: 6`, while the graph holds `PORTFOLIO-7 → PORTFOLIO-6`. Resolve each value
through `#` to its `Project` cell before comparing, or every dependency reads as unrecorded. **A
value resolving to a row with no `Project` yet is not a gap** — skip it silently; an unprovisioned
iteration has no node for an edge to point at.

The root project is excluded by construction — `portfolio show` already excludes it from
`iterations`, so this needs no filter of your own.

**All three are offers, never automatic writes.** A clean return says nothing at all — no
"checked, all good," and the operator hears about drift only. This costs only the `portfolio
show` already made in step 1, plus reading the timeline table — nothing more.

## Lifecycle
Bootstrap once, then a loop. Not exclusive or ordered — the root's *Where We Are* says what's
available now; no lifecycle state is stored anywhere else.

| Stage | What happens |
|---|---|
| **Bootstrap** | `portfolio create`, write ROOT + DECISIONS, announce. Once. |
| **Design** | The default mode: converge, keep documents current via the beats below |
| **Scope** | Name the next iteration, provision it once the operator says yes, and record its coarse scope here; hand the detail to `/rad-brainstorm` |
| **Deliver** | The iteration executes outside this skill |
| **Fold back** | `debrief` records shipped-versus-scoped |

## The beats — what forces a document update
The anti-rot mechanism, and the reason this skill exists — it has to fire on its own, since the
operator will never remember to ask.

| When this happens | Scribe to | What lands |
|---|---|---|
| Something converges | Decisions — plus Ground truth when it cites a fact about the code, and Technical when it changes the shape, in the same pass | The reasoning, the fact and its citation, or the resulting shape — whichever the moment produced |
| A search bounds a surface, and someone would look again | Ground truth | The positive fact, plus its citation |
| A decision rests on something unchecked | Decisions → *Assumptions* | The belief, why it's held, and what breaks if it's wrong |
| A strong idea gets deferred | Iterations → *Not Yet Scoped* | The idea, why it might matter, and what would promote it |
| An iteration is named, folded, or dropped | Iterations → timeline | The call — status is derived, never hand-written |
| An open question opens or closes | Decisions, and the root | The root's *Where We Are*, rewritten |
| Something that might support or become a decision later | Decisions → *Notes* | Concise, high-signal, and consistent with what's already been aligned on |
| Any time the root is touched | Root | Refresh its counts in the same pass — not a trigger of its own |

Routing clarity is the control, not a size limit. Mechanics of *how* to file a beat:
[references/scribing.md](./references/scribing.md).

## Scoping — this altitude, and where it stops
Portfolio work **is** iterative planning. Naming iterations, ordering them, and saying roughly
what each owes is this skill's job. What it never does is turn one into requirements.

**Provisioning the folder, the membership, and the dependency edges is plumbing, not
requirements** — it decides nothing about the iteration. Ask, then do it in the same pass as
naming the iteration; see **The calls**.

| Here | `/rad-brainstorm` |
|---|---|
| Which iterations exist, in what order | What one iteration owes, requirement by requirement |
| Coarse `Scope` bullets + `Explicitly out of scope` | Acceptance criteria, technical spec, testing approach |
| Dependencies between iterations | Files, functions, flags |
| The parking lot, and what would promote an idea | — |

**Scope bullets are coarse but checkable** — `debrief` compares what shipped against these exact
bullets, so a vague one breaks the fold-back beat.

**The handoff.** Hand an iteration's requirements to **`/rad-brainstorm`**, never `/rad-plan`, and
only once **Technical** is current for the part being scoped — a plan built on a stale Technical
document is a plan built on nothing.

## Routing Table
| When you need to… | Use |
|---|---|
| Run the full collaborative session | [references/collaboration.md](./references/collaboration.md) |
| Create a new portfolio | [references/bootstrap.md](./references/bootstrap.md) |
| Execute a beat — where it lands, whether it earns a number | [references/scribing.md](./references/scribing.md) |
| Fold back an iteration's actual delivery | [references/debrief.md](./references/debrief.md) |
| See the shape a document must take | [templates/](./templates/) |
| Scope the next iteration | hand off to `/rad-brainstorm` |
