import { describe, it, expect } from 'vitest';
import { InMemoryStateStore } from '../src/store/in-memory-store.js';
import { runStateStoreConformance } from '../src/testing/state-store-conformance.js';

runStateStoreConformance(() => new InMemoryStateStore(), { describe, it, expect });
