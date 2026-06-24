import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toFilesTouched } from './files-touched';

const call = (seq: number, name: string, fp: string, useId: string) =>
  ({ seq, timestamp: '', kind: 'tool_call', tool: { name, input: { text: `${name} ${fp}` }, toolUseId: useId } }) as never;
const result = (seq: number, useId: string, output: string, isError: boolean) =>
  ({ seq, timestamp: '', kind: 'tool_result', result: { toolUseId: useId, output: { text: output }, isError } }) as never;
const fileChange = (seq: number, path: string, op: 'edit' | 'write' | 'snapshot') =>
  ({ seq, timestamp: '', kind: 'file_change', file: { path, op } }) as never;

test('groups file_change by path, deduped in first-seen order (FR-1, NFR-6)', () => {
  const events = [
    call(1, 'Write', 'a.ts', 'u1'), result(2, 'u1', 'ok', false), fileChange(3, 'a.ts', 'write'),
    call(4, 'Edit', 'b.ts', 'u2'), result(5, 'u2', 'ok', false), fileChange(6, 'b.ts', 'edit'),
    call(7, 'Edit', 'a.ts', 'u3'), result(8, 'u3', 'ok', false), fileChange(9, 'a.ts', 'edit'),
  ];
  assert.deepEqual(toFilesTouched(events).map((f) => f.path), ['a.ts', 'b.ts']);
});

test('a path touched by both write and edit carries both ops and N changes (FR-2)', () => {
  const events = [
    call(1, 'Write', 'a.ts', 'u1'), result(2, 'u1', 'ok', false), fileChange(3, 'a.ts', 'write'),
    call(4, 'Edit', 'a.ts', 'u2'), result(5, 'u2', 'ok', false), fileChange(6, 'a.ts', 'edit'),
  ];
  const [a] = toFilesTouched(events);
  assert.deepEqual(a.ops, ['write', 'edit']);
  assert.equal(a.changes.length, 2);
});

test('each change pairs to its owning call+result by adjacency and toolUseId (AD-2)', () => {
  const events = [call(1, 'Edit', 'a.ts', 'u1'), result(2, 'u1', 'patched', false), fileChange(3, 'a.ts', 'edit')];
  const [a] = toFilesTouched(events);
  assert.equal(a.changes[0].callEvent?.seq, 1);
  assert.equal(a.changes[0].resultEvent?.seq, 2);
});

test('a change whose call has no result yet keeps callEvent, no resultEvent (AD-2)', () => {
  const events = [call(1, 'Write', 'a.ts', 'u1'), fileChange(2, 'a.ts', 'write')];
  const [a] = toFilesTouched(events);
  assert.equal(a.changes[0].callEvent?.seq, 1);
  assert.equal(a.changes[0].resultEvent, undefined);
});

test('a snapshot op is carried through defensively, not dropped (AD-6)', () => {
  const [a] = toFilesTouched([fileChange(1, 'a.ts', 'snapshot')] as never);
  assert.deepEqual(a.ops, ['snapshot']);
});
