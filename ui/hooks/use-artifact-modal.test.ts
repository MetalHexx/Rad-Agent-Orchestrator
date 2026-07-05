import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextIndex,
  prevIndex,
  indexAfterDelete,
  modalKeyAction,
  markdownPathForActive,
  fileNameAtOffset,
  fileNameAfterDelete,
  deleteTargetForActive,
  openNavMode,
  closeNavMode,
} from './use-artifact-modal';
import type { ModalDoc } from '@/lib/modal-doc-model';

const arts: ModalDoc[] = [
  { path: 'A.md', kind: 'markdown', title: 'Brainstorm', isMarkdown: true },
  { path: 'B.html', kind: 'visual', title: 'Brainstorm Visual', isMarkdown: false },
  { path: 'C.html', kind: 'wireframe', title: 'X', isMarkdown: false },
];

test('nextIndex advances and loops past the end (FR-14)', () => {
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
});

test('prevIndex retreats and loops past the start (FR-14)', () => {
  assert.equal(prevIndex(1, 3), 0);
  assert.equal(prevIndex(0, 3), 2);
});

test('indexAfterDelete keeps position when a middle item is removed (FR-19)', () => {
  // deleting index 1 of 3 → list length 2, stay at index 1 (now the old index 2)
  assert.equal(indexAfterDelete(1, 3), 1);
});

test('indexAfterDelete clamps when the last item in the list is removed (FR-19)', () => {
  // deleting index 2 of 3 → list length 2, clamp to index 1
  assert.equal(indexAfterDelete(2, 3), 1);
});

test('indexAfterDelete returns -1 when the only item is removed so the modal closes (FR-19)', () => {
  assert.equal(indexAfterDelete(0, 1), -1);
});

test('modalKeyAction returns prev for ArrowLeft (FR-14, FR-15)', () => {
  assert.equal(modalKeyAction('ArrowLeft'), 'prev');
});

test('modalKeyAction returns next for ArrowRight (FR-14, FR-15)', () => {
  assert.equal(modalKeyAction('ArrowRight'), 'next');
});

test('modalKeyAction returns close for Escape (FR-14, FR-15)', () => {
  assert.equal(modalKeyAction('Escape'), 'close');
});

test('modalKeyAction returns null for any other key (FR-14, FR-15)', () => {
  assert.equal(modalKeyAction('a'), null);
});

// ─── markdownPathForActive — now anchored to a filename, not an index ─────────

test('markdownPathForActive returns the md filename when the active artifact is markdown (FR-12, AD-8)', () => {
  assert.equal(markdownPathForActive(arts, 'A.md'), 'A.md');
});

test('markdownPathForActive returns null when the active artifact is html (AD-8)', () => {
  assert.equal(markdownPathForActive(arts, 'B.html'), null);
});

test('markdownPathForActive returns null when the filename is absent so the modal stays closed (FR-19)', () => {
  assert.equal(markdownPathForActive(arts, null), null);
  assert.equal(markdownPathForActive(arts, 'GONE.md'), null);
});

// ─── fileNameAtOffset — prev/next navigate by the active filename's position ──

test('fileNameAtOffset advances to the next filename and wraps past the end (FR-14)', () => {
  assert.equal(fileNameAtOffset(arts, 'A.md', 1), 'B.html');
  assert.equal(fileNameAtOffset(arts, 'C.html', 1), 'A.md');
});

test('fileNameAtOffset retreats to the previous filename and wraps past the start (FR-14)', () => {
  assert.equal(fileNameAtOffset(arts, 'B.html', -1), 'A.md');
  assert.equal(fileNameAtOffset(arts, 'A.md', -1), 'C.html');
});

test('fileNameAtOffset navigates from the active filename position after a reorder, not a stale index (regression)', () => {
  // The user is looking at B.html. The live list reorders underneath the modal.
  const reordered: ModalDoc[] = [arts[2], arts[0], arts[1]]; // C, A, B
  // Next from B (now last) wraps to C (now first) — the neighbour of the file
  // the user actually sees, NOT whatever sits at B's old index 1.
  assert.equal(fileNameAtOffset(reordered, 'B.html', 1), 'C.html');
  // Prev from B lands on A — again, relative to B's CURRENT position.
  assert.equal(fileNameAtOffset(reordered, 'B.html', -1), 'A.md');
});

test('fileNameAtOffset falls back to the first file when the active filename is gone (FR-19)', () => {
  assert.equal(fileNameAtOffset(arts, 'GONE.md', 1), 'A.md');
  assert.equal(fileNameAtOffset(arts, null, -1), 'A.md');
});

test('fileNameAtOffset returns null for an empty list', () => {
  assert.equal(fileNameAtOffset([], 'A.md', 1), null);
});

// ─── fileNameAfterDelete — clamp semantics in filename terms (FR-19) ──────────

test('fileNameAfterDelete keeps position when a middle file is removed', () => {
  // delete B (index 1) → remaining [A, C], clamp Math.min(1, 1) = 1 → C
  assert.equal(fileNameAfterDelete(arts, 'B.html'), 'C.html');
});

test('fileNameAfterDelete clamps to the new last file when the tail is removed', () => {
  // delete C (index 2) → remaining [A, B], clamp Math.min(2, 1) = 1 → B
  assert.equal(fileNameAfterDelete(arts, 'C.html'), 'B.html');
});

test('fileNameAfterDelete returns null when the only file is removed so the modal closes', () => {
  assert.equal(fileNameAfterDelete([arts[0]], 'A.md'), null);
});

test('fileNameAfterDelete returns null when the active filename is absent', () => {
  assert.equal(fileNameAfterDelete(arts, 'GONE.md'), null);
});

// ─── deleteTargetForActive — resolves against the unified doc list, not a root-only one (FR-19) ──

test('deleteTargetForActive resolves a root doc by its bare filename', () => {
  assert.deepEqual(deleteTargetForActive(arts, 'A.md'), { fileName: 'A.md' });
});

test('deleteTargetForActive resolves a subfolder doc by its full path (regression: must not depend on a root-only list)', () => {
  const withSubfolder: ModalDoc[] = [
    ...arts,
    { path: 'phases/PHASE-2-PLAN.md', kind: 'markdown', title: 'Phase 2 Plan', isMarkdown: true, category: 'phase' },
  ];
  assert.deepEqual(
    deleteTargetForActive(withSubfolder, 'phases/PHASE-2-PLAN.md'),
    { fileName: 'phases/PHASE-2-PLAN.md' },
  );
});

test('deleteTargetForActive returns null when the active path is absent from the list', () => {
  assert.equal(deleteTargetForActive(arts, 'GONE.md'), null);
  assert.equal(deleteTargetForActive(arts, 'phases/PHASE-2-PLAN.md'), null);
});

test('deleteTargetForActive returns null when there is no active path', () => {
  assert.equal(deleteTargetForActive(arts, null), null);
});

test('openNavMode pushes when opening from closed and replaces when switching', () => {
  assert.equal(openNavMode(false), 'push');
  assert.equal(openNavMode(true), 'replace');
});

test('closeNavMode goes back when the open pushed an entry, else replaces to the project route', () => {
  assert.equal(closeNavMode(true), 'back');
  assert.equal(closeNavMode(false), 'replace');
});
