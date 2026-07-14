import { describe, expect, it } from 'vitest';
import {
  APPROVAL_DECIDED_TOKEN,
  APPROVAL_NODE_TYPE,
  CODE_REVIEW_NODE_TYPE,
  CODE_REVIEW_REVIEWED_TOKEN,
  CORRECTIVE_NODE_TYPE,
  EXPLOSION_NODE_TYPE,
  MASTER_PLAN_AUTHORED_TOKEN,
  MASTER_PLAN_NODE_TYPE,
  PHASE_NODE_TYPE,
  PLAN_AUDIT_NODE_TYPE,
  PR_CREATED_TOKEN,
  PR_NODE_TYPE,
  TASK_COMPLETED_TOKEN,
  TASK_NODE_TYPE,
} from '../../src/index.js';

// The nine built-ins' `completionToken` field, table-driven against the exact map
// `NEXT_ACTION_COMPLETION_TOKENS` held before this declaration relocated onto each node type itself.

describe('completionToken — reproducing NEXT_ACTION_COMPLETION_TOKENS exactly', () => {
  it.each([
    ['rad-orc:task', TASK_NODE_TYPE, TASK_COMPLETED_TOKEN],
    ['rad-orc:corrective', CORRECTIVE_NODE_TYPE, TASK_COMPLETED_TOKEN],
    ['rad-orc:code_review', CODE_REVIEW_NODE_TYPE, CODE_REVIEW_REVIEWED_TOKEN],
    ['rad-orc:approval', APPROVAL_NODE_TYPE, APPROVAL_DECIDED_TOKEN],
    ['rad-orc:pr', PR_NODE_TYPE, PR_CREATED_TOKEN],
    ['rad-orc:master_plan', MASTER_PLAN_NODE_TYPE, MASTER_PLAN_AUTHORED_TOKEN],
  ] as const)('%s declares completionToken %s', (_name, nodeType, token) => {
    expect(nodeType.completionToken).toBe(token);
  });

  it('corrective reuses task\'s own token verbatim, never a corrective-namespaced one', () => {
    expect(CORRECTIVE_NODE_TYPE.completionToken).toBe(TASK_NODE_TYPE.completionToken);
  });

  it.each([
    ['rad-orc:explosion', EXPLOSION_NODE_TYPE],
    ['rad-orc:plan_audit', PLAN_AUDIT_NODE_TYPE],
    ['rad-orc:phase', PHASE_NODE_TYPE],
  ] as const)('%s declares no completionToken — never an external-actor stop in the old map', (_name, nodeType) => {
    expect(nodeType.completionToken).toBeUndefined();
  });
});
