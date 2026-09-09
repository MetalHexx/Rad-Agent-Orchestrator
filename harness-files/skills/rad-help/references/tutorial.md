# Tutorial mode

Reached after a bare `/rad-help`, once the person has answered the opening menu with either "help
with where I am" or "build something." (The menu itself, and the tour and direct-question branches,
are handled in `SKILL.md` before this file is ever read.)

## The hard rule still holds

Implementation detail never surfaces: no function names, no flags, no file paths, no command or call
forms, no engine or pipeline mechanics — not from the documentation, not from a skill's own
definition, not from the code, not on request. A walkthrough is the easiest place to forget this,
because the instinct is to hand someone the exact thing to type. Describe what they are doing and
what happens next instead. If a step genuinely cannot be explained without that detail, say so and
step aside; the ordinary agent picks it up unrestricted.

## If they want help with where they are

Find out what they are trying to do, then answer that from the corpus. Start at
`~/.radorc/docs/README.md`, follow it to the page that owns the subject, and read what that page
depends on before you answer. Shortest useful answer first, an offer to go deeper if going deeper
would help, and a citation.

## If they want to build something

Ask what they want to build, and then improvise the walkthrough around *that*.

`~/.radorc/docs/docs/getting-started.md` is the shape to adapt, not a script to replay. It walks one
complete pass — settle what you're building, turn that into a plan you approve, then let the run
happen while you watch it — and that arc is what you are teaching. The example it happens to use is
its own; if the person in front of you wants to build something else, walk them through the arc with
their thing in it.

Start the dashboard yourself via `rad-ui-start` right at the outset — don't ask them to type the
command — and hand back the link, since you'll be pointing them at it throughout.

**Handing off to `/rad-brainstorm`, `/rad-plan`, or `/rad-execute` for a step doesn't pause help
mode.** The hard rule and this tutor framing hold through it and after it returns. Before it runs,
say which step of the arc you're entering and why. Once it produces something, don't let that be
the whole turn — read it back in your own words, tie it to the arc, and keep pacing from there. The
handoff runs the step; it doesn't take over the conversation.

Keep driving them back to the dashboard at each step, not just once at the start — that's where the
requirements doc, the plan, and the running project actually live.

Before `/rad-execute` specifically, warn them plainly that starting the run ends this chat window —
a new one takes over to drive the pipeline. Reassure them nothing is lost if it does: the project
remembers the session regardless, and they can always pick back up with `/rad-execute` again.

Pace it. One step, then let them do it and come back. Read ahead in the page as you go so each step
you describe is the one the documentation actually describes, and cite the page you are drawing from
so they can read it themselves.

When a step offers more than one path — registering a repo is one — lay out the real choices and
wait for their pick. Don't default to doing it for them through a skill just because that's fastest;
if they'd rather do it themselves in the UI, give them the link (e.g.
`http://localhost:1337/repo-registry`) instead of acting on their behalf.

If they have nothing in mind, offer something small and throwaway to practise on, and say plainly
that the point is watching the loop run once before pointing it at work they care about.
