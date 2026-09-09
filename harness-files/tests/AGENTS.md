# `harness-files/tests/`

Corpus-wide guards over canonical agent and skill source. A test belongs here only if it asserts
something about the **set** — a call form every shipped file must match, a name no file may still
use, a phrase no file may claim. Anything asserting about one skill or one agent lives beside its
subject, not here.

> **What each guard actually asserts, and the gap they share, is in
> [`docs/internals/skills.md`](../../docs/internals/skills.md#what-holds-the-set-together)** — read
> it before adding a guard, so you extend the set rather than re-covering it. This file owns the
> boundary and the obligations; that page owns the inventory.

## How it works

The guards that live here, each with its own scan radius — and the radius is the part people get
wrong:

| Guard | Walks |
|---|---|
| `test-skill-call-form.test.mjs` | Every `SKILL.md` and every `references/**/*.md` under `harness-files/skills/` |
| `test-agent-skill-refs.test.mjs` | The frontmatter `skills:` list of every `harness-files/agents/*.md` body |
| `test-final-review-corrective-claims.test.mjs` | Every `.md` under `harness-files/skills/`, `runtime-config/action-events/`, **and `docs/`** |

The third reaches well outside canonical source. It also carries a skip list —
paths matching `node_modules`, `dist`, `output`, `dogfood-marketplace`, `.claude`, or `.github` are
never read — and it deliberately does not scan the repo root or `ui/`, where the same vocabulary has
legitimate uses.

## Conventions

### The shape boundary — this folder is the sanctioned exception

The root `AGENTS.md` bans tests that assert on the textual shape of markdown: regexes against
headings, prose, pinned numbers, or specific phrasing. They break on every prose edit and pin the
docs without testing behavior. **The exception it carves out is exactly what this folder holds** — a
broad anti-regression scan, where one token or one required form is swept across many files.

The line:

- **Belongs here.** One denylisted token, or one required call form, applied uniformly to a whole
  corpus. It survives rewording because it does not care how a file is written, only whether a known
  wrong string is in it.
- **Does not belong here, or anywhere, without explicit sign-off.** A check on one document's
  headings, section order, table shape, or wording. A count of anything. Anything that would fail
  because a paragraph was rephrased.

If a markdown invariant genuinely needs guarding and it is not corpus-wide, ask first.

### Extending a guard beats writing one

A recurring authoring mistake is usually a new entry in an existing list, not a new file:

- `FORBIDDEN` in `test-agent-skill-refs.test.mjs` — skill names that must never appear in an agent's
  `skills:` list again.
- `FORBIDDEN_TOKENS` in `test-final-review-corrective-claims.test.mjs` — retired claims about the
  corrective and amendment cycles.
- `CANONICAL` and `CANDIDATE` in `test-skill-call-form.test.mjs` — the invocation shape, and what
  counts as an invocation to check.

Write a new guard only when the invariant is a new *kind* — a different corpus, or a check that is
not a token sweep.

### The runner idiom, and where it is not followed

Use `node:test`'s `test()` so a failure names the case that broke.
`test-final-review-corrective-claims.test.mjs` does this. **Known deviation:**
`test-agent-skill-refs.test.mjs` and `test-skill-call-form.test.mjs` are bare top-level scripts that
assert as they walk and log on success — they still pass and fail correctly under `node --test`, but
a failure reports as the file dying rather than as a named case. Match the surrounding file when
editing one of those; use `test()` for anything new.

## Hazards

### Nothing here runs in CI

No workflow invokes `node --test harness-files/tests/*.test.mjs`. These guards catch only what a
contributor runs locally, so a change that breaks one lands green. Run them before you land an edit
to canonical source — that is the whole enforcement.

### Widening a radius breaks somebody else's folder

The corrective-claims guard already reads `runtime-config/action-events/` and `docs/`. Add a
directory to a guard's scan list and every legitimate use of the token in that directory starts
failing — in a folder whose author has never run this suite and whose CI does not run it either.
Before widening, either narrow the token or extend the guard's skip list in the same change.

## When a change here ripples

- **Changed the canonical call form, or the bundle path inside it?** The `CANONICAL` regex here and
  the call-form rule written into [`harness-files/AGENTS.md`](../AGENTS.md) are two statements of the
  same contract, and the path it pins —
  `skills/rad-orchestration/scripts/radorch.mjs` — is where `cli/` bundles its binary. All three
  move together, plus every shipped invocation. Detail: [`cli/AGENTS.md`](../../cli/AGENTS.md)

- **Retiring a name or a claim from canonical source?** Deleting the last occurrence does not stop it
  coming back — nothing resolves a skill-to-skill handoff, and an agent frontmatter `skills:` list is
  just prose to everything but this folder. Add the retired string to the matching denylist in the
  same change, so the sweep that follows is what enforces it. Detail:
  [`harness-files/AGENTS.md`](../AGENTS.md)

- **Added a guard?** Add its row to the inventory table in
  [`docs/internals/skills.md`](../../docs/internals/skills.md#what-holds-the-set-together). That page
  is where a reader goes to find out what is already covered; a guard missing from it gets
  reimplemented.

## Commands

Run from the repo root:

```
node --test harness-files/tests/*.test.mjs
```

## Further reading

- [`docs/internals/skills.md`](../../docs/internals/skills.md#what-holds-the-set-together) — the
  guard inventory, and the resolution gap none of them closes
- [`harness-files/AGENTS.md`](../AGENTS.md) — the canonical source these guards sweep, and the
  authoring rules they enforce a corner of
- [`cli/AGENTS.md`](../../cli/AGENTS.md) — the binary the call form invokes
- [`AGENTS.md`](../../AGENTS.md) — the repo map, and the markdown-shape-test ban this folder is the
  exception to
