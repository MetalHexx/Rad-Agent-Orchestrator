import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useSpendRateChart } from './use-spend-rate-chart';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'use-spend-rate-chart.ts'), 'utf8');

test('useSpendRateChart is exported as a function (AD-6)', () => {
  assert.equal(typeof useSpendRateChart, 'function');
});

test('memoizes the builder on [rows, window] (AD-6, FR-11)', () => {
  assert.match(src, /useMemo\(\s*\(\)\s*=>\s*buildSpendRateChart\(rows,\s*window\),\s*\[rows,\s*window\]\s*\)/,
    'chart memo dependency array must be [rows, window]');
});
