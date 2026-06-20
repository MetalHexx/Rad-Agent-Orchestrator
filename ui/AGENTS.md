# `ui/` — Contributing Guide

## Purpose

This folder is the **radorch dashboard** — a Next.js 14 (App Router) standalone-build Node app that ships inside the installer payload as `~/.radorc/ui/`. The dashboard lets users browse projects, drive gates, inspect pipeline state, and (since ACTION-EVENT-DATA-2) edit per-slot custom instruction overlays for actions and events with a live byte-for-byte Preview against the orchestrator's compose function.

The dashboard server is launched by `radorch ui start` (a CLI subcommand at `cli/src/commands/ui/start.ts`). That command stamps its own binary location into the env var `RADORCH_CLI_PATH` so the UI's server-side routes can shell out to the same CLI that spawned them.

The UI is built ONCE during the standard-installer build (`emit-ui-bundle` in `harness-installers/shared/build-helpers/`) and shipped to the top-level `output/ui/` (shared across all three harnesses per AD-9 — never duplicated under `output/<harness>/`).

## How it works

Layered structure:

- **`app/`** — Next.js App Router routes. Two flavors:
  - **Pages** (`page.tsx`, `layout.tsx`) — React server + client components rendered by Next.
  - **API routes** (`app/api/<resource>/route.ts`) — server-side `GET`/`POST`/`PUT`/`DELETE` handlers consumed by the page components via `fetch`. **All long-lived business logic lives behind these routes**, not in the pages.
- **`components/`** — reusable React components, grouped by feature folder. The `components/ui/` subfolder is shadcn-generated primitives (`button.tsx`, `tooltip.tsx`, etc.) — do not hand-edit those; regenerate via the shadcn CLI if a primitive needs updating.
- **`hooks/`** — custom React hooks (`useCatalog`, `useDirtyCards`, `useApproveGate`, etc.). One hook per file; tests live alongside as `<name>.test.ts(x)`.
- **`lib/`** — pure helpers (parsers, FS readers, the `cli-shell` execFile/spawn wrapper, type definitions). Server-only modules use `node:*` builtins and run inside route handlers; client-only modules avoid them.
- **`types/`** — shared TypeScript interfaces consumed across `app/`, `components/`, `hooks/`, and `lib/`. Pure type declarations only — no runtime code.

Tests use `node --test` with `tsx` as the TypeScript loader. The runner is configured in `package.json#scripts.test`:

```
node --test --import tsx "lib/**/*.test.ts" "lib/**/*.test.mjs" \
  "hooks/**/*.test.ts" "hooks/**/*.test.tsx" \
  "components/**/*.test.ts" "components/**/*.test.tsx" \
  "app/**/*.test.ts" "app/**/*.test.tsx" "tests/**/*.test.ts"
```

This runner resolves `.js` extensions to `.ts` files via bundler-style resolution. **Next's webpack does NOT** — see the cross-package import rule below.

## Feature: brainstorming live visual docs

Surfaces a project's brainstorming artifacts — `*-BRAINSTORMING.md`, `*-BRAINSTORM.html`, and `*-WIREFRAME-*.html` — as live previews on the launch screen, in the DAG view, and in a full-screen modal. How the pieces fit:

- **Model** — `lib/artifact-model.ts#deriveArtifacts` (pure) takes the file list and returns **project-root files only**, ordered **markdown first, then html, alphabetical by filename within each type** — a *stable* order that never depends on mtime, so live edits (which bump mtime) don't reorder rows on any surface or shift the modal's active item. `hooks/use-project-artifacts.ts` memoizes it (`useProjectArtifacts`) and exposes `deleteArtifact`.
- **Raw route** — `app/api/projects/[name]/raw/route.ts` serves a root HTML artifact as `text/html` under a strict CSP, with the usual `..` / within-projectDir guards. Opt-in `?chrome=` injects a `<style>` before `</head>`: `scroll` = thin dark app-matching scrollbars (the modal stage), `hide` = no scrollbars (thumbnails); no param = untouched raw bytes.
- **Preview iframes** — `components/artifacts/iframe-preview.tsx`: `IframePreview` (scaled, non-interactive thumbnail, requests `&chrome=hide`) and `StageIframe` (modal stage, `&chrome=scroll`, `computeFitScale` for scale-to-fit). Both set `sandbox="allow-same-origin"` (NOT `allow-scripts`) — **required** so the injected scrollbar CSS is honored (an opaque-origin `sandbox=""` iframe ignores scrollbar styling), while static artifacts still can't run JS or read app storage.
- **Surfaces** — launch tiles (`components/layout/launch-screen.tsx`, `components/artifacts/artifact-tile.tsx`), the DAG `BrainstormingSection` (`components/dag-timeline/brainstorming-section.tsx`), and `ArtifactViewerModal` (`components/artifacts/artifact-viewer-modal.tsx` — filmstrip nav + markdown/HTML). Clickable rows/tiles use **sibling** real `<button>`s for open vs. delete — never one interactive element nested inside another (HTML/ARIA validity).
- **Data flow** — the files API returns `{ files, mtimes }`; `app/projects/page.tsx` threads `fileList`/`fileMtimes` into the model and gates the timeline body on a `filesLoaded` flag so the brainstorming section and the DAG render together (no late pop-in / layout shift).
- **Delete** — `POST /api/projects/[name]/delete?path=` unlinks one artifact, server-side **allowlisted to root-level `.md`/`.html`** so it can't touch `state.json` / schemas; the confirm dialog surfaces failures instead of silently advancing.

## Coding standards

- **Server boundary: API routes only.** Browser-side code (`page.tsx`, components, hooks) must never reach for `node:fs`, `child_process`, or any other Node builtin. If you need data from the filesystem or another process, expose it through an `app/api/<thing>/route.ts` handler and fetch it from the client.
- **No cross-package source imports — shell out to the CLI instead.** See the dedicated rule below; this is non-negotiable.
- **Default `export const dynamic = 'force-dynamic'` on API routes that read mutable state.** Without it, Next caches the response and the dashboard ships stale data after a backend change.
- **HTTP contract stability.** When you refactor a route's internals, preserve the existing status codes and response body shape. Hooks and components consume those contracts; changing them silently breaks consumers that have no tests against the route.
- **Tests at the boundary.** Every API route gets a `route.test.ts` sibling. Every hook gets a `<name>.test.ts(x)` sibling. Components get tests only when they encode invariants worth pinning (FR-mapped behavior, structural-shape assertions via `readFileSync` source inspection are common for pair-view and similar feature components).
- **No `any` casts unless they're already there.** Next's `build-standalone` script (`next build`) runs ESLint AND the TypeScript typecheck across every `.ts(x)` file in the project — including test files. A stray `as any` introduced for test-fixture convenience will block the standard-installer build, not just the dev `npm test`.
- **`use client` is opt-in.** Default to server components; add `"use client"` only when the file uses `useState`, `useEffect`, `useRouter`, browser APIs, or other client-only surface.
- **Match the `gate/route.ts` pattern for env-var failure modes.** Any server-side path that needs `RADORCH_CLI_PATH` hard-fails with HTTP 500 and a body like `{ error: 'RADORCH_CLI_PATH not set.', detail: '...start via radorch ui start...' }` when the env var is unset. The shared helper `ui/lib/cli-shell.ts#runCli` returns this as a failure envelope rather than throwing — wrap it in your route's 500 response.

## 🚫 Hard rule: no direct code dependencies on `cli/`

**The UI must NOT import TypeScript source from `cli/src/`** — not via relative path (`../../cli/src/...`), not via re-export, not via a third "shared" package that hides the same edge.

### Why this rule exists

- The standard-installer build runs `next build` to produce a standalone bundle. Next's webpack resolver does NOT map `.js → .ts` for imports that point outside the `ui/` project root, so any `from '../../cli/src/.../something.js'` line breaks the build with `Module not found: Can't resolve '...'`.
- The local `npm test` runner (`node --test --import tsx`) DOES resolve `.js → .ts` cross-package because `tsx` uses bundler-style resolution. This is a footgun: tests pass green while the production build silently breaks.
- Reaching into CLI source also bypasses the JSON envelope contract that every other consumer of the CLI relies on, weakening the integration surface.

### Compiled workspace-package exception

**The UI MAY import `@rad-orchestration/repo-registry` and `@rad-orchestration/telemetry` by their package names** in server-side API routes (`app/api/**/*.ts`). This is a sanctioned exception because:

- The workspace symlink resolves against the library's compiled `dist/` (ESM `.js` + `.d.ts`), not raw TypeScript source — Next's webpack resolver handles it correctly.
- The root `npm install` establishes the workspace symlink before any build step; no deep relative path is needed.
- Browser-side code (pages, components, hooks) must still never import from these packages; all `@rad-orchestration/repo-registry` and `@rad-orchestration/telemetry` imports must remain in server-side API routes only.

The general ban on importing another package's `.ts` source remains absolute. Only compiled output consumed through the by-name workspace symlink qualifies for this carve-out.

## Architectural rule: shell out vs in-process

When the UI needs functionality that the CLI also implements, draw the line at **what's being touched**, not at "is it in the CLI."

**Shell out to the CLI when the operation mutates pipeline state or needs the pipeline runtime.** The canonical example is `ui/app/api/projects/[name]/gate/route.ts` — it invokes `processEvent`, which writes `state.json` and runs an actual orchestration step. The compose route (`ui/app/api/action-events/compose/route.ts`) is the secondary example — preview must be byte-for-byte identical to what the orchestrator would emit, AND it's user-clicked / low-frequency (~1 spawn per Preview click), so paying for a subprocess is honest.

**Stay in-process for pure reads/writes against user-owned files in `~/.radorc/`.** The dashboard's catalog, shipped, and custom routes all touch `~/.radorc/action-events/` — a directory the UI server has direct `fs` access to. Spawning a Node subprocess that loads the ~10 MB `radorch.mjs` bundle just to do an `fs.readFileSync` is wasteful: cold-start on Windows is ~150-300 ms × N for N slot cards on a single page. Use `fs` directly.

**Cross-package source imports stay forbidden.** When the UI needs an algorithm that the CLI also implements (e.g., parsing action/event frontmatter, deriving a signal line), transplant a verbatim copy into `ui/lib/` with a header comment naming the canonical CLI source. The current example is `ui/lib/action-events-fs.ts` — it mirrors `cli/src/lib/pipeline-engine/action-event-loader.ts` and the `deriveSignalLine` export from `composer.ts`. Drift risk is bounded because the compose route (still shelled out) exercises the same frontmatter shapes end-to-end — any parser divergence would surface as a Preview output mismatch.

### The shell-out pattern (when it applies)

When you DO shell out, use `ui/lib/cli-shell.ts#runCli<T>`. It spawns the CLI as a subprocess via `child_process.execFile` (or `spawn` if you need to pipe stdin), addresses the binary through `process.env.RADORCH_CLI_PATH`, and parses the standard envelope `{ ok, data, error }` from stdout.

```ts
import { runCli } from '@/lib/cli-shell';

const result = await runCli<{ prompt: string }>({
  args: ['action-events', 'compose', '--kind', kind, '--name', name],
  stdin: JSON.stringify({ overlay }),
});
if (!result.envelope.ok) {
  return NextResponse.json({ error: result.envelope.error.message }, { status: 500 });
}
return NextResponse.json({ prompt: result.envelope.data.prompt }, { status: 200 });
```

`runCli` always pipes stdin (even an empty payload) so the CLI subprocess cannot hang waiting on a non-TTY parent. It returns a failure envelope for every failure mode (env var missing, spawn error, unparseable stdout, CLI exit non-zero) — routes branch on `envelope.ok` and never need a try/catch.

### Adding a new feature — picking the side

1. **Does the operation mutate `~/.radorc/projects/<name>/state.json` OR invoke the pipeline engine's state machine?** → Shell out. Add a CLI subcommand (see `cli/AGENTS.md#Adding a new subcommand`), wrap with `runCli` in your route.
2. **Does the UI need byte-for-byte parity with output the orchestrator would compose?** → Shell out (compose is the example).
3. **Otherwise — does it just read or write files in `~/.radorc/`?** → In-process. Add a helper to `ui/lib/` or use `fs` directly in the route.

The vast majority of new dashboard features are case (3). When in doubt, choose in-process — you can always escalate to shell-out later if a parity or state-mutation requirement emerges.

## Feature: Observability toggle

The dashboard's configuration editor includes an **Observability** section that controls whether the telemetry library captures usage events for harness sessions.

### How the field is registered

`ui/lib/config-field-meta.ts` is the single source of truth for every editable config field. The telemetry entry is:

```
{
  key: 'telemetry.enabled',
  label: 'Observability',
  tooltip: 'Capture neutral, non-attributed usage telemetry for harness sessions. Off by default; turning it on is opt-in.',
  section: 'telemetry',
  controlType: 'switch',
}
```

- **`key`** — the dot-path that `config-form.tsx` reads/writes against the live `OrchestrationConfig` object via `getNestedValue` / `onChange`.
- **`section: 'telemetry'`** — `config-form.tsx` renders this inside an accordion section titled **Observability** (mapped in `SECTION_TITLES`).
- **`controlType: 'switch'`** — renders a shadcn `Switch` component. The switch's `checked` state is `!!value`; toggling calls `onChange('telemetry.enabled', checked)`.

### Validation

`ui/lib/config-validator.ts` validates `telemetry.enabled` in the optional-section block:

```
// 10. telemetry (optional section)
if (config.telemetry !== undefined) {
  if (!isSection(config.telemetry) || typeof config.telemetry.enabled !== 'boolean') {
    errors['telemetry.enabled'] = 'Invalid telemetry enabled setting';
  }
}
```

The section is entirely optional — if `telemetry` is absent from `orchestration.yml` the validator produces no error. When the section is present, `telemetry.enabled` must be a boolean; any other type emits a field-level error keyed `'telemetry.enabled'` that the `ConfigFieldRow` for that field will surface.

### Session-start preamble indicator

When telemetry is enabled (`telemetry.enabled: true` in `orchestration.yml`), the CLI's `session-context` subcommand (`cli/src/commands/session-context/render.ts`) appends a `· observability \`on\`` segment to the **Config** row of the preamble block. This indicator is surfaced to the assistant on every session start via the `session-preamble.mjs` hook (`harness-installers/shared/hooks/session-preamble.mjs`). When telemetry is disabled or the `telemetry` section is absent, the indicator is omitted entirely.

## Seams to other modules

- **`cli/` (via shell-out for state-mutating ops only; in-process duplicates for parsers/types)** — Routes that mutate pipeline state or need parity with orchestrator output invoke `radorch <noun> <subcommand>` via `RADORCH_CLI_PATH` + `runCli`. The CLI emits the JSON envelope `{ ok, data, error }` on stdout; the UI parses it and maps to HTTP. Pure parsers / type shapes (e.g., `parseActionEventFile`, `CatalogEntry`) are transplanted as verbatim copies into `ui/lib/` (canonical implementation stays in CLI). Never import from `cli/src/`.
- **`~/.radorc/` (user data)** — The UI reads project state from `~/.radorc/projects/<name>/state.json` via `ui/lib/fs-reader.ts`. The same `os.homedir()` indirection used elsewhere is the only sanctioned path-resolution mechanism (AD-10) — tests stub `os.homedir()` to redirect (see `ui/lib/test-helpers.ts#withHomedir`).
- **`harness-installers/standard/build-scripts/build.js`** — invokes `emit-ui-bundle` which runs `next build` inside `ui/`, producing the standalone bundle that's packaged into `harness-installers/standard/output/ui/`. Any change that breaks `next build` (cross-package imports, type errors, lint errors) breaks the installer.
- **`radorch ui start`** (CLI subcommand at `cli/src/commands/ui/start.ts`) — launches the UI dev/prod server and sets `RADORCH_CLI_PATH` to its own binary path so the spawned UI process can shell back out to the CLI.

## Common commands

Run from the `ui/` directory:

```
npm run dev               # Next dev server (live reload) on http://localhost:3000
npm run dev:live          # same live reload, but auto-wires RADORCH_CLI_PATH (gate/compose routes work)
npm test                  # node --test across lib/ hooks/ components/ app/
npm run build             # next build (production; same as build-standalone but no clean step)
npm run build-standalone  # the build the installer uses; runs the prebuild clean step + next build
```

### `dev:live` vs `dev` — developing against a live UI

Both give Fast Refresh / hot reload, and replace the heavy build → pack → reinstall → `radorch ui start` loop for UI work. The difference is `RADORCH_CLI_PATH`:

- **`npm run dev`** runs `next dev` with nothing else wired. Read-only surfaces (project browsing, docs, the DAG, observability) work, but any route that shells out to the CLI — **driving gates** and the **action-event compose Preview** — returns HTTP 500 because `RADORCH_CLI_PATH` is unset (`lib/cli-shell.ts`).
- **`npm run dev:live`** (`scripts/dev-live.mjs`) runs the same `next dev` but auto-points `RADORCH_CLI_PATH` at the locally built CLI (`cli/dist/bin/radorch.js`) — the same env var the production launcher (`radorch ui start`) sets — so the shell-out routes work in dev too. It needs the CLI built first (`cd cli && npm run build`, or `npm run watch` for continuous rebuilds); if the bundle is missing it prints a warning and continues, and the read-only surfaces still work.

Run from the repo root to verify the full installer build picks up your UI changes:

```
node harness-installers/standard/build-scripts/build.js
```

If `emit-ui-bundle` fails, the installer cannot ship. Treat that as a P0.

## Further reading

- `cli/AGENTS.md` — the CLI binary the UI shells out to; documents the subcommand structure, JSON envelope shape, and three-level help convention.
- `harness-installers/standard/AGENTS.md` — the installer that bundles this UI; explains how `emit-ui-bundle` packages the standalone Next build.
- `AGENTS.md` (repo root) — repo-wide rules: per-module ownership, no cross-module reach-ins, canonical source vs runtime compiled outputs.
