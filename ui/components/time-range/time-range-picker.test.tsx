// ui/components/time-range/time-range-picker.test.tsx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TimeRangePicker } from './time-range-picker';
import type { TimeRange } from '@/lib/time-range/range';
(globalThis as unknown as { React: typeof React }).React = React;

test('renders the current range as the trigger label (FR-1, DD-1)', () => {
  const value: TimeRange = { kind: 'relative', preset: '6h' };
  const html = renderToStaticMarkup(
    createElement(TimeRangePicker, { value, onChange: () => {}, min: 0, scopeLabel: 'All sessions' })
  );
  assert.ok(html.includes('Last 6 hours'), 'trigger shows the active range label');
});

test('the public prop type is decoupled from observability (FR-15, AD-4)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, 'time-range-picker.tsx'), 'utf8');
  assert.doesNotMatch(src, /observability|sessions/i, 'picker carries no observability/session imports');
});
