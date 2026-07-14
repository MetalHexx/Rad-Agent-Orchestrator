// A thin disk-artifact entrypoint: `manifest.yml`'s `rad-orc:phase` entry names this built file,
// and the on-disk loader (`graph-service/src/node-types/scan.ts`) reads `mod.default`. The barrel
// (`src/index.ts`) keeps exporting `PHASE_NODE_TYPE` as a named export for in-process consumers —
// this file exists only so the same definition is also reachable as a default export once staged
// into a `builtin/` tree.
export { PHASE_NODE_TYPE as default } from '../rad-orc/phase.js';
