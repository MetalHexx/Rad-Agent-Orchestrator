import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { useTimeRangeWindow } from './use-time-range-window';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'use-time-range-window.ts'), 'utf8');

test('useTimeRangeWindow is exported as a function (AD-6)', () => {
  assert.equal(typeof useTimeRangeWindow, 'function');
});

test('constructs a TimeWindow from range + effectiveTick + floorMs (AD-6, FR-11)', () => {
  assert.match(src, /new TimeWindow\(range,\s*effectiveTick,\s*floorMs\)/,
    'window is built from range, effectiveTick, floorMs');
});

test('manual refresh advances manualTick to now (FR-2, FR-11)', () => {
  assert.match(src, /setManualTick\(Date\.now\(\)\)/, 'refreshNow advances the now-relative window');
});
