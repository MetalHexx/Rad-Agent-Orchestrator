import { describe, expect, it } from 'vitest';
import type { Result } from '@rad-orchestration/graph-engine';
import { err, fromResult, ok } from '../../src/http/respond.js';

describe('ok/err', () => {
  it('builds the success envelope', () => {
    expect(ok({ x: 1 })).toEqual({ ok: true, data: { x: 1 } });
  });

  it('builds the failure envelope', () => {
    expect(err('unknown_node_type', 'nope')).toEqual({
      ok: false,
      error: { code: 'unknown_node_type', message: 'nope' },
    });
  });
});

describe('fromResult', () => {
  it('maps a successful engine Result to the success envelope', () => {
    const result: Result<{ id: string }> = { ok: true, data: { id: 'n1' } };
    expect(fromResult(result)).toEqual({ ok: true, data: { id: 'n1' } });
  });

  it('maps a failing engine Result to a structured failure envelope, never a throw', () => {
    const result: Result<never> = {
      ok: false,
      error: { code: 'unknown_node_type', message: "node type 'bogus' is not registered" },
    };
    expect(fromResult(result)).toEqual({
      ok: false,
      error: { code: 'unknown_node_type', message: "node type 'bogus' is not registered" },
    });
  });
});
