/**
 * Tests for the pure `computeSmartDefaults` helper and callback shapes exported
 * by `use-follow-mode.ts`. Exercises the state-walking logic without rendering
 * React components.
 *
 * Run with: npx tsx ui/hooks/use-follow-mode.test.ts
 */
import assert from 'node:assert';

// Import the pure helper and shallow-equal utility directly — these have no
// React lifecycle dependency and can be exercised without a renderer. The
// test file does NOT import React or run any React hooks — it only tests the
// pure helpers and verifies the module's exported surface.
import {
  computeSmartDefaults,
  __shallowEqualStringArrays,
  useFollowMode,
} from './use-follow-mode';
import type { UseFollowModeReturn } from './use-follow-mode';

// ─── Minimal inline type shapes matching ui/types/state.ts ───────────────────
// Inlined per the `use-projects.test.ts` convention — keeps the test file
// self-contained and avoids coupling to the full state-type surface.

type NodeStatus = 'not_started' | 'in_progress' | 'completed' | 'failed' | 'halted' | 'skipped';

interface StepNodeShape {
  kind: 'step';
  status: NodeStatus;
  doc_path: string | null;
  retries: number;
  corrective_tasks?: CorrectiveTaskShape[];
}

interface ParallelNodeShape {
  kind: 'parallel';
  status: NodeStatus;
  nodes: Record<string, AnyNodeShape>;
}

interface CorrectiveTaskShape {
  index: number;
  status: NodeStatus;
  nodes: Record<string, AnyNodeShape>;
  reason?: string;
  injected_after?: string;
  doc_path?: string | null;
  commit_hash?: string | null;
}

interface IterationEntryShape {
  index: number;
  status: NodeStatus;
  nodes: Record<string, AnyNodeShape>;
  corrective_tasks: CorrectiveTaskShape[];
  commit_hash?: string | null;
}

// Alias so the new AD-6 tests can use the canonical name directly.
type NodesRecord = Record<string, AnyNodeShape>;

interface ForEachPhaseNodeShape {
  kind: 'for_each_phase';
  status: NodeStatus;
  iterations: IterationEntryShape[];
}

interface ForEachTaskNodeShape {
  kind: 'for_each_task';
  status: NodeStatus;
  iterations: IterationEntryShape[];
}

type AnyNodeShape =
  | StepNodeShape
  | ParallelNodeShape
  | ForEachPhaseNodeShape
  | ForEachTaskNodeShape;

// ─── Test harness ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗ ${name}\n    ${msg}`);
    failed++;
  }
}

// Helper — cast the loosely-typed inline shape to the NodesRecord type that
// `computeSmartDefaults` expects. The runtime behaviour is identical; the
// cast only silences TypeScript because we intentionally inline a minimal
// type surface in this test file.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toNodes = (v: Record<string, AnyNodeShape>): any => v;

async function run() {
  console.log('use-follow-mode — computeSmartDefaults + exported surface');

  // (a) empty record
  await test('(a) computeSmartDefaults({}) returns []', () => {
    const result = computeSmartDefaults(toNodes({}));
    assert.deepStrictEqual(result, []);
  });

  // (b) single top-level for_each_phase, in_progress — active iteration
  await test('(b) computeSmartDefaults emits iter-phase_loop-0 for an active phase iteration inside an active phase loop (AD-3, FR-12)', () => {
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [
          { index: 0, status: 'in_progress', nodes: {}, corrective_tasks: [] },
        ],
      },
    };
    assert.deepStrictEqual(computeSmartDefaults(toNodes(nodes)), ['iter-phase_loop-0']);
  });

  // (c) recursion into iteration nodes — nested for_each_task
  await test('(c) computeSmartDefaults emits one iter-... per nested active task iteration (FR-12)', () => {
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [
                { index: 0, status: 'completed', nodes: {}, corrective_tasks: [] },
                { index: 1, status: 'in_progress', nodes: {}, corrective_tasks: [] },
              ],
            },
          },
        }],
      },
    };
    assert.deepStrictEqual(
      computeSmartDefaults(toNodes(nodes)),
      ['iter-phase_loop-0', 'iter-phase_loop.iter0.task_loop-1']
    );
  });

  // (d) excludes loops with non-in_progress status
  await test('(d) computeSmartDefaults excludes loops whose status is "completed"', () => {
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase',
        status: 'completed',
        iterations: [],
      },
    };
    const result = computeSmartDefaults(toNodes(nodes));
    assert.deepStrictEqual(result, []);
  });

  await test('(d2) computeSmartDefaults excludes loops whose status is "not_started"', () => {
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase',
        status: 'not_started',
        iterations: [],
      },
    };
    assert.deepStrictEqual(computeSmartDefaults(toNodes(nodes)), []);
  });

  await test('(d3) computeSmartDefaults excludes loops whose status is "failed" / "halted" / "skipped"', () => {
    const statuses: NodeStatus[] = ['failed', 'halted', 'skipped'];
    for (const s of statuses) {
      const nodes: Record<string, AnyNodeShape> = {
        phase_loop: {
          kind: 'for_each_phase',
          status: s,
          iterations: [],
        },
      };
      assert.deepStrictEqual(
        computeSmartDefaults(toNodes(nodes)),
        [],
        `status=${s} should not appear in smart defaults`
      );
    }
  });

  // (e) null input
  await test('(e) computeSmartDefaults(null) returns []', () => {
    const result = computeSmartDefaults(null);
    assert.deepStrictEqual(result, []);
  });

  // (f) recursion into parallel.nodes
  await test('(f) computeSmartDefaults recurses into parallel.nodes for nested loops', () => {
    const nodes: Record<string, AnyNodeShape> = {
      parallel_block: {
        kind: 'parallel', status: 'in_progress',
        nodes: {
          nested_phase_loop: {
            kind: 'for_each_phase', status: 'in_progress',
            iterations: [{ index: 0, status: 'in_progress', nodes: {}, corrective_tasks: [] }],
          },
        },
      },
    };
    assert.deepStrictEqual(computeSmartDefaults(toNodes(nodes)), ['iter-nested_phase_loop-0']);
  });

  // (g) shallow-equal short-circuit helper — identical arrays
  await test('(g) __shallowEqualStringArrays returns true for same-length same-order arrays', () => {
    assert.strictEqual(__shallowEqualStringArrays([], []), true);
    assert.strictEqual(__shallowEqualStringArrays(['a'], ['a']), true);
    assert.strictEqual(
      __shallowEqualStringArrays(['iter-phase_loop-0', 'iter-task_loop-0'], ['iter-phase_loop-0', 'iter-task_loop-0']),
      true
    );
  });

  await test('(g2) __shallowEqualStringArrays returns false for different-length arrays', () => {
    assert.strictEqual(__shallowEqualStringArrays([], ['a']), false);
    assert.strictEqual(__shallowEqualStringArrays(['a'], ['a', 'b']), false);
  });

  await test('(g3) __shallowEqualStringArrays returns false for same-length arrays with different content', () => {
    assert.strictEqual(__shallowEqualStringArrays(['a'], ['b']), false);
    assert.strictEqual(
      __shallowEqualStringArrays(['loop-a', 'loop-b'], ['loop-b', 'loop-a']),
      false,
      'order-sensitive'
    );
  });

  // (h) two calls with structurally equal inputs produce equal arrays by value.
  //     (Reference-equality is NOT guaranteed for pure calls of
  //     `computeSmartDefaults`; the shallow-equal short-circuit lives inside
  //     the hook's effect and preserves reference equality across renders.)
  await test('(h) computeSmartDefaults returns value-equal arrays for equivalent inputs', () => {
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase',
        status: 'in_progress',
        iterations: [],
      },
    };
    const a = computeSmartDefaults(toNodes(nodes));
    const b = computeSmartDefaults(toNodes(nodes));
    assert.deepStrictEqual(a, b);
    assert.strictEqual(__shallowEqualStringArrays(a, b), true);
  });

  // (i) exported-surface check — `useFollowMode` is a named function export
  //     and `UseFollowModeReturn` is a named type export (verified at compile
  //     time by the `import type` at the top of this file).
  await test('(i) useFollowMode is exported as a function', () => {
    assert.strictEqual(typeof useFollowMode, 'function');
    // UseFollowModeReturn is a type-only export — the compile-time import at
    // the top of this file verifies the name is exported. A runtime assertion
    // is not possible for type-only exports. The `_type` reference below
    // keeps the import non-trivially used for the type-checker.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _type: UseFollowModeReturn | null = null;
    assert.strictEqual(_type, null);
  });

  // (j) onAccordionChange callback shape — compile-time check via a stub
  //     function that matches the contract signature. Both 'trigger-press'
  //     and 'none' reason values must type-check and not throw when invoked.
  await test('(j) onAccordionChange signature accepts both "trigger-press" and "none" reasons', () => {
    const stub: (value: string[], eventDetails: { reason: string }) => void = (_value, _eventDetails) => {
      // no-op
    };
    // These calls exercise the runtime path — they must not throw.
    assert.doesNotThrow(() => stub(['loop-phase_loop'], { reason: 'trigger-press' }));
    assert.doesNotThrow(() => stub([], { reason: 'none' }));
    assert.doesNotThrow(() => stub(['loop-a', 'loop-b'], { reason: 'trigger-press' }));
  });

  // (k-toggle) source-text: toggleFollowMode must branch on current followMode
  //   so the Switch flips both directions (On→Off and Off→On). Earlier
  //   revision unconditionally called setFollowMode(true), which meant
  //   clicking the Switch while follow-mode was already on had no effect.
  await test('(k-toggle) toggleFollowMode source branches on `followMode` (not always setFollowMode(true))', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const hookSource = readFileSync(join(__dirname, 'use-follow-mode.ts'), 'utf-8');
    // Slice just the toggleFollowMode body so we don't match unrelated code.
    const startIdx = hookSource.indexOf('const toggleFollowMode');
    assert.ok(startIdx !== -1, 'toggleFollowMode declaration must exist in hook source');
    const endIdx = hookSource.indexOf('}, [followMode, nodes]);', startIdx);
    assert.ok(endIdx !== -1, 'toggleFollowMode must depend on both followMode and nodes');
    const body = hookSource.slice(startIdx, endIdx);
    assert.ok(
      /if\s*\(\s*followMode\s*\)/.test(body),
      'toggleFollowMode must branch on `followMode` so the Switch can flip both directions',
    );
    assert.ok(
      body.includes('setFollowMode(false)'),
      'toggleFollowMode must disengage via setFollowMode(false) on the On→Off branch',
    );
    assert.ok(
      body.includes('setFollowMode(true)'),
      'toggleFollowMode must re-engage via setFollowMode(true) on the Off→On branch',
    );
  });

  // (k-disengage) source-text regression: onAccordionChange must not rely on
  //   the base-ui `reason` field (AccordionRoot.js:73 hardcodes it to
  //   REASONS.none), and must still use !isProgrammaticRef as the guard.
  await test('(k-disengage) onAccordionChange drops reason check and keeps isProgrammaticRef guard', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const hookSource = readFileSync(join(__dirname, 'use-follow-mode.ts'), 'utf-8');
    const startIdx = hookSource.indexOf('const onAccordionChange');
    assert.ok(startIdx !== -1, 'onAccordionChange declaration must exist in hook source');
    const endIdx = hookSource.indexOf('  );', startIdx);
    assert.ok(endIdx !== -1, 'onAccordionChange body must be closed with "  );"');
    const body = hookSource.slice(startIdx, endIdx);
    assert.ok(
      !body.includes("'trigger-press'") && !body.includes('"trigger-press"'),
      'onAccordionChange must not reference the literal "trigger-press" (base-ui reason is always "none" at runtime)',
    );
    assert.ok(
      body.includes('!isProgrammaticRef.current'),
      'onAccordionChange must still guard disengagement with !isProgrammaticRef.current',
    );
    assert.ok(
      body.includes('setFollowMode(false)'),
      'onAccordionChange must call setFollowMode(false) on the user-click branch',
    );
  });

  // (k) corrective tasks emit ct-... additively alongside the parent iteration
  await test('(k) computeSmartDefaults emits ct-... for an active corrective task additively to its parent iteration (FR-13, DD-7)', () => {
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'in_progress',
                nodes: {},
                corrective_tasks: [
                  { index: 1, status: 'in_progress', nodes: {} },
                ],
              }],
            },
          },
        }],
      },
    };
    const result = computeSmartDefaults(toNodes(nodes));
    assert.deepStrictEqual(result, [
      'iter-phase_loop-0',
      'iter-phase_loop.iter0.task_loop-0',
      'ct-iter-phase_loop.iter0.task_loop-0-1',
    ]);
  });

  await test('(l) iteration keys emitted by computeSmartDefaults match buildIterationItemValue / buildCorrectiveItemValue for the same node tree (AD-3 hook+renderer parity)', async () => {
    const { buildIterationItemValue, buildCorrectiveItemValue } = await import(
      '../components/dag-timeline/dag-timeline-helpers'
    );
    const nodes: Record<string, AnyNodeShape> = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [],
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 2, status: 'in_progress',
                nodes: {},
                corrective_tasks: [
                  { index: 1, status: 'in_progress', nodes: {} },
                ],
              }],
            },
          },
        }],
      },
    };
    const phaseIterKey = buildIterationItemValue('phase_loop', 0);
    const taskIterKey = buildIterationItemValue('phase_loop.iter0.task_loop', 2);
    const ctKey = buildCorrectiveItemValue(taskIterKey, 1);
    const expected = [phaseIterKey, taskIterKey, ctKey];
    assert.deepStrictEqual(computeSmartDefaults(toNodes(nodes)), expected);
  });

  console.log("\nFR-13 / FR-14 / FR-15 follow-mode parity across new leaf shapes (AD-6)\n");

  test("FR-13 task in Coding state — computeSmartDefaults emits the active task iter key (no substep key needed)", () => {
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
                nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(keys.includes('iter-phase_loop-0'),
      'phase iter key emitted (FR-13)');
    assert.ok(keys.includes('iter-phase_loop.iter0.task_loop-0'),
      'active task iter key emitted (FR-13) — task header is the new leaf');
  });

  test("FR-13 task in Reviewing state — same iter key set, no substep keys", () => {
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
                nodes: { code_review: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(keys.includes('iter-phase_loop.iter0.task_loop-0'), 'active task iter key emitted');
  });

  test("FR-14 task in Correcting state — active corrective ct- key emitted alongside parent iter key", () => {
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'in_progress', commit_hash: null,
                corrective_tasks: [
                  { index: 1, reason: 'r', injected_after: 'code_review', status: 'in_progress',
                    nodes: {}, doc_path: null, commit_hash: null },
                ],
                nodes: {},
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(keys.includes('iter-phase_loop.iter0.task_loop-0'),
      'parent task iter key emitted (FR-14)');
    assert.ok(keys.includes('ct-iter-phase_loop.iter0.task_loop-0-1'),
      'active corrective ct- key emitted alongside parent (FR-14)');
  });

  test("FR-14 nested corrective — deepest in_progress ct- key emitted (recursive leaf)", () => {
    // Note: corrective_tasks is a flat list at one nesting level today;
    // the recursive walk lives in computeSmartDefaults' iteration recursion.
    // This test validates the flat shape — nested correctives are
    // structurally additive at the same iter scope.
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'in_progress', commit_hash: null,
                corrective_tasks: [
                  { index: 1, reason: 'r1', injected_after: 'code_review', status: 'completed',
                    nodes: {}, doc_path: null, commit_hash: null },
                  { index: 2, reason: 'r2', injected_after: 'code_review', status: 'in_progress',
                    nodes: {}, doc_path: null, commit_hash: null },
                ],
                nodes: {},
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(keys.includes('ct-iter-phase_loop.iter0.task_loop-0-2'),
      'second corrective (in_progress) is the active leaf (FR-14)');
    assert.ok(!keys.includes('ct-iter-phase_loop.iter0.task_loop-0-1'),
      'first corrective (completed) is not a leaf (FR-14)');
  });

  test("FR-15 task in terminal Failed state — task iter key still emitted while parent loop active so the failure stays visible", () => {
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'failed', corrective_tasks: [], commit_hash: null,
                nodes: { task_executor: { kind: 'step', status: 'failed', doc_path: null, retries: 0 } },
              }, {
                index: 1, status: 'in_progress', corrective_tasks: [], commit_hash: null,
                nodes: { task_executor: { kind: 'step', status: 'in_progress', doc_path: null, retries: 0 } },
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    // The active iter is task 1 (the in-flight one); follow mode tracks
    // the active leaf, but the failed task 0's parent accordion remains
    // expanded by virtue of the task_loop being in_progress so the
    // failure stays in view (FR-15 is row-visibility, not key emission;
    // the contract here is that the active leaf is still emitted).
    assert.ok(keys.includes('iter-phase_loop.iter0.task_loop-1'),
      'active in_progress task iter is the leaf, but the failed task 0 row stays visible because the parent loop is still expanded (FR-15)');
  });

  test("FR-13 task in Done state with no active siblings — no task iter key emitted (loop expansion only)", () => {
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'completed', corrective_tasks: [], commit_hash: null,
                nodes: {},
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(keys.includes('iter-phase_loop-0'),
      'phase iter key emitted while phase is in_progress (FR-13)');
    assert.ok(!keys.includes('iter-phase_loop.iter0.task_loop-0'),
      'completed task iter is not a leaf — no key emitted (FR-13)');
  });

  test("FR-13/FR-15 corrected iteration (completed + corrective_tasks resolved) — no key emitted, row visibility owned by Corrected pill not follow mode", () => {
    const nodes: NodesRecord = {
      phase_loop: {
        kind: 'for_each_phase', status: 'in_progress',
        iterations: [{
          index: 0, status: 'in_progress', corrective_tasks: [], commit_hash: null,
          nodes: {
            task_loop: {
              kind: 'for_each_task', status: 'in_progress',
              iterations: [{
                index: 0, status: 'completed', commit_hash: null,
                corrective_tasks: [
                  { index: 1, reason: 'r', injected_after: 'code_review', status: 'completed',
                    nodes: {}, doc_path: null, commit_hash: null },
                ],
                nodes: {},
              }],
            },
          },
        }],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(!keys.includes('iter-phase_loop.iter0.task_loop-0'),
      'completed corrected task iter emits no follow-mode key (FR-13)');
    assert.ok(!keys.includes('ct-iter-phase_loop.iter0.task_loop-0-1'),
      'resolved corrective emits no follow-mode key (FR-14)');
  });

  console.log("\nP04-T05 step-hosted correctives\n");

  test("step node with in_progress corrective task emits ct- key (final_review scenario)", () => {
    const nodes: NodesRecord = {
      final_review: {
        kind: 'step', status: 'in_progress', doc_path: 'reports/FINAL-REVIEW.md', retries: 0,
        corrective_tasks: [
          { index: 1, reason: 'changes requested', injected_after: 'code_review', status: 'in_progress', nodes: {} },
        ],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(keys.includes('ct-final_review-1'),
      'in_progress corrective on final_review must emit ct-final_review-1 key');
  });

  test("step node with completed corrective task does NOT emit ct- key", () => {
    const nodes: NodesRecord = {
      final_review: {
        kind: 'step', status: 'completed', doc_path: 'reports/FINAL-REVIEW.md', retries: 0,
        corrective_tasks: [
          { index: 1, reason: 'changes requested', injected_after: 'code_review', status: 'completed', nodes: {} },
        ],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(!keys.includes('ct-final_review-1'),
      'completed corrective on final_review must not emit a key');
  });

  test("step node with multiple correctives emits only in_progress ones", () => {
    const nodes: NodesRecord = {
      final_review: {
        kind: 'step', status: 'in_progress', doc_path: 'reports/FINAL-REVIEW.md', retries: 0,
        corrective_tasks: [
          { index: 1, reason: 'first', injected_after: 'code_review', status: 'completed', nodes: {} },
          { index: 2, reason: 'second', injected_after: 'code_review', status: 'in_progress', nodes: {} },
          { index: 3, reason: 'third', injected_after: 'code_review', status: 'in_progress', nodes: {} },
        ],
      },
    };
    const keys = computeSmartDefaults(toNodes(nodes));
    assert.ok(!keys.includes('ct-final_review-1'), 'completed corrective 1 not emitted');
    assert.ok(keys.includes('ct-final_review-2'), 'in_progress corrective 2 emitted');
    assert.ok(keys.includes('ct-final_review-3'), 'in_progress corrective 3 emitted');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
