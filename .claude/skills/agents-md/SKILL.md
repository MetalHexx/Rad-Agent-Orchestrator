---
name: agents-md
description: How to author and maintain this repo's AGENTS.md files — the shape they share, how co-change edges are written, what belongs in an AGENTS.md versus docs/internals/ versus CONTRIBUTING.md, and the checklist for standing up a new module. Load this before creating an AGENTS.md, restructuring one, adding a module to the repo, or sweeping the set for drift. Do not improvise the format.
user-invocable: false
---

# Authoring and maintaining `AGENTS.md`

This repo's `AGENTS.md` files are a routing system, not documentation. Root is the map; each module's
file tells an agent how to conduct itself there and **what else has to move when that module moves**.

You are here because you are about to create one, change one, add a module, or sweep the set. Follow
this rather than pattern-matching off whichever file you happened to open — several are still
pre-standard and will teach you the wrong shape.

---

## The one principle

**If the code changed, would this sentence need to change?**

- **Yes** → it describes behavior. The code is the better source. Cut it, or move it to
  `docs/internals/` if the *why* is worth preserving.
- **No** → it is a convention, a boundary, or a hazard. It belongs here.

Conventions outlive implementations. Behavior descriptions do not — they rot silently, and nothing
tests them.

Stated from the reader's side: an `AGENTS.md` answers ***"what would I get wrong?"***, never
***"what does this do?"***

The failure this prevents is specific and it has already happened here. `ui/AGENTS.md` accumulated
feature write-ups — one section ran seventy lines describing a UI feature that has its own
`docs/internals/` page. That is always-on context spent on something an agent editing the UI does
not need loaded, duplicating a page that explains it better.

---

## What belongs where

Four surfaces. Getting this wrong is the most common mistake, and it produces the same content in
two places, which then disagree.

| Surface | Addressing | Holds |
|---|---|---|
| Root `AGENTS.md` | Positional, **always-on** | The map, and invariants no single module can own |
| Module `AGENTS.md` | Positional, when working in that module | Local conventions, hazards, commands, **co-change edges** |
| `docs/internals/` | Referential, on demand | How and why a subsystem is shaped this way. Cites source paths freely |
| `CONTRIBUTING.md` | Referential, on demand | Process — how a change moves from idea to merged and released |

The test between the two `AGENTS.md` rows: **can any single module own this rule?** If yes it goes in
that module. If it only makes sense across modules, root owns it.

The test between `AGENTS.md` and `docs/internals/`: **prescriptive or descriptive?** *"Never import
`cli/` from `ui/`"* is prescriptive — module file. *"The dashboard shells out to the CLI because the
engine has not been extracted into a library yet"* is descriptive — internals.

**Never restate across the boundary.** If a sentence would be equally at home in the module's
`AGENTS.md`, it belongs there and the internals page should link to it instead.

---

## The module file and its internals page

Not every module has a `docs/internals/` page. When one does, the two are a **named pair** — each
links the other — and that link is not decoration.

**It is where the explanation went.** Everything the one principle evicts from a module file, if it
was worth keeping at all, is on that page. Cut the explanation and drop the link and you have not
moved the content, you have deleted it: the next agent has no signal it ever existed.

- **Name it at the top**, directly under the purpose sentence, not only in *Further reading*. The
  reader who needs it most is the one who just noticed the explanation is not here — and they are at
  the top of the file.
- **Say when to follow it** — before restructuring the module, or for a change that spans modules;
  not for a routine edit. Without that clause the link is either ignored or treated as mandatory
  reading, and both are wrong.
- **The page names the module file back**, in its *Module contracts* section. That half usually
  already exists.
- **Check root's map.** The Modules table's *Detail* column is the third route in. A page reachable
  only from the module file is invisible to an agent still deciding where to go.

**A link is not a load.** Module `AGENTS.md` files are positional — they cost context only while you
are working in that module, and a linked page costs nothing until someone follows it. That is
exactly why explanation is safe to move there, and exactly why the when-to-follow clause has to
travel with the link.

---

## The shape of a module `AGENTS.md`

Sections in this order. **Purpose**, **When a change here ripples**, and **Commands** are required;
the rest appear when the module has something to say.

```
# <Module name>

One or two sentences: what this module owns, and why it exists as its own module.

> When the module has a docs/internals/ page, point at it here, with a when-to-follow
> clause. See "The module file and its internals page" above.

## How it works
Enough structure to navigate — the folders, the entry point, the shape. Not behavior detail.

## Conventions
Local rules. Naming, patterns, what to reach for, what not to. Only what is specific here.

## Hazards
What bites. Non-obvious failures, footguns, things that look safe and are not.
Prefer a hazard that already happened once — those are the ones worth writing down.

## When a change here ripples          <- REQUIRED. See below.

## Commands
Build, test, lint for this module. The commands, not an explanation of them.

## Further reading
Links out — the docs/internals/ page for this subsystem, related module files.
```

Keep it short — but length is a symptom. The rule is the one principle, not a line count.

**Two hundred lines is where you look, not a limit.** Past it, re-read the file against the one
principle and move what is descriptive. A file that is all conventions, hazards, and edges is healthy
well above it. Past roughly four hundred, look harder — something has usually crept in that belongs
on a `docs/internals/` page.

**Never trim to hit a number.** These earn their space at any length, and cutting them is the worse
failure: hazards that already bit someone; co-change edges, consequence clause included; the
`docs/internals/` link and its when-to-follow clause; and recorded known deviations — *"the idiom is
X; `a.ts` and `b.ts` do Y"* — which read like cruft and are load-bearing.

The test that works at any length: **what fraction of this file would need editing in the same PR as
a code change?** Near zero is healthy. High is rotting, at ninety lines or three hundred.

---

## Co-change edges

The load-bearing section. An edge says: **when this module changes, what else has to change with
it.** Declared **outbound from the trigger** — "if you change me, go look at these" — because that is
the direction an agent actually travels, and because whoever edits this module is already in this
file and will keep it current.

Every edge has four parts:

| Part | Job |
|---|---|
| **Trigger** | The specific kind of change that fires this. Not "changes here" |
| **Consequence** | What breaks if it is ignored. **This is the load-bearing part** |
| **Action** | The concrete thing to do |
| **Link** | Where to go for detail |

The consequence clause is what converts a pointer into a requirement. Without it an agent reads a
cross-reference, weighs the cost of another file read, and moves on.

**Good:**

> - **Added, renamed, or deleted a file under `skills/` or `agents/`?** The standard installer's
>   manifest is a checked-in path catalog, and uninstall removes only what the manifest recorded — a
>   stale one leaves orphaned files on the user's machine. Regenerate with `npm run build` in
>   `harness-installers/standard/`. Detail: [`harness-installers/standard/AGENTS.md`](...)

**Bad, and why:**

> - Changes here may affect `harness-installers/`.

No trigger — fires on everything, so it fires on nothing. No consequence, no action.

> - See also: [`cli/AGENTS.md`](...)

A pointer with no information. The agent cannot tell whether it applies before paying to find out.

> - When you add a skill, the manifest at
>   `harness-installers/standard/manifests/<harness>/v1.0.0-alpha.N.json` records a
>   `{bundlePath, destinationPath}` entry per file, and is regenerated by the build script's
>   `emit-manifest` step, which walks the output tree and...

Correct, but it has become the linked file. Say what to do and link; do not re-explain the target.

Aim for a handful of real edges. Most modules have two to four. If you are writing eight, some are
not real co-change relationships — they are just things that are nearby.

---

## Standing up a new module

1. Write the module's `AGENTS.md` to the shape above.
2. **Declare its outbound edges** — what must move when this module moves.
3. **Add a row to root `AGENTS.md`'s Modules table.** A module missing from the map is a module no
   agent will route to.
4. **Ask who needs an edge pointing *at* the new module.** This is the step that gets skipped, and
   skipping it is the whole failure mode of an outbound-only design: a new module is orphaned by
   construction until an existing module declares an edge to it. Walk the modules that will now
   depend on it, or that it changes the behavior of, and add the edge **in their files**.
5. If the module participates in a feature that spans several modules, add or update the row in root
   `AGENTS.md`'s **Surfaces** table.
6. If the module warrants explanation beyond conventions and hazards, write the `docs/internals/`
   page and wire the pair — see *The module file and its internals page* above. A page reachable
   from nowhere a reader starts is an orphan.

Step 4 is not optional. Both times this repo shipped a one-directional link, it was caught by the
repo owner rather than by any check.

---

## Maintaining the set

### Before you evict a section

Removing content carries the same co-change obligation as adding it, and it is easier to miss
because nothing looks broken afterwards.

**Grep for inbound references to this file before you cut.** `docs/internals/` pages cite module
files *by the section they own* — `communication-style.md` points at `ui/AGENTS.md` for "the
dashboard's Communication Style accordion" — so evicting that section silently orphans the pointer.

```
grep -rn "<module>/AGENTS.md" docs/ *.md
```

For each hit, ask whether the sentence still describes what this file holds. If not, repoint it in
the same change. This is the mirror of *Standing up a new module* step 4: that step asks who needs
an edge pointing **at** something new, this one asks who is already pointing at what you are about
to remove.

Then decide where each evicted block actually goes. There are three outcomes, not two:

| The block is | Do |
|---|---|
| A convention, boundary, or hazard | Keep it |
| Valid explanation on the wrong surface | Relocate to `docs/internals/` — **unless the destination already covers it**, in which case delete |
| An answer to *"what does this do"* | Delete. The code is the better source |

### When you change a module

Before you finish:

- Does an existing edge now describe something that is no longer true?
- Did this change create a **new** co-change relationship that no edge declares yet?
- Did it invalidate a hazard, or create one worth recording?
- Did content drift in that describes behavior rather than convention? Apply the one principle.

When you touch root `AGENTS.md`:

- Does the Modules table still match the modules that exist?
- Does the Surfaces table still match what each feature spans?
- Did an invariant land in root that a single module could own? Move it down.

---

## Rules that always apply

Root `AGENTS.md` is authoritative on all of these; they are repeated here only because they bite
hardest while authoring instruction files.

- **Name the members, do not count them.** Never write a count of things the repo contains — nothing
  tests it and it rots the moment anything is added. *"The hooks that ship: `session-preamble`,
  `telemetry-capture`."* The list is the count.
- **Plain code fences** for shell commands, no language tag, unless the snippet uses shell-specific
  syntax.
- **No requirement identifiers** (`FR-N`, `NFR-N`, `AD-N`, `DD-N`, `R-N`, or any planning
  requirements-shaped values) outside planning documents. This applies to the instruction files
  themselves — do not number the rules in an `AGENTS.md` so they can be cited from elsewhere.
- **No markdown-shape tests** asserting on headings or prose without explicit sign-off.
- **Link both directions.** A page nothing links to does not exist.
