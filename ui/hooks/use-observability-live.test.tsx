import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const hookSource = fs.readFileSync(path.join(__dirname, 'use-observability-live.tsx'), 'utf8');

test('hook fetches the selected range and drops the Earlier plumbing (FR-4, AD-2)', () => {
  assert.ok(!hookSource.includes('canLoadEarlier') && !hookSource.includes('previousUtcDay'),
    'the one-day-at-a-time Earlier plumbing is removed');
  assert.match(hookSource, /rangeUtcDates|startDate=/, 'fetches the selected range via the range endpoint');
});

test('hook keeps the live SSE subscription and reconnect self-heal (NFR-3, AD-2)', () => {
  assert.ok(hookSource.includes('subscribe') && hookSource.includes('telemetry_rows'), 'SSE subscription preserved');
  assert.ok(hookSource.includes('upsertRows'), 'rows merged by upsert (self-heal on reconnect)');
});
