import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { deriveRingArc, derivePhaseNumber, phaseReviewView } from './phase-review-view';
import type { IterationEntry } from '@/types/state';

const dir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(dir, 'phase-review-view.tsx'), 'utf-8');

function makeIteration(overrides: Partial<IterationEntry> = {}): IterationEntry {
  return {
    index: 1,
    status: 'in_progress',
    doc_path: 'phases/PHASE-02.md',
    corrective_tasks: [],
    repos: [],
    nodes: {},
    ...overrides,
  };
}

// ─── derivePhaseNumber ────────────────────────────────────────────────────────

test('derivePhaseNumber is 1-based from the enclosing phase iteration index', () => {
  assert.equal(derivePhaseNumber(makeIteration({ index: 1 })), 2);
});

test('derivePhaseNumber is null when no iteration resolved', () => {
  assert.equal(derivePhaseNumber(undefined), null);
});

// ─── deriveRingArc ────────────────────────────────────────────────────────────

test('deriveRingArc passes through a valid phase progress', () => {
  assert.deepEqual(deriveRingArc({ completed: 1, total: 4 }), { value: 1, max: 4 });
});

test('deriveRingArc falls back to {0, 1} when phase progress is null', () => {
  assert.deepEqual(deriveRingArc(null), { value: 0, max: 1 });
});

test('deriveRingArc falls back to {0, 1} when total is zero (avoids a degenerate arc domain)', () => {
  assert.deepEqual(deriveRingArc({ completed: 0, total: 0 }), { value: 0, max: 1 });
});

// ─── source shape ─────────────────────────────────────────────────────────────

test('phase review view id is "phase-review"', () => {
  assert.equal(phaseReviewView.id, 'phase-review');
});

test('phase review view renders a determinate ring tinted to the purple review tier', () => {
  assert.match(source, /mode="determinate"/);
  assert.match(source, /--tier-review/);
});

test('phase review view renders the Report doc link', () => {
  assert.match(source, /label="Report"/);
});

test('phase review view renders no commit chip', () => {
  assert.ok(!source.includes('CommitChips'));
});

test('phase review view sets no slot geometry — the shared slot wrappers own layout', () => {
  assert.ok(!/gridArea|gridTemplate|grid-template/.test(source));
  assert.ok(!source.includes('RING_DIAMETER'));
});
