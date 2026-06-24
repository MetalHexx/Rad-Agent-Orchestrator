import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToolBreakdown } from './tool-breakdown';
Object.assign(globalThis, { React });

const render = (summary: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ToolBreakdown, { summary } as never));

test('renders one bar per tool, sorted by descending count, meter scaled to the max (FR-2, DD-4, AD-7)', () => {
  const html = render({ total: 10, byName: { Read: 8, Glob: 2 }, errors: 0 });
  assert.ok(html.includes('Calls by tool'), 'card title');
  assert.ok(html.indexOf('Read') < html.indexOf('Glob'), 'sorted by descending count');
  assert.ok(html.includes('×8') && html.includes('×2'), 'counts shown');
  assert.ok(html.includes('width:100%'), 'busiest tool fills the meter');
  assert.ok(html.includes('width:25%'), 'others scale to the max (2/8)');
  assert.ok(html.includes('var(--chart-2)'), 'flat chart-2 meter fill (DD-4)');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), 'no literal hex (NFR-3)');
});

test('foot totals calls + tools and shows a destructive errors chip only when errors > 0 (FR-3, DD-5)', () => {
  const withErr = render({ total: 10, byName: { Read: 8, Glob: 2 }, errors: 3 });
  assert.ok(withErr.includes('total 10 calls · 2 tools'), 'foot summary');
  assert.ok(/3 errors/.test(withErr) && withErr.includes('text-destructive'), 'destructive errors chip');
  const clean = render({ total: 5, byName: { Read: 5 }, errors: 0 });
  assert.ok(/0 errors/.test(clean) && !clean.includes('text-destructive'), 'calm chip on a clean run');
});

test('an empty summary renders a no-calls message, never a blank card (FR-2)', () => {
  assert.ok(/no tool calls/i.test(render({ total: 0, byName: {}, errors: 0 })));
});
