import { describe, expect, it } from 'vitest';
import { ENGINE_SCHEMA_VERSION } from '../src/index.js';

describe('graph-node-types barrel', () => {
  it('is importable and re-exports the engine scaffold marker', () => {
    expect(ENGINE_SCHEMA_VERSION).toBe('graph-engine/v0');
  });
});
