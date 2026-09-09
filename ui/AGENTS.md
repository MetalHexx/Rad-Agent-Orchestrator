# `ui/`

The **radorch dashboard** — a Next.js App Router standalone-build Node app that ships inside the
installer payload as `~/.radorc/ui/`. It is a read-mostly view over `~/.radorc/`: it browses
projects, drives gates, inspects pipeline state, and edits config and custom-instruction overlays.

> **The how and why live in [`docs/internals/dashboard.md`](../docs/internals/dashboard.md)** — path
> resolution, the live-update pipeline, the two builds this module has to survive, and the reasoning
> behind the boundaries below. Read it before restructuring anything here, adding a route that
> crosses a seam, or making a change that spans modules. Not needed for a routine edit.

## How it works

- **`app/`** — App Router routes, two flavors. **Pages** (`page.tsx`, `layout.tsx`) render React;
  **API routes** (`app/api/<resource>/route.ts`) hold the server-side handlers. **All long-lived
  business logic lives behind the routes**, never in the pages.
- **`components/`** — React components grouped by feature folder. `components/ui/` is
  shadcn-generated primitives — **do not hand-edit those**; regenerate via the shadcn CLI.
- **`hooks/`** — one hook per file, tests alongside as `<name>.test.ts(x)`.
- **`lib/`** — pure helpers, FS readers, the `cli-shell` wrapper, type definitions. Server-only
  modules use `node:*` builtins and run inside route handlers; client-only modules avoid them.
- **`types/`** — shared interfaces. Pure type declarations, no runtime code.

## Conventions

- **Server boundary: API routes only.** Browser-side code — pages, components, hooks — must never
  reach for `node:fs`, `child_process`, or any other Node builtin. Expose it through an
  `app/api/<thing>/route.ts` handler and `fetch` it.
- **`export const dynamic = 'force-dynamic'` on any API route that reads mutable state.** Without
  it Next caches the response and the dashboard ships stale data after a backend change.
- **`use client` is opt-in.** Default to server components; add it only when the file uses
  `useState`, `useEffect`, `useRouter`, or another browser-only surface.
- **Preserve a route's status codes and response body shape when refactoring its internals.** Hooks
  and components consume those contracts and often have no test against the route itself.
- **Tests at the boundary.** Every API route gets a `route.test.ts` sibling; every hook a
  `<name>.test.ts(x)` sibling. Components get tests only when they encode an invariant worth
  pinning.
- **Every editable config field is registered in `ui/lib/config-field-meta.ts`** — the single source
  of truth for the config editor — with a matching entry in `ui/lib/config-validator.ts`. Adding a
  field anywhere else produces a control that renders and never validates.
- **Clickable rows and tiles use sibling `<button>`s** for open versus delete. Never nest one
  interactive element inside another.
- **Match `gate/route.ts` for env-var failure modes.** A server path needing `RADORCH_CLI_PATH`
  hard-fails with HTTP 500 and a body naming the variable and the fix.
  `ui/lib/cli-shell.ts#runCli` returns this as a failure envelope rather than throwing.

### Shell out, or stay in-process

Draw the line at **what is being touched**, not at "is it in the CLI."

1. **Mutates pipeline state, or needs the pipeline runtime?** → Shell out. `gate/route.ts` is the
   canonical example: it invokes `processEvent`, which writes `state.json` and runs an
   orchestration step.
2. **Needs byte-for-byte parity with orchestrator output?** → Shell out. The action-event compose
   route is the example — Preview must match what the engine would emit, and it is user-clicked, so
   a subprocess is honest.
3. **Otherwise, just reading or writing files under `~/.radorc/`?** → **In-process.** Use `fs`
   directly or add a `ui/lib/` helper.

Most new features are case 3. When in doubt choose in-process; escalating later is cheap.

When you do shell out, use `runCli<T>` from `ui/lib/cli-shell.ts`. It always pipes stdin so the
subprocess cannot hang on a non-TTY parent, and it returns a failure envelope for every failure
mode — routes branch on `envelope.ok` and never need a try/catch.

```ts
const result = await runCli<{ prompt: string }>({
  args: ['action-events', 'compose', '--kind', kind, '--name', name],
  stdin: JSON.stringify({ overlay }),
});
if (!result.envelope.ok) {
  return NextResponse.json({ error: result.envelope.error.message }, { status: 500 });
}
```

### Transplants

When the UI needs an algorithm the CLI also implements, **copy it into `ui/lib/` with a header
comment naming the canonical CLI source.** The CLI stays canonical; the copy is a consumer. Existing
transplants: `action-events-fs.ts`, `communication-styles-fs.ts`, `project-sessions-reader.ts`,
`fs-reader.ts`'s `communication_style` and `ambient_awareness` defaults, `registry/validate.ts#normalizeRemote`,
and `portfolio-show.ts`. Never import the original — see the hard rule below.

`normalizeRemote` is the one to be careful with. `action-events-fs.ts`,
`communication-styles-fs.ts`, `project-sessions-reader.ts`, and `portfolio-show.ts` are **read-only**
consumers of files or state the CLI owns, so drift shows up as a display mismatch. `normalizeRemote` is
a **writer**: both it and `cli/src/lib/repo-identity.ts` normalize remotes into the same shared registry,
so a divergence does not merely display wrong — it persists mixed canonical forms on disk, and the
registry has no reconciliation pass. `fs-reader.ts`'s defaults are read-side but reach disk too,
because the same module's `writeConfig` saves what a form-mode config edit sends back.

## Hazards

### Never import TypeScript source from `cli/src/`

Not by relative path, not by re-export, not through a third "shared" package hiding the same edge.

**This fails in the direction that hurts.** The local test runner (`node --test --import tsx`) uses
bundler-style resolution and maps `.js → .ts` across packages, so tests pass green. Next's webpack
resolver does **not** do this outside the `ui/` project root, so `next build` breaks with
`Module not found` — meaning the failure appears in the installer build, not in your test run.

**The compiled-workspace-package exception.** The UI **may** import
`@rad-orchestration/repo-registry`, `@rad-orchestration/telemetry`, `@rad-orchestration/work-graph`,
and `@rad-orchestration/terminal-launch` **by package name**, in `app/api/**` routes and in
server-only `lib/` modules. Those resolve to compiled `dist/`, which webpack handles correctly.
Browser-side code still never imports them. Type-only imports (`import type`) are exempt from the
location restriction — `isolatedModules` erases them, so they never reach a browser bundle.

The ban on importing another package's `.ts` source is otherwise absolute.

### A route segment is untrusted input

`[name]` and `[sessionId]` arrive from the network. **Validate the segment itself before it reaches
any path operation**, and validate it the same way in every route that accepts it.

`path.join` **collapses** `..` rather than rejecting it, so a containment check whose base is
derived from the same untrusted segment can never fail — `join(root, name).startsWith(join(root,
name))` is tautological and reads like a guard. Contain with `path.relative` instead: a result that
is non-empty, does not start with `..`, and is not itself absolute (a Windows drive-letter mismatch
yields an absolute "relative" path). `lib/work-graph/src/delete-project.ts:94` is the reference
implementation; `ui/lib/path-resolver.ts` has a private copy, `isStrictlyUnderHome`, wired only to
display formatting — **it is not exported, so do not reach for it.** Write the three-part check
inline.

**Known deviation:** the artifact routes do not follow this yet. `raw/route.ts:51`,
`document/route.ts:35`, and `delete/route.ts:36` each contain with `startsWith`. Match the
surrounding route when you edit one of those; use the idiom above for anything new.

Related: **the sessions launch route never reads its own request body.** Every value handed to
`launchTerminal` is looked up server-side from the project's own `.project-sessions.json` by the
validated id in the URL. It spawns a local process on request, so its input surface is deliberately
tiny. Keep it that way.

### Artifact iframes must not gain `allow-scripts`

Artifact previews set `sandbox="allow-same-origin"` and nothing else. Same-origin is required so the
injected scrollbar CSS is honored — an opaque-origin `sandbox=""` frame ignores it. **Adding
`allow-scripts` alongside `allow-same-origin` defeats the sandbox entirely**, letting arbitrary
project HTML run JS against the dashboard's own origin and storage. Artifacts are user-authored
files; treat them as untrusted documents.

The artifact delete route is allowlisted server-side to root-level `.md` and `.html` so it cannot
reach `state.json` or a schema. Widening that allowlist widens what a delete can destroy.

### An SSE event name is declared twice

`types/events.ts` carries both a TypeScript union and the runtime `EVENT_TYPES` array, because the
client registers one named listener per entry. **A name in the union but not the array is silently
dropped by the browser** — no type error, no runtime error, just an event that never arrives. A test
guards this; keep it passing rather than working around it.

### Project deletion needs the watchers released first

`remove/route.ts` suspends the projects watcher and the shared watcher before deleting and resumes
both in a `finally`. On Windows an open directory handle blocks the removal outright. This is also
why deletion stays in-process despite touching `state.json`: a subprocess cannot reach into its
parent's in-memory watcher state.

## When a change here ripples

- **Added a cross-package import, or changed anything `tsc` or ESLint sees?** Any of those fails
  `emit-ui-bundle`, and the standard installer cannot ship at all — the dashboard is bundled once
  and shared across every harness. Verify with
  `node harness-installers/standard/build-scripts/build.js` from the repo root, not just
  `npm test`. Detail: [`harness-installers/standard/AGENTS.md`](../harness-installers/standard/AGENTS.md)

- **Added a route that value-imports a workspace package?** Next's file tracer cannot see through an
  externalized package, so the route works in dev and **returns 500 in the shipped standalone
  build**. Add an `outputFileTracingIncludes` entry for it in `ui/next.config.mjs` pulling in that
  library's `dist/` and `package.json`. Detail:
  [`docs/internals/dashboard.md`](../docs/internals/dashboard.md)

- **Changed a transplanted parser in `ui/lib/`?** The canonical implementation is in `cli/`, and
  nothing tests the two against each other — they drift silently until output diverges. Apply the
  same change to the CLI source named in the file's header comment, or confirm it does not apply.
  Detail: [`cli/AGENTS.md`](../cli/AGENTS.md)

- **Changed the artifact filename matchers in `ui/lib/artifact-model.ts`?** Those names are a live
  contract with the skill that *writes* the files — `rad-visual-docs` emits `{PROJECT}-BRAINSTORM.html`
  and `{PROJECT}-WIREFRAME-{SLUG}.html` on the strength of these matchers. Break the pair and the
  artifact still lands on disk and still surfaces — it just falls through to the generic `Visual`
  branch and loses its dedicated slot, with nothing to signal the regression. Update the skill's
  naming conventions in the same change. Detail:
  [`harness-files/AGENTS.md`](../harness-files/AGENTS.md)

- **Added or changed a config field?** The field must exist in the shipped `orchestration.yml`
  that `runtime-config/` ships, or the editor writes a key nothing reads. The CLI validates the
  same file independently. Detail: [`runtime-config/AGENTS.md`](../runtime-config/AGENTS.md)

## Commands

Run from `ui/`:

```
npm run dev               # next dev, nothing else wired
npm run dev:live          # dev + RADORCH_CLI_PATH + rebuilds the @rad-orchestration/* lib dist
npm run dev:live:watch    # dev:live, plus rebuild a lib and restart on its src change
npm test                  # node --test across lib/ hooks/ components/ app/ tests/ types/
npm run build             # next build
npm run build-standalone  # the build the installer runs (clean + next build)
```

Run from the repo root to confirm the installer picks your changes up:

```
node harness-installers/standard/build-scripts/build.js
```

**`npm test` runs in no CI workflow.** CI runs `next build` and one smoke route only, so several
guards live exclusively in the local suite — run it for every change here.

## Further reading

- [`docs/internals/dashboard.md`](../docs/internals/dashboard.md) — this module's architecture: path
  resolution, the live-update pipeline, the standalone-build traps
- [`cli/AGENTS.md`](../cli/AGENTS.md) — the binary this module shells out to, and the envelope shape
- [`harness-installers/standard/AGENTS.md`](../harness-installers/standard/AGENTS.md) — how
  `emit-ui-bundle` packages the standalone build
- [`AGENTS.md`](../AGENTS.md) — the repo map, and the invariants no single module owns
