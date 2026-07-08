// Facade-only seam: `@rad-orchestration/graph-engine` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path. No engine logic ships yet;
// this scaffold-phase marker exists only to prove the workspace + build + typecheck wiring
// end-to-end, since `graph-node-types` depends on this package by name from its first commit.
export const ENGINE_SCHEMA_VERSION = 'graph-engine/v0' as const;
