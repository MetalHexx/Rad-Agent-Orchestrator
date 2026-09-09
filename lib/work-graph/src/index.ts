// AD-8: the public barrel is the facade-only surface. Consumers reach the
// work-graph exclusively through `WorkGraphService` and the public type
// vocabulary below. Internals (GraphIndex, WorkGraph, the remaining derive/*
// helpers, validate/reconcile, the store-format types, and the id helpers that
// stay internal — `slugify`, `groupId`) are NOT re-exported here, so no
// consumer can bypass the facade or touch the backing store. `isGroupId` is
// the one id helper that IS public: it is a read-only predicate, and consumers
// were re-deriving the `group:` prefix by hand instead of calling it — exposing
// it bypasses nothing. Tests that need an internal import it by its direct
// module path.
export { WorkGraphService } from './service.js';
export type { ServiceOpts } from './service.js';
export type {
  DeletionItemKind, DeletionDisposition, DeletionOutcome,
  DeletionItem, DeletionPlan, DeletionItemResult, DeletionReport, DeletionSkip,
} from './delete-project.js';
export { within } from './derive/locate.js';
export type { LocateResult, LocateKind } from './derive/locate.js';
export { deriveProjectState, combineProjectStates, PROJECT_STATES, PROJECT_STATE_LABELS } from './derive/project-state.js';
export type { ProjectState, DerivedProjectState } from './derive/project-state.js';
export { PROJECTION_SCHEMA, PROJECT_KINDS } from './types.js';
export type {
  NodeId, NodeKind, NodeStatus, Tier, Node, Group, ProjectDocs, ProjectKind, WorktreeRef,
  Project, EdgeType, Edge, GraphDTO,
  WorkGraphError, WorkGraphErrorCode, Result,
} from './types.js';
export { RANKING_EDGE_TYPES, isRankingEdgeType } from './edge-semantics.js';
export {
  isPortfolioRootDir, readPortfolioLifecycle, listPortfolios, resolvePortfolioAmong,
  portfolioRootDirName, portfolioBaseFromRootDir, portfolioRootDocPath,
  nodePortfolioFs, PORTFOLIO_LIFECYCLE_VALUES,
} from './derive/portfolio.js';
export type { PortfolioLifecycle, PortfolioFsReads, PortfolioRef } from './derive/portfolio.js';
export { isGroupId } from './ids.js';
