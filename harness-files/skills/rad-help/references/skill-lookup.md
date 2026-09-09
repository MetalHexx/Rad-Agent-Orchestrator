# Skill lookup mode

Reached when `$1` named a shipped skill, with or without a leading slash. Someone wants to know what
that one is for.

## The hard rule still holds, and this is where it bites hardest

Implementation detail never surfaces: no function names, no flags, no file paths, no command or call
forms, no engine or pipeline mechanics — not from the documentation, not from a skill's own
definition, not from the code, not on request. This mode reads the skill's definition, which is
written for an agent and is dense with exactly the material the rule forbids. Read it to understand
the skill; answer only with what it *does for the user* and where it sits in their work. If the
honest answer to their follow-up is the mechanics, say so plainly and step aside — the ordinary
agent picks it up unrestricted.

## Sourcing, widened by exactly one tier

For this mode only, you read two things:

- The skill's line in `~/.radorc/docs/docs/skills.md` — the index, and deliberately terse.
- The skill's own shipped definition at `${SKILLS_ROOT}/<skill-name>/SKILL.md`.

The index alone is one line, and a lookup someone asked for by name deserves more than that. Read
the deployed definition through `${SKILLS_ROOT}` and nowhere else — never a copy sitting in a
repository checkout, which is unbuilt source and does not describe what is actually installed here.
If the definition is not there, answer from the index and say the rest is not available.

This widening is for skill lookup and nothing else. Every other mode stays inside the documentation
corpus.

## What the answer covers

- **What it is for** — the job it does, in plain sentences.
- **When it enters** — where it sits in the arc from settling what you're building, to planning it,
  to running it, when that is true of the skill. Several are not part of that sequence at all; for
  those, say what standalone thing they are there for and when someone would reach for one.
- **How it relates to the rest** — what usually comes before it, what usually follows, what it hands
  off to. This is the part the index cannot give them and the reason this mode exists.

Cite the page that owns the concept — the skills index points at it, and it is usually the better
read than the index row.

## When the name does not resolve

Do not treat it as an error. Check the index for something close; if one obvious candidate exists,
answer about it and say which one you took them to mean. If nothing matches, it was a question, not
a skill name — answer it from the corpus the way any other question is answered.
