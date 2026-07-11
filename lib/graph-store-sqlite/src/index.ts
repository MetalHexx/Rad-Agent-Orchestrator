// Facade-only seam: `@rad-orchestration/graph-store-sqlite` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path.
export { openDatabase } from './db.js';
export { SqliteStateStore } from './sqlite-state-store.js';
export type { ChangeLogListener, ChangeLogRow } from './sqlite-state-store.js';
export { SqlitePortfolioStore } from './portfolio-store.js';
export type { PortfolioChangeListener, PortfolioChangeLogRow } from './portfolio-store.js';
export type {
  AutoPolicy,
  DocAttachInput,
  DocOwner,
  DocRecord,
  DocType,
  DocUpdateInput,
  EdgeType,
  ExternalRefRecord,
  ExternalRefUpsertInput,
  GroupChildren,
  GroupCreateInput,
  GroupRecord,
  GroupUpdateInput,
  LinkProjectToRefInput,
  PortfolioStore,
  ProjectCreateInput,
  ProjectEdgeRecord,
  ProjectExternalRefRecord,
  ProjectRecord,
  ProjectStatus,
  ProjectUpdateInput,
  RefRelation,
  WorktreeInput,
  WorktreeRecord,
} from './portfolio-types.js';
