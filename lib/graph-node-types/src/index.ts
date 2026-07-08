// Facade-only seam: `@rad-orchestration/graph-node-types` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path. No node-type vocabulary ships
// yet; re-exporting the engine's scaffold marker proves this package resolves and typechecks
// against `@rad-orchestration/graph-engine` by name across the workspace symlink.
export { ENGINE_SCHEMA_VERSION } from '@rad-orchestration/graph-engine';

export type { EventTokenIncoherence } from './event-tokens.js';
export {
  EVENT_TOKENS,
  BUILT_IN_ROUTED_OUTCOMES,
  findEventTokenIncoherence,
  assertEventTokenCoherence,
} from './event-tokens.js';
