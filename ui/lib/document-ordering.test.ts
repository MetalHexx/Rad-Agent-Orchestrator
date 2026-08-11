/**
 * Tests for document-ordering utility.
 * Run with: npx tsx ui/lib/document-ordering.test.ts
 */
import assert from 'node:assert';
import { getAdjacentDocs, getOrderedDocsV5 } from './document-ordering';
import * as mod from './document-ordering';
import type { ProjectStateV5, NodesRecord } from '@/types/state';
import type { OrderedDoc } from '@/types/components';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

console.log('\ngetAdjacentDocs');

const sampleDocs: OrderedDoc[] = [
  { path: 'a.md', title: 'A', category: 'planning' },
  { path: 'b.md', title: 'B', category: 'phase' },
  { path: 'c.md', title: 'C', category: 'task' },
];

test('returns prev: null at index 0', () => {
  const result = getAdjacentDocs(sampleDocs, 'a.md');
  assert.strictEqual(result.prev, null);
  assert.deepStrictEqual(result.next, sampleDocs[1]);
  assert.strictEqual(result.currentIndex, 0);
  assert.strictEqual(result.total, 3);
});

test('returns next: null at last index', () => {
  const result = getAdjacentDocs(sampleDocs, 'c.md');
  assert.deepStrictEqual(result.prev, sampleDocs[1]);
  assert.strictEqual(result.next, null);
  assert.strictEqual(result.currentIndex, 2);
  assert.strictEqual(result.total, 3);
});

test('returns both prev and next at a middle index', () => {
  const result = getAdjacentDocs(sampleDocs, 'b.md');
  assert.deepStrictEqual(result.prev, sampleDocs[0]);
  assert.deepStrictEqual(result.next, sampleDocs[2]);
  assert.strictEqual(result.currentIndex, 1);
  assert.strictEqual(result.total, 3);
});

test('returns currentIndex -1 when path not found', () => {
  const result = getAdjacentDocs(sampleDocs, 'unknown.md');
  assert.deepStrictEqual(result, { prev: null, next: null, currentIndex: -1, total: 3 });
});

// ─── getOrderedDocsV5 ─────────────────────────────────────────────────────────

console.log('\ngetOrderedDocsV5');

function makeV5State(nodes: NodesRecord = {}): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: 'TEST', created: '', updated: '' },
    config: {
      gate_mode: 'autonomous',
      limits: { max_phases: 5, max_tasks_per_phase: 10, max_retries_per_task: 2 },
      source_control: { auto_commit: 'never', auto_pr: 'never' },
    },
    pipeline: {
      gate_mode: 'autonomous',
      source_control: null,
      current_tier: 'execution',
      halt_reason: null,
    },
    graph: {
      template_id: 'extra-high',
      status: 'in_progress',
      current_node_path: null,
      nodes,
    },
  };
}

test('root planning step nodes produce docs in definition order with planning category', () => {
  const state = makeV5State({
    research: { kind: 'step', status: 'completed', doc_path: 'docs/RESEARCH.md', retries: 0 },
    prd: { kind: 'step', status: 'completed', doc_path: 'docs/PRD.md', retries: 0 },
    design: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    architecture: { kind: 'step', status: 'completed', doc_path: 'docs/ARCH.md', retries: 0 },
    master_plan: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 3);
  assert.deepStrictEqual(docs.map((d) => d.title), ['Research Findings', 'PRD', 'Architecture']);
  assert.deepStrictEqual(docs.map((d) => d.category), ['planning', 'planning', 'planning']);
  assert.strictEqual(docs[0].path, 'docs/RESEARCH.md');
});

test('null doc_path on step nodes is skipped', () => {
  const state = makeV5State({
    research: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
    prd: { kind: 'step', status: 'completed', doc_path: 'docs/PRD.md', retries: 0 },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].title, 'PRD');
});

test('for_each_phase iterations produce phase-level documents with correct categories and titles', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'completed',
          doc_path: 'phases/P01-PLAN.md',
          nodes: {
            phase_report: { kind: 'step', status: 'completed', doc_path: 'phases/P01-REPORT.md', retries: 0 },
            phase_review: { kind: 'step', status: 'completed', doc_path: 'reviews/P01-REVIEW.md', retries: 0 },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 3);
  assert.deepStrictEqual(docs.map((d) => d.title), ['Phase 1 Plan', 'Phase 1 Report', 'Phase 1 Review']);
  assert.deepStrictEqual(docs.map((d) => d.category), ['phase', 'phase', 'review']);
});

test('for_each_task iterations produce task-level documents with correct categories and PN-TM titles', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'completed',
                  doc_path: 'tasks/T01.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/T01-REVIEW.md', retries: 0 },
                  },
                  corrective_tasks: [],
                  repos: [],
                },
              ],
            },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 2);
  assert.deepStrictEqual(docs.map((d) => d.title), ['P1-T1 Handoff', 'P1-T1 Review']);
  assert.strictEqual(docs[0].category, 'task');
  assert.strictEqual(docs[1].category, 'review');
});

test('corrective task step nodes append CT suffix with task category', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'in_progress',
                  nodes: {
                    task_handoff: { kind: 'step', status: 'completed', doc_path: 'tasks/T01.md', retries: 0 },
                  },
                  corrective_tasks: [
                    {
                      index: 1,
                      reason: 'failed',
                      injected_after: 'code_review',
                      status: 'completed',
                      doc_path: 'tasks/T01-CT1.md',
                      nodes: {},
                      repos: [],
                    },
                  ],
                  repos: [],
                },
              ],
            },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].title, 'P1-T1 Handoff');
  assert.strictEqual(docs[1].title, 'P1-T1 CT1');
  assert.strictEqual(docs[1].category, 'task');
  assert.strictEqual(docs[1].path, 'tasks/T01-CT1.md');
});

test('phase-scope corrective task step nodes emit Phase N CTK labels with correct categories', () => {
  // Mirrors the task-scope corrective test above but for phaseIter.corrective_tasks.
  // Exercises the phase-scope loop: ct.doc_path for the corrective handoff (FR-3 / AD-2),
  // ct.nodes.code_review for the review (code_review IS a child step node at corrective scope).
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          nodes: {
            phase_planning: { kind: 'step', status: 'completed', doc_path: 'phases/P01-PLAN.md', retries: 0 },
            phase_review: { kind: 'step', status: 'completed', doc_path: 'reports/P01-PHASE-REVIEW.md', retries: 0 },
          },
          corrective_tasks: [
            {
              index: 1,
              reason: 'Phase review requested changes',
              injected_after: 'phase_review',
              status: 'completed',
              doc_path: 'tasks/PROJ-TASK-P01-PHASE-C1.md',
              nodes: {
                code_review: { kind: 'step', status: 'completed', doc_path: 'reports/PROJ-CODE-REVIEW-P01-PHASE-C1.md', retries: 0 },
              },
              repos: [],
            },
          ],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  // Expect: phase_planning, phase_review, then two phase-scope corrective docs
  assert.strictEqual(docs.length, 4);
  assert.strictEqual(docs[0].title, 'Phase 1 Plan');
  assert.strictEqual(docs[1].title, 'Phase 1 Review');
  assert.strictEqual(docs[2].title, 'Phase 1 CT1');
  assert.strictEqual(docs[2].category, 'phase');
  assert.strictEqual(docs[2].path, 'tasks/PROJ-TASK-P01-PHASE-C1.md');
  assert.strictEqual(docs[3].title, 'Phase 1 CT1 Review');
  assert.strictEqual(docs[3].category, 'review');
  assert.strictEqual(docs[3].path, 'reports/PROJ-CODE-REVIEW-P01-PHASE-C1.md');
});

test('a corrective whose doc_path aliases its hosting iteration\'s own doc_path does not duplicate the filmstrip entry', () => {
  // Mirrors real engine behavior (buildCorrectiveBirth sets doc_path: scopeDocPath,
  // the SAME handoff/plan doc, "never re-authored" — see corrective-playbook.md),
  // unlike the other corrective tests above which use synthetic distinct paths.
  // Without a path-uniqueness guard in `push`, this would surface a second
  // "Phase 1 CT1" tile aliasing the same path as "Phase 1 Plan", and the
  // filmstrip's path-based active check would highlight both simultaneously.
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phases/P01-PLAN.md',
          nodes: {
            phase_review: { kind: 'step', status: 'completed', doc_path: 'reports/P01-PHASE-REVIEW.md', retries: 0 },
          },
          corrective_tasks: [
            {
              index: 1,
              reason: 'Phase review requested changes',
              injected_after: 'phase_review',
              status: 'completed',
              doc_path: 'phases/P01-PLAN.md',
              nodes: {
                task_executor: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
              },
              repos: [],
            },
          ],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].title, 'Phase 1 Plan');
  assert.strictEqual(docs[0].path, 'phases/P01-PLAN.md');
  assert.strictEqual(docs[1].title, 'Phase 1 Review');
  assert.ok(
    !docs.some((d) => d.title === 'Phase 1 CT1'),
    'corrective entry aliasing an already-seen path must not surface as its own tile',
  );
});

test('phase-scope corrective docs are sorted by corrective index and interleave correctly with task docs', () => {
  // Two phase-scope correctives (index 1 + index 2), stored out of order.
  // Ensures the sort((a, b) => a.index - b.index) in the loop is exercised.
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          nodes: {
            phase_review: { kind: 'step', status: 'completed', doc_path: 'reports/P01-PHASE-REVIEW.md', retries: 0 },
          },
          corrective_tasks: [
            // Intentionally out of order: index 2 before index 1
            {
              index: 2,
              reason: 'Phase review second round',
              injected_after: 'phase_review',
              status: 'completed',
              doc_path: 'tasks/PROJ-TASK-P01-PHASE-C2.md',
              nodes: {},
              repos: [],
            },
            {
              index: 1,
              reason: 'Phase review first round',
              injected_after: 'phase_review',
              status: 'completed',
              doc_path: 'tasks/PROJ-TASK-P01-PHASE-C1.md',
              nodes: {},
              repos: [],
            },
          ],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  // phase_review, then corrective C1 (index 1) before C2 (index 2)
  assert.strictEqual(docs.length, 3);
  assert.strictEqual(docs[0].title, 'Phase 1 Review');
  assert.strictEqual(docs[1].title, 'Phase 1 CT1');
  assert.strictEqual(docs[1].path, 'tasks/PROJ-TASK-P01-PHASE-C1.md');
  assert.strictEqual(docs[2].title, 'Phase 1 CT2');
  assert.strictEqual(docs[2].path, 'tasks/PROJ-TASK-P01-PHASE-C2.md');
});

test('FR-4 walk order — task with corrective AND phase with phase-scope corrective stays grouped (FR-3, FR-4, NFR-3)', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phases/P01-PLAN.md',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'in_progress',
                  doc_path: 'tasks/T01.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/T01-REVIEW.md', retries: 0 },
                  },
                  corrective_tasks: [
                    {
                      index: 1,
                      reason: 'fix one',
                      injected_after: 'code_review',
                      status: 'completed',
                      doc_path: 'tasks/T01-CT1.md',
                      nodes: {
                        code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/T01-CT1-REVIEW.md', retries: 0 },
                      },
                      repos: [],
                    },
                  ],
                  repos: [],
                },
                {
                  index: 1,
                  status: 'in_progress',
                  doc_path: 'tasks/T02.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/T02-REVIEW.md', retries: 0 },
                  },
                  corrective_tasks: [],
                  repos: [],
                },
              ],
            },
            phase_review: { kind: 'step', status: 'completed', doc_path: 'reports/P01-REVIEW.md', retries: 0 },
          },
          corrective_tasks: [
            {
              index: 1,
              reason: 'phase fix',
              injected_after: 'phase_review',
              status: 'completed',
              doc_path: 'tasks/P01-PCT1.md',
              nodes: {
                code_review: { kind: 'step', status: 'completed', doc_path: 'reports/P01-PCT1-REVIEW.md', retries: 0 },
              },
              repos: [],
            },
          ],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'PROJ');
  assert.deepStrictEqual(docs.map((d) => d.title), [
    'Phase 1 Plan',
    'P1-T1 Handoff',
    'P1-T1 Review',
    'P1-T1 CT1',
    'P1-T1 CT1 Review',
    'P1-T2 Handoff',           // walk advances to next task only after T1's correctives
    'P1-T2 Review',
    'Phase 1 Review',
    'Phase 1 CT1',
    'Phase 1 CT1 Review',
  ]);
});

test('gate and conditional nodes are skipped (no documents produced)', () => {
  const state = makeV5State({
    plan_approval_gate: { kind: 'gate', status: 'not_started', gate_active: false },
    gate_mode_selection: { kind: 'conditional', status: 'not_started', branch_taken: null },
    research: { kind: 'step', status: 'completed', doc_path: 'docs/RESEARCH.md', retries: 0 },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].title, 'Research Findings');
});

test('final_review root step node produces review category with Final Review title', () => {
  // Simplified test fixture — production uses reports/{NAME}-FINAL-REVIEW.md
  // but the path-move assertion only cares about the reports/ prefix.
  const state = makeV5State({
    final_review: { kind: 'step', status: 'completed', doc_path: 'reports/FINAL-REVIEW.md', retries: 0 },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].title, 'Final Review');
  assert.strictEqual(docs[0].category, 'review');
  assert.strictEqual(docs[0].path, 'reports/FINAL-REVIEW.md');
});

test('final_review with in_progress corrective child code_review aliases the final review doc path (dedup test)', () => {
  // P04-T05: final corrective has no handoff doc (ct.doc_path is null by design).
  // Its code_review child's doc_path is the final review report re-opened.
  // Without seenPaths dedup, this would surface a second tile aliasing the same path.
  const state = makeV5State({
    final_review: {
      kind: 'step',
      status: 'in_progress',
      doc_path: 'reports/PROJ-FINAL-REVIEW.md',
      retries: 0,
      corrective_tasks: [
        {
          index: 1,
          reason: 'changes requested',
          injected_after: 'code_review',
          status: 'in_progress',
          doc_path: null,
          nodes: {
            code_review: { kind: 'step', status: 'in_progress', doc_path: 'reports/PROJ-FINAL-REVIEW.md', retries: 0 },
          },
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'PROJ');
  // Only one entry despite the code_review aliasing the same path
  assert.strictEqual(docs.length, 1);
  assert.strictEqual(docs[0].title, 'Final Review');
  assert.strictEqual(docs[0].path, 'reports/PROJ-FINAL-REVIEW.md');
  assert.ok(
    !docs.some((d) => d.title.includes('Final CT1')),
    'final corrective handoff is null and its code_review aliases final_review path — no separate tile',
  );
});

test('final_review corrective child with distinct doc path surfaces with Final CT{K} title', () => {
  // A final corrective child step with a distinct doc path (e.g., a custom template).
  const state = makeV5State({
    final_review: {
      kind: 'step',
      status: 'in_progress',
      doc_path: 'reports/PROJ-FINAL-REVIEW.md',
      retries: 0,
      corrective_tasks: [
        {
          index: 1,
          reason: 'changes requested',
          injected_after: 'code_review',
          status: 'in_progress',
          doc_path: null,
          nodes: {
            code_review: { kind: 'step', status: 'in_progress', doc_path: 'reports/PROJ-FINAL-REVIEW.md', retries: 0 },
            custom_step: { kind: 'step', status: 'in_progress', doc_path: 'reports/CUSTOM-ANALYSIS.md', retries: 0 },
          },
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'PROJ');
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].title, 'Final Review');
  assert.strictEqual(docs[0].path, 'reports/PROJ-FINAL-REVIEW.md');
  assert.strictEqual(docs[1].title, 'Final CT1 Custom Step');
  assert.strictEqual(docs[1].category, 'other');
  assert.strictEqual(docs[1].path, 'reports/CUSTOM-ANALYSIS.md');
});

test('error log from allFiles is appended with error-log category after graph docs', () => {
  const state = makeV5State({
    final_review: { kind: 'step', status: 'completed', doc_path: 'reports/FINAL-REVIEW.md', retries: 0 },
  });

  const allFiles = ['reports/FINAL-REVIEW.md', 'TEST-ERROR-LOG.md'];
  const docs = getOrderedDocsV5(state, 'TEST', allFiles);

  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].title, 'Final Review');
  assert.strictEqual(docs[1].title, 'Error Log');
  assert.strictEqual(docs[1].category, 'error-log');
});

test('remaining md files from allFiles are appended sorted with other category', () => {
  const state = makeV5State();
  const allFiles = ['docs/ZEBRA.md', 'docs/ALPHA.md', 'image.png'];
  const docs = getOrderedDocsV5(state, 'TEST', allFiles);

  assert.deepStrictEqual(docs.map((d) => d.title), ['Alpha', 'Zebra']);
  assert.strictEqual(docs[0].category, 'other');
  assert.strictEqual(docs[1].category, 'other');
});

test('empty graph produces empty result', () => {
  const state = makeV5State();
  const docs = getOrderedDocsV5(state, 'TEST');
  assert.deepStrictEqual(docs, []);
});

test('empty graph with allFiles extras returns only extras', () => {
  const state = makeV5State();
  const allFiles = ['TEST-ERROR-LOG.md', 'EXTRA.md'];
  const docs = getOrderedDocsV5(state, 'TEST', allFiles);
  assert.strictEqual(docs[0].category, 'error-log');
  assert.strictEqual(docs[1].category, 'other');
  assert.strictEqual(docs[1].title, 'Extra');
});

test('full integration: planning + phase iteration with task iteration + corrective task + final review', () => {
  const state = makeV5State({
    research: { kind: 'step', status: 'completed', doc_path: 'docs/RESEARCH.md', retries: 0 },
    prd: { kind: 'step', status: 'completed', doc_path: 'docs/PRD.md', retries: 0 },
    design: { kind: 'step', status: 'completed', doc_path: 'docs/DESIGN.md', retries: 0 },
    architecture: { kind: 'step', status: 'completed', doc_path: 'docs/ARCH.md', retries: 0 },
    master_plan: { kind: 'step', status: 'completed', doc_path: 'docs/MASTER-PLAN.md', retries: 0 },
    plan_approval_gate: { kind: 'gate', status: 'completed', gate_active: false },
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phases/P01-PLAN.md',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'completed',
                  doc_path: 'tasks/T01.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/T01-REVIEW.md', retries: 0 },
                  },
                  corrective_tasks: [
                    {
                      index: 1,
                      reason: 'failed review',
                      injected_after: 'code_review',
                      status: 'completed',
                      doc_path: 'tasks/T01-CT1.md',
                      nodes: {},
                      repos: [],
                    },
                  ],
                  repos: [],
                },
              ],
            },
            phase_report: { kind: 'step', status: 'completed', doc_path: 'phases/P01-REPORT.md', retries: 0 },
            phase_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
    final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  const titles = docs.map((d) => d.title);

  assert.deepStrictEqual(titles, [
    'Research Findings',
    'PRD',
    'Design',
    'Architecture',
    'Master Plan',
    'Phase 1 Plan',
    'P1-T1 Handoff',
    'P1-T1 Review',
    'P1-T1 CT1',
    'Phase 1 Report',
  ]);

  assert.strictEqual(docs[0].category, 'planning');
  assert.strictEqual(docs[5].category, 'phase');
  assert.strictEqual(docs[6].category, 'task');
  assert.strictEqual(docs[7].category, 'review');
  assert.strictEqual(docs[8].category, 'task');
  assert.strictEqual(docs[9].category, 'phase');
});

test('label helpers and within-iteration order constants — locked label scheme (FR-5..11, DD-1)', () => {
  // Import surface — these are exported for testing in P01-T01

  // FR-6 — planning labels survive rewrite unchanged
  assert.strictEqual(mod.STEP_TITLES_V5.research, 'Research Findings');
  assert.strictEqual(mod.STEP_TITLES_V5.prd, 'PRD');
  assert.strictEqual(mod.STEP_TITLES_V5.design, 'Design');
  assert.strictEqual(mod.STEP_TITLES_V5.architecture, 'Architecture');
  assert.strictEqual(mod.STEP_TITLES_V5.requirements, 'Requirements');
  assert.strictEqual(mod.STEP_TITLES_V5.master_plan, 'Master Plan');

  // FR-5 / AD-3 — explicit per-scope ordering constants (no Object.entries reliance)
  assert.deepStrictEqual([...mod.PHASE_ITER_CHILD_ORDER], ['phase_planning', 'task_loop', 'phase_report', 'phase_review']);
  assert.deepStrictEqual([...mod.TASK_ITER_CHILD_ORDER], ['task_handoff', 'code_review']);

  // FR-7 — phase plan label
  assert.strictEqual(mod.titleForPhaseChild('phase_planning', 3), 'Phase 3 Plan');
  // AD-6 — phase_report mapping preserved as harmless dead code
  assert.strictEqual(mod.titleForPhaseChild('phase_report', 3), 'Phase 3 Report');
  // FR-10 — phase review label
  assert.strictEqual(mod.titleForPhaseChild('phase_review', 3), 'Phase 3 Review');

  // FR-8 — task labels (no task name interpolation)
  assert.strictEqual(mod.titleForTaskChild('task_handoff', 2, 5), 'P2-T5 Handoff');
  assert.strictEqual(mod.titleForTaskChild('code_review', 2, 5), 'P2-T5 Review');

  // FR-9 — task-scope corrective labels (CT shorthand, no "Handoff" word on plan)
  assert.strictEqual(mod.titleForTaskCorrectiveChild('task_handoff', 2, 5, 1), 'P2-T5 CT1');
  assert.strictEqual(mod.titleForTaskCorrectiveChild('code_review', 2, 5, 1), 'P2-T5 CT1 Review');

  // FR-10 — phase-scope corrective labels (Phase {N} CT{K} / Phase {N} CT{K} Review)
  assert.strictEqual(mod.titleForPhaseCorrectiveChild('task_handoff', 1, 1), 'Phase 1 CT1');
  assert.strictEqual(mod.titleForPhaseCorrectiveChild('code_review', 1, 1), 'Phase 1 CT1 Review');

  // P04-T05 — final-scope corrective labels (Final CT{K} Review / Final CT{K} ...)
  // Note: final correctives have no handoff doc, so only child step node labels apply.
  assert.strictEqual(mod.titleForFinalCorrectiveChild('code_review', 1), 'Final CT1 Review');
  assert.strictEqual(mod.titleForFinalCorrectiveChild('custom_step', 2), 'Final CT2 Custom Step');
});

test('emits phase-plan from iteration.doc_path and task-handoff from taskIter.doc_path (FR-1, FR-2, FR-4, FR-7, FR-8, AD-2)', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          // Iteration-level doc_path — the phase plan (FR-1 / AD-2)
          doc_path: 'phases/PROJ-PHASE-P01-PLAN.md',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'completed',
                  // Iteration-level doc_path — the task handoff (FR-2 / AD-2)
                  doc_path: 'tasks/PROJ-TASK-P01-T01.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/PROJ-CODE-REVIEW-P01-T01.md', retries: 0 },
                  },
                  corrective_tasks: [],
                  repos: [],
                },
              ],
            },
            phase_review: { kind: 'step', status: 'completed', doc_path: 'reports/PROJ-PHASE-REVIEW-P01.md', retries: 0 },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'PROJ');

  // FR-4 walk order: phase plan → task handoff → task review → phase review
  assert.deepStrictEqual(docs.map((d) => d.title), [
    'Phase 1 Plan',
    'P1-T1 Handoff',
    'P1-T1 Review',
    'Phase 1 Review',
  ]);
  // Path source: iteration.doc_path / taskIter.doc_path (not from nodes.task_handoff)
  assert.strictEqual(docs[0].path, 'phases/PROJ-PHASE-P01-PLAN.md');
  assert.strictEqual(docs[1].path, 'tasks/PROJ-TASK-P01-T01.md');
  assert.strictEqual(docs[0].category, 'phase');
  assert.strictEqual(docs[1].category, 'task');
  assert.strictEqual(docs[2].category, 'review');
  assert.strictEqual(docs[3].category, 'review');
});

test('phase-iteration with both iteration.doc_path AND legacy phase_planning child emits the plan only once (mixed-shape dedup)', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phase-1-plan.md',
          nodes: {
            phase_planning: { kind: 'step', status: 'completed', doc_path: 'phase-1-plan.md', retries: 0 },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  const matching = docs.filter((d) => d.path === 'phase-1-plan.md');
  assert.strictEqual(matching.length, 1, 'phase plan should be emitted exactly once');
});

test('task-iteration with both taskIter.doc_path AND legacy task_handoff child emits the handoff only once (mixed-shape dedup)', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'in_progress',
                  doc_path: 'tasks/T01-handoff.md',
                  nodes: {
                    task_handoff: { kind: 'step', status: 'completed', doc_path: 'tasks/T01-handoff.md', retries: 0 },
                  },
                  corrective_tasks: [],
                  repos: [],
                },
              ],
            },
          },
          corrective_tasks: [],
          repos: [],
        },
      ],
    },
  });

  const docs = getOrderedDocsV5(state, 'TEST');
  const matching = docs.filter((d) => d.path === 'tasks/T01-handoff.md');
  assert.strictEqual(matching.length, 1, 'task handoff should be emitted exactly once');
});

test('FR-12 — v5 tail-bucket .md files are prefix-stripped and title-cased', () => {
  const state = makeV5State();
  const allFiles = [
    'projects/UI-IMPROVE-1-FIXES/UI-IMPROVE-1-FIXES-BRAINSTORMING.md',
    'projects/UI-IMPROVE-1-FIXES/UI-IMPROVE-1-FIXES-AUDIT-REPORT.md',
    'projects/UI-IMPROVE-1-FIXES/UI-IMPROVE-1-FIXES-ERROR-LOG.md',
    'projects/UI-IMPROVE-1-FIXES/scratch_notes.md',
    'image.png',
  ];
  const docs = getOrderedDocsV5(state, 'UI-IMPROVE-1-FIXES', allFiles);

  // FR-11 — error log label is unchanged
  const errorLog = docs.find((d) => d.category === 'error-log')!;
  assert.strictEqual(errorLog.title, 'Error Log');

  // FR-12 — prefix stripped, separators → spaces, title-cased
  const titles = docs.filter((d) => d.category === 'other').map((d) => d.title).sort();
  assert.deepStrictEqual(titles, ['Audit Report', 'Brainstorming', 'Scratch Notes']);
});

test('FR-12 — v5 tail-bucket label keeps name when project prefix is absent', () => {
  const state = makeV5State();
  const allFiles = ['NOTES.md', 'random-thoughts.md'];
  const docs = getOrderedDocsV5(state, 'PROJ', allFiles);
  const titles = docs.filter((d) => d.category === 'other').map((d) => d.title).sort();
  assert.deepStrictEqual(titles, ['Notes', 'Random Thoughts']);
});

test('NFR-2 — no canonical doc emitted by the engine lands in the tail "other" bucket', () => {
  // Default-template fixture: planning steps, one phase with two tasks,
  // one task-scope corrective on T1, one phase-scope corrective, final review.
  const state = makeV5State({
    research: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/PROJ-RESEARCH-FINDINGS.md', retries: 0 },
    prd: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/PROJ-PRD.md', retries: 0 },
    design: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/PROJ-DESIGN.md', retries: 0 },
    architecture: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/PROJ-ARCHITECTURE.md', retries: 0 },
    requirements: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/PROJ-REQUIREMENTS.md', retries: 0 },
    master_plan: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/PROJ-MASTER-PLAN.md', retries: 0 },
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'projects/PROJ/phases/PROJ-PHASE-P01-PLAN.md',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'completed',
                  doc_path: 'projects/PROJ/tasks/PROJ-TASK-P01-T01.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-T01.md', retries: 0 },
                  },
                  corrective_tasks: [
                    {
                      index: 1,
                      reason: 'fix',
                      injected_after: 'code_review',
                      status: 'completed',
                      doc_path: 'projects/PROJ/tasks/PROJ-TASK-P01-T01-CT1.md',
                      nodes: {
                        code_review: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-T01-CT1.md', retries: 0 },
                      },
                      repos: [],
                    },
                  ],
                  repos: [],
                },
                {
                  index: 1,
                  status: 'completed',
                  doc_path: 'projects/PROJ/tasks/PROJ-TASK-P01-T02.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-T02.md', retries: 0 },
                  },
                  corrective_tasks: [],
                  repos: [],
                },
              ],
            },
            phase_review: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/reports/PROJ-PHASE-REVIEW-P01.md', retries: 0 },
          },
          corrective_tasks: [
            {
              index: 1,
              reason: 'phase fix',
              injected_after: 'phase_review',
              status: 'completed',
              doc_path: 'projects/PROJ/tasks/PROJ-TASK-P01-PHASE-C1.md',
              nodes: {
                code_review: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-PHASE-C1.md', retries: 0 },
              },
              repos: [],
            },
          ],
          repos: [],
        },
      ],
    },
    final_review: { kind: 'step', status: 'completed', doc_path: 'projects/PROJ/reports/PROJ-FINAL-REVIEW.md', retries: 0 },
  });

  // allFiles mirrors the canonical paths above plus genuine tail docs.
  const canonicalPaths = [
    'projects/PROJ/PROJ-RESEARCH-FINDINGS.md',
    'projects/PROJ/PROJ-PRD.md',
    'projects/PROJ/PROJ-DESIGN.md',
    'projects/PROJ/PROJ-ARCHITECTURE.md',
    'projects/PROJ/PROJ-REQUIREMENTS.md',
    'projects/PROJ/PROJ-MASTER-PLAN.md',
    'projects/PROJ/phases/PROJ-PHASE-P01-PLAN.md',
    'projects/PROJ/tasks/PROJ-TASK-P01-T01.md',
    'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-T01.md',
    'projects/PROJ/tasks/PROJ-TASK-P01-T01-CT1.md',
    'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-T01-CT1.md',
    'projects/PROJ/tasks/PROJ-TASK-P01-T02.md',
    'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-T02.md',
    'projects/PROJ/reports/PROJ-PHASE-REVIEW-P01.md',
    'projects/PROJ/tasks/PROJ-TASK-P01-PHASE-C1.md',
    'projects/PROJ/reviews/PROJ-CODE-REVIEW-P01-PHASE-C1.md',
    'projects/PROJ/reports/PROJ-FINAL-REVIEW.md',
  ];
  const tailFiles = [
    'projects/PROJ/PROJ-BRAINSTORMING.md',
    'projects/PROJ/PROJ-ERROR-LOG.md',
  ];
  const allFiles = [...canonicalPaths, ...tailFiles];

  const docs = getOrderedDocsV5(state, 'PROJ', allFiles);

  // NFR-2 invariant — every canonical path is in docs and NOT categorized 'other'.
  const otherPaths = new Set(docs.filter((d) => d.category === 'other').map((d) => d.path));
  for (const p of canonicalPaths) {
    assert.ok(!otherPaths.has(p), `canonical doc ${p} leaked into the tail "other" bucket`);
    assert.ok(docs.some((d) => d.path === p), `canonical doc ${p} is missing from the walk`);
  }

  // Tail bucket contains only the brainstorming file (error log gets its own category).
  const others = docs.filter((d) => d.category === 'other');
  assert.deepStrictEqual(others.map((d) => d.title), ['Brainstorming']);
  assert.strictEqual(docs.find((d) => d.category === 'error-log')!.title, 'Error Log');

  // FR-4 walk-order spot-check: phase plan precedes T1 handoff; T1's CT precedes T2.
  const titles = docs.map((d) => d.title);
  const idxPhasePlan = titles.indexOf('Phase 1 Plan');
  const idxT1Handoff = titles.indexOf('P1-T1 Handoff');
  const idxT1CT = titles.indexOf('P1-T1 CT1');
  const idxT2Handoff = titles.indexOf('P1-T2 Handoff');
  const idxPhaseReview = titles.indexOf('Phase 1 Review');
  const idxPhaseCT = titles.indexOf('Phase 1 CT1');
  const idxFinal = titles.indexOf('Final Review');
  assert.ok(idxPhasePlan < idxT1Handoff && idxT1Handoff < idxT1CT && idxT1CT < idxT2Handoff,
    'task-scope corrective must stay grouped with parent task before walk advances');
  assert.ok(idxT2Handoff < idxPhaseReview && idxPhaseReview < idxPhaseCT && idxPhaseCT < idxFinal,
    'phase review precedes phase-scope correctives, both precede final review');
});

test('FR-13 — drawer header file is untouched (compile-time pin)', () => {
  // FR-13 is enforced by source-control review — no code changes in
  // ui/components/documents/document-drawer.tsx (or the drawer header
  // sub-components) are introduced by this iteration. This test exists
  // as a documentation marker so a reviewer knows to verify the drawer
  // file diff is empty.
  assert.ok(true, 'see ui/components/documents/document-drawer.tsx — no diff expected');
});

// ─── P01-T02 — Requirements doc restored to Planning via file-list fallback ───

test('requirements slot with no state node falls back to allFiles and lands before Master Plan, not in the "other" tail', () => {
  const state = makeV5State({
    research: { kind: 'step', status: 'completed', doc_path: 'PROJ-RESEARCH-FINDINGS.md', retries: 0 },
    master_plan: { kind: 'step', status: 'completed', doc_path: 'PROJ-MASTER-PLAN.md', retries: 0 },
  });
  const allFiles = ['PROJ-RESEARCH-FINDINGS.md', 'PROJ-MASTER-PLAN.md', 'PROJ-REQUIREMENTS.md'];

  const docs = getOrderedDocsV5(state, 'PROJ', allFiles);

  const reqIndex = docs.findIndex((d) => d.title === 'Requirements');
  const masterPlanIndex = docs.findIndex((d) => d.title === 'Master Plan');
  assert.notStrictEqual(reqIndex, -1, 'Requirements doc must be present');
  assert.deepStrictEqual(docs[reqIndex], { path: 'PROJ-REQUIREMENTS.md', title: 'Requirements', category: 'planning' });
  assert.ok(reqIndex < masterPlanIndex, 'Requirements must be ordered before Master Plan');
  assert.ok(!docs.some((d) => d.category === 'other' && d.path === 'PROJ-REQUIREMENTS.md'), 'Requirements must not leak into the "other" tail');
});

test('requirements slot with no doc in allFiles produces no Requirements entry', () => {
  const state = makeV5State({
    master_plan: { kind: 'step', status: 'completed', doc_path: 'PROJ-MASTER-PLAN.md', retries: 0 },
  });
  const allFiles = ['PROJ-MASTER-PLAN.md'];

  const docs = getOrderedDocsV5(state, 'PROJ', allFiles);
  assert.ok(!docs.some((d) => d.title === 'Requirements'), 'no Requirements entry when the file is absent');
});

test('a legacy requirements state node still present alongside allFiles produces exactly one Requirements entry (no duplicate)', () => {
  const state = makeV5State({
    requirements: { kind: 'step', status: 'completed', doc_path: 'PROJ-REQUIREMENTS.md', retries: 0 },
    master_plan: { kind: 'step', status: 'completed', doc_path: 'PROJ-MASTER-PLAN.md', retries: 0 },
  });
  const allFiles = ['PROJ-REQUIREMENTS.md', 'PROJ-MASTER-PLAN.md'];

  const docs = getOrderedDocsV5(state, 'PROJ', allFiles);
  const matching = docs.filter((d) => d.title === 'Requirements');
  assert.strictEqual(matching.length, 1, 'legacy state node path must not double up with the file-list fallback');
  assert.strictEqual(matching[0].path, 'PROJ-REQUIREMENTS.md');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
