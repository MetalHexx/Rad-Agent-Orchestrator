# `cli/src/lib/pipeline-engine/` — Contributing Guide

## What the pipeline does

Drives the orchestrator's event loop. Every pipeline event signaled by the orchestrator
flows through `processEvent` in `engine.ts`, which loads state, applies the event's
mutation, validates the result, persists `state.json`, and resolves the next action via
the DAG walker. This library is the sole writer of `state.json` — no skill, agent, or
CLI command writes pipeline state directly.

`cli/src/commands/pipeline/signal.ts` is the primary consumer; the gate commands
(`cli/src/commands/gate/shared.ts`) also drive `processEvent` for `gate approve-plan`
and `gate approve-final`. Both surfaces project the result into the canonical envelope
`{ ok, data: { action, context }, error }` that every downstream consumer reads.

## What a change here impacts

A change inside this folder can ripple to several surfaces. Verify each before merging:

- **Markdown surfaces.** The action routing table in
  `harness-files/skills/rad-orchestration/references/action-event-reference.md` and the
  parse-instruction prose in
  `harness-files/skills/rad-orchestration/references/pipeline-guide.md` both
  describe the envelope shape and the action-to-event routing this engine emits. A new
  action, a renamed context field, or a new event reshapes those prose surfaces too.
- **UI dashboard.** `ui/app/api/projects/[name]/gate/route.ts` (and its test) parses
  the envelope from the gate subcommands. Any change to the gate-path envelope fields
  flows through this route's `data.*` reads.
- **Schema artifact.** `cli/src/lib/pipeline-engine/schemas/orchestration-state-v5.schema.json`
  is the JSON Schema the validator runs every write against. Any state-shape change
  requires a matching schema update or the validator rejects the write.
- **Behavioral and unit tests.** `cli/tests/lib/pipeline-engine/` carries unit tests,
  `cli/tests/commands/pipeline/` carries CLI behavioral tests against the envelope
  contract. New actions or event semantics warrant new behavioral coverage.

## Coding standards specific to engine modifications

All event and status string literals come from the frozen enum objects in `constants.ts` —
never hardcode string values inline. Adding a new node status or event means adding it to
the corresponding `Object.freeze(...)` export and updating the matching
`ALLOWED_*_TRANSITIONS` map. The map is the enforcement surface for the validator; an
omitted transition causes writes to fail validation.

Mutations in `mutations.ts` receive a deep clone of the current state and return a new
state object in `MutationResult.state`. Mutations must not touch the live state reference
passed in. The `mutations_applied` field on `MutationResult` is an internal observability
field — it is never surfaced on the envelope returned to callers.

On `code_review_completed` or `phase_review_completed` with `verdict: changes_requested`,
the current node pointer advances only after the corrective cycle completes. The mutation
marks the corrective task as active and leaves the pointer on the review node until the
corrective's own completion event fires. Mutations branching on this deferral pattern
must consult the corrective-task entry in state, not assume the pointer has moved.

## Cross-reference

For the complete event-to-action routing table and signaling reference, see the
rad-orchestration skill's
[`references/action-event-reference.md`](~/.claude/skills/rad-orchestration/references/action-event-reference.md).
That document is the authoritative lookup during pipeline operation.
