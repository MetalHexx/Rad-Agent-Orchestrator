# `cli/src/lib/pipeline-engine/`

The state machine behind `radorch pipeline signal` and the `gate approve plan` / `gate approve final`
commands. Every pipeline
event enters `processEvent` in `engine.ts`, which loads state, applies the event's mutation,
validates the result, persists `state.json`, and resolves the next action through the DAG walker.
It lives inside `cli/` but is a module in its own right, because its state shape, node ids, and
event vocabulary are read by surfaces that cannot import it.

> **The how and why live in
> [`docs/internals/system-architecture.md`](../../../../docs/internals/system-architecture.md#the-agentengine-loop)**
> — what the agent–engine loop is, why the DAG is a template decision rather than an engine
> decision, and where amendments sit outside the loop. Read it before changing the state shape,
> adding an event, or making a change that spans modules. Not needed to fix a mutation.

## How it works

| Path | Holds |
|---|---|
| `engine.ts` | `processEvent` — the loop. Also owns out-of-band routing and catalog-root resolution |
| `mutations.ts` | The per-event mutation registry. `getMutation(event)` is the only way in |
| `dag-walker.ts` | Walks the template against state to resolve the next action and node path |
| `validator.ts` | State invariants checked on every write. `schema-validator.ts` is the Ajv pass over the JSON Schema |
| `constants.ts` | The frozen enums — node kinds and statuses, graph statuses, next actions, `EVENTS`, `OUT_OF_BAND_EVENTS`, review verdicts, `ALLOWED_NODE_TRANSITIONS` |
| `types.ts` | `PipelineState`, template and node types, `IOAdapter`, `PipelineResult` |
| `state-io.ts` | `readState` / `writeState` / `readConfig` / document IO — the filesystem `IOAdapter` |
| `scaffold.ts` | Materializes node state from a template node when the walker first reaches it |
| `template-loader.ts` · `template-resolver.ts` · `template-validator.ts` | Load a tier template, decide which one applies, and check its shape |
| `action-event-loader.ts` · `composer.ts` · `custom-slot.ts` | Parse the action/event catalog and compose the action prompt, including user overlays |
| `completion-commands.ts` · `context-enrichment.ts` · `resolve-doc-paths.ts` · `pre-reads.ts` | Build what rides on the envelope: the signal commands, the enriched action context, resolved doc paths, and pre-read documents |
| `condition-evaluator.ts` · `frontmatter-validators.ts` · `config-validator.ts` · `path-context.ts` | Conditional-node expressions, catalog frontmatter rules, `orchestration.yml` field validation, and root path resolution |
| `migrations/` | `version.ts` (`CURRENT_SCHEMA_VERSION`) and `steps.ts` (`MIGRATION_LADDER`) |
| `schemas/` | The current JSON Schema, plus every superseded one under `schemas/legacy/` |

`cli/src/commands/pipeline/signal.ts` is the primary consumer; `cli/src/commands/gate/shared.ts`
drives the same `processEvent` for `gate approve plan` and `gate approve final`. Both project the
result into the envelope `{ ok, data: { action, context }, error }` every downstream consumer reads.

**The catalog is runtime input, not documentation.** `composer.ts` reads action and event markdown
from `userDataPaths().actionEvents` — `~/.radorc/action-events/`, which is what `runtime-config/`
shipped — and composes the prompt that rides on the envelope. A missing catalog file is not an
error; the composer returns nothing for it and the prompt loses that section silently.

## Conventions

- **Every event and status string comes from `constants.ts`.** Never write the literal inline. The
  frozen enum is the vocabulary; a hardcoded string is invisible to every consumer that greps for
  one.
- **`ALLOWED_NODE_TRANSITIONS` is keyed on node status, not on events.** It maps a `NodeStatus` to
  the statuses that may follow it, and the validator enforces it on every write. Adding a **node
  status** means adding it to `NODE_STATUSES` *and* giving it an entry plus every inbound edge in
  that map — an omitted transition makes writes fail validation. Adding an **event** does not touch
  this map at all; see below.
- **Adding an event** means: an entry in `EVENTS`; a mutation registered against it in
  `mutations.ts` (unregistered events have no path through the loop); an `event.<name>.md` file in
  the catalog, or the composed prompt silently omits its section; and, if the event fires outside
  the template's event index — a rejection, a halt, a configuration mutation — an entry in
  `OUT_OF_BAND_EVENTS`, which is routed **ahead of** the index in `engine.ts`.
- **Mutations receive a deep clone and return a new state.** Never touch the live state reference
  passed in. `MutationResult.mutations_applied` is internal observability and never reaches the
  envelope.
- **The corrective cycle defers the node pointer.** On `code_review_completed`,
  `phase_review_completed`, or `final_review_completed` with `verdict: changes_requested`, the
  mutation marks the corrective task active and leaves the pointer on the review node until the
  corrective's own completion event fires — including the step-host case, where a
  `final_review_completed` corrective is appended to the review step's own `corrective_tasks[]`
  rather than to a phase or task iteration. A mutation branching on this pattern must read the
  corrective-task entry in state rather than assume the pointer moved.

## Hazards

### This library is the sole `state.json` writer only *inside* the loop

No skill or agent writes pipeline state; anything needing a running project's state to change
signals an event. But CLI-side writers sit outside the loop and none of them routes through
`processEvent`. The ones to account for when you change state shape or bump the schema:

- `cli/src/lib/amendment/apply.ts` — rewrites iteration arrays when an operator applies an amendment.
- `cli/src/lib/explode-master-plan.ts` — seeds iterations when a plan is exploded.
- `cli/src/commands/migrate/` — rewrites the file when the schema is migrated.
- `cli/src/commands/source-control/init.ts` — imports `writeState` from `state-io.ts` and writes
  `pipeline.source_control` directly, deliberately without an event round-trip. This is the one that
  gets missed, and it writes exactly the sub-tree the v5→v6 migration reshapes.

### The engine writes one document that is not `state.json`

On `final_corrective_requested` it appends the operator's objection as a numbered finding to the
running final review report — the path `state.graph.nodes.final_review.doc_path` names, never a
synthesized one — through the `IOAdapter`. The report is composed before the mutation and committed
after post-walk validation, report first and state second, so a crash between the two leaves a
finding whose corrective was never born and re-signalling completes it. Adding a document the engine
writes, or reshaping that report, touches both the IO adapter and the out-of-band branch.

### Node ids are a cross-module contract with no type check

Node ids are declared in the tier templates and then consumed by name in code that never imports
this module — some of it outside this package entirely, some of it running in a browser. Renaming
one compiles clean, passes every engine test, and breaks the product. See the edge below before you
rename anything in a template's `nodes`.

## When a change here ripples

- **Changed the state shape, or bumped the schema version?** A bump is not one edit. It needs
  `CURRENT_SCHEMA_VERSION` in `migrations/version.ts`, a new step in `MIGRATION_LADDER`, the
  outgoing schema **archived under `schemas/legacy/`** (the ladder validates migration input against
  the archived copy and throws if it is absent), the `$schema` literal type in `types.ts`, the
  `migrate` command, and the `$schema` literal seeded into every behavioral test's world. Outside
  this package, `ui/lib/fs-reader.ts` throws `Unrecognized state schema` on a version it does not
  branch on, which takes the whole project list down rather than one project. Detail:
  [`cli/tests/behavioral/AGENTS.md`](../../../tests/behavioral/AGENTS.md),
  [`ui/AGENTS.md`](../../../../ui/AGENTS.md)

- **Renamed, added, or removed a node id?** Nothing type-checks across this boundary.
  `context-enrichment.ts` reaches for `phase_loop` by name here;
  `lib/work-graph/src/derive/project-state.ts` hardcodes the planning step ids plus `phase_loop` and
  `final_review` to decide what state a project is in; and `ui/components/dag-timeline/` maps gate
  node ids to gate events **in the browser** and parses the `<loop>.iterN.<node>` compound path
  format. A rename produces no build error and no failing engine test — every project renders the
  wrong state and the approve button stops appearing. Move the tier templates in
  `runtime-config/templates/`, `context-enrichment.ts`, `lib/work-graph/src/derive/project-state.ts`,
  and `ui/components/dag-timeline/` together. Detail:
  [`ui/AGENTS.md`](../../../../ui/AGENTS.md), [`runtime-config/AGENTS.md`](../../../../runtime-config/AGENTS.md)

- **Added or renamed an action or event, or changed the catalog's frontmatter shape?** The catalog
  files in `runtime-config/action-events/` are what this engine composes prompts from at runtime, so
  the change is half-real until they exist — and `cli/src/commands/action-events/` exposes the same
  composer to users through `compose`, `custom-slot.ts`'s recognized overlay filenames, and
  the dashboard's Preview. The parse-instruction prose in
  `harness-files/skills/rad-orchestration/references/pipeline-guide.md` tells the orchestrator how to
  read the result. Detail: [`runtime-config/AGENTS.md`](../../../../runtime-config/AGENTS.md),
  [`harness-files/AGENTS.md`](../../../../harness-files/AGENTS.md)

- **Changed `action-event-loader.ts` or `composer.ts`?** `ui/lib/action-events-fs.ts` is a
  hand-maintained transplant of both, so the dashboard's catalog routes can stay in-process. This
  module is canonical and changes first; nothing tests the pair against each other, and the only
  path that exercises both is a user clicking Preview. Port the change and update the transplant's
  header comment. Detail: [`ui/AGENTS.md`](../../../../ui/AGENTS.md)

- **Changed the gate-path envelope fields?** `ui/app/api/projects/[name]/gate/route.ts` shells out
  to the gate subcommands and reads `data.*` off the envelope. A reshaped field surfaces as an
  unexplained 500 in the browser rather than as a test failure. Detail:
  [`ui/AGENTS.md`](../../../../ui/AGENTS.md)

## Commands

Run from `cli/`:

```
npm run build
npm test
```

Unit tests for this module live at `cli/tests/lib/pipeline-engine/`. **Coverage of the observable
contract — the envelope, the resulting `state.json`, and the side-files an event writes — belongs in
the behavioral tier at `cli/tests/behavioral/pipeline/`**, which drives real events against the real
`extra-high` template and the real catalog. New actions and new event semantics warrant a suite
there. Read [`cli/tests/behavioral/AGENTS.md`](../../../tests/behavioral/AGENTS.md) first; the tier
has its own conventions.

## Further reading

- [`docs/internals/system-architecture.md`](../../../../docs/internals/system-architecture.md#the-agentengine-loop)
  — the agent–engine loop, and why amendments sit outside it
- [`cli/AGENTS.md`](../../../AGENTS.md) — the binary this module sits in, and the envelope contract
- [`runtime-config/AGENTS.md`](../../../../runtime-config/AGENTS.md) — the tier templates and the
  action/event catalog this engine reads at runtime
- [`cli/tests/behavioral/AGENTS.md`](../../../tests/behavioral/AGENTS.md) — the tier that covers this
  module's observable contract
- [`AGENTS.md`](../../../../AGENTS.md) — the repo map, and the invariants no single module owns
