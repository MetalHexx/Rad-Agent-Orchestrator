# `cli/`

The `radorch` binary — a single Node/TypeScript CLI carrying every deterministic operation in the
system. Skills, hooks, and the dashboard all reach it rather than re-deriving the same decision, so
its command surface is an integration contract, not a human convenience.

> **The how and why live in [`docs/internals/cli.md`](../docs/internals/cli.md)** — what the command
> surface is for, how the noun groups are organised, and why so little of the system's behavior sits
> in prose. Read it before adding a noun, changing the envelope, or reworking the framework. Not
> needed to add a subcommand to an existing noun.

## How it works

- `src/bin/radorch.ts` — process entry point. Reads argv, builds the commander program, invokes it.
- `src/cli.ts` — the program builder. Wires every top-level noun and delegates to per-subcommand
  modules.
- `src/framework/` — `defineCommand` / `runCommand`, the envelope `emit` surface, logger, prompter,
  theme, and the exit-code map.
- `src/commands/<noun>/` — one folder per noun. Each subcommand exports a `defineCommand` value and
  a **pure core function** that does the work and is test-injectable.
- `src/lib/` — cross-command utilities. `src/lib/pipeline-engine/` is a module in its own right with
  its own `AGENTS.md`.
- `tests/` — vitest, mirroring the `src/` tree.

The nouns are `action-events`, `amendment`, `communication-style`, `config`, `doctor`, `execute`,
`gate`, `graph`, `migrate`, `pipeline`, `plan`, `portfolio`, `project`, `project-group`, `repo`,
`repo-group`, `session`, `session-context`, `side-project`, `skill`, `source-control`, `telemetry`,
`ui`, and `worktree` — one folder each under `src/commands/`. **Reuse one before inventing another**
— group by the concept the user thinks they are acting on, not by the tool the implementation
reaches for. `source-control` is a noun; `git` is not.

## Conventions

- **One envelope on stdout, always.** Every path emits exactly one `{ ok, data, error }` through
  `framework/output.ts#emit`. No subcommand calls `console.log` directly, no path emits two JSON
  objects, and no path emits a bare object outside the envelope. The payload goes in `data`.
- **Do not invent exit codes.** The framework maps `ok: true → 0`, `user_error → 1`,
  `system_error → 2`. A **success** envelope may carry an `exit_code` override to say "`ok: true`,
  but the caller should treat this as a failure" — `doctor` reporting findings, `execute prepare`
  reporting an unpushed branch, `worktree create` aggregating per-repo results. On a failure
  envelope the field is **ignored** (`framework/command.ts:145` only reads it when `envelope.ok`),
  so setting it there does nothing; several commands do anyway. Reach for the override only when a
  caller must branch on the process exit status — otherwise express partial success in `data`.
- **Three-level help text.** A one-line description on the noun group, a present-tense action-verb
  description on each `defineCommand` (under 90 columns, no trailing period), and a description on
  every arg and flag saying what it accepts and what it defaults to. Verify at all three depths:
  `radorch --help`, `radorch <noun> --help`, `radorch <noun> <subcommand> --help`.
- **Shell-outs are dependency-injected.** A subcommand that runs an external binary exports a pure
  core function taking injectable dependencies; the `defineCommand` handler is a thin shell over it.
  Unit tests pass stubs and never require the host to have the binary.
- **No test-only branches in production code.** Injection is how the test and production paths stay
  honest. Never add `if (process.env.NODE_ENV === 'test')`.
- **No new runtime dependencies without a strong reason.** Everything here is bundled into
  `radorch.mjs` by esbuild, so each entry in `package.json#dependencies` grows what ships. Prefer
  `node:*` builtins.
- **`state` answers "what state is this project in".** `status` and `tier` are subordinate
  diagnostic detail and must never be read as the answer. The vocabulary is owned by
  `@rad-orchestration/work-graph` and reached through its facade — never re-declared here.
- **Never write `.project-sessions.json` directly.** A new capture seam calls `session save`, which
  owns writing both that file and the telemetry project index together. Writing one without the
  other is how an attributed session loses its retention exemption.

### Registry writes go through named mutations — hard rule

A command must never import `writeIdentity` / `writeLocal` / `ensureLocalGitignored`, and never
mutate `reg.repos`, `reg.repoGroups`, or `reg.localPaths` and persist inline. Read with
`readRegistry` / `resolveRepoPath`, do the domain work, then call exactly one named mutation:
`addRepo`, `editRepo`, `removeRepo`, `bindRepo`, `createGroup`, `editGroup`, `addGroupMember`,
`removeGroupMember`, `deleteGroup`.

This keeps the write surface reusable — the dashboard calls the same library — and keeps the
registry's invariants in one place. Enforced by `tests/lib/registry-mutation-seam.test.ts`.

### Flag matrices that depend on a discriminant

When a flag's validity depends on another flag's value — `worktree launch --agent` selects which of
`--prompt` and `--permission-mode` apply — validate synchronously in the handler **before any
side-effecting work**. Export the validator as a pure function returning
`{ ok: true, ...normalized }` or `{ ok: false, error }`, so it is independently testable. On
rejection, surface `user_error` naming both the offending flag and the discriminant value that
caused the conflict. Worked example: `validateLaunchFlags` in `src/commands/worktree/launch.ts`.

## Hazards

### `repo-registry` and `work-graph` report failure differently

There is no single error convention across the seams, and the difference is silent in both
directions:

- **`@rad-orchestration/repo-registry` throws.** A bad slug, a missing repo, an unparseable file —
  all `throw new Error(...)`.
- **`@rad-orchestration/work-graph` returns failure as a value**, `{ ok: false, error: { code,
  message } }`, and never throws for those cases.

**An uncaught throw is classified as `system_error` and exits 2**, because `framework/command.ts`
wraps anything that is not already a `RadorchError` in `SystemError`. So a registry error that is
plainly the user's fault — "repo 'x' does not exist" — reports as an internal failure unless your
command catches it and rethrows as `UserError`. In the other direction, an unchecked `{ ok: false }`
from work-graph is a truthy object: forget to test `.ok` and the command reports success.

Catch registry throws and reclassify; branch on `.ok` for work-graph. Do not assume either shape.

### Error messages reach the envelope verbatim

`framework/command.ts` emits `err.message` straight into the envelope, which is then parsed by
skills and printed to users. Never interpolate a git remote URL, `gh` output, or `process.env` into
an error — remotes carry embedded access tokens.

### `dist/` and the shipping bundle are different artifacts

`npm run build` runs `tsc` into `cli/dist/`, used locally and to verify the workspace package
resolves before bundling. **The shipping artifact is `radorch.mjs`**, produced separately by
esbuild, which inlines every dependency — including the workspace libraries' `dist/` — into one
file. A change that works against `dist/` can still break the bundle.

### Changes here do not reach your own machine

Preamble and CLI output changes land on a developer machine only through an installer reinstall.
Run `/rad-dogfood-harness`; nothing here is hot-reloaded.

## When a change here ripples

- **Changed a subcommand's name, arguments, or `data` shape?** Skills call this binary by exact
  command string and read fields out of `data`, and so do the installed hooks — each of which calls
  exactly one subcommand: `shared/hooks/session-preamble.mjs` calls `session-context`,
  `telemetry-capture.mjs` calls `telemetry capture`. Nothing resolves any of those references, so a
  rename fails at runtime on a user's machine with no build error anywhere, and a hook fails
  **silently** by contract — the preamble degrades to "ambient awareness did not load" and exits 0.
  Update every calling `SKILL.md`, plus whichever shim calls the command you changed. Detail:
  [`harness-files/AGENTS.md`](../harness-files/AGENTS.md),
  [`harness-installers/shared/hooks/AGENTS.md`](../harness-installers/shared/hooks/AGENTS.md)

- **Changed logic the dashboard keeps its own copy of?** `ui/` may not import `cli/src/`, so the
  logic it shares is transplanted into it by hand: `pipeline-engine/action-event-loader.ts` +
  `composer.ts` → `ui/lib/action-events-fs.ts`; `lib/communication-style.ts` →
  `ui/lib/communication-styles-fs.ts`; `lib/project-sessions.ts` →
  `ui/lib/project-sessions-reader.ts`; `lib/repo-identity.ts#normalizeRemote` →
  `ui/lib/registry/validate.ts`; `commands/config/index.ts#readConfig`'s `communication_style` and
  `ambient_awareness` defaults → `ui/lib/fs-reader.ts`; `commands/portfolio/show.ts` →
  `ui/lib/portfolio-show.ts`. **`cli/` is canonical and changes first.** Divergence is silent
  — no test spans the pair — and the `normalizeRemote` copy is the worst of them, because both
  sides *write* the shared repo registry, so a drifted normalizer persists mixed remote formats on
  disk. Port the change and update the transplant's header comment. Detail:
  [`ui/AGENTS.md`](../ui/AGENTS.md)

- **Changed a command the dashboard shells out to?** The gate and compose routes invoke this binary
  through `RADORCH_CLI_PATH` and branch on the envelope. A changed error shape or exit code
  surfaces as an unexplained 500 in the browser. Grep `ui/` for the subcommand string and update
  the route's branching in the same change. Detail: [`ui/AGENTS.md`](../ui/AGENTS.md)

- **Added or renamed an `orchestration.yml` field in the `config` commands or a `doctor` check?**
  The field is only half-real until it also exists in the file `runtime-config/` ships and in the
  dashboard's editor registry — otherwise the CLI validates a key no shipped config contains, and
  the editor never offers it. Detail: [`runtime-config/AGENTS.md`](../runtime-config/AGENTS.md)

- **Added a new external binary dependency?** A missing tool otherwise surfaces as a crash
  mid-pipeline rather than a diagnosis. Extend `doctor`'s tooling probes so it is caught up front.
  Existing probes: `git` and `gh` unconditionally, plus `claude`, `copilot`, and `code` when the
  matching harness is installed. Detail:
  [`src/commands/doctor/checks.ts#runToolingChecks`](./src/commands/doctor/checks.ts)

- **Changed the pipeline engine's state shape, node ids, or event vocabulary?** The engine is a
  module in its own right with consumers well outside this binary — the dashboard renders its DAG
  from those node ids in the browser, and nothing type-checks across that boundary. Read its file
  before editing, and do not reach into it from a new subcommand unless that subcommand approves or
  progresses pipeline state. Detail:
  [`src/lib/pipeline-engine/AGENTS.md`](./src/lib/pipeline-engine/AGENTS.md)

- **Changed something the shipping bundle has to carry — a new dependency, a dynamic `require`, or a
  path resolved at runtime?** Every installer variant inlines this module through `emitCliBundle` and
  ships the result as its `radorch.mjs` payload, so one bundling break takes every release channel
  out at once. Nothing here covers that artifact: the local bundle smoke test builds `dist/` through
  this module's own `scripts/bundle.mjs`, not the payload the installers emit from `src/`. Run every
  installer build before landing — root `AGENTS.md` names them as the pre-land gate. Detail:
  [`harness-installers/AGENTS.md`](../harness-installers/AGENTS.md),
  [`AGENTS.md`](../AGENTS.md#pre-land-validation-gates)

## Adding a subcommand

The code pattern is best learned by reading a neighbour — `src/commands/source-control/init.ts` is
the reference. What is *not* discoverable from the code is everything else the change owes:

1. **Core function** in `src/commands/<noun>/<name>.ts` — pure, injectable dependencies, returns the
   response shape. The framework wraps it in `data`. No `console.log` inside it.
2. **`defineCommand` shell** in the same file, plus a `*WithDefaults` variant wiring the real
   implementations.
3. **Re-export** from `src/commands/<noun>/index.ts`.
4. **Register** in `src/cli.ts` under the noun group, mirroring an existing block exactly.
5. **`doctor` probe**, only if it shells out to a binary not already probed.
6. **Unit test** at `tests/commands/<noun>/<name>.test.ts` covering every documented outcome. Stub
   the injected dependencies; never shell out to a real binary.
7. **Help-shape test** — extend `tests/bin/help.test.ts` so the subcommand surfaces at all three
   depths.
8. **Rewrite the calling skill** to the canonical call form, reading results from `data`.
   `harness-files/tests/test-skill-call-form.test.mjs` catches a malformed rewrite.

Steps 3, 4, and 7 are the ones that get skipped, and none of them fails loudly.

You do **not** owe a manifest regeneration. The installer manifests are path catalogs, and this
whole module bundles to a single entry — `skills/rad-orchestration/scripts/radorch.mjs` — so adding
a file under `src/` changes no manifest at all.

## Commands

```
npm run build
npm test
```

## Further reading

- [`docs/internals/cli.md`](../docs/internals/cli.md) — what this command surface is for and how it
  is organised
- [`src/lib/pipeline-engine/AGENTS.md`](./src/lib/pipeline-engine/AGENTS.md) — the state machine
- [`harness-files/AGENTS.md`](../harness-files/AGENTS.md) — the canonical skills that call this
  binary, and the `${PLUGIN_ROOT}` token contract
- [`harness-installers/AGENTS.md`](../harness-installers/AGENTS.md) — how `emitCliBundle` ships it
- [`AGENTS.md`](../AGENTS.md) — the repo map, and why nothing may write to stdout outside the
  envelope
