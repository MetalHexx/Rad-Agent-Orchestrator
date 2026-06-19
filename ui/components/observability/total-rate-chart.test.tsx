import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(path.join(process.cwd(), 'components', 'observability', 'total-rate-chart.tsx'), 'utf-8');
const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));

test('recharts is a declared dependency (AD-7)', () => {
  assert.ok(pkg.dependencies?.recharts, 'recharts must be in package.json dependencies');
});

test('chart is a single-series area chart titled "Total Rate" with no legend/subtitle/gridlines (DD-3)', () => {
  assert.ok(src.includes('Total Rate'), 'card title present');
  assert.ok(src.includes('AreaChart') && src.includes('<Area'), 'uses a recharts AreaChart/Area');
  assert.ok(src.includes('var(--chart-2)') || src.includes('--chart-2'), 'series stroked from the --chart-2 token (NFR-2)');
  assert.ok(!src.includes('Legend'), 'no legend (single series)');
  assert.ok(!src.includes('CartesianGrid'), 'no gridlines');
});

test('animates first render only — disabled on live updates (NFR-1)', () => {
  assert.ok(src.includes('isAnimationActive'), 'animation is explicitly controlled to avoid jitter on pushes');
});

test('renders a real time X axis and a stable Y domain (DD-4, DD-5)', () => {
  assert.ok(src.includes('XAxis') && src.includes('type="number"') && src.includes('dataKey="t"'), 'numeric time X axis bound to t');
  assert.ok(!src.includes('"dataMax"'), 'y-domain no longer autoscales to dataMax');
  assert.ok(src.includes('niceMax'), 'y-domain uses the stable niceMax');
});
test('gradient is strengthened and gridlines stay off (DD-6)', () => {
  assert.match(src, /stopOpacity=\{0\.8[0-9]?\}|stopOpacity=\{0\.9\}/, 'top gradient stop is strong (>= 0.8)');
  assert.ok(!src.includes('CartesianGrid'), 'still no gridlines');
});

test('axes show a fixed, small number of labels — X is not the d3-time bloat (NFR-4)', () => {
  assert.ok(src.includes('ticks={xTicks}') && src.includes('interval={0}'), 'X axis renders an explicit fixed tick set, not auto time ticks');
  assert.ok(!src.includes('tickCount={5}'), 'the ignored tickCount hint is gone');
});

test('Y axis humanizes token counts so labels are meaningful, not the clipped "00000" bug', () => {
  assert.ok(src.includes('tickFormatter={humanizeTokens}'), 'Y axis formats ticks via humanizeTokens (250K / 1.2M)');
  assert.ok(src.includes('humanizeTokens'), 'imports the shared humanizer');
});
