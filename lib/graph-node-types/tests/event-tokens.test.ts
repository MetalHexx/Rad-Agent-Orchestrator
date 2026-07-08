import { describe, expect, it } from 'vitest';
import {
  EVENT_TOKENS,
  BUILT_IN_ROUTED_OUTCOMES,
  findEventTokenIncoherence,
  assertEventTokenCoherence,
  APPROVAL_DECIDED_TOKEN,
  CODE_REVIEW_REVIEWED_TOKEN,
  EXPLOSION_PARSED_TOKEN,
  EXPLOSION_PARSE_FAILED_TOKEN,
  MASTER_PLAN_AUTHORED_TOKEN,
  PR_CREATED_TOKEN,
  TASK_COMPLETED_TOKEN,
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

  it('folds the task/phase gate approvals onto one rad-orc:approval.decided token', () => {
    expect(BUILT_IN_ROUTED_OUTCOMES['rad-orc:approval']).toEqual(['decided']);
    expect(EVENT_TOKENS).toContain('rad-orc:approval.decided');
  });
});

describe('the map against the real built-ins', () => {
  // Each built-in's own `*_TOKEN` export is the ground truth its `handle` actually dispatches
  // on. Walking those real exports (rather than only cross-checking the two hand-authored
  // constants against each other) is what catches the map drifting from the shipped code.
  const realBuiltInTokens: readonly string[] = [
    TASK_COMPLETED_TOKEN,
    CODE_REVIEW_REVIEWED_TOKEN,
    APPROVAL_DECIDED_TOKEN,
    MASTER_PLAN_AUTHORED_TOKEN,
    EXPLOSION_PARSED_TOKEN,
    EXPLOSION_PARSE_FAILED_TOKEN,
    PR_CREATED_TOKEN,
  ];

  it('declares every built-in\'s real dispatch token in EVENT_TOKENS', () => {
    for (const token of realBuiltInTokens) {
      expect(EVENT_TOKENS).toContain(token);
    }
  });

  it('routes every built-in\'s real dispatch token through BUILT_IN_ROUTED_OUTCOMES', () => {
    for (const token of realBuiltInTokens) {
      const [type, outcome] = token.split('.') as [string, string];
      expect(BUILT_IN_ROUTED_OUTCOMES[type as keyof typeof BUILT_IN_ROUTED_OUTCOMES]).toContain(outcome);
    }
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
