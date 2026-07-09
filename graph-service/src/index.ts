// Facade-only seam: `@rad-orchestration/graph-service` is consumed exclusively through this
// barrel — nothing outside this package imports internals (`compose.ts`, `http/*.ts`) by path.
export type { ComposeOptions, GraphService } from './compose.js';
export { compose } from './compose.js';

export { buildApp } from './http/app.js';
export type { Envelope, FailureEnvelope, SuccessEnvelope } from './http/respond.js';
export { err, fromResult, ok } from './http/respond.js';
