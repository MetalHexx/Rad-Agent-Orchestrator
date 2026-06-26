import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentTranscript } from '@rad-orchestration/telemetry';
import { OverviewFacet } from './overview-facet';
Object.assign(globalThis, { React });

const transcript: AgentTranscript = {
  transcriptId: 't1',
  sessionId: 's1',
  harness: 'claude-code',
  role: 'subagent',
  agentType: 'coder',
  model: ['claude-sonnet-4-6'],
  durationMs: 184000,
  prompt: 'Do the thing.\nSecond line.',
  result: '**Done.**\n\n- `a.tsx` changed',
  tokens: { in: 1000, out: 2000, cacheRead: 5000, cacheCreate: 400 },
  toolSummary: { total: 16, byName: { Read: 5, Edit: 4, Bash: 6, Write: 1 }, errors: 2 },
  filesTouched: ['a.tsx', 'b.css', 'c.test.tsx'],
  events: [],
};

test('scorecard shows the five tiles from the transcript (FR-2, DD-2, AD-2)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript }));
  assert.ok(html.includes('Total Spend') && html.includes('12.0K'), 'effective-token spend tile (1000*1+2000*5+5000*0.1+400*1.25=12000)');
  assert.ok(html.includes('Duration') && html.includes('3m'), 'duration tile via house formatter');
  assert.ok(html.includes('Tool Calls') && html.includes('16'), 'tool-calls tile');
  assert.ok(html.includes('Errors') && html.includes('2'), 'errors tile');
  assert.ok(html.includes('Files') && html.includes('3'), 'files tile');
  assert.ok(html.includes('sm:grid-cols-5'), 'five-up grid (DD-2)');
});

test('tools card lists chips by count and points to the Tools facet (FR-3, DD-5)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript }));
  assert.ok(html.includes('Bash') && html.includes('×6'), 'tool chip with count');
  assert.ok(html.includes('Tools facet'), 'hint points to the Tools facet');
});

test('renders prompt (mono) and result (prose) panels (FR-4, FR-5, DD-3, NFR-1)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript }));
  assert.ok(html.includes('Spawn Prompt') && html.includes('whitespace-pre-wrap'), 'prompt panel in mono');
  assert.ok(html.includes('Result') && html.includes('<strong'), 'result panel in prose');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-1)');
});

test('degrades when prompt, result, tools, and duration are absent (FR-7, DD-7)', () => {
  const bare: AgentTranscript = {
    ...transcript,
    prompt: undefined,
    result: undefined,
    durationMs: undefined,
    toolSummary: { total: 0, byName: {}, errors: 0 },
    filesTouched: [],
  };
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript: bare }));
  assert.ok(html.includes('No spawn prompt recorded.'), 'prompt empty state');
  assert.ok(html.includes('No result recorded.'), 'result empty state');
  assert.ok(html.includes('No tool calls.'), 'tools empty state');
  assert.ok(html.includes('—'), 'duration renders an em dash when undefined');
});

test('mounts the raw token breakdown under the scorecard, agent-scoped (FR-5, FR-6, AD-3)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript }));
  for (const label of ['Input', 'Output', 'Cache read', 'Cache create']) {
    assert.ok(html.includes(label), `${label} cell present`);
  }
  assert.ok(html.includes('5.0K') && html.includes('2.0K'), 'agent-scoped raw counts via humanizeTokens');
  // The "fold into Total Spend" note now lives in a hover tooltip (#149), which renderToStaticMarkup
  // does not emit. Verify the wiring instead: OverviewFacet feeds the one computed effective spend to
  // both the Total Spend tile and the breakdown, so the breakdown reuses the facet's spend figure.
  const facetSrc = fs.readFileSync(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'overview-facet.tsx'), 'utf8');
  assert.match(facetSrc, /spend=\{spend\}/, 'breakdown receives the facet effective spend (single source of truth)');
  const grid = html.indexOf('sm:grid-cols-5'), breakdown = html.indexOf('Cache create');
  assert.ok(grid !== -1 && breakdown !== -1 && grid < breakdown, 'breakdown sits below the 5-up scorecard');
});
