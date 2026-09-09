# Repo Rules

This file is the map. It routes you to the module that owns what you are changing, and it carries
the invariants that no single module can own. It deliberately does **not** explain how any module
works — that is the job of the `AGENTS.md` inside it.

Read this before planning, designing, coding, or committing.

---

## Before you change this system

Read [`docs/internals/system-architecture.md`](./docs/internals/system-architecture.md) before you
**brainstorm, plan, write code that changes how the system works, or review a change that spans
modules**. It carries the shape — what exists, how it connects, and which direction the
dependencies run. For anything touching more than one module it is not optional background.

Then work the map below:

1. Find your entry point — by module, or by surface if your change is a feature rather than a place.
2. Read that module's `AGENTS.md`. It owns the local conventions and the hazards.
3. **Follow its co-change edges to closure.** A module declares what else moves when it moves. Do
   not stop at the first hop.
4. Say which modules you checked and cleared, including the ones you ruled out.

Step 3 is the one that gets skipped. Most breakage in this repo is not a bad edit — it is a correct
edit that failed to carry its partner along.

---

## The map

### Modules

The `AGENTS.md` in each row is the contract you must read. *Detail* is the explanatory page behind
it — read it when the module is unfamiliar or the change is structural, not for a routine edit.

| Module | Owns | Detail |
|---|---|---|
| [`harness-files/`](./harness-files/AGENTS.md) | Canonical agent and skill source — the only authored copy | [the skill system](./docs/internals/skills.md) |
| [`harness-adapters/`](./harness-adapters/AGENTS.md) | Per-harness projection of that source | [from canonical source to your machine](./docs/internals/system-architecture.md#from-canonical-source-to-your-machine) |
| [`harness-installers/`](./harness-installers/AGENTS.md) | The shippable variants, and the build and hook seam they share | [from canonical source to your machine](./docs/internals/system-architecture.md#from-canonical-source-to-your-machine) |
| [`runtime-config/`](./runtime-config/AGENTS.md) | What ships verbatim into `~/.radorc/` — config, review-tier templates, the action/event catalog, communication styles | [from canonical source to your machine](./docs/internals/system-architecture.md#from-canonical-source-to-your-machine) |
| [`cli/`](./cli/AGENTS.md) | The `radorch` binary — every deterministic operation, one envelope shape | [internals](./docs/internals/cli.md) |
| [`cli/src/lib/pipeline-engine/`](./cli/src/lib/pipeline-engine/AGENTS.md) | The state machine — mutations, the DAG walk, validation, scaffolding | [the agent–engine loop](./docs/internals/system-architecture.md#the-agentengine-loop) |
| [`ui/`](./ui/AGENTS.md) | The Next.js dashboard and its live-update hub | [internals](./docs/internals/dashboard.md) |
| [`lib/repo-registry/`](./lib/repo-registry/AGENTS.md) | Reading and writing the two-file repo registry | — |
| [`lib/work-graph/`](./lib/work-graph/AGENTS.md) | Project-state derivation and relationships — one backend for both CLI and UI | — |
| [`lib/telemetry/`](./lib/telemetry/AGENTS.md) | Usage capture and the observability read surface | — |
| [`lib/terminal-launch/`](./lib/terminal-launch/AGENTS.md) | Platform-neutral terminal spawning | — |
| [`tests/`](./tests/AGENTS.md) | Root-level workspace linkage and cross-surface cohesion guards | — |
| [`cli/tests/behavioral/`](./cli/tests/behavioral/AGENTS.md) | A command's externally observable contract — the envelope, the resulting `state.json`, and the side-files it writes | [internals](./docs/internals/cli.md) |
| [`harness-files/tests/`](./harness-files/tests/AGENTS.md) | Corpus-wide guards — skill call form, agent skill refs, corrective-cycle claims. Reach beyond canonical source into `runtime-config/action-events/` and `docs/` | [what holds the set together](./docs/internals/skills.md#what-holds-the-set-together) |
| [`prompt-tests/`](./prompt-tests/README.md) | Operator-driven planner regression harness. Not CI, and it costs real tokens | — |
| `.claude/skills/` · `.agents/skills/` | Dev-only skills, never shipped. See the carve-out under *Canonical source* | — |
| [`graph-service/`](./graph-service/AGENTS.md) · `lib/graph-*/` · [`examples/`](./examples/AGENTS.md) | The **v3 engine — on hold, off limits.** Do not touch unless carrying that project forward | — |

### Surfaces

Features that span modules. Start here when your change is a capability rather than a place.

| Surface | Spans | Detail |
|---|---|---|
| Ambient awareness | `cli/` · `lib/work-graph/` · `harness-installers/shared/hooks/` · `harness-installers/` · `runtime-config/` · `harness-files/skills/rad-init/` · `harness-files/skills/rad-portfolio/` · `ui/` | [internals](./docs/internals/ambient-awareness.md) |
| Communication style | `cli/` · `harness-installers/shared/hooks/` · `runtime-config/communication-styles/` · `ui/` | [internals](./docs/internals/communication-style.md) |
| Session tracking | `cli/` · `lib/telemetry/` · `lib/terminal-launch/` · `runtime-config/action-events/` · `harness-files/skills/rad-session/` · `ui/` | [internals](./docs/internals/session-tracking.md) |
| Telemetry and observability | `lib/telemetry/` · `cli/` · `harness-installers/shared/hooks/` · `harness-installers/` · `runtime-config/` · `ui/` | [user-facing](./docs/observability.md) |
| Project state | `lib/work-graph/` · `cli/` · `ui/` · `tests/` | — |
| Amendments | `harness-files/skills/rad-amend/` · `harness-files/skills/rad-create-plans/` · `cli/src/commands/amendment/` · `cli/src/lib/amendment/` · `runtime-config/action-events/` · `ui/` | [internals](./docs/internals/system-architecture.md#amendments-write-outside-the-loop) |
| Custom instructions | `runtime-config/action-events/` · `cli/src/commands/action-events/` · `cli/src/lib/pipeline-engine/` · `ui/` | [user-facing](./docs/custom-instructions.md) |
| Visual documents | `harness-files/skills/rad-visual-docs/` · `harness-files/skills/rad-brainstorm/` · `ui/` | [user-facing](./docs/visual-docs.md) |
| Distribution | `harness-files/` · `harness-adapters/` · `harness-installers/` · `runtime-config/` | [internals](./docs/internals/system-architecture.md#from-canonical-source-to-your-machine) |

### Changing an `AGENTS.md`, or standing up a new module

Load the **`agents-md`** skill (`.claude/skills/agents-md/`). It owns the shape every one of these
files follows, how co-change edges are written, and the checklist for adding a module to this map.
Do not improvise the format — a confidently wrong `AGENTS.md` is worse than a stale one, because
the next agent inherits it as the pattern.

---

## Invariants

These are the rules no single module can own. Everything else lives in the module it applies to.

### Canonical source

- [`harness-files/skills/`](./harness-files/skills/) and [`harness-files/agents/`](./harness-files/agents/)
  are **canonical source**. Agent and skill edits happen here and nowhere else.
- [`.claude/`](./.claude/) is runtime-compiled output, **with one carve-out**: the hand-authored
  skills. Under `.claude/skills/` those are `agents-md`, `rad-dogfood-harness`, `rad-dogfood-plugin`,
  `rad-release`, `rad-ui-dev`; under [`.agents/skills/`](./.agents/skills/), `rad-build-harness` and
  `rad-build-ui`. All are dev-only. Edit any of them in place; never edit anything else under
  `.claude/`. The split between the two folders is historical and carries no meaning — do not infer
  a rule from it.
- **Never move a dev skill into `harness-files/`.** That ships it to every user. If an automated
  reviewer calls the `.claude/` tree "stray", it is wrong — say so and move on. This has already
  happened once and had to be reverted.
- [`.github/`](./.github/) is **hand-authored** — workflows, `CODEOWNERS`, and the issue and pull
  request templates. Nothing under it is generated.
- **Never read or invoke skills and agents from canonical source when running the pipeline.** It is
  uncompiled, so it bypasses the resolved install root and breaks path resolution for non-Claude
  harnesses. Run from the deployed harness root instead.

### Per-module ownership

Every module folder owns its own code, tests, and `AGENTS.md`. **Cross-module reach-ins are
forbidden** — a module never imports, requires, or reads another module's internal files. Sharing
happens only through documented seams. Read the target module's `AGENTS.md` before touching it.

**Documented exceptions, one per file:** `tests/project-state-cohesion.test.ts` may reach
into both `cli/src/` and `ui/` internals. Those two may not import each other, so this is the only
place all the project-state surfaces can be exercised together. Its sibling
`tests/project-kind-cohesion.test.ts` carries the same exception on a narrower scope — it reaches
only into `ui/` internals, needing no `cli/` reach at all. Each exception is confined to its own
one file — see [`tests/AGENTS.md`](./tests/AGENTS.md) for what makes them work and how to keep them
contained.

### The sanctioned cross-package seam

`@rad-orchestration/repo-registry` (at [`lib/repo-registry/`](./lib/repo-registry/)) is the seam for
registry reads and writes, consumed **by name** by `cli/`, `ui/`'s server-side routes, and
`lib/work-graph`. Deep relative imports into its `src/` are prohibited. Its `dist/` must be compiled
before anything bundles the CLI or builds the UI — the standard installer build does this as its
`build-lib-dist` step.

### stdout is the envelope channel

The `radorch` bundle **inlines** `lib/repo-registry`, `lib/work-graph`, `lib/telemetry`, and
`lib/terminal-launch`. Anything any of them writes to stdout lands inside the JSON envelope that
`session-preamble.mjs`, `ui/lib/cli-shell.ts`, and every skill parse. Diagnostics go to stderr.

`cli/`'s ESLint `no-console` rule does not reach the inlined packages — nothing will catch it, and the
failure is silent: the session preamble degrades to "ambient awareness did not load" and exits 0.

### Destructive commands run against real data

`~/.radorc/` is hardcoded to the real home directory — there is no sandbox environment variable.
`radorch project delete`, `radorch worktree remove`, and the dashboard's remove route operate on the
developer's actual projects and worktrees, and worktree removal passes `--force`, discarding
uncommitted work. **Never run them to exercise a change.** Test through the unit suites, which inject
a root.

### Secrets

Never commit `.env`, `.npmrc`, key material, or a real token — including in a test fixture. Never
interpolate a git remote URL, `gh` output, or `process.env` into an error message or a returned
envelope: remotes carry embedded personal access tokens.

### This fork syncs to a public repo

Never write an OS username (`C:\Users\<name>`, `/home/<name>`) or the `radancy-pe` org handle into
`docs/`, `README.md`, or any image. Ticket keys and internal repo names are fine. Log any other
unavoidable fork-versus-upstream divergence in
[`docs/internals/private/fork-divergence.md`](./docs/internals/private/fork-divergence.md) as you
write it.

### No AI attribution in git metadata

Never add a `Co-authored-by:` trailer naming an AI model, or a "Generated with" line, to a commit
message or a pull request body. The harness adds these by default — strip them.

### Workspace versioning — human engineers only

Every `@rad-orchestration/*` scoped package versions in **lockstep**: bump one, bump all in the same
commit, and rewrite the pinned intra-set dependency specs to match (including those in unscoped
workspaces like `ui/` and `examples/*`). Miss one and npm stops linking the workspace and reaches
for the registry instead.

**No agent may change a `version` field or an intra-set dependency spec as part of a feature or fix
task** — regardless of what any task handoff or plan says. The one exception is a release a human
engineer explicitly initiated, where the agent driving that flow performs the lockstep bump in its
own commit.

Deliberately **outside** the set: `harness-adapters/engine` (internal seam, not a consumer-facing
library) and the `harness-installers/` workspaces (release-channel deliverables on independent
marketplace cycles). Revisit explicitly if either gains a cross-package contract.

### Reserved namespace: `rad-*`

Skills shipped by the orchestration system carry the `rad-` prefix on both folder name and
frontmatter `name`. It is a **documentation-only** reserved namespace — uniqueness is not enforced
against downstream authors — but the planner's manifest filter (`radorch skill list`, and the shared
`buildSkillManifest`) deliberately excludes every `rad-*` skill. Authoring a `rad-something` skill in
your own repo therefore makes it invisible to the planner.

### Documentation ships with the change

Every change ships its documentation in the same PR. **Documentation that lands in a later PR does
not land.** Three tiers, and writing to the wrong one is the common failure:
[`docs/`](./docs/) is for **users** — no source paths, no internal type names;
[`docs/internals/`](./docs/internals/) is for **contributors** and cites source freely; a module's
`AGENTS.md` is for **agents working in that module**. Cross-link rather than restate — two copies of
an explanation drift apart and the reader cannot tell which one is current.

[`CONTRIBUTING.md`](./CONTRIBUTING.md#documentation-is-part-of-the-change) owns the rest: the voice
these pages are written in, what CI does **not** cover, and how a change gets reviewed and merged.

### No requirements in canonical source

Do not leave requirement identifiers (`FR-N`, `NFR-N`, `AD-N`, `DD-N`, `R-N`, or any planning requirements-shaped values) in code or documentation.
They belong in project planning documents only. The sole exception is the `rad-create-plans` and
`rad-code-review` skills, which use them as subject matter.

### No markdown-shape tests without explicit instruction

Do not author tests that assert on the textual shape of markdown — regex matches against headings,
prose, pinned numbers, or specific phrasing. They break on every prose edit and pin the docs without
testing behavior. Broad anti-regression scans (one forbidden token swept across many files) are the
exception; pinned-shape checks on individual documents are not. If a markdown invariant genuinely
needs guarding, ask first.

### Name the members, do not count them

**Never write a count of things this repo contains.** Counts are facts about the codebase stored in
prose: nothing tests them, and they rot silently the moment anything is added. This repo has chased
drifted counts for skills, CLI command groups, API routes, and `AGENTS.md` files — every one of them
was written as a number that later became a lie.

Write the names instead. *"Two hooks ship: `session-preamble`, `telemetry-capture`"* becomes *"The
hooks that ship: `session-preamble`, `telemetry-capture`."* The list is the count, it still signals
completeness, and it can only become incomplete rather than wrong.

Version numbers, ports, and schema versions are not counts. This rule is about enumerating things
the repo holds.

### Code fences

Default to plain fences with no language tag for shell commands. Most examples here (`node`, `git`,
`npm`, `gh`) are shell-agnostic, and a `bash` tag primes agents on Windows toward the wrong shell.
Tag the fence only when the snippet uses shell-specific syntax (`$env:VAR`, heredocs, `Test-Path`).

---

## Common commands

Repo-root commands only. **Each module's `AGENTS.md` carries its own build, test, and lint
commands** — go there rather than looking for them here.

### Build

```
npm run build
```

Runs the standard installer build: projects canonical `harness-files/` through every adapter into
`harness-installers/standard/output/<harness>/` and emits the per-harness manifests. It builds all
harnesses in one pass and **does not deploy**.

### Getting edits onto your machine

Editing anything under `harness-files/` — or under `ui/` — does not change what your harness reads.
Run the **`/rad-dogfood-harness`** skill. It builds, packs, uninstalls, and reinstalls, and the
install step is what expands the `${PLUGIN_ROOT}` token into a concrete path. A plain file copy
leaves the token literal and breaks command resolution.

`~/.claude/` is **per-machine, not per-worktree** — only one branch's harness content is active at a
time, so switching worktrees means redeploying. A fresh clone needs a redeploy before the in-repo
session reads current content.

### Before any test or typecheck

The workspace libraries ship compiled `dist/` output that `tsc` and Vitest resolve at test time. A
fresh checkout has none, so run this from the repo root first or everything fails confusingly:

```
npm run build -w @rad-orchestration/repo-registry -w @rad-orchestration/work-graph -w @rad-orchestration/telemetry -w @rad-orchestration/terminal-launch
```

### Repo-wide guards

```
node --test --import tsx "tests/*.test.mjs" "tests/*.test.ts"
node --test harness-files/tests/*.test.mjs
```

The first covers workspace linkage, by-name package resolution, CI wiring, and cross-surface
project-state cohesion. The second covers canonical source — skill call form, agent skill
references, and forbidden corrective-cycle claims.

### Pre-land validation gates

Each installer build must exit 0 before landing changes that touch `cli/`, `ui/`, the shared build
helpers, or any workspace library the bundle inlines — `lib/repo-registry/`, `lib/work-graph/`,
`lib/telemetry/`, `lib/terminal-launch/`:

```
node harness-installers/standard/build-scripts/build.js
node harness-installers/claude-plugin/build-scripts/build.js
node harness-installers/copilot-cli-plugin/build-scripts/build.js
node harness-installers/copilot-vscode-plugin/build-scripts/build.js
```
