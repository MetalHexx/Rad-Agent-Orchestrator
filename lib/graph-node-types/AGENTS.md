# graph-node-types

The node-type vocabulary and type contracts for the steerable DAG, layered on
`@rad-orchestration/graph-engine`. The strict build, the vitest harness, the facade-only barrel,
and the lint gate were established here so every later task inherits them. `graph-engine` now
ships the full relational model and state store (see its `AGENTS.md`); this package ships the
frozen wire-contract fixtures, the built-in event-token normalization, and all nine `rad-orc:*`
built-ins — `phase`, `master_plan`, `plan_audit`, `explosion`, `approval`, `task`, `code_review`, `corrective`,
`pr` — under `src/rad-orc/`, plus the P05 test harness (`tests/harness/test-driver.ts`, a
driver implementing the engine's driver contract over faked capability ports) driving the
integration and property-style contract suites under `tests/`.

## Standing conventions

These two conventions are enforced from this package's first file and apply to every file added
here going forward:

- **Closed vocabularies are `as const` arrays or string-literal unions — never `enum`.** TypeScript
  `enum` produces a runtime object with reverse mappings and doesn't structurally narrow the way a
  literal union does; every fixed vocabulary in this package (node kinds, port types, etc.) is
  expressed as a `const` array (`as const`) or a string-literal union type instead.
- **Decision-traceability.** A non-obvious choice carries an inline comment naming the governing
  design decision in `STEERABLE-DAG-DESIGN`, e.g. `// D8: ...` or `// D22: ...` — matching that
  design doc's own `D<N>` decision numbering (its "Locked Decisions" section runs `D1`-`D23`).

## Seam rules

- **Consumed only through `src/index.ts` — with one named exception.** Never import another
  module's internals (e.g. a future `src/**/*.ts` file) from outside this package by path — only
  the barrel's named exports are the public surface. Tests inside this library may import
  internals by their direct module path. The one intentional carve-out is the disk-artifact shape
  this package ships alongside the barrel: `manifest.yml` plus the thin `src/entrypoints/*.ts`
  default-export shims, built to `dist/entrypoints/*.js`. `graph-service`'s on-disk node-type
  loader (`graph-service/src/node-types/scan.ts`) dynamic-`import()`s each entrypoint by its
  built file path rather than through the barrel, because the loader's contract (a
  `manifest.yml`-named entrypoint resolving to a default-exported `NodeTypeDefinition`) is the
  same shape every `custom/`-origin package must also satisfy — the loader cannot special-case
  built-ins by routing them through `src/index.ts` instead. This is the only sanctioned path-based
  external consumer; anything else reaching past the barrel by path remains forbidden.
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
