# Bootstrap — creating a portfolio

Once per initiative. Everything after this is the design loop.

## Before the call
A portfolio is a commitment to keeping five documents true for months. Confirm it earns that.

- **Is this actually long-running?** Many iterations across many sessions — or one project with
  phases? A project with phases is a project. Say so and stop; a portfolio around it adds
  paperwork and buys nothing.
- **Does one already exist?** `portfolio list` first, every status — the preamble's Active
  Portfolios row only lists active ones, so an on-hold or done initiative for the same subject
  would be invisible to it and this check exists precisely to catch those too. A related
  initiative may already hold this, and a second portfolio beside it splits the record in two —
  the failure this whole system exists to prevent.

## Name it together
The base name and the one-sentence description both go into the create call, and both are hard
to change afterward — there is no rename verb.

- **Propose, don't ask blindly.** Offer a name and a sentence drawn from what you have already
  discussed, then let the operator correct them. "What should we call it?" spends a turn you
  could have spent being useful.
- **Base name:** SCREAMING-CASE, with no `-ROOT` suffix — the CLI adds that itself. Write
  `PORTFOLIO`, never `PORTFOLIO-ROOT`.
- **The sentence** is what a stranger reads to decide whether to open this. Say what the
  initiative is for, not what it is called.

## The call

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" portfolio create --portfolio <BASE> --description "<one sentence>"
```

Creates the directory, the group, and the edge between them. Returns all five document paths
and a `write` field naming which to author now.

If it fails, read the message and fix the input — it rolls back, and the message names what was
undone. Do not retry with a different name to get past an error you have not read.

## Write the two
The create call's `write` field already named them: **root** and **decisions**. Shapes are in
[templates/](../templates/); mechanics in [scribing.md](./scribing.md).

The other three paths are real and already known, but those documents are born later, when they
earn content. This includes iterations, which is easy to assume is fundamental — it is born when
the first iteration is named, not at creation. **An empty document is worse than an absent one:**
it reads as "nothing decided here" rather than "not yet."

## Announce in one line
Say what exists and what comes next — not a tour of the structure the operator just watched you
build.

> Created `PORTFOLIO` — root and decisions written. Next: the spine.
