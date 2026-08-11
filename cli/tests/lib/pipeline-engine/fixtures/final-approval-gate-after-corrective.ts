// cli/tests/lib/pipeline-engine/fixtures/final-approval-gate-after-corrective.ts
//
// Regression fixture: a project parked at `final_approval_gate`, blocking on a
// person, immediately after a final-scope corrective closed. This is the exact
// state shape that surfaced the defect this task fixes in a live run — before
// the fix, `deriveCurrentNodePathFromMarkers` returned null here (the phase
// loop is completed with no in_progress leaf anywhere below it, and the gate
// itself stayed `not_started` rather than reporting `in_progress`), so the
// dashboard's cursor fell back to a stale echoed path instead of the gate.
//
// Pinned as a literal state object (not driven through processEvent) so the
// exact shape that produced the defect is preserved verbatim.
import type { PipelineState } from '../../../../src/lib/pipeline-engine/types.js';

export function finalApprovalGateAfterCorrectiveState(): PipelineState {
  return {
    $schema: 'orchestration-state-v6',
    project: { name: 'post-final-corrective', created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z' },
    config: {
      gate_mode: 'autonomous',
      limits: { max_retries_per_task: 3 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'autonomous',
      source_control: null,
      current_tier: 'review',
      halt_reason: null,
    },
    graph: {
      template_id: 'medium',
      status: 'in_progress',
      current_node_path: 'final_approval_gate',
      nodes: {
        phase_loop: {
          kind: 'for_each_phase',
          status: 'completed',
          iterations: [
            { index: 0, status: 'completed', doc_path: 'phases/phase-1.md', repos: [], corrective_tasks: [], nodes: {} },
          ],
        },
        final_review: {
          kind: 'step',
          status: 'completed',
          doc_path: 'final-review.md',
          retries: 0,
          verdict: 'approved',
          corrective_budget_origin: 0,
          corrective_tasks: [
            {
              index: 1,
              reason: 'Final review requested changes',
              injected_after: 'final_review',
              status: 'completed',
              doc_path: null,
              review_report_path: 'final-review.md',
              repos: [],
              nodes: {
                task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
                code_review: { kind: 'step', status: 'completed', doc_path: null, retries: 0, verdict: 'approved' },
              },
            },
          ],
        },
        final_approval_gate: { kind: 'gate', status: 'in_progress', gate_active: true },
      },
    },
  } as unknown as PipelineState;
}
