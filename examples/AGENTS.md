# examples

Reference custom node-type packages for a team building their own `custom/`-origin node types
against `@rad-orchestration/graph-engine`. Today this holds one package, `examples/example`
(npm workspace `example`), covering both shapes a custom type can take: `example:greet`, a
zero-capability node whose `act` speaks inline, and `example:scribe`, a capability-bearing node
that requests `doc-write` and declares its own `resolve` + `completionToken` to re-derive its
outcome host-side rather than trust a relayed one.

## What a custom package is

A custom node-type package is a directory with:

- **`manifest.yml`** — a `namespace`, a `version`, and a `nodeTypes` list, each entry naming the
  node's fully-qualified `name` (e.g. `example:scribe`) and the built JS `entrypoint` the loader
  dynamic-`import()`s (e.g. `./dist/scribe.js`). The manifest is the loader's only source of truth
  for what a package ships — nothing is inferred from the package's file layout beyond it.
- **One default-exported `NodeTypeDefinition` per entrypoint** — the same contract every built-in
  satisfies (`name`, `dataSchema`, `traits`, `capabilities`, `presentation`, `instructions`, plus
  the `act`/`handle`/`projectStatus` hooks, and optionally `resolve` + `completionToken` for a node
  that needs a host-side outcome derivation rather than a client-relayed one). See
  `lib/graph-engine`'s `node-type/definition.ts` for the full shape.

## The TS authoring path

`examples/example` authors each entrypoint in TypeScript (`src/greet.ts`, `src/scribe.ts`) and
compiles with a plain `tsc` (`tsconfig.json`, `npm run build`) to the `dist/*.js` the manifest's
`entrypoint` fields name — the same gitignored-`dist/`-plus-`tsc`-script convention every
`lib/*` package follows. `@rad-orchestration/graph-engine` is a `devDependency` only: it supplies
the authoring-time types (`NodeTypeDefinition`, `ResolveContext`, `ResolveOutcome`, …), never a
runtime import the compiled JS carries forward. TypeScript is a convenience for authoring, not a
loader requirement — the loader only ever imports the built JS a manifest entry names, so a
package written directly in JS satisfies the same contract.

## How the loader discovers it

`graph-service/src/node-types/scan.ts`'s `discoverNodeTypes` scans `<nodeTypesRoot>/custom/<pkg>/
manifest.yml`, dynamic-`import()`s each declared entrypoint, and validates the default export
against the `NodeTypeDefinition` contract before handing it to the registry — a package with no
`manifest.yml` is skipped, not an error, and any per-package failure becomes a collected
`NodeTypeLoadError` rather than crashing discovery of the rest. A team copying this package as a
starting point places their own package directory under `~/.radorc/node-types/custom/`, ships a
`manifest.yml` alongside a built `dist/`, and the daemon's next discovery pass picks it up —
nothing in `graph-service` special-cases this package's name or path.

## Running tests

This package has no test suite of its own; it is exercised indirectly by `graph-service`'s own
tests (`tests/node-types/example-scribe.test.ts`, `tests/functional/acid-test.test.ts`,
`tests/templates/shipped-templates.test.ts`), which stage or import it directly off disk. Build it
first: `npm run build -w example`.
