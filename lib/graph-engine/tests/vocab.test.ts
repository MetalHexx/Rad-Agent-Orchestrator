import { describe, expect, it } from 'vitest';
import {
  NODE_STATUSES,
  TRAITS,
  EXECUTORS,
  CAPABILITY_NAMES,
  PRIMITIVE_NAMES,
  PRIMITIVE_RESET,
  assertNever,
} from '../src/model/vocab.js';
import type { Trait } from '../src/model/vocab.js';

describe('NodeStatus vocabulary', () => {
  it('has exactly the core-owned status members', () => {
    expect(NODE_STATUSES).toEqual(['not_started', 'in_progress', 'done', 'blocked', 'failed']);
  });

  it('excludes a non-member value', () => {
    expect((NODE_STATUSES as readonly string[]).includes('cancelled')).toBe(false);
  });
});

describe('Trait vocabulary', () => {
  it('has exactly the generic node behaviors', () => {
    expect(TRAITS).toEqual(['contains', 'routes', 'expands']);
  });

  it('excludes a non-member value', () => {
    expect((TRAITS as readonly string[]).includes('bogus')).toBe(false);
  });
});

describe('Executor vocabulary', () => {
  it('has exactly the four executor kinds', () => {
    expect(EXECUTORS).toEqual(['spawn-sub-agent', 'orchestrator-inline', 'request-human', 'noop']);
  });

  it('excludes a non-member value', () => {
    expect((EXECUTORS as readonly string[]).includes('bogus')).toBe(false);
  });
});

describe('CapabilityName vocabulary', () => {
  it('has exactly the well-known capability set', () => {
    expect(CAPABILITY_NAMES).toEqual([
      'doc-read', 'doc-write', 'git-facts', 'spawn-agent', 'run-command', 'request-human',
    ]);
  });
});

describe('PrimitiveName vocabulary', () => {
  it('has exactly the P03 CRUD/lifecycle/batch/iteration primitive names plus the driver contract\'s engage', () => {
    expect(PRIMITIVE_NAMES).toEqual([
      'add_node',
      'remove_node',
      'add_dependency',
      'remove_dependency',
      'move_node',
      'set_order',
      'toggle',
      'resume',
      'expand',
      'apply_event',
      'add_corrective',
      'reset',
      'engage',
    ]);
  });
});

describe('PRIMITIVE_RESET singleton', () => {
  it('equals the reset primitive name', () => {
    expect(PRIMITIVE_RESET).toBe('reset');
  });
});

describe('assertNever', () => {
  it('throws when reached with a value outside its declared union', () => {
    expect(() => assertNever('unreachable' as never)).toThrow(/unreachable vocabulary member/);
  });

  it('a switch over every live Trait member never falls through to assertNever', () => {
    function labelForTrait(trait: Trait): string {
      switch (trait) {
        case 'contains':
          return 'contains';
        case 'routes':
          return 'routes';
        case 'expands':
          return 'expands';
        default:
          return assertNever(trait);
      }
    }

    for (const trait of TRAITS) {
      expect(labelForTrait(trait)).toBe(trait);
    }
  });
});
