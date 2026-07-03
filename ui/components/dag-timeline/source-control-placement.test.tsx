import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DAGTimeline } from './dag-timeline';
import type { NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// 'requirements' is a retired Planning-section node id — it must render
// nowhere in the timeline (the Planning card + docs list own it now).
// 'phase_loop' → Execution bucket, 'final_review' → Completion bucket.
const nodes: NodesRecord = {
  requirements: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  phase_loop: {
    kind: 'for_each_phase',
    status: 'not_started',
    iterations: [],
  },
  final_review: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
};

const html = renderToStaticMarkup(
  createElement(DAGTimeline, {
    nodes,
    currentNodePath: null,
    onDocClick: () => {},
    expandedLoopIds: [],
    onAccordionChange: () => {},
    compareUrlByRepo: {},
    projectName: 'TEST-PROJECT',
    phaseLoopStatus: 'not_started',
    prUrl: null,
    afterPlanningSlot: createElement('div', { 'data-testid': 'sc-slot' }),
  })
);

assert.ok(!html.includes('Planning'), 'the timeline must no longer render a Planning section');
assert.ok(!html.includes('Requirements'), 'the retired requirements node must not render anywhere in the timeline');

const slotIdx = html.indexOf('sc-slot');
const executionIdx = html.indexOf('Execution');
const completionIdx = html.indexOf('Completion');

assert.ok(slotIdx >= 0 && executionIdx >= 0 && completionIdx >= 0,
  `Expected sc-slot (${slotIdx}), Execution (${executionIdx}), and Completion (${completionIdx}) to all be present`);
assert.ok(slotIdx < executionIdx && executionIdx < completionIdx,
  'Source Control slot must render above Execution, which stays above Completion');

console.log('source-control-placement ✓');
