# graph-engine

The steerable DAG execution engine. The strict build, the vitest harness, the facade-only
barrel, and the lint gate were established here so every later task inherits them, and the
package now ships the engine's relational spine: the node envelope (`DagNode`), the typed
dependency edge (`DagEdge`), the closed vocabularies, the `ChangeDelta` shape, and the
scope-aware `StateStore` interface with its `InMemoryStateStore` implementation.

## Standing conventions

These two conventions are enforced from this package's first file and apply to every file added
here going forward:

- **Closed vocabularies are `as const` arrays or string-literal unions — never `enum`.** TypeScript
  `enum` produces a runtime object with reverse mappings and doesn't structurally narrow the way a
  literal union does; every fixed vocabulary in this package (node kinds, edge types, statuses,
  etc.) is expressed as a `const` array (`as const`) or a string-literal union type instead.
- **Decision-traceability.** A non-obvious choice carries an inline comment naming the governing
  design decision in `STEERABLE-DAG-DESIGN`, e.g. `// D8: ...` or `// D22: ...` — matching that
  design doc's own `D<N>` decision numbering (its "Locked Decisions" section runs `D1`-`D23`).

## Seam rules

- **Consumed only through `src/index.ts`.** Never import another module's internals (e.g. a future
  `src/**/*.ts` file) from outside this package by path — only the barrel's named exports are the
  public surface. Tests inside this library may import internals by their direct module path.
- **Lint is a required gate, not optional.** `npm run lint` (ESLint flat config in
  `eslint.config.js`, modeled on `cli/eslint.config.js`) must pass clean; it enforces
  `consistent-type-imports` and the `^_`-ignore convention for intentionally-unused
  args/vars.

## Build and distribution

```
npm run build
```

Runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` plus `.d.ts` declarations for
every public export. The `package.json` `exports` map resolves `@rad-orchestration/graph-engine`
to `dist/index.js` (runtime) and `dist/index.d.ts` (types).

**Workspace consumption.** The root `package.json` declares this package as a workspace entry
(`lib/graph-engine`). After a root `npm install`, npm symlinks
`node_modules/@rad-orchestration/graph-engine` here. `@rad-orchestration/graph-node-types`
consumes this package by name and resolves against the compiled `dist/`; build this package
before building or typechecking a consumer.

## Running tests

```
npm test
```

Runs the vitest suite in `tests/`.
