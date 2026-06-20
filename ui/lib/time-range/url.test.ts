// ui/lib/time-range/url.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRange, decodeRange } from './url';
import type { TimeRange } from './range';

const cases: TimeRange[] = [
  { kind: 'relative', preset: '24h' },
  { kind: 'since', startMs: 1_718_745_430_000 },
  { kind: 'absolute', startMs: 1_718_745_430_000, endMs: 1_718_759_964_000 },
];

test('every kind round-trips through the codec (FR-12, AD-8)', () => {
  for (const r of cases) assert.deepEqual(decodeRange(encodeRange(r)), r);
});

test('encoded forms are the agreed shapes (AD-8)', () => {
  assert.equal(encodeRange(cases[0]), 'rel:24h');
  assert.equal(encodeRange(cases[1]), 'since:1718745430000');
  assert.equal(encodeRange(cases[2]), 'abs:1718745430000-1718759964000');
});

test('malformed or missing input decodes to null (AD-8)', () => {
  assert.equal(decodeRange(null), null);
  assert.equal(decodeRange('rel:99x'), null);
  assert.equal(decodeRange('abs:notanumber'), null);
});
