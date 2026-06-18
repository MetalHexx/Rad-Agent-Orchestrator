import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tailCompleteLines } from '../lib/live/telemetry-tail';

function tmpFile(): string { return join(mkdtempSync(join(tmpdir(), 'tail-')), 'p.ndjson'); }

test('seed offset 0 reads the whole file including the first line (FR-12)', () => {
  const f = tmpFile();
  writeFileSync(f, '{"usageId":"u1"}\n{"usageId":"u2"}\n');
  const r = tailCompleteLines(f, 0);
  assert.deepEqual(r.lines, ['{"usageId":"u1"}', '{"usageId":"u2"}']);
  assert.equal(r.offset, statSync(f).size);
});

test('seed at EOF reads nothing, so a restart never re-emits (FR-12)', () => {
  const f = tmpFile();
  writeFileSync(f, '{"usageId":"u1"}\n');
  assert.deepEqual(tailCompleteLines(f, statSync(f).size).lines, []);
});

test('buffers a trailing partial line until its newline arrives (AD-6)', () => {
  const f = tmpFile();
  writeFileSync(f, '{"usageId":"u1"}\n{"partial":');
  const first = tailCompleteLines(f, 0);
  assert.deepEqual(first.lines, ['{"usageId":"u1"}']);
  appendFileSync(f, '"u2"}\n');
  const second = tailCompleteLines(f, first.offset);
  assert.deepEqual(second.lines, ['{"partial":"u2"}']);
});
