import { describe, expect, it } from 'vitest';
import { ENGINE_SCHEMA_VERSION } from '../src/index.js';

describe('graph-engine barrel', () => {
  it('is importable and exposes the scaffold marker', () => {
    expect(ENGINE_SCHEMA_VERSION).toBe('graph-engine/v0');
  });
});
