# Designing a Communication Style

For the free-form branch of `rad-communication`'s `SKILL.md`. Read this when someone wants to craft a style, adjust one, or has just told you that you're annoying them.

## What you're actually doing

You are not filling out a form. You are helping someone describe something they have felt for years and probably never had to articulate: how they like to be talked to.  Offer sugestions, ask questions, most importantly,  be a good listener.  Don't firehose them about who they are with little information -- you don't know them, so be inquisitive and take it slow.

Most people can't answer "what tone do you want?" — it's an abstraction they've never needed a vocabulary for. But nearly everyone can answer "what's something a coworker does that drives you up the wall?" Irritation is specific and immediately available; preference is vague and reconstructed after the fact. **Mine the irritation.** "You over-explain" is a usable finding. "I want concise" is a word that means six different things to six people.  But it's not all about irritations.  Sometimes it's about a pacing style, level of elevation, word choice, question framing.  There are many things that shape the way the user communicates, and it's your job to help them scribe a communication style that works for them.

Expect the stated request and the real one to differ. "Be more concise" sometimes means fewer words, but just as often means *stop hedging*, *lead with the answer*, or *stop explaining things I already know* — three different fixes, all of which read as length from the outside. Ask what specifically felt long, and you'll usually find the actual complaint underneath. Take the complaint seriously and diagnose it; don't just accept the label and shave word count.

Watch how the user writes to you, too. Someone who types in terse fragments and someone who writes full paragraphs are telling you something before you ask. It's evidence, not proof — some people write tersely and want to read prose — but it's a good opening hypothesis to test out loud.

## Why it's worth the effort

A communication style is one of very few things in this harness that the user tunes for themselves rather than for the work. Get it right and it disappears — every future session simply feels easier, and they stop noticing the interface at all. Get it wrong and it's a small tax on every exchange, one that most people will tolerate silently rather than complain about twice.

That asymmetry is the reason to invest real attention here: they may only tell you once.

## Dimensions

Six axes, matching `STYLE-TEMPLATE.md`'s sections. They're a checklist for *your* coverage, not a script — never walk a user through all six in order. A complaint usually lives on one axis; a from-scratch style benefits from a light pass across all of them.

**Tone** — the register underneath the words. Peer thinking out loud, or professional filing a report? The live question is usually warmth and hedging, not formality: "might be worth checking the null case" and "handle the null case" carry identical information and land entirely differently.

**Structure** — how a reply is shaped. Scannable bullets or connected prose. Answer first then reasoning, or reasoning that arrives at the answer. This one tracks how someone reads: skimmers want the shape visible at a glance, readers find bullets fragmented and want the argument to hold together.

**Length** — the ceiling on a routine reply, and what earns an exception. Ask both halves. A ceiling with no exception clause produces terse answers in exactly the moments that deserved depth.

**Vocabulary** — assumed knowledge. Jargon reads as respect for expertise to one person and as gatekeeping to another. The tell is whether they want a term defined on first use or find that patronizing.

**Depth** — how far to go unprompted. Whether noticing that the sibling module has the same bug is a service or a digression. Some people want every tradeoff surfaced; others want the question answered and nothing more.

**Avoid** — the explicit anti-pattern list. Usually the richest section and the easiest to fill, because it's where the irritation lives. Start here when someone arrives complaining.

## Converging

Play back a concrete sample — a couple of lines written the way you'd write them under the style being described — rather than a summary of what they said. People recognize the register instantly when they see it and will correct it far more precisely than they can specify it in the abstract.

Then push for brevity. This file loads into the context window every session, so the shipped ceiling is roughly 25–35 lines of high-signal bullets. A long conversation does not become a long style; distill it, and drop anything the user only mildly agreed with — what survives should be the things they actually cared about. If they want it longer anyway, that's their call; make sure they know the cost is paid every session, then write what they asked for.
