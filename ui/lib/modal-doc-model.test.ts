import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModalDocs } from './modal-doc-model';
import { deriveArtifacts } from './artifact-model';
import type { ProjectStateV5, NodesRecord } from '@/types/state';

const PROJECT = 'DEMO';

function makeV5State(nodes: NodesRecord = {}): ProjectStateV5 {
  return {
    $schema: 'orchestration-state-v5',
    project: { name: PROJECT, created: '', updated: '' },
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

// ─── Stateless project — root-only, matches deriveArtifacts ──────────────────

test('hasTimeline=false: root-only order matches deriveArtifacts exactly', () => {
  const files = [
    `${PROJECT}-BRAINSTORMING.md`,
    `${PROJECT}-BRAINSTORM.html`,
    `${PROJECT}-REQUIREMENTS.md`,
    `${PROJECT}-WIREFRAME-LAUNCH-SCREEN.html`,
    'phases/PHASE-1-PLAN.md', // subfolder doc must be excluded (no spine to walk)
  ];
  const docs = buildModalDocs(PROJECT, files, null, false);
  const expected = deriveArtifacts(PROJECT, files, false);
  assert.deepEqual(docs.map((d) => d.path), expected.map((a) => a.fileName));
  assert.deepEqual(docs.map((d) => d.title), expected.map((a) => a.title ?? a.label));
  assert.ok(!docs.some((d) => d.path.startsWith('phases/')), 'subfolder docs never appear without a timeline');
});

test('hasTimeline=false with a v5 state passed anyway still returns the stateless root-only order', () => {
  // hasTimeline is the authority, not the presence of a state object.
  const state = makeV5State({ research: { kind: 'step', status: 'completed', doc_path: 'DEMO-RESEARCH.md', retries: 0 } });
  const files = [`${PROJECT}-BRAINSTORMING.md`];
  const docs = buildModalDocs(PROJECT, files, state, false);
  assert.deepEqual(docs.map((d) => d.path), [`${PROJECT}-BRAINSTORMING.md`]);
});

// ─── Full pipelined project — union membership, planning-front order ─────────

test('hasTimeline=true: union of root + subfolder docs, planning-front spine order, structural titles, no duplicates', () => {
  const state = makeV5State({
    requirements: { kind: 'step', status: 'completed', doc_path: `${PROJECT}-REQUIREMENTS.md`, retries: 0 },
    master_plan: { kind: 'step', status: 'completed', doc_path: `${PROJECT}-MASTER-PLAN.md`, retries: 0 },
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        {
          index: 0,
          status: 'in_progress',
          doc_path: 'phases/PHASE-1-PLAN.md',
          nodes: {
            task_loop: {
              kind: 'for_each_task',
              status: 'in_progress',
              iterations: [
                {
                  index: 0,
                  status: 'completed',
                  doc_path: 'tasks/P1-T1.md',
                  nodes: {
                    code_review: { kind: 'step', status: 'completed', doc_path: 'reviews/P1-T1-REVIEW.md', retries: 0 },
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
  const files = [
    `${PROJECT}-REQUIREMENTS.md`,
    `${PROJECT}-MASTER-PLAN.md`,
    `${PROJECT}-ERROR-LOG.md`,
    'phases/PHASE-1-PLAN.md',
    'tasks/P1-T1.md',
    'reviews/P1-T1-REVIEW.md',
  ];

  const docs = buildModalDocs(PROJECT, files, state, true);
  const paths = docs.map((d) => d.path);

  // Union membership: every root and subfolder doc is present exactly once.
  for (const f of files) {
    assert.equal(paths.filter((p) => p === f).length, 1, `${f} must appear exactly once`);
  }

  // Planning-front spine order: Requirements, Master Plan precede the phase docs;
  // Error Log (spine tail) comes after, per getOrderedDocsV5's own order.
  assert.deepEqual(paths, [
    `${PROJECT}-REQUIREMENTS.md`,
    `${PROJECT}-MASTER-PLAN.md`,
    'phases/PHASE-1-PLAN.md',
    'tasks/P1-T1.md',
    'reviews/P1-T1-REVIEW.md',
    `${PROJECT}-ERROR-LOG.md`,
  ]);

  const byPath = Object.fromEntries(docs.map((d) => [d.path, d]));
  assert.equal(byPath[`${PROJECT}-REQUIREMENTS.md`].title, 'Requirements');
  assert.equal(byPath[`${PROJECT}-MASTER-PLAN.md`].title, 'Master Plan');
  assert.equal(byPath['phases/PHASE-1-PLAN.md'].title, 'Phase 1 Plan');
  assert.equal(byPath['tasks/P1-T1.md'].title, 'P1-T1 Handoff');
  assert.equal(byPath['reviews/P1-T1-REVIEW.md'].title, 'P1-T1 Review');
  assert.equal(byPath[`${PROJECT}-ERROR-LOG.md`].title, 'Error Log');
  assert.ok(docs.every((d) => d.isMarkdown), 'every doc in this fixture is markdown');
});

test('hasTimeline=true: subfolder docs are markdown-kind and keyed by their full relative path', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        { index: 0, status: 'in_progress', doc_path: 'phases/PHASE-1-PLAN.md', nodes: {}, corrective_tasks: [], repos: [] },
      ],
    },
  });
  const files = ['phases/PHASE-1-PLAN.md'];
  const docs = buildModalDocs(PROJECT, files, state, true);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].path, 'phases/PHASE-1-PLAN.md');
  assert.equal(docs[0].isMarkdown, true);
  assert.equal(docs[0].kind, 'markdown');
});

// ─── Wireframes + brainstorm visual — visuals sit in the front block ─────────

test('hasTimeline=true: wireframes and a brainstorm visual sit in the front block, before any phase doc', () => {
  const state = makeV5State({
    requirements: { kind: 'step', status: 'completed', doc_path: `${PROJECT}-REQUIREMENTS.md`, retries: 0 },
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        { index: 0, status: 'in_progress', doc_path: 'phases/PHASE-1-PLAN.md', nodes: {}, corrective_tasks: [], repos: [] },
      ],
    },
  });
  const files = [
    `${PROJECT}-REQUIREMENTS.md`,
    `${PROJECT}-BRAINSTORMING.md`,
    `${PROJECT}-BRAINSTORM.html`,
    `${PROJECT}-WIREFRAME-LAUNCH-SCREEN.html`,
    `${PROJECT}-WIREFRAME-DAG-VIEW.html`,
    'phases/PHASE-1-PLAN.md',
  ];

  const docs = buildModalDocs(PROJECT, files, state, true);
  const paths = docs.map((d) => d.path);

  const phaseIdx = paths.indexOf('phases/PHASE-1-PLAN.md');
  const visualPaths = [
    `${PROJECT}-BRAINSTORMING.md`,
    `${PROJECT}-BRAINSTORM.html`,
    `${PROJECT}-WIREFRAME-LAUNCH-SCREEN.html`,
    `${PROJECT}-WIREFRAME-DAG-VIEW.html`,
  ];
  for (const v of visualPaths) {
    const idx = paths.indexOf(v);
    assert.notEqual(idx, -1, `${v} must be present`);
    assert.ok(idx < phaseIdx, `${v} must sit in the front block, before the first phase doc`);
  }

  const byPath = Object.fromEntries(docs.map((d) => [d.path, d]));
  assert.equal(byPath[`${PROJECT}-BRAINSTORMING.md`].title, 'Brainstorm');
  assert.equal(byPath[`${PROJECT}-BRAINSTORM.html`].title, 'Brainstorm Visual');
  assert.equal(byPath[`${PROJECT}-WIREFRAME-LAUNCH-SCREEN.html`].title, 'Launch Screen');
  assert.equal(byPath[`${PROJECT}-WIREFRAME-DAG-VIEW.html`].title, 'Dag View');
  assert.equal(byPath[`${PROJECT}-BRAINSTORM.html`].isMarkdown, false);
  assert.equal(byPath[`${PROJECT}-BRAINSTORM.html`].kind, 'visual');
  assert.equal(byPath[`${PROJECT}-WIREFRAME-LAUNCH-SCREEN.html`].kind, 'wireframe');

  // Never duplicated: the brainstorm markdown is not ALSO left in the spine's tail.
  assert.equal(paths.filter((p) => p === `${PROJECT}-BRAINSTORMING.md`).length, 1);
});

test('hasTimeline=true: a generic other-root .html doc (not brainstorm/wireframe) also lands in the front block', () => {
  const state = makeV5State({
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        { index: 0, status: 'in_progress', doc_path: 'phases/PHASE-1-PLAN.md', nodes: {}, corrective_tasks: [], repos: [] },
      ],
    },
  });
  const files = [`${PROJECT}-DIAGRAM-FLOW.html`, 'phases/PHASE-1-PLAN.md'];
  const docs = buildModalDocs(PROJECT, files, state, true);
  const paths = docs.map((d) => d.path);
  const phaseIdx = paths.indexOf('phases/PHASE-1-PLAN.md');
  const diagramIdx = paths.indexOf(`${PROJECT}-DIAGRAM-FLOW.html`);
  assert.notEqual(diagramIdx, -1);
  assert.ok(diagramIdx < phaseIdx);
});

test('hasTimeline=true: Plan Audit and generic other-root .md docs are NOT hoisted to the front — they stay in the spine tail', () => {
  const state = makeV5State({
    requirements: { kind: 'step', status: 'completed', doc_path: `${PROJECT}-REQUIREMENTS.md`, retries: 0 },
    phase_loop: {
      kind: 'for_each_phase',
      status: 'in_progress',
      iterations: [
        { index: 0, status: 'in_progress', doc_path: 'phases/PHASE-1-PLAN.md', nodes: {}, corrective_tasks: [], repos: [] },
      ],
    },
  });
  const files = [
    `${PROJECT}-REQUIREMENTS.md`,
    `${PROJECT}-PLAN-AUDIT.md`,
    `${PROJECT}-NOTES.md`,
    'phases/PHASE-1-PLAN.md',
  ];
  const docs = buildModalDocs(PROJECT, files, state, true);
  const paths = docs.map((d) => d.path);
  const phaseIdx = paths.indexOf('phases/PHASE-1-PLAN.md');
  const auditIdx = paths.indexOf(`${PROJECT}-PLAN-AUDIT.md`);
  const notesIdx = paths.indexOf(`${PROJECT}-NOTES.md`);
  assert.ok(auditIdx > phaseIdx, 'Plan Audit stays in the tail, after phase docs');
  assert.ok(notesIdx > phaseIdx, 'a generic other-root .md doc stays in the tail, after phase docs');
});
