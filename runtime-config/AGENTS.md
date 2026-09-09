# `runtime-config/`

Source of truth for harness-neutral runtime configuration. Installers copy this content **verbatim**
to `~/.radorc/`; nothing here is transformed, templated, or made harness-specific. If a value would
differ per harness, it does not belong in this folder.

> **Where this sits in the pipeline from canonical source to a user's machine:**
> [`docs/internals/system-architecture.md`](../docs/internals/system-architecture.md#from-canonical-source-to-your-machine).
> Read it before adding something new to this folder or changing how a category is staged. Not
> needed to edit a value in a file that already ships.

## How it works

| Path | Ships? | Holds |
|---|---|---|
| `orchestration.yml` | yes | System configuration, read by every project's pipeline |
| `templates/` | yes | The review-intensity tier templates the engine loads when a project starts |
| `action-events/` | yes | The action and event catalog — one markdown file per action or event, plus a `README.md` |
| `action-events/custom/` | folder only | User overlay target. Ships empty; contents are never installed or removed |
| `communication-styles/` | yes | Shipped style definitions: YAML frontmatter (`name`, `title`, `description`) plus prose |
| `communication-styles/custom/` | folder only | User overlay target, same rule as above |
| `node-graph-templates/` | **no** | Belongs to the **v3 engine, on hold and off limits**. Consumed only by `graph-service/` tests. Nothing in the installer reads it |
| `tests/` | no | `orchestration-config.test.mjs`, the guard over the shipped config shape |

The tier templates are `extra-high.yml`, `high.yml`, `medium.yml`, and `low.yml`. Each defines a
`template` header — `id`, `version`, `description` — and a `nodes` DAG; the header's own
`description` says which review stages that tier runs, so read the file rather than a summary of it.

### `custom/` is a reserved overlay slot, not a folder an install creates

Both `action-events/` and `communication-styles/` carry a `custom/` directory for user-authored
overlays, and the build's filter stages the directory while excluding everything inside it. It does
**not** follow that an install creates it: a manifest catalogs files only, and each install loop
creates just the parent directory of a file it is about to write, so nothing puts an empty `custom/`
on the user's machine. Treat it as a reserved destination that exists once something writes into it.
A change to how either folder is staged must preserve the filter — dropping it would carry
user-overlay files into the payload and the manifest, and from there an upgrade overwrites them.

### What survives an upgrade, and what does not

`orchestration.yml` survives both an upgrade and an uninstall — which is why the hazard below holds.
Everything else this folder ships is **overwritten** on every upgrade. The plugin and standard
channels reach that outcome by different mechanisms, so do not carry the one you happen to be
reading across to the other:

- **Plugin variants — the manifest's `ownership` field.** `orchestration.yml` is marked
  `user-config`; the tier templates, action-event files, and communication styles are marked
  `installer-owned`. `install-files.js` short-circuits a `user-config` entry whose destination
  already exists, and `remove-files.js` skips one outright. The `installer-owned` entries are
  **removed** on uninstall.
- **Standard channel — `hydrateUserData`.** Its manifests carry no `ownership` field, and neither
  `orchestration.yml` nor `templates/` appears in one at all. `hydrateUserData` owns them: it copies
  `orchestration.yml` only when the destination is absent, and rewrites the shipped tier templates
  every time. Being in no manifest, both also survive an uninstall — of what this folder ships, only
  the action-event and communication-style catalogs are removed.

**Anything under `custom/` survives both operations** — it is in no manifest, so nothing installs or
removes it, and uninstall's empty-directory pruning stops at a folder that still has content. That
is the whole reason the overlay directories are user-writable and the shipped ones are not: edit a
shipped file on your machine and the next upgrade silently reverts you.

## Conventions

- **No per-harness anything.** No conditionals, no harness names, no adapter-specific paths.
- **No runtime variable substitution.** Every value is a static literal.
- **YAML only** for configuration; no JSON equivalents. The catalogs are markdown.
- **No adapter pass reads this folder.** The `harness-adapters` engine does not touch
  `runtime-config/`, and it should stay that way — this content is projected by copying, not by
  transformation.

## Hazards

### `orchestration.yml` is user-owned after install

Editing it here changes **fresh installs only**. Every channel declines to overwrite an existing
copy — the plugin installers skip any entry tagged `ownership: user-config`, and the standard
hydrator copies only when the file is absent — so an update leaves a running machine on its old
defaults and a field you add is absent from every machine already installed. Anything reading a new
field must tolerate its absence rather than assume the shipped default.

Adding a section lands in several files — see the co-change edges below.

### `action-event-loader.ts` and `ui/lib/action-events-fs.ts` both parse the catalog

`action-events/` is read by the pipeline engine's `action-event-loader.ts` **and**, independently, by
`ui/lib/action-events-fs.ts`, which is a deliberate transplant so the dashboard's catalog routes can
stay in-process. A frontmatter shape this folder introduces has to be understood by both. Only the
compose route exercises them against each other, and only when someone clicks Preview.

## When a change here ripples

- **Added, renamed, or deleted any file that ships?** Every installer manifest is a checked-in path
  catalog, and **uninstall removes only what the manifest recorded** — a stale one leaves orphaned
  files on the user's machine. **The manifests are not all maintained the same way.** The standard
  installer's, one per harness, are generated: run `npm run build` from the repo root and commit the
  diff — but `orchestration.yml` and `templates/` are excluded from those manifests and installed by
  the hydration step instead, so changing either produces no standard manifest diff to commit. The
  plugin variants' are **hand-authored** — the build copies the committed
  `manifests/v<version>.json` verbatim, so no rebuild can regenerate them, and `claude-plugin/`,
  `copilot-cli-plugin/`, and `copilot-vscode-plugin/` each need the entry added by hand. This folder
  is the *only* source whose entries are hand-authored there — the shipped documentation corpus is
  the other half of those catalogs and the build generates it into `output/manifests/` — so a file
  added here is owed in every one of them. Each variant's `tests/manifest-payload-parity.test.mjs` is what catches a missed one. Detail:
  [`harness-installers/AGENTS.md`](../harness-installers/AGENTS.md)

- **Added or renamed a field in `orchestration.yml`?** A field present here and nowhere else is
  invisible to every surface a user actually touches. The dashboard needs it in
  `ui/lib/config-field-meta.ts` **and** `ui/lib/config-validator.ts`, or it renders no control and
  validates nothing. The CLI is a narrower obligation, not a blanket one: `readConfig` projects a
  named subset — `source_control`, `telemetry`, `ambient_awareness`, `communication_style` — and
  `doctor` reports only on what it diagnoses, so extend those when your field is one the CLI is
  meant to surface and leave them untouched when it is not. Detail: [`ui/AGENTS.md`](../ui/AGENTS.md),
  [`cli/AGENTS.md`](../cli/AGENTS.md)

- **Added or changed an action or event file?** The pipeline engine composes prompts from these, and
  the dashboard parses them again through its own transplanted reader to render the catalog and the
  overlay editor. Change the frontmatter shape and the two parsers disagree silently — the engine
  keeps working while the dashboard's Preview diverges. Detail:
  [`cli/src/lib/pipeline-engine/AGENTS.md`](../cli/src/lib/pipeline-engine/AGENTS.md)

- **Changed the frontmatter shape a shipped communication style carries?**
  `cli/src/lib/communication-style.ts` and the dashboard's hand-maintained transplant
  `ui/lib/communication-styles-fs.ts` parse these independently, and both reject a style whose
  frontmatter is missing a required field. Neither rejection reaches the user: the style drops out
  of the dashboard's catalog behind a `console.warn` on the server's own stderr, and the
  session-start read returns null with nothing logged at all, so a selected style silently stops
  being applied. Change the shape in both parsers, or in neither. Detail:
  [`cli/AGENTS.md`](../cli/AGENTS.md), [`ui/AGENTS.md`](../ui/AGENTS.md)

- **Changed a tier template's schema, node ids, or DAG shape?** The engine walks it, and the
  dashboard both serves and edits it through `ui/app/api/templates/` with its own serializer and
  layout logic. A shape change that only satisfies the engine will break the dashboard's template
  views. Detail: [`ui/AGENTS.md`](../ui/AGENTS.md)

## Commands

This folder has no build. Its guard runs from the repo root:

```
node --test runtime-config/tests/orchestration-config.test.mjs
```

To confirm the installers stage a change correctly:

```
node harness-installers/standard/build-scripts/build.js
```

## Further reading

- [`docs/configuration.md`](../docs/configuration.md) — the user-facing reference for every field
  in `orchestration.yml`
- [`docs/custom-instructions.md`](../docs/custom-instructions.md) — what the action and event
  catalog is for, and how a user overlays it
- [`docs/internals/system-architecture.md`](../docs/internals/system-architecture.md#from-canonical-source-to-your-machine)
  — how this folder reaches a user's machine
- [`AGENTS.md`](../AGENTS.md) — the repo map, and the Distribution surface this folder sits on
