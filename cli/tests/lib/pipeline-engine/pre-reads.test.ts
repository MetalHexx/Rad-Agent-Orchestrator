import { describe, expect, it } from 'vitest';
import { preRead } from '../../../src/lib/pipeline-engine/pre-reads.js';
import type { EventContext, EventIndexEntry } from '../../../src/lib/pipeline-engine/types.js';
import {
  PROJECT_DIR,
  codeReviewDoc,
  createMockIO,
  phaseReviewDoc,
  seedDoc,
} from './fixtures/parity-states.js';

/**
 * `preRead` merges a document's frontmatter into the event context, which is
 * what carries `verdict` and friends into the mutation. Node identity is the
 * one thing it must NOT carry: the engine resolves phase/task from state (or
 * from an explicit `--phase`/`--task` on the signal), and a review doc whose
 * frontmatter happens to say `phase: P01` would otherwise steer resolution to
 * a node the engine never selected.
 *
 * Both merge sites are covered — the `plan_approved` branch and the generic
 * step path — against the same DOC_STORE-backed `readDocument` the rest of the
 * engine suite uses.
 */

const readDocument = createMockIO().readDocument;

const CODE_REVIEW_ENTRY: EventIndexEntry = {
  nodeDef: {
    id: 'code_review',
    kind: 'step',
    action: 'spawn_code_reviewer',
    events: { completed: 'code_review_completed' },
    doc_output_field: 'doc_path',
  },
  eventPhase: 'completed',
  templatePath: 'phase_loop.body.task_loop.body.code_review',
};

const PHASE_REVIEW_ENTRY: EventIndexEntry = {
  nodeDef: {
    id: 'phase_review',
    kind: 'step',
    action: 'spawn_phase_reviewer',
    events: { completed: 'phase_review_completed' },
    doc_output_field: 'doc_path',
  },
  eventPhase: 'completed',
  templatePath: 'phase_loop.body.phase_review',
};

const PLAN_GATE_ENTRY: EventIndexEntry = {
  nodeDef: {
    id: 'plan_approval_gate',
    kind: 'gate',
    mode_ref: 'human_gates.after_planning',
    action_if_needed: 'request_plan_approval',
    approved_event: 'plan_approved',
  },
  eventPhase: 'approved',
  templatePath: 'plan_approval_gate',
};

function run(
  event: string,
  context: Partial<EventContext>,
  entry: EventIndexEntry,
): Record<string, unknown> {
  const result = preRead(event, context, readDocument, PROJECT_DIR, null, entry);
  expect(result.error).toBeUndefined();
  return result.context as Record<string, unknown>;
}

describe('preRead strips engine-owned identity from document frontmatter', () => {
  it('keeps a review doc\'s own phase/task out of the mutation context', () => {
    // The exact shape that broke `code_review_completed`: the reviewer's
    // frontmatter carries the string IDs, which reached the context and made
    // `resolveNodeState` throw on a phase it was never asked to resolve.
    const docPath = codeReviewDoc(1, 2);
    seedDoc(docPath, { phase: 'P01', task: 'P01-T02', verdict: 'approved' });

    const context = run('code_review_completed', { doc_path: docPath }, CODE_REVIEW_ENTRY);
    expect(context.phase).toBeUndefined();
    expect(context.task).toBeUndefined();
    expect(context.verdict).toBe('approved');
  });

  it('still admits verdict and exit_criteria_met from a phase review doc', () => {
    // Neither field has any source other than the document, so the strip must
    // stay narrow enough to leave them alone.
    const docPath = phaseReviewDoc(4);
    seedDoc(docPath, {
      phase: 'P04',
      verdict: 'changes_requested',
      exit_criteria_met: false,
      reason: 'Exit criteria unmet',
    });

    const context = run('phase_review_completed', { doc_path: docPath }, PHASE_REVIEW_ENTRY);
    expect(context.phase).toBeUndefined();
    expect(context.verdict).toBe('changes_requested');
    expect(context.exit_criteria_met).toBe(false);
    expect(context.reason).toBe('Exit criteria unmet');
  });

  // Guards the strip against being implemented on the *merged* result
  // (`delete enriched.phase`), which would throw away the CLI flag too.
  it('leaves an explicit --phase / --task on the context intact', () => {
    const docPath = codeReviewDoc(2, 1);
    seedDoc(docPath, { phase: 'P01', task: 'P01-T02', verdict: 'approved' });

    const context = run(
      'code_review_completed',
      { doc_path: docPath, phase: 2, task: 1 },
      CODE_REVIEW_ENTRY,
    );
    expect(context.phase).toBe(2);
    expect(context.task).toBe(1);
  });

  it('strips at the plan_approved site too, without dropping the plan totals', () => {
    const docPath = `${PROJECT_DIR}/master-plan.md`;
    seedDoc(docPath, { phase: 'P01', task: 'P01-T02', total_phases: 3, total_tasks: 7 });

    const context = run('plan_approved', { doc_path: docPath }, PLAN_GATE_ENTRY);
    expect(context.phase).toBeUndefined();
    expect(context.task).toBeUndefined();
    expect(context.total_phases).toBe(3);
    expect(context.total_tasks).toBe(7);
  });
});
