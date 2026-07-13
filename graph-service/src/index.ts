// Facade-only seam: `@rad-orchestration/graph-service` is consumed exclusively through this
// barrel — nothing outside this package imports internals (`compose.ts`, `http/*.ts`,
// `capabilities/*.ts`, `driver/*.ts`) by path.
export type { ComposeOptions, GraphService } from './compose.js';
export { compose } from './compose.js';

export { buildApp } from './http/app.js';
export type { Envelope, FailureEnvelope, SuccessEnvelope } from './http/respond.js';
export { err, fromResult, ok } from './http/respond.js';

export type { CapabilityPorts } from './capabilities/ports.js';
export type { FakedCapabilityPorts } from './capabilities/fakes.js';
export {
  FakeDocReadPort,
  FakeDocWritePort,
  FakeGitFactsPort,
  FakeRequestHumanPort,
  FakeRunCommandPort,
  FakeSpawnAgentPort,
  createFakedCapabilityPorts,
} from './capabilities/fakes.js';

export type { DriverOutcome } from './driver/outcome.js';
export { applyOutcome } from './driver/outcome.js';
export { globalFrontier, isGloballyQuiescent } from './driver/frontier.js';
export type {
  AdvanceResult,
  NodeOutcomeResolver,
  QuiescenceNotSettled,
  QuiescenceResult,
  QuiescenceSettled,
  QuiescenceStoppedAtActor,
} from './driver/drive.js';
export { advance, runToQuiescence } from './driver/drive.js';
export { createBuiltInResolvers } from './driver/resolvers.js';

export type { ServiceDiscovery } from './lifecycle/discovery.js';
export {
  discoveryFilePath,
  readDiscoveryFile,
  removeDiscoveryFile,
  resolveRadorcRoot,
  writeDiscoveryFile,
} from './lifecycle/discovery.js';

export type { EnsureOptions, EnsureResult, StatusOptions, StatusResult } from './lifecycle/ensure.js';
export { ensure, status } from './lifecycle/ensure.js';

export type { StartOptions, StartResult, StopOptions, StopResult } from './lifecycle/daemon.js';
export { start, stop } from './lifecycle/daemon.js';
