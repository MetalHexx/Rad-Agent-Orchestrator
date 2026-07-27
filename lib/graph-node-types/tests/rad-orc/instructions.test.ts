import { describe, expect, it } from 'vitest';
import { BUILT_IN_NODE_TYPES } from '../../src/index.js';

describe('instructions — vocabulary-leak scan across all nine built-in types', () => {
  // The forbidden set: engine-internal tokens and language that should not appear in
  // agent-facing instructions. These are implementation concerns, not user concerns.
  const FORBIDDEN_TOKENS = [
    'expands-trait', // Hyphenated variant sometimes appears
    'expands',
    'code-behind',
    'routing request',
    'dependency-driven',
    'frontier-eligible',
    'cascade reset',
    'cascade-resets',
    'the engine\'s',
    'sole',
    'primitive',
    'AgentSpawnRequest',
    'not_started',
    'in_progress',
  ];

  it('no forbidden engine-internal token appears in any nine-type instructions', () => {
    for (const nodeType of BUILT_IN_NODE_TYPES) {
      const instructions = nodeType.instructions ?? '';
      for (const token of FORBIDDEN_TOKENS) {
        expect(instructions).not.toContain(
          token,
          `Found forbidden token "${token}" in ${nodeType.name} instructions`,
        );
      }
    }
  });

  it('bare hook names (handle, act, projectStatus) do not appear in instructions', () => {
    const bareHookNames = ['handle', 'act', 'projectStatus'];
    for (const nodeType of BUILT_IN_NODE_TYPES) {
      const instructions = nodeType.instructions ?? '';
      for (const hook of bareHookNames) {
        // Allow these if they appear in code blocks or backticks (like `act`), but not bare
        const barePattern = new RegExp(`(?<!\`)\\b${hook}\\b(?!\`)`);
        expect(instructions).not.toMatch(
          barePattern,
          `Bare hook name "${hook}" found in ${nodeType.name} instructions`,
        );
      }
    }
  });

  it('explosion declares no instruction', () => {
    const explosion = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:explosion');
    expect(explosion).toBeDefined();
    expect(explosion!.instructions).toBeUndefined();
  });

  it('task names its governing skill', () => {
    const task = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:task');
    expect(task).toBeDefined();
    expect(task!.instructions).toContain('rad-execute-coding-task');
  });

  it('corrective names its governing skill', () => {
    const corrective = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:corrective');
    expect(corrective).toBeDefined();
    expect(corrective!.instructions).toContain('rad-execute-coding-task');
  });

  it('code_review names its governing skill', () => {
    const codeReview = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:code_review');
    expect(codeReview).toBeDefined();
    expect(codeReview!.instructions).toContain('rad-code-review');
  });

  it('pr names its governing skill', () => {
    const pr = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:pr');
    expect(pr).toBeDefined();
    expect(pr!.instructions).toContain('rad-source-control');
  });

  it('master_plan names its governing skill', () => {
    const masterPlan = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:master_plan');
    expect(masterPlan).toBeDefined();
    expect(masterPlan!.instructions).toContain('rad-create-plans');
  });

  it('approval emits payload with level always and repos when present', () => {
    const approval = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:approval');
    expect(approval).toBeDefined();
    const schema = approval!.dataSchema;
    expect(schema.level).toBeDefined();
    expect(schema.level.level).toBe('required');
    expect(schema.repos).toBeDefined();
    expect(schema.repos.level).toBe('optional');
    expect(schema.repos.kind).toBe('array');
  });

  it('approval.repos declares no resolve hint — pr_url must not be path-resolved', () => {
    const approval = BUILT_IN_NODE_TYPES.find((t) => t.name === 'rad-orc:approval');
    expect(approval).toBeDefined();
    const reposField = approval!.dataSchema.repos;
    expect(reposField).toBeDefined();
    expect(reposField.resolve).toBeUndefined();
  });
});
