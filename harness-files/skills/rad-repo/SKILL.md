---
name: rad-repo
description: Use this skill whenever a task might involve code beyond the current working directory — when you're figuring out where code lives, scoping work that may span multiple repositories, or about to act as if the current repo is the whole system.  Use it whenever the user asks to register, bind, describe, group, or manage repositories and repo-groups.
user-invocable: true
---

# What is the `rad-repo` skill?

Your view of the world is bounded by your current working directory. The work rarely is. A single feature or task often spans several repositories — a backend, a frontend, a shared library, infrastructure — and from inside one directory you have no way to know the others exist.

The **repo registry** is your map of that larger world: the repositories a team works across, where each one lives on this machine, and — through each repo's **description** — what it is and why you'd ever look there. This skill exists to give you that map and teach you to use it well.

Two forces are always in play, and good work needs both:

- **Reach** — descriptions are your *reason to explore*. "There's a repo over there" is useless; "there's a repo over there that owns billing" is a decision you can act on. Reach is what stops you from tunnelling on the current directory and missing where the work actually lands.
- **Focus** — **repo-groups** scope you to the repos that matter for a domain. A team may own *Products* and *Authentication*; a task about product copy has nothing to do with auth. Groups keep you from wasting effort and context on unrelated code.

Blindness (missing relevant repos) and distraction (drowning in irrelevant ones) are the two failure modes. The registry is the dial between them — and it only works if the map is **true**.

# How you should work

- **Don't assume the current directory is the whole story.** Before you research or write code, ask whether the task reaches other registered repos. Consult the session preamble, `repo list`, and `repo show` to orient.
- **Help scope; don't own the plan.** When work is being scoped, surface the map — descriptions for reach, repo-groups for focus — and offer to crystallize a recurring working set into a group. Planning which repos a task touches and sequencing the work is `/rad-brainstorm`'s, using this map. See [references/interacting-with-users.md](references/interacting-with-users.md).
- **Capture the *true* home, and interview on ambiguity.** Register a repo's durable main clone — never a throwaway worktree or a subdirectory you happen to be in. The CLI resolves the deterministic facts (the main clone, the remote, the default branch); *you* resolve the judgment calls (the slug, which remote, the description, "is this even the repo they mean?"). Run `repo add --dry-run` first to see what the CLI detected, then confirm with the user before writing.
- **Descriptions are required and load-bearing.** Every repo and repo-group must carry a real "what is this and why would I look here." Never write a placeholder — a description-less map is a blind one.
- **Confirm before anything destructive** (`repo remove`, `repo-group delete`); run everything else directly.
- **Side-projects are unregistered by design.** A side-project is a personal, self-contained project that lives at `~/.radorc/side-projects/<project-name>/`. It is never written to either registry file (`repos.yml` or `repo-groups.yml`) and never appears in the session-start ambient registry block — that block lists only registered repos, so side-projects are naturally excluded from team-shared awareness. Do not attempt to register a side-project's folder; its absence from the registry is intentional.

# Commands & references

The CLI is the mechanical executor — fail-loud and non-interactive. *You* bring the conversation: warm, helpful, plain language. Resolve the mechanics silently — surface only the conclusion and any real question, never raw output or flags. (See [references/interacting-with-users.md](references/interacting-with-users.md) for voice & tone.) Every command supports `--help` at the noun, subcommand, and flag level.

- **[references/concepts.md](references/concepts.md)** — what repos, repo-groups, and the registry are; the two-file model; the unbound state; slug and description rules. Start here when you (or the user) need the *why*.
- **[references/cli-commands.md](references/cli-commands.md)** — the full command + flag reference for `repo` and `repo-group`.
- **[references/interacting-with-users.md](references/interacting-with-users.md)** — how to register, scope, bind, and manage *with* the user: the dry-run → interview → confirm flow, project scoping, and the unbound/empty-state cases.
- **[references/multi-repo-projects.md](references/multi-repo-projects.md)** — what makes a project multi-repo, how the workspace is arranged, why the agent works from above the repos, and why a single clone cannot host a multi-repo project.

Each command emits a JSON envelope `{ "ok": <bool>, "data": { ... }, "error": { ... } }`. On success, surface the relevant `data` fields in a short plain-language confirmation. On failure, surface `error.message`.

# Orient → situate → act

`rad-repo` gives you **repo identity and homes** — the first step. For everything that follows (work items, inter-repo relationships, and "where should I actually do this work?"), continue to **`rad-project`**: it is the work-graph-aware layer that situates tasks, tracks relationships, and surfaces worktree awareness. Route any work / relationship / "where do I do it" question to `rad-project` rather than stopping at the registry.

The full in-scope orient → situate chain is: **`rad-repo`** (repo identity & homes) → **`rad-project`** (work, relationships, worktree awareness).
