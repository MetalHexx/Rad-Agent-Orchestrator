# `lib/terminal-launch/`

Platform-neutral terminal spawning: the per-harness argument shapes, the quoting, and the env
sanitization, shared by the CLI (`worktree launch`) and the dashboard (the start-action and
session-resume routes) without either depending on the other.

## How it works

- `src/index.ts` — the barrel. **The barrel is the list of what is public**; read the file rather
  than a table here. Anything not exported there is internal, whatever its path suggests.
- `src/launch.ts` — the agent/permission vocabularies, the option and result shapes, the per-agent
  arg builders, the per-platform spawn attempts, and `launchTerminal` itself.
- `src/env.ts` — `sanitizeLaunchEnv` and the per-agent marker table.
- `src/quote.ts` — `quoteSingle` (POSIX) and `quoteSinglePwsh` (PowerShell) literal escaping.
- `tests/` — vitest.

## Conventions

- **Consumed only through `src/index.ts`** — never reach into `src/launch.ts`, `src/env.ts`, or
  `src/quote.ts` directly from another module. Tests inside this library may.
- **By package name only.** Import `@rad-orchestration/terminal-launch`; a deep relative import into
  `lib/terminal-launch/src/` from another module is prohibited.
- **No workspace dependencies — this is the bottom of the stack.** `dependencies` is empty; this
  package imports no other `@rad-orchestration/*` package and no npm runtime package, so nothing
  above it can create a cycle by depending on it.
- **Everything is path/fs-injected.** `spawn`, `cwdExists`, `env`, and `platform` are all optional
  inputs with real defaults (`node:child_process` spawn, `fs.existsSync`, `process.env`,
  `process.platform`) — callers can substitute all of them for deterministic tests without touching
  a real terminal, process env, or the real host platform.
- **`LAUNCH_AGENTS` is the closed agent set:** `claude`, `copilot`, `vscode`, `terminal`. Only
  `claude` and `copilot` take a prompt; only `claude` takes a permission mode or a `--model` flag.
- **`VALID_PERMISSION_MODES` is an `as const` tuple, not a `readonly string[]`** — `PermissionMode`
  is derived from it as `typeof VALID_PERMISSION_MODES[number]`, so adding a value widens the type
  and every exhaustive consumer sees it. The values: `default`, `acceptEdits`, `bypassPermissions`,
  `auto`, `dontAsk`, `plan`.
- **The default permission mode is `auto`** — the permissive one — and it is spelled out separately
  in `src/launch.ts`, in `cli/src/commands/worktree/launch.ts`'s `validateLaunchFlags`, and in
  `ui/app/api/projects/[name]/start-action/route.ts`. Nothing links them; change one and change
  all of them.

## Hazards

### `TerminalLaunchResult` is not a discriminated union, and `ok: true` is weaker than it looks

`ok` is a plain `boolean` and `error` is optional **even on failure**, so a caller cannot narrow on
`result.ok` the way it can on `work-graph`'s `Result<T>`. Worse, `ok: true` means only *a spawn
attempt was fired*, not *the agent started*:

- `launchTerminal` returns synchronously as soon as the first spawn attempt is fired. A missing
  terminal binary surfaces asynchronously as an `error` event, which the fallback chain swallows —
  the winning attempt is never reported back.
- An agent that reaches none of the arg-building branches gets an empty arg list and opens a **bare
  terminal**, still reporting `ok: true`. `resumeSessionId` with agent `vscode` or `terminal` is
  exactly that case.

Validate the agent value at the point of use rather than trusting the type. The dashboard's
session-resume route does: `VALID_HARNESSES` in
`ui/app/api/projects/[name]/sessions/[sessionId]/launch/route.ts` is a defensive allowlist added for
this reason, with the reasoning in its header comment.

### The asymmetric resume form

The resume argument shapes are asymmetric and must stay byte-identical: claude is a **two-token**
`['claude', '--resume', id]`, copilot is a **single-token** `['copilot', '--resume=' + id]`. The `=`
form is not stylistic — a value beginning with a dash would otherwise be read as a flag by copilot's
own arg parser. Never "normalise" these to one form.

`addDir` and `model` are caller-supplied inputs, not constants: when absent, the corresponding flag
is omitted entirely rather than emitted empty. Copilot never receives a `--model` flag regardless of
whether `model` is supplied.

### Nothing here may write to stdout

Anything this package prints on stdout corrupts the `radorch` envelope, and there is no ESLint
config here at all to catch it — send diagnostics to stderr. Detail:
[`AGENTS.md`](../../AGENTS.md#stdout-is-the-envelope-channel)

## Open item: Copilot env markers

`sanitizeLaunchEnv`'s per-agent marker table strips claude's `CLAUDECODE` / `CLAUDE_CODE_*` markers
but is deliberately empty for `copilot`. Copilot sets `COPILOT_SUPERVISED` and `COPILOT_LOADER_PID`
on its own process tree and strips exactly those two when launching a user's `!` shell escape — but
whether they reach a session spawned from *inside* a live Copilot session is unverified, and
settling it requires running a command inside one. Do not add copilot markers on a guess; verify
against a live session first.

## When a change here ripples

- **Added, removed, or renamed a `LaunchAgent` or a permission mode?** `cli/src/commands/worktree/launch.ts`
  re-exports both constants and derives its `--agent` / `--permission-mode` rejection messages from
  them, but its **help text transcribes the values by hand** — the noun description and the
  `permission-mode` arg description both spell out the list and the `auto` default as literal
  strings. Adding a value leaves the help text quietly lying: `cli/tests/bin/help.test.ts` pins that
  prose with a regex rather than deriving it from the constants, so it fails on a reword and passes
  on a missing value. Update the literals in the same change. Detail:
  [`cli/AGENTS.md`](../../cli/AGENTS.md)

- **Changed `TerminalLaunchOptions`, `TerminalLaunchResult`, or the launch failure behaviour?** Both
  callers import this package **by name** and resolve against the compiled `dist/`, so a source
  change is invisible until `npm run build` runs here. The dashboard's routes translate the result
  into HTTP and they do not agree on the optional `error`: the start-action route falls back to a
  literal `'Launcher failed.'`, while the session-resume route passes `result.error` straight
  through, so a failure carrying no message becomes a 500 with an empty JSON body.
  In `ui/`, a route that value-imports this package also needs its `outputFileTracingIncludes` entry
  in `ui/next.config.mjs`, or it works in dev and 500s in the shipped standalone build. Detail:
  [`ui/AGENTS.md`](../../ui/AGENTS.md)

- **Changed the resume arg shapes, or how a session id reaches them?** Session tracking spans this
  library, the CLI's `session` commands, and the dashboard's resume route; the id comes from
  `.project-sessions.json` and is passed through unvalidated by this library. Walk the feature
  before changing the form. Detail:
  [`docs/internals/session-tracking.md`](../../docs/internals/session-tracking.md)

## Commands

```
npm run build
npm test
```

`build` runs `tsc` and emits the ESM `dist/` tree plus declarations; the `package.json` `exports`
map resolves `@rad-orchestration/terminal-launch` to it. **Consumers read `dist/`, never source.**
The standard installer build runs this for you as its `build-lib-dist` step, before it bundles the
CLI or the UI:

```
node harness-installers/standard/build-scripts/build.js
```

## Further reading

- [`docs/internals/session-tracking.md`](../../docs/internals/session-tracking.md) — the resume path
  this launcher sits at the end of
- [`docs/internals/dashboard.md`](../../docs/internals/dashboard.md) — the routes that spawn
  through this library, and the same-origin posture they were given
- [`AGENTS.md`](../../AGENTS.md) — the repo map, and why nothing here may write to stdout
