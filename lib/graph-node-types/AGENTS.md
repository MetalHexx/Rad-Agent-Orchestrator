# graph-node-types

The node-type vocabulary and type contracts for the steerable DAG, layered on
`@rad-orchestration/graph-engine`. This package is currently a bare scaffold — the strict build,
the vitest harness, the facade-only barrel, and the lint gate are established here so every later
task inherits them; no node-type vocabulary ships yet.

## Standing conventions

These two conventions are enforced from this package's first file and apply to every file added
here going forward:

- **Closed vocabularies are `as const` arrays or string-literal unions — never `enum`.** TypeScript
  `enum` produces a runtime object with reverse mappings and doesn't structurally narrow the way a
  literal union does; every fixed vocabulary in this package (node kinds, port types, etc.) is
  expressed as a `const` array (`as const`) or a string-literal union type instead.
- **Decision-traceability.** A non-obvious choice carries an inline comment naming the governing
  design decision in `STEERABLE-DAG-DESIGN`, e.g. `// AD-3: ...` or `// FR-2: ...` — the same
  `AD-`/`FR-` comment convention `lib/telemetry` and `lib/work-graph` already use for their own
  design documents, applied here to this project's decisions.

## Seam rules

- **Consumed only through `src/index.ts`.** Never import another module's internals (e.g. a future
  `src/**/*.ts` file) from outside this package by path — only the barrel's named exports are the
  public surface. Tests inside this library may import internals by their direct module path.
- **Depends on `@rad-orchestration/graph-engine` by scoped name only**, pinned to the same
  monorepo-lockstep version. Never reach past the engine's own barrel into its internals.
- **Lint is a required gate, not optional.** `npm run lint` (ESLint flat config in
  `eslint.config.js`, modeled on `cli/eslint.config.js`) must pass clean; it enforces
  `consistent-type-imports` and the `^_`-ignore convention for intentionally-unused
  args/vars.

## Build and distribution

```
npm run build
```

Runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` plus `.d.ts` declarations for
every public export. The `package.json` `exports` map resolves `@rad-orchestration/graph-node-types`
to `dist/index.js` (runtime) and `dist/index.d.ts` (types).

**Workspace consumption.** The root `package.json` declares this package as a workspace entry
(`lib/graph-node-types`). After a root `npm install`, npm symlinks
`node_modules/@rad-orchestration/graph-node-types` here, and this package resolves
`@rad-orchestration/graph-engine` through its own workspace symlink. Build `graph-engine` before
building or typechecking this package.

## Running tests

```
npm test
```

Runs the vitest suite in `tests/`.
