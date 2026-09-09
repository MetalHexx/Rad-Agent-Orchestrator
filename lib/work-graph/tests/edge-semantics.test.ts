import { describe, it, expect } from 'vitest';
import { isRankingEdgeType, RANKING_EDGE_TYPES } from '../src/edge-semantics.js';

describe('edge semantics', () => {
  it('classifies ranking edge types as ranking', () => {
    expect(isRankingEdgeType('follows')).toBe(true);
    expect(isRankingEdgeType('depends-on')).toBe(true);
  });
  it('classifies spawned-from and contains as decoration', () => {
    expect(isRankingEdgeType('spawned-from')).toBe(false);
    expect(isRankingEdgeType('contains')).toBe(false);
  });
  it('fails safe to decoration for unrecognised edge types', () => {
    expect(isRankingEdgeType('corrective')).toBe(false);
    expect(isRankingEdgeType('some-invented-type')).toBe(false);
  });
  it('holds exactly the ranking edge types', () => {
    expect(RANKING_EDGE_TYPES).toEqual(new Set(['follows', 'depends-on']));
  });
});
