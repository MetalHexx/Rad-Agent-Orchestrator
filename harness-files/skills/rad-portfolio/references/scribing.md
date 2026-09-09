# Scribing — how to file a beat

- **Creating a document for the first time?** Shapes are in [templates/](../templates/).
- **Which document does this land in?** The beats table in `SKILL.md` — it owns routing.
- **This file is the mechanics:** numbering, dates, shapes, and the traps.

## Before you write anything
- **Not yet is the default.** Offer before scribing anything new, inferred, or
  direction-changing — [collaboration.md](./collaboration.md) has the trigger model: detect,
  offer, reset.
- **Announce the filing in one line. Never ask.** What was decided is the operator's; which
  document holds it is yours.
- **One pass, all affected documents.** A beat that touches two documents and updates one has
  created drift, not a record.

## What every entry carries
- **A date.** A portfolio spans months; an undated claim cannot be aged.
- **A citation, if it claims something about the code.** File and line.
- **A link, not a copy, to a fact recorded elsewhere.** Two copies of the same fact drift into
  two different facts.

## Frontmatter and the map
- Bump `updated` on any document you touch.
- `description` is **mirrored verbatim** into the root document's map row. Change one, change
  both in the same pass — that mirrored line is all an agent reads before deciding whether to
  open the file.
- Write `description` as a reason to open the document, not a label.

## Decisions
Two rules survive everything else that used to live here.

- **A number is never reused**, because a cross-reference must still resolve in a year. Gaps
  are fine; renumbering is not.
- **Nothing is deleted**, because the record that something was once believed is worth more
  than a tidy ledger.

**A number is earned, not automatic.** An entry gets one when it is genuinely settled *and*
something else needs to point at it — not everything written down gets one. That is the
sentence that stops the zone from becoming another ledger.

Changed our mind, or said it badly — the difference is real and worth telling apart, but it is
plain sense: no formal test, no tiebreaker, and no prescribed shape for how a superseded entry
looks.

An entry is prose. A decision carries as much of its own explanation — the reasoning, the
alternative it beat — as it needs, in one place, rather than split across fragments or
documents and cross-linked. Existing entries keep their current form; nothing is rewritten to
match.

## Assumptions
An assumption is **discharged, not promoted**: verifying it writes a new ground-truth row
carrying the citation the assumption never had, and the assumption entry then goes.

## Technical
- Organized **by concern**, not chronologically. Find the concern; add to it.
- **Altitude:** a sentence that would have to change when someone renames a function is too
  low; one that survives a rewrite of the module belongs. General altitude rules are in
  [collaboration.md](./collaboration.md).
- **Shape, never schedule.** Present tense describes what a thing is meant to be, whether or
  not it is built yet — that is not a claim it has shipped. Sequencing is the iterations
  timeline's job: no *iteration N owes this*, *until then*, *pending*, or *to be confirmed*
  here.

## Iterations
- **The `#` is a stable identifier, not a position — never renumber to imply sequence.** Other
  rows resolve dependencies through it; a renumbered timeline silently repoints every one of
  them.
- **Status is decided; readiness is derived — never record *ready*, *in flight*, or *blocked*.**
  A hand-written blocker goes stale the moment its blocker ships, and a stale blocker hides
  available work.
- **Proposed forward, corrected backward.** An iteration starts as a rough scope, sharpens when
  planned, and — the step most easily skipped — gets rewritten once it ships to say what
  actually landed.
- **Never overwrite a `folded` or `dropped` row with a derived value.** The CLI cannot see
  those — they exist only here, as human calls. This is the one place a status refresh can
  silently destroy operator intent.
- Scope bullet quality is load-bearing for `debrief` — see *Scoping* in `SKILL.md`.
- **Provision the iteration when you name it — don't hand this off.** One call creates the
  folder, registers the membership, and records its dependency edges; ask first. See **The
  calls** in `SKILL.md` for the exact command.

## Root
- ***Where We Are* is rewritten, never appended to.** Older lines merge and coarsen. The root
  is the arc, not the log.
- **Keep it short.** When a section grows past a screen, that's the signal it has become its
  own document — move it out and leave a map row behind.

## The shape every document obeys
Three parts: frontmatter, title + preamble, body.

- **Headings are anchors, and anchors are a public surface.** Once linked, renaming a heading
  breaks that link silently. Add freely; rename deliberately.
- **Relative links only.** `[D7](./PORTFOLIO-DECISIONS.md#d7)`. Never absolute, never `file://`.
- **Every document is reachable from the root map.** A document not on the map does not exist —
  no agent will open it. Adding one means adding its map row in the same pass.
- **The preamble's `It is not` line orients a cold reader.** It says plainly what the document
  is not, so nobody has to guess. Keep it accurate when the document's shape shifts.
