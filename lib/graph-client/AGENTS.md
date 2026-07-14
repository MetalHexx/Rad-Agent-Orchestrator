# graph-client

An HTTP client for a running `graph-service` instance's `/engine-graph` surface: construct a
`GraphClient`, bind a project with `.project(id)`, then drive (`submitEvent`) and read
(`dag`, `frontier`, `node`) against the service, with failures arriving as one typed
`GraphClientError` channel.

## Standing conventions

- **Closed vocabularies are `as const` arrays or string-literal unions — never `enum`.** Every
  fixed vocabulary (`NodeStatus`, `Executor`, `GraphClientErrorCode`) is a `const` array
  (`as const`) with a derived union type, never a TypeScript `enum`.
- **Facade-only barrel.** `@rad-orchestration/graph-client` is consumed exclusively through
  `src/index.ts`. Nothing outside this package imports `src/*` by path.
- **`import type` under `verbatimModuleSyntax`.** Type-only imports/exports use `import type` /
  `export type` so they erase cleanly at compile time.
- **`.js` extensions on relative imports.** NodeNext module resolution requires the emitted
  extension on every relative specifier (`./client.js`, not `./client`).
- **No `any` at the boundary.** Unknown wire payloads are typed `unknown` and narrowed
  (see `transport.ts`'s envelope guard), never cast through `any`.
- **The client owns its wire mirror.** `src/types.ts` hand-duplicates the subset of the
  service's wire shapes this package consumes; `graph-client` takes no code edge to
  `@rad-orchestration/graph-service` or `@rad-orchestration/graph-engine` — the shared source of
  truth is the running service's behavior, enforced by tests, not a shared symbol.
- **Lint is a required gate, not optional.** `npm run lint` (ESLint flat config in
  `eslint.config.js`) must pass clean; it enforces `consistent-type-imports` and the `^_`-ignore
  convention for intentionally-unused args/vars.

## Build and distribution

```
npm run build
```

Runs `tsc` and emits a compiled ESM `dist/` tree — `dist/index.js` plus `.d.ts` declarations for
every public export. The `package.json` `exports` map resolves
`@rad-orchestration/graph-client` to `dist/index.js` (runtime) and `dist/index.d.ts` (types).

## Running tests

```
npm test
```

Runs the vitest suite in `tests/` — service-free unit tests against an injected `fetch` stub
(`GraphClientConfig.fetch`); no running `graph-service` is required.
