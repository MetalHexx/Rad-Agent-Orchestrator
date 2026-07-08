// Facade-only seam: `@rad-orchestration/graph-store-sqlite` is consumed exclusively through this
// barrel — nothing outside this package imports internals by path.
export { openDatabase } from './db.js';

// The store class (the `StateStore` implementation over this schema) lands in P02.
