import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentTranscript, ObservabilityUsageRow } from '@rad-orchestration/telemetry';
import { spendReceipt } from '@/lib/observability/spend-display';
import { OverviewFacet } from './overview-facet';
Object.assign(globalThis, { React });

const transcript: AgentTranscript = {
  transcriptId: 't1',
  sessionId: 's1',
  harness: 'claude-code',
  role: 'subagent',
  agentType: 'coder',
  model: ['claude-sonnet-5'],
  durationMs: 184000,
  prompt: 'Do the thing.\nSecond line.',
  result: '**Done.**\n\n- `a.tsx` changed',
  tokens: { in: 1000, out: 2000, cacheRead: 5000, cacheCreate: 400 },
  toolSummary: { total: 16, byName: { Read: 5, Edit: 4, Bash: 6, Write: 1 }, errors: 2 },
  filesTouched: ['a.tsx', 'b.css', 'c.test.tsx'],
  events: [],
};

// Rows fixture — the modal's spend numbers now come from spendReceipt(rows), NOT transcript.tokens
// (R8: single source shared with the session-view row). Priced against a known model (sonnet-5) so
// the dollar figure is a real number, not "price unavailable".
const rows: ObservabilityUsageRow[] = [
  {
    sessionId: 's1', usageId: 'u1', timestamp: '2026-07-01T00:00:00.000Z',
    inputTokens: 2_000_000, outputTokens: 400_000, cacheReadTokens: 1_000_000, cacheCreationTokens: 800_000,
    source: 'main-agent', harness: 'claude-code', model: 'claude-sonnet-5',
  },
];
const receipt = spendReceipt(rows);

const unpricedRows: ObservabilityUsageRow[] = [
  {
    sessionId: 's1', usageId: 'u2', timestamp: '2026-07-01T00:00:00.000Z',
    inputTokens: 100, outputTokens: 50, source: 'main-agent', harness: 'claude-code', model: 'gpt-5-codex',
  },
];

test('cost trio + operational grid render from spendReceipt(rows), not the transcript (FR-2, DD-2, AD-2)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript, rows }));
  assert.ok(html.includes('Total Spend (weighted)') && html.includes('5.10M'), 'weighted trio card from receipt.costWeighted');
  assert.ok(html.includes('Cost (USD)') && html.includes('$15.30'), 'dollar trio card from receipt.dollars');
  assert.ok(html.includes('New tokens') && html.includes('800.0K'), 'new-tokens trio card from receipt.newTokens');
  assert.ok(html.includes('sm:grid-cols-3'), 'cost trio is a three-up grid');
  assert.ok(html.includes('Duration') && html.includes('3m'), 'duration tile via house formatter');
  assert.ok(html.includes('Tool Calls') && html.includes('16'), 'tool-calls tile');
  assert.ok(html.includes('Errors') && html.includes('2'), 'errors tile');
  assert.ok(html.includes('Files') && html.includes('3'), 'files tile');
  assert.ok(html.includes('sm:grid-cols-4'), 'operational grid drops to four-up now Total Spend moved into the trio');
  assert.ok(!html.includes('sm:grid-cols-5'), 'no collapsed or 6-up grid — two grids, not one');
});

test('trio parity: rendered weighted/new-tokens/dollars equal spendReceipt(rows) directly (row == modal guard, dollar axis)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript, rows }));
  assert.equal(receipt.costWeighted, 5_100_000, 'weighted total matches the fixture math');
  assert.equal(receipt.dollars, 15.3, 'dollar total matches the fixture math');
  assert.ok(html.includes('5.10M') && html.includes('$15.30') && html.includes('800.0K'), 'rendered figures equal the receipt built from the same rows');
});

test('unpriced model renders "price unavailable" in the Cost (USD) trio card, never $0', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript, rows: unpricedRows }));
  assert.ok(html.includes('price unavailable'), 'unknown-priced model renders unavailable');
  assert.ok(!html.includes('$0.00'), 'never a silent $0');
});

test('tools card lists chips by count and points to the Tools facet (FR-3, DD-5)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript, rows }));
  assert.ok(html.includes('Bash') && html.includes('×6'), 'tool chip with count');
  assert.ok(html.includes('Tools facet'), 'hint points to the Tools facet');
});

test('renders prompt (mono) and result (prose) panels (FR-4, FR-5, DD-3, NFR-1)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript, rows }));
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
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript: bare, rows: [] }));
  assert.ok(html.includes('No spawn prompt recorded.'), 'prompt empty state');
  assert.ok(html.includes('No result recorded.'), 'result empty state');
  assert.ok(html.includes('No tool calls.'), 'tools empty state');
  assert.ok(html.includes('—'), 'duration renders an em dash when undefined');
});

test('mounts the raw token breakdown under both grids, fed from the same receipt (FR-5, FR-6, AD-3)', () => {
  const html = renderToStaticMarkup(createElement(OverviewFacet, { transcript, rows }));
  for (const label of ['Input', 'Output', 'Cache read', 'Cache create']) {
    assert.ok(html.includes(label), `${label} cell present`);
  }
  assert.ok(html.includes('2.00M') && html.includes('400.0K'), 'agent-scoped raw counts via humanizeTokens');
  const facetSrc = fs.readFileSync(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'overview-facet.tsx'), 'utf8');
  assert.match(facetSrc, /spend=\{receipt\.costWeighted\}/, 'breakdown receives the same receipt spend as the trio');
  assert.match(facetSrc, /dollars=\{receipt\.dollars\}/, 'breakdown receives the same receipt dollars as the trio');
  const trioGrid = html.indexOf('sm:grid-cols-3'), opGrid = html.indexOf('sm:grid-cols-4'), breakdown = html.indexOf('Cache create');
  assert.ok(trioGrid !== -1 && opGrid !== -1 && breakdown !== -1 && trioGrid < opGrid && opGrid < breakdown, 'breakdown sits below both grids');
});
