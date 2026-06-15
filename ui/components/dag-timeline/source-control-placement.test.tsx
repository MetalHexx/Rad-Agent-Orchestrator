import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DAGTimeline } from './dag-timeline';
import type { NodesRecord } from '@/types/state';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).React = React;

// Minimal nodes graph that produces both a Planning and an Execution section group.
// `requirements` maps to Planning; `phase_loop` maps to Execution (see NODE_SECTION_MAP).
const nodes: NodesRecord = {
  requirements: { kind: 'step', status: 'completed', doc_path: null, retries: 0 },
  phase_loop: {
    kind: 'for_each_phase',
    status: 'not_started',
    iterations: [],
  },
};

const noop = () => {};
const noopAccordion = (_value: string[], _eventDetails: { reason: string }) => {};

const html = renderToStaticMarkup(
  React.createElement(DAGTimeline, {
    nodes,
    currentNodePath: null,
    onDocClick: noop,
    expandedLoopIds: [],
    onAccordionChange: noopAccordion,
    repoBaseUrl: null,
    projectName: 'TEST-PROJECT',
    phaseLoopStatus: 'not_started',
    prUrl: null,
    afterPlanningSlot: React.createElement('div', { 'data-testid': 'sc-slot' }),
  })
);

const planningIdx = html.indexOf('Planning');
const slotIdx = html.indexOf('sc-slot');
const executionIdx = html.indexOf('Execution');

assert.ok(planningIdx >= 0 && slotIdx >= 0 && executionIdx >= 0,
  `Expected Planning (${planningIdx}), sc-slot (${slotIdx}), and Execution (${executionIdx}) to all be present in the markup`);
assert.ok(
  planningIdx < slotIdx && slotIdx < executionIdx,
  `Source Control slot must render between Planning and Execution. Got: Planning@${planningIdx}, sc-slot@${slotIdx}, Execution@${executionIdx}`
);

console.log('source-control-placement ✓');
