import { describe, it, expect } from 'vitest';
import { runStateStoreConformance } from '@rad-orchestration/graph-engine/testing';
import { SqliteStateStore } from '../src/sqlite-state-store.js';
import { openDatabase } from '../src/db.js';

// The same store-agnostic behavioral suite that guards `InMemoryStateStore`
// (`lib/graph-engine/tests/in-memory-store.test.ts`), run unmodified against `SqliteStateStore`.
// `:memory:` is correct here — durability is exercised separately in `durability.test.ts`.
runStateStoreConformance(() => new SqliteStateStore(openDatabase(':memory:')), { describe, it, expect });
