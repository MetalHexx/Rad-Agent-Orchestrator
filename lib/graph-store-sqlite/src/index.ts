// Facade-only seam: `@rad-orchestration/graph-store-sqlite` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path.
export { openDatabase } from './db.js';
export { SqliteStateStore } from './sqlite-state-store.js';
export { SqlitePortfolioStore } from './portfolio-store.js';
export type {
  AutoPolicy,
  PortfolioStore,
  ProjectCreateInput,
  ProjectRecord,
  ProjectStatus,
  ProjectUpdateInput,
  WorktreeInput,
  WorktreeRecord,
} from './portfolio-types.js';
