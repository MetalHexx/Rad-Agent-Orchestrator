import { describe, expect, it } from 'vitest';
import { resolveCoderAgent, resolveReviewerAgent } from '../../src/rad-orc/agent-tier.js';

describe('resolveCoderAgent', () => {
  describe('base tier (no corrective context)', () => {
    it('returns coder-junior for simple tasks', () => {
      const result = resolveCoderAgent({ complexity: 'simple' });
      expect(result).toBe('coder-junior');
    });

    it('returns coder for standard tasks', () => {
      const result = resolveCoderAgent({ complexity: 'standard' });
      expect(result).toBe('coder');
    });

    it('returns coder for complex tasks', () => {
      const result = resolveCoderAgent({ complexity: 'complex' });
      expect(result).toBe('coder');
    });
  });

  describe('no escalation without correctiveIndex', () => {
    it('ignores maxRetries when correctiveIndex is absent', () => {
      const result = resolveCoderAgent({
        complexity: 'simple',
        maxRetries: 2,
        correctiveIndex: undefined,
      });
      expect(result).toBe('coder-junior');
    });
  });

  describe('escalation table with maxRetries: 5 (default)', () => {
    const complexities = ['simple', 'standard', 'complex'] as const;

    for (const complexity of complexities) {
      describe(`${complexity} tasks`, () => {
        it('attempt 1 (remaining: 4) → base tier', () => {
          const result = resolveCoderAgent({
            complexity,
            correctiveIndex: 1,
            maxRetries: 5,
          });
          const base = complexity === 'simple' ? 'coder-junior' : 'coder';
          expect(result).toBe(base);
        });

        it('attempt 2 (remaining: 3) → base tier', () => {
          const result = resolveCoderAgent({
            complexity,
            correctiveIndex: 2,
            maxRetries: 5,
          });
          const base = complexity === 'simple' ? 'coder-junior' : 'coder';
          expect(result).toBe(base);
        });

        it('attempt 3 (remaining: 2) → one step up', () => {
          const result = resolveCoderAgent({
            complexity,
            correctiveIndex: 3,
            maxRetries: 5,
          });
          if (complexity === 'simple') {
            expect(result).toBe('coder');
          } else {
            // standard and complex stay at coder
            expect(result).toBe('coder');
          }
        });

        it('attempt 4 (remaining: 1) → coder-senior', () => {
          const result = resolveCoderAgent({
            complexity,
            correctiveIndex: 4,
            maxRetries: 5,
          });
          expect(result).toBe('coder-senior');
        });

        it('attempt 5 (remaining: 0) → coder-senior', () => {
          const result = resolveCoderAgent({
            complexity,
            correctiveIndex: 5,
            maxRetries: 5,
          });
          expect(result).toBe('coder-senior');
        });
      });
    }
  });

  describe('escalation with non-default maxRetries', () => {
    it('shifts boundaries correctly with maxRetries: 3', () => {
      // With maxRetries: 3:
      // - attempt 1 (remaining: 2) → one step up
      // - attempt 2+ (remaining: <= 1) → coder-senior
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 1, maxRetries: 3 })).toBe(
        'coder',
      );
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 2, maxRetries: 3 })).toBe(
        'coder-senior',
      );
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 3, maxRetries: 3 })).toBe(
        'coder-senior',
      );
    });

    it('handles maxRetries: 1 (immediate escalation)', () => {
      // With maxRetries: 1, attempt 1 has remaining: 0, so coder-senior immediately
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 1, maxRetries: 1 })).toBe(
        'coder-senior',
      );
    });

    it('handles maxRetries: 10 (longer buffer)', () => {
      // With maxRetries: 10:
      // - attempts 1-7 (remaining: 9-3, > 2) → base tier
      // - attempt 8 (remaining: 2) → one step up
      // - attempts 9-10 (remaining: <= 1) → coder-senior
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 7, maxRetries: 10 })).toBe(
        'coder-junior',
      );
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 8, maxRetries: 10 })).toBe(
        'coder',
      );
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 9, maxRetries: 10 })).toBe(
        'coder-senior',
      );
    });
  });

  describe('default maxRetries fallback', () => {
    it('falls back to default maxRetries: 5 when maxRetries is absent', () => {
      // This should behave the same as explicitly passing maxRetries: 5
      expect(resolveCoderAgent({ complexity: 'simple', correctiveIndex: 3 })).toBe(
        resolveCoderAgent({ complexity: 'simple', correctiveIndex: 3, maxRetries: 5 }),
      );
    });

    it('uses the provided maxRetries even if different from default', () => {
      const result = resolveCoderAgent({
        complexity: 'simple',
        correctiveIndex: 1,
        maxRetries: 2,
      });
      // With maxRetries: 2, attempt 1 has remaining: 1, so coder-senior
      expect(result).toBe('coder-senior');
    });
  });
});

describe('resolveReviewerAgent', () => {
  describe('task-level reviews (apply complexity tier)', () => {
    it('returns reviewer-junior for simple tasks', () => {
      const result = resolveReviewerAgent({
        level: 'task',
        complexity: 'simple',
      });
      expect(result).toBe('reviewer-junior');
    });

    it('returns reviewer for standard tasks', () => {
      const result = resolveReviewerAgent({
        level: 'task',
        complexity: 'standard',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer for complex tasks', () => {
      const result = resolveReviewerAgent({
        level: 'task',
        complexity: 'complex',
      });
      expect(result).toBe('reviewer');
    });

    it('defaults to standard (reviewer) when complexity is absent', () => {
      const result = resolveReviewerAgent({
        level: 'task',
      });
      expect(result).toBe('reviewer');
    });
  });

  describe('phase-level reviews (always reviewer, regardless of complexity)', () => {
    it('returns reviewer for simple tasks', () => {
      const result = resolveReviewerAgent({
        level: 'phase',
        complexity: 'simple',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer for standard tasks', () => {
      const result = resolveReviewerAgent({
        level: 'phase',
        complexity: 'standard',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer for complex tasks', () => {
      const result = resolveReviewerAgent({
        level: 'phase',
        complexity: 'complex',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer even when complexity is absent', () => {
      const result = resolveReviewerAgent({
        level: 'phase',
      });
      expect(result).toBe('reviewer');
    });
  });

  describe('final-level reviews (always reviewer, regardless of complexity)', () => {
    it('returns reviewer for simple tasks', () => {
      const result = resolveReviewerAgent({
        level: 'final',
        complexity: 'simple',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer for standard tasks', () => {
      const result = resolveReviewerAgent({
        level: 'final',
        complexity: 'standard',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer for complex tasks', () => {
      const result = resolveReviewerAgent({
        level: 'final',
        complexity: 'complex',
      });
      expect(result).toBe('reviewer');
    });

    it('returns reviewer even when complexity is absent', () => {
      const result = resolveReviewerAgent({
        level: 'final',
      });
      expect(result).toBe('reviewer');
    });
  });

  describe('reviewer escrow: no senior tier, no escalation', () => {
    it('returns only one of the two reviewer tiers (no senior)', () => {
      const agents = new Set<string>();
      for (const level of ['task', 'phase', 'final'] as const) {
        for (const complexity of ['simple', 'standard', 'complex'] as const) {
          agents.add(resolveReviewerAgent({ level, complexity }));
        }
      }
      expect(agents).toEqual(new Set(['reviewer-junior', 'reviewer']));
      expect(agents.has('reviewer-senior')).toBe(false);
    });
  });
});
