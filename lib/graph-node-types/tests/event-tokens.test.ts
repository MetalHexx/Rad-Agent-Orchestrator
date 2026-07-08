import { describe, expect, it } from 'vitest';
import {
  EVENT_TOKENS,
  BUILT_IN_ROUTED_OUTCOMES,
  findEventTokenIncoherence,
  assertEventTokenCoherence,
} from '../src/index.js';

describe('the shipped event-token map', () => {
  it('is internally coherent — no routed outcome lacks a token, no token lacks a routed outcome', () => {
    expect(() => assertEventTokenCoherence()).not.toThrow();
  });

  it('declares no duplicate tokens', () => {
    expect(new Set(EVENT_TOKENS).size).toBe(EVENT_TOKENS.length);
  });

  it('every token matches the `<type>:<name>.<outcome>` shape', () => {
    for (const token of EVENT_TOKENS) {
      expect(token).toMatch(/^[^:.]+:[^:.]+\.[^:.]+$/);
    }
  });

  it("folds the three per-level review completions onto one rad-orc:code_review.reviewed token", () => {
    expect(BUILT_IN_ROUTED_OUTCOMES['rad-orc:code_review']).toEqual(['reviewed']);
    expect(EVENT_TOKENS).toContain('rad-orc:code_review.reviewed');
  });

  it('folds the task/phase gate approvals onto one rad-orc:approval.approved token', () => {
    expect(BUILT_IN_ROUTED_OUTCOMES['rad-orc:approval']).toEqual(['approved']);
    expect(EVENT_TOKENS).toContain('rad-orc:approval.approved');
  });
});

describe('findEventTokenIncoherence', () => {
  it('reports no incoherence when the token list and the routed-outcomes map agree', () => {
    const result = findEventTokenIncoherence(['rad-orc:task.completed'], { 'rad-orc:task': ['completed'] });
    expect(result).toEqual({ missingTokens: [], orphanTokens: [] });
  });

  it('reports a missing token for a routed outcome with no declared token', () => {
    const result = findEventTokenIncoherence([], { 'rad-orc:task': ['completed'] });
    expect(result.missingTokens).toEqual(['rad-orc:task.completed']);
    expect(result.orphanTokens).toEqual([]);
  });

  it('reports an orphan token for a declared token no built-in routes on', () => {
    const result = findEventTokenIncoherence(['rad-orc:task.completed'], {});
    expect(result.missingTokens).toEqual([]);
    expect(result.orphanTokens).toEqual(['rad-orc:task.completed']);
  });

  it('assertEventTokenCoherence throws on a crafted incoherent pair', () => {
    expect(() =>
      assertEventTokenCoherence(['rad-orc:task.completed'], { 'rad-orc:task': ['completed', 'failed'] }),
    ).toThrow(/failed/);
  });
});
