# Pipeline Subcommand

`radorch pipeline signal` is the single entry point for all deterministic pipeline
operations: routing, mutation, and validation. The same `state.json` always produces
the same next action — the engine encodes routing decisions as tested, deterministic
code so LLM agents never re-derive them from natural language.

> `radorch pipeline signal` is called by the main agent during pipeline
> execution. Users do not run it directly.

## CLI Interface

```
node "${PLUGIN_ROOT}/skills/rad-orchestration/scripts/radorch.mjs" pipeline signal \
  --event <event_name> \
  --project-dir <path> \
  [--config <path>] [--doc-path <path>] \
  [--branch <name>] [--base-branch <name>] [--worktree-path <path>] \
  [--auto-commit <always|never>] [--auto-pr <always|never>] \
  [--gate-type <type>] [--reason <text>] [--gate-mode <mode>] \
  [--commit-hash <hash>] [--pushed <true|false>] \
  [--verdict <verdict>] [--phase <N>] [--task <N>] \
  [--pr-url <url>] [--remote-url <url>] [--compare-url <url>] \
  [--template <name>] [--parse-error <json>]
```

All flags are documented in the CLI's three-level `--help`:
`radorch pipeline signal --help`.

## Envelope shape

Every call emits a single JSON envelope on stdout:

```json
{
  "ok": true,
  "data": { "action": "<next-action>", "context": { ... } }
}
```

On error:

```json
{
  "ok": false,
  "data": { "event": "<event-name>", "field": "<field-name-if-applicable>" },
  "error": { "type": "user_error", "message": "<message>" }
}
```

The main agent dispatches on `data.action`; the context payload is action-specific
and documented in the action routing table.

## Cross-reference

For the complete event-to-action routing table and signaling reference, see
the action/event catalog at
[`runtime-config/action-events/`](../../runtime-config/action-events/).
