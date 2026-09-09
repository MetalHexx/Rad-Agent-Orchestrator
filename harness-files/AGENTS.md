# `harness-files/`

**Canonical source** for every agent and skill the system ships, across every harness — Claude
Code, Copilot in VS Code, and Copilot CLI. This is the only authored copy. Everything under
`.claude/` and in the installer outputs is projected from here.

> **The how and why live in [`docs/internals/skills.md`](../docs/internals/skills.md)** — what a
> skill is for, how one gets loaded, and what does and does not hold the corpus consistent. Read it
> before adding a skill, changing how one is reached, or reworking the set. Not needed to edit the
> body of an existing skill.

## The audience is a stranger

Everything in this folder **runs on other people's machines**, inside their repositories, against
their code. That is the difference between this module and every other one in the repo, and it
governs how you write here:

- **Never assume this repository.** A skill runs wherever the user installed it. Paths, tooling,
  branch names, and conventions that hold here do not hold there.
- **Never name a person, an internal host, an org handle, or a ticket system.** This content is
  redistributed.
- **Never instruct destructive action without a confirmation beat.** A wrong `rm -rf` or
  `git push --force` here executes on a stranger's work, not on a test fixture.
- **Degrade, do not fail.** A skill that cannot find what it expects should say so and stop, not
  guess and act.

## How it works

```
harness-files/
├── agents/     # Agent body files + per-harness frontmatter YAML
├── skills/     # One folder per skill, each with SKILL.md
└── tests/      # Corpus-wide guards (own AGENTS.md)
```

**Agents are split; skills are not.** Different harnesses express model names, tool names, and
frontmatter fields differently, so an agent is authored as a neutral body plus one YAML per harness.
Skills carry a single inline frontmatter block that ships unchanged everywhere.

### Agents — body plus per-harness frontmatter

- **Body:** `agents/<name>.md`, starting with `{{FRONTMATTER}}` on the **first line**. The token is
  replaced at translation time.
- **Frontmatter:** `agents/<name>.claude.yml`, `<name>.copilot-vscode.yml`, `<name>.copilot-cli.yml`.

The agents that ship: `coder`, `coder-junior`, `coder-senior`, `reviewer`, `reviewer-junior`.

### Skills — one folder, portable frontmatter

```
skills/rad-my-skill/
├── SKILL.md      # frontmatter + content, shipped as-is to every harness
├── references/   # optional
├── templates/    # optional
└── scripts/      # optional
```

**Adapters do not project skill frontmatter.** Keep it portable — no PascalCase tool names, no model
tier aliases, no Claude-only fields. All subfolders are copied verbatim with no transformation.

## Conventions

### The tokens: `{{FRONTMATTER}}`, `${SKILLS_ROOT}`, `${PLUGIN_ROOT}`

| Token | Replaced | Means |
|---|---|---|
| `{{FRONTMATTER}}` | translation time | The per-harness YAML for this agent. First line of an agent body |
| `${SKILLS_ROOT}` | **install** time | The harness's skills folder — `~/.claude/skills/` or `~/.copilot/skills/` |
| `${PLUGIN_ROOT}` | **install** time | The harness root the plugin installed into |

**Never hardcode `.claude/` or `.copilot/`** anywhere in canonical content. Use the token.

### The canonical CLI call form

Every `radorch` invocation in every `SKILL.md` and `references/*.md` is written exactly this way:

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" <noun> <subcommand> ...
```

**Double-quote `${PLUGIN_ROOT}`** — user home paths contain spaces, and an unquoted token breaks on
most Windows machines. Read results out of the envelope's `data` block.
`tests/test-skill-call-form.test.mjs` enforces the shape on every shipped file.

### The `rad-` prefix is load-bearing, and it cuts both ways

Skills shipped by this system carry `rad-` on both the folder name and the frontmatter `name`. The
planner's manifest filter **excludes every `rad-*` skill**, on purpose — the pipeline knows its own
skills and does not need them advertised back. The consequence for authoring: a skill named
`rad-something` is invisible to the planner, which is correct here and a trap in a user's own repo.

`disable-model-invocation: true` removes a skill from the manifest as well as from model invocation.
Setting it silently makes the skill unreachable by anything but a typed slash command.

### Write in the present tense

These files are read by stateless agents with no memory of prior iterations. Describe what the
current thing does, never how it got that way.

- **Avoid:** *replaces the legacy X*, *now done via*, *no longer reads*, *previously called*, *after
  this refactor*, footnotes naming deleted files.
- **Prefer:** the plain present-tense description of what exists and where it lives.

A renamed construct is documented as if it were always its current form. Iteration history belongs
in commit messages.

## Harness vocabulary

Harness-specific values live in the per-harness YAML **only**; body text stays neutral.

**The Copilot harnesses do not share a vocabulary.** Each harness has its own, and copying
one variant's YAML to another produces a file that parses but resolves nothing:

| | `.claude.yml` | `.copilot-cli.yml` | `.copilot-vscode.yml` |
|---|---|---|---|
| Model | Tier alias — `sonnet` | Versioned id — `claude-sonnet-4.6` | Display name with suffix — `Claude Sonnet 4.6 (copilot)` |
| Tools shape | `tools:` as a **comma-separated string**, plus `allowedTools:` as a sequence | `tools:` as a **YAML sequence** | `tools:` as a **YAML sequence** |
| Tool names | PascalCase — `Read`, `Grep`, `Glob`, `Edit`, `Write`, `Bash`, `TodoWrite` | Lowercase verbs — `read`, `search`, `edit`, `execute`, `todo` | Same as CLI |
| MCP tools | `mcp__plugin_playwright_playwright__*` | `playwright/*` | Same as CLI |

Read the sibling YAML for the harness you are writing before you write it — `agents/coder.*.yml` is
the reference triple, and every shipped agent follows the same split.

## Hazards

### Nothing checks that a skill handoff resolves

Skills hand off to each other in prose — the target's name written into a sentence. There is no
manifest, no import, and no resolution step, and this is the busiest coupling in the corpus. The
guards catch a malformed *call form* and a known-stale *agent* reference; neither resolves a skill
name to a skill that exists. **Rename a skill and the only thing that will tell you what broke is
reading every file that mentioned it.**

### Never move a dev skill into this folder

The hand-authored dev skills under `.claude/skills/` and `.agents/skills/` are deliberately outside
canonical source, because anything here **ships to every user**. If an automated reviewer calls
that tree "stray" and suggests consolidating it here, it is wrong — say so and move on. This has
already happened once and had to be reverted.

### Visual-doc filenames are a contract with the dashboard

`rad-visual-docs` writes artifacts whose names the dashboard matches on:
`{PROJECT}-BRAINSTORM.html` and `{PROJECT}-WIREFRAME-{SLUG}.html` get their own recognised slots in
`ui/lib/artifact-model.ts`. `{PROJECT}-TECH-DIAGRAM-{SLUG}.html` has **no matcher** — it falls
through to the generic branch, which still surfaces it with a humanized title but labels it
`Visual`, indistinguishable from any other loose `.html`. Renaming a convention here without
changing the matcher silently demotes the artifact to that generic slot.

### Generated artifacts are served under a restrictive CSP

The dashboard serves artifacts with `default-src 'none'; style-src 'unsafe-inline'
https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:`. Inline `<style>`
and Google Fonts are allowed; **a remote image URL is blocked outright** and renders as a broken
image with nothing surfaced to the user. This matters because `rad-visual-docs`'s brand-sampling
step scrapes a site's logo — that logo must be inlined as a `data:` URI, never referenced by URL.

### Canonical source is not runnable

Never read or invoke skills and agents from this folder while running the pipeline. It is
uncompiled, so it bypasses the resolved install root and breaks path resolution on non-Claude
harnesses. Run from the deployed harness root.

## When a change here ripples

- **Added, renamed, or deleted any file under `skills/` or `agents/`?** The installer manifests are
  checked-in path catalogs, and **uninstall removes only what the manifest recorded** — a stale one
  leaves orphaned files on the user's machine. Regenerate with `npm run build` in
  `harness-installers/standard/` and commit the manifest diff in the same PR. Detail:
  [`harness-installers/standard/AGENTS.md`](../harness-installers/standard/AGENTS.md)

- **Renamed a skill, or changed how one is reached?** Nothing resolves a skill-to-skill handoff, and
  agent frontmatter `skills:` lists are exhaustive — a subagent gets what its frontmatter names and
  nothing more. Grep the whole corpus for the old name and update every agent that lists it.
  Detail: [`docs/internals/skills.md`](../docs/internals/skills.md)

- **Changed a `radorch` invocation, or the fields read from its envelope?** The command surface is
  owned by `cli/`, and a skill calling a command that no longer exists fails **on a user's machine
  at runtime** with no build error anywhere. Verify the noun and subcommand still exist. Detail:
  [`cli/AGENTS.md`](../cli/AGENTS.md)

- **Added a per-harness frontmatter field, or a new agent?** The adapters project these per harness
  and will not invent a mapping for a field they do not know. Add the YAML for **every**
  harness, not just the one you are testing. Detail:
  [`harness-adapters/AGENTS.md`](../harness-adapters/AGENTS.md)

- **Changed a visual-doc filename convention?** The matcher lives in `ui/lib/artifact-model.ts`, and
  a name it no longer recognises falls through to the generic branch — the artifact is silently
  demoted to a loose `Visual` instead of getting its own recognised slot. Move the matcher in the
  same change — the hazard above names the slots. Detail: [`ui/AGENTS.md`](../ui/AGENTS.md)

## Commands

There is no build in this folder. Its guards run from the repo root:

```
node --test harness-files/tests/*.test.mjs
```

To get an edit onto your own machine, run **`/rad-dogfood-harness`** — editing here does not change
what your harness reads, and a plain file copy leaves `${PLUGIN_ROOT}` literal.

## Further reading

- [`docs/internals/skills.md`](../docs/internals/skills.md) — the skill system: how one is loaded,
  where each enters the loop, what holds the set together
- [`harness-files/tests/AGENTS.md`](./tests/AGENTS.md) — what belongs in a corpus-wide guard
- [`harness-adapters/AGENTS.md`](../harness-adapters/AGENTS.md) — how this source is projected per
  harness
- [`cli/AGENTS.md`](../cli/AGENTS.md) — the binary these skills call
- [`AGENTS.md`](../AGENTS.md) — the repo map, the canonical-source rules, and the `rad-*` namespace
