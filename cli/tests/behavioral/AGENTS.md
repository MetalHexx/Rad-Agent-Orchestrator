# `cli/tests/behavioral/`

The tier that pins a command's **externally observable contract** — the JSON envelope, the resulting
`state.json`, and the side-files the command writes — and nothing else. A test here should survive
any internal refactor of the command it covers and fail only when the contract a caller depends on
actually changes.

> **What that contract is for lives in [`docs/internals/cli.md`](../../../docs/internals/cli.md)** —
> who calls the binary, what the envelope promises them, and why the command surface is shaped this
> way. Read it before adding a suite for a command family this tier does not cover yet, or when you
> are deciding whether an assertion is on the contract or on an internal. Not needed to add a case
> to an existing suite.

## How it works

```
behavioral/
├── pipeline/
│   ├── events/*.behavioral.test.ts           # event suites, plus cross-cutting flow suites
│   ├── events/fixtures/                      # synthetic template bodies shared by those files
│   ├── unhappy/<class>.behavioral.test.ts    # bad-input, invalid-transition, missing-world
│   ├── helpers/                              # scoped to this command family
│   └── fixture-audit.test.ts                 # meta-guard over the files above
└── manifest-integrity/                       # not a command suite; see below
```

`pipeline/` is the command family the tier was built around, and the shape to copy. Its helpers:
`world.ts` (per-test `os.tmpdir()` project scaffolding), `drive.ts` (the event chains that walk a
fresh world to a named node), `catalog.ts` (points the composer at a real or copied action/event
catalog), `capture.ts` (stdout capture around a command call), `assert.ts` (the
envelope/state/side-file assertion), and `prompt.ts` (the `data.prompt` / `data.completion_event` /
`data.completion_commands` contract). `drive.test.ts` covers the driver itself.

**Not every file here is a behavioral test.** `manifest-integrity/` guards that one action-event
file survives intact into the shipped installer manifests, and `pipeline/fixture-audit.test.ts`
scans the behavioral sources for an assertion pattern the contract retired. Both are legitimate
residents; neither drives a command, so neither carries the suffix.

## Conventions

- **`.behavioral.test.ts` marks a test that drives a command.** The suffix is the filter tooling can
  select on, and the signal that the file is bound by the assertion rules below. A guard that does
  not invoke a command uses a plain `.test.ts` name.
- **Assert on the envelope, on `state.json`'s contents or absence after the call, and on the
  side-files the command touched inside the project directory — and on nothing else.** Never assert
  on mutation order, walker decisions, intermediate engine state, logs, or console output; those are
  the internals the tier exists to stay out of.
- **In-process invocation.** Drive either the framework dispatcher —
  `runCommand(<command>, { argv, env, isTTY, stderr })` with stdout captured — or the command's core
  function directly. **No test in this tier spawns a Node subprocess.**
- **Each test authors its own world.** A per-test `os.tmpdir()` directory holds the seed state,
  config, and project scaffolding, and the world owns its own cleanup.
- **Helpers are scoped to a command family**, under `<command>/helpers/`. There is no CLI-wide
  behavioral helper module; a new family copies the shape into its own folder rather than reaching
  across.
- **Choosing a tier.** Framework tests (`cli/tests/framework/`) cover argv parsing, exit-code wiring,
  and logger plumbing. Integration tests (`cli/tests/integration/`) cover cross-command and
  cross-package wiring. Behavioral tests cover the public contract of a **single command call**.
  When the assertion is on the envelope, state, and side-files of one call, prefer this tier.

## Hazards

### The world is synthetic; the template and catalog often are not

Tests author their own template bodies (`events/fixtures/`), but the tier also reads production
content directly, and that coupling is easy to miss:

- `helpers/drive.ts` resolves `runtime-config/templates/` and copies `extra-high.yml` into the
  world, because the chains are written against the real extra-high DAG.
- `helpers/catalog.ts#useRealCatalog()` points the engine's composer at
  `runtime-config/action-events/` so prompts compose from the files committed at HEAD.
  `useTempCatalogCopy()` snapshots them first when a test needs to mutate frontmatter or author a
  custom slot.
- `manifest-integrity/` reads a catalog file and the standard installer manifests straight from the
  working tree.

So a `runtime-config/` edit can break this suite. **CI will not tell you.**
`.github/workflows/cli.yml` triggers on `cli/**`, `lib/repo-registry/**`, `lib/work-graph/**`, and
`lib/telemetry/**` — `runtime-config/**` is not a trigger path. A PR touching only `runtime-config/`
can break these tests with no signal, and the red lands on the next unrelated `cli/**` PR.

### Pinned literals rot quietly

Every seed state in this tier writes the `$schema` literal for the current state schema, and
`manifest-integrity/` names manifest files by their version-numbered filename. Neither is derived
from a constant, so both survive a bump elsewhere by silently testing the old world.

## When a change here ripples

- **Adding a behavioral suite for a command outside `pipeline/`?** Nothing needs wiring —
  `cli/vitest.config.ts` includes `tests/**/*.test.ts` and CI runs the package's suite, so a new
  folder is picked up. What you do owe is the helper set: copy the shape from `pipeline/helpers/`
  into `<command>/helpers/` rather than importing across families, or the first refactor of the
  pipeline helpers breaks a suite that has nothing to do with the pipeline. Detail:
  [`cli/AGENTS.md`](../../AGENTS.md#adding-a-subcommand)

- **Reached for a new file under `runtime-config/` from a helper?** You have widened a coupling that
  CI does not watch, in the direction where the breakage lands on somebody else's PR. Prefer
  authoring the content into the world's own fixture. If the test genuinely needs the shipped file,
  say so in a comment at the read site so the next person editing `runtime-config/` has something to
  grep for. Detail: [`runtime-config/AGENTS.md`](../../../runtime-config/AGENTS.md)

- **Changed a helper under `pipeline/helpers/`?** Every file in `events/` and `unhappy/` drives
  through them, and `drive.test.ts` and `fixture-audit.test.ts` assert on the driver and on the test
  sources themselves. Run the whole tier, not the file you were editing. Detail:
  [`cli/src/lib/pipeline-engine/AGENTS.md`](../../src/lib/pipeline-engine/AGENTS.md)

## Commands

Run from `cli/`:

```
npm test
npx vitest run tests/behavioral
```

## Further reading

- [`cli/src/lib/pipeline-engine/AGENTS.md`](../../src/lib/pipeline-engine/AGENTS.md) — the state
  machine this tier's `pipeline/` suite covers
- [`cli/AGENTS.md`](../../AGENTS.md) — the envelope contract these tests assert on
- [`docs/internals/cli.md`](../../../docs/internals/cli.md) — what the command surface is for
- [`AGENTS.md`](../../../AGENTS.md) — the repo map, and the invariants no single module owns
