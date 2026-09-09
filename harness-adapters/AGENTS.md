# `harness-adapters/`

Projects canonical `harness-files/` into one per-harness tree under `output/<adapter.name>/`. The
module exists so that **the engine stays blind**: it knows there are harnesses, never which ones.
Every harness-specific value lives in data outside this engine — the per-harness YAML beside each
agent body in `harness-files/agents/`, and the fields an adapter declares.

> **Where this sits in the pipeline from source to a user's machine:**
> [`docs/internals/system-architecture.md`](../docs/internals/system-architecture.md#from-canonical-source-to-your-machine).
> Read it before adding a harness or changing what translation emits. Not needed to edit an
> existing adapter's fields.

## How it works

```
harness-adapters/
├── adapters/
│   ├── _template/adapter.js   # reference shape; the `_` prefix excludes it from discovery
│   └── <harness>/adapter.js   # one folder per registered harness
├── engine/
│   ├── index.js               # the whole engine: discovery, translation, output writing
│   ├── build.js               # CLI entry — `--harness=<name>` filters to one adapter
│   └── __tests__/             # node:test guards over the engine and the adapters
└── output/<adapter.name>/     # generated; the installers' input, never edited by hand
```

The adapters that ship: `claude`, `copilot-vscode`, `copilot-cli`.

A run walks `adapters/` to discover the registered harnesses, then for each one clears that
adapter's `output/<name>/agents/` and `output/<name>/skills/` and translates the canonical source in
a single pass. No caching, no intermediate manifest, no destination-shaped artifact — the engine
emits harness-shaped files and stops.

### Agents and skills are not translated the same way

This is the distinction to get right, because the two halves look symmetrical and are not.

- **Agents are composed** from the canonical body plus that agent's `<name>.<harness>.yml`. A missing
  YAML for any `(agent, adapter)` pair is a **hard build error** — there is no fallback to the
  canonical body.
- **Skills are copied**, and **nothing projects skill frontmatter.** A skill's frontmatter block
  ships to every harness exactly as authored, which is why `harness-files/` requires it to stay
  portable.

### The adapter contract

An adapter is a data module exporting an `adapter` object carrying `name`, `filenames`, and
`bodyTokens` — and nothing else. No tool dictionary, no model alias map, no frontmatter projector,
no destination logic, no manifest emitter; those are either engine-standard or the installer's
business. `engine/__tests__/day-one-adapters.test.mjs` pins the exact key set and field values of
each shipped adapter, so an extra field fails there rather than being quietly ignored — but only for
the adapters that test names, so a new one gets that check only when you add its case.

| Field | Holds |
|---|---|
| `name` | The harness identifier. Doubles as the output subdirectory name under `output/` |
| `filenames` | One template string per content kind (`agent`, `skill`), with `{name}` as the canonical-name substitution token |
| `bodyTokens` | Flat string-to-string map applied to text content after any frontmatter substitution. Every shipped adapter declares `{}`; the field is the extension point for vocabulary drift |

## Conventions

- **No harness name in `engine/`.** Not in code, not in a comment, not in a fixture path. The
  identity of this module is that the engine cannot tell the harnesses apart; a name in engine
  source is the failure, not a shortcut. See the hazard below — a test enforces it.
- **Harness vocabulary lives in the per-harness YAML**, never in the engine and never in an adapter.
  If you find yourself wanting a conditional on `adapter.name`, the value belongs in
  `harness-files/agents/<agent>.<harness>.yml` instead.
- **The dev-artifact skip-list is engine-owned and not adapter-tunable.** Excluded from source
  iteration everywhere: the directories `__tests__`, `node_modules`, `.next`, `dist`, `dist-bundle`;
  the files `vitest.config.{ts,js,mjs}` and `tsconfig.tsbuildinfo`; and anything matching
  `*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}`. Per-adapter customization would let the same
  fixture land in one bundle and not another.
- **`${...}` destination tokens pass through untouched.** `${SKILLS_ROOT}` and `${PLUGIN_ROOT}` are
  install-time placeholders the installer resolves against the installing user's home. The engine
  never substitutes, validates, or warns on them, and an adapter must never claim one in
  `bodyTokens` — baking a build machine's path into shipped content is the failure that rule exists
  to prevent.
- **`output/` is generated.** Never hand-edit it, never commit a fix into it. Fix the source or the
  adapter and rebuild.

## Hazards

### Writing a harness name anywhere under `engine/` fails CI

`engine/__tests__/harness-blindness.test.mjs` reads every `.js`, `.mjs`, `.cjs`, and `.json` file
under `engine/` (skipping `__tests__` and `node_modules`) and fails if the lowercased text contains
`claude`, `copilot-vscode`, or `copilot-cli`. It is a substring match on the whole file, so **a
harness name in a code comment fails exactly like one in a string literal**. Tests are excluded
because fixtures legitimately spell the names.

### A misfiled adapter is dropped in silence

Discovery skips any folder under `adapters/` whose name starts with `_`, and the output directory is
`adapter.name` rather than the folder name. Ways to register nothing and see no error:

- The folder keeps an `_` prefix — discovery never looks inside it.
- The folder is renamed but `name` still reads `'_template'` — translation succeeds and writes into
  `output/_template/`, which no installer stages.

The placeholder `filenames` in `_template/adapter.js` fail the same way: they resolve to a literal
`<your-harness-agent-pattern>` filename rather than raising. After copying the template, confirm the
build actually wrote `output/<your-harness>/agents/` and `output/<your-harness>/skills/`.

## When a change here ripples

- **Added an adapter?** Discovery finding it is not the same as shipping it. Every installer build
  carries its own hardcoded harness list — `harness-installers/standard/build-scripts/build.js`
  names the set twice (the `HARNESSES` constant and again in the `validate` step's arguments), and
  each plugin build hardcodes a single `--harness=` literal. A correctly registered adapter that is
  in none of them produces `output/` nobody reads, and no build fails. It also needs one
  `<agent>.<new-harness>.yml` beside **every** agent body in `harness-files/agents/` — a single
  missing pair aborts the build for that harness rather than skipping the agent, deliberately, so a
  harness never ships a partial agent set. Detail:
  [`harness-installers/AGENTS.md`](../harness-installers/AGENTS.md),
  [`harness-files/AGENTS.md`](../harness-files/AGENTS.md)

- **Changed `filenames`, `bodyTokens`, or what translation emits?** Two independent surfaces pin the
  result and neither is reached from here: `engine/__tests__/day-one-adapters.test.mjs` asserts each
  shipped adapter's exact field values, and `harness-installers/standard/build-scripts/validate.js`
  gates the packaged tree on the agent filename suffix it expects per harness. A change that only
  satisfies the engine fails at the installer's final gate, after the whole build has run. Detail:
  [`harness-installers/standard/AGENTS.md`](../harness-installers/standard/AGENTS.md)

- **Changed the skip-list, or anything that alters which files land in `output/`?** The installer
  manifests are checked-in path catalogs and uninstall removes only what a manifest recorded, so a
  file that starts or stops being emitted leaves the manifests wrong in one direction or the other.
  Rebuild and commit the manifest diff in the same change. Detail:
  [`harness-installers/AGENTS.md`](../harness-installers/AGENTS.md)

## Commands

Build every registered adapter, or one:

```
node harness-adapters/engine/build.js
node harness-adapters/engine/build.js --harness=<name>
```

Guards:

```
node --test harness-adapters/engine/__tests__/*.test.mjs
```

Building here writes `output/` only. To get an edit onto your own machine, run the full installer
build and reinstall — see the root `AGENTS.md`.

## Further reading

- [`docs/internals/system-architecture.md`](../docs/internals/system-architecture.md#from-canonical-source-to-your-machine)
  — how canonical source reaches a user's machine, and where this pass sits in it
- [`harness-files/AGENTS.md`](../harness-files/AGENTS.md) — the source this module projects, and the
  per-harness YAML vocabulary
- [`harness-installers/AGENTS.md`](../harness-installers/AGENTS.md) — what consumes `output/`
- [`AGENTS.md`](../AGENTS.md) — the repo map, and the Distribution surface this module sits on
