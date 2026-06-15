import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DAGTimeline } from './dag-timeline';
import type { NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// Minimal nodes graph: 'requirements' → Planning bucket, 'phase_loop' → Execution bucket.
// This produces both a Planning section group and an Execution section group in DAGTimeline.
const nodes: NodesRecord = {
  requirements: { kind: 'step', status: 'not_started', doc_path: null, retries: 0 },
  phase_loop: {
    kind: 'for_each_phase',
    status: 'not_started',
    iterations: [],
  },
};

const html = renderToStaticMarkup(
  createElement(DAGTimeline, {
    nodes,
    currentNodePath: null,
    onDocClick: () => {},
    expandedLoopIds: [],
    onAccordionChange: () => {},
    repoBaseUrl: null,
    projectName: 'TEST-PROJECT',
    phaseLoopStatus: 'not_started',
    prUrl: null,
    afterPlanningSlot: createElement('div', { 'data-testid': 'sc-slot' }),
  })
);

const planningIdx = html.indexOf('Planning');
const slotIdx = html.indexOf('sc-slot');
const executionIdx = html.indexOf('Execution');

assert.ok(planningIdx >= 0 && slotIdx >= 0 && executionIdx >= 0,
  `Expected Planning (${planningIdx}), sc-slot (${slotIdx}), and Execution (${executionIdx}) to all be present`);
assert.ok(planningIdx < slotIdx && slotIdx < executionIdx,
  'Source Control slot must render between Planning and Execution');

console.log('source-control-placement ✓');
