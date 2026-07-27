// Extended property suite: across long, randomized mutation sequences — add/remove/move/
// reorder/expand/reset/toggle/resume, interleaved with direct status advances and direct
// `budgetAnchor` stamps (the same raw-`store.apply` seeding idiom every other test file's own
// `seed()` helper already uses) — `depends_on` stays acyclic, `parent` stays a tree, no
// `budgetAnchor` dangles at a removed node, and the frontier stays correct against an
// independently-authored reference resolver (never a call into the resolver `frontier` itself uses).
import { describe, expect, it } from 'vitest';
import {
  InMemoryStateStore,
  ROOT_NODE_ID,
  add_dependency,
  add_node,
  createNodeTypeRegistry,
  deriveContainerStatus,
  expand,
  frontier,
  move_node,
  remove_dependency,
  remove_node,
  reset,
  resume,
  set_order,
  toggle,
} from '../../src/index.js';
import type {
  ChildRemovalStrategy,
  DagEdge,
  DagNode,
  DependentRemovalStrategy,
  NodeStatus,
  NodeTypeDefinition,
  NodeTypeRegistry,
  PrimitiveContext,
} from '../../src/index.js';
import { detectCycle, isTreeShaped } from '../../src/derive/invariants.js';

/** A tiny deterministic PRNG (mulberry32) — no new dependency, fully reproducible per seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

function nonRootIds(nodes: readonly DagNode[]): string[] {
  return nodes.filter((node) => node.id !== ROOT_NODE_ID).map((node) => node.id);
}

const FAKE_NODE_TYPE: NodeTypeDefinition = {
  name: 'test:fake',
  dataSchema: {},
  traits: [],
  capabilities: [],
  presentation: { label: 'Fake' },
  instructions: '',
  act: () => ({ executor: 'noop' }),
  handle: () => ({}),
  projectStatus: () => 'not_started',
};

let idCounter = 0;
function freshId(): string {
  idCounter += 1;
  return `n${idCounter}`;
}

const CHILD_STRATEGIES: readonly ChildRemovalStrategy[] = ['cascade', 'promote'];
const DEPENDENT_STRATEGIES: readonly DependentRemovalStrategy[] = ['heal', 'cascade', 'detach'];
const OPS = ['add_node', 'remove_node', 'add_dependency', 'remove_dependency', 'move_node', 'set_order', 'expand', 'reset', 'toggle', 'resume'] as const;

// ── A known, out-of-scope engine gap this generator deliberately steers around ────
// A `depends_on` edge whose two endpoints are also related by containment (one is the other's
// ancestor) creates unbounded mutual recursion in `derive/readiness.ts`'s `resolve`/`hasBegun` —
// neither `detectCycle` (depends_on alone) nor `isTreeShaped` (parent alone) catches this
// *cross-type* cycle, since each checks only its own edge kind. This is a real, pre-existing gap in
// the shipped `add_dependency`/`move_node` primitives (they validate only within their own axis),
// not something this test-only generator should paper over by chance — so it steers away from ever
// constructing the combination, and the gap itself is flagged in this task's Execution Notes rather
// than fixed here (fixing `validate()`'s cross-axis guard is a separate, non-test change).
function isAncestorOrSelf(nodes: readonly DagNode[], ancestorId: string, nodeId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current: string | null = nodeId;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = byId.get(current)?.parent ?? null;
  }
  return false;
}

function containmentRelated(nodes: readonly DagNode[], a: string, b: string): boolean {
  return isAncestorOrSelf(nodes, a, b) || isAncestorOrSelf(nodes, b, a);
}

function subtreeIds(nodes: readonly DagNode[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parent === null) continue;
    const siblings = childrenByParent.get(node.parent) ?? [];
    siblings.push(node.id);
    childrenByParent.set(node.parent, siblings);
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of childrenByParent.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

/** Whether moving `target`'s whole subtree under `newParent` would newly relate (by containment) the two endpoints of some existing `depends_on` edge. */
function wouldCrossContainmentAndDependency(nodes: readonly DagNode[], edges: readonly DagEdge[], target: string, newParent: string): boolean {
  const movingSubtree = subtreeIds(nodes, target);
  const newAncestors = new Set(
    (function ancestorsOf(id: string): string[] {
      const chain: string[] = [];
      let current: string | null = id;
      const byId = new Map(nodes.map((node) => [node.id, node]));
      while (current !== null) {
        chain.push(current);
        current = byId.get(current)?.parent ?? null;
      }
      return chain;
    })(newParent),
  );
  return edges.some((edge) => {
    if (edge.kind !== 'depends_on') return false;
    const fromMoves = movingSubtree.has(edge.from);
    const toMoves = movingSubtree.has(edge.to);
    const fromIsNewAncestor = newAncestors.has(edge.from);
    const toIsNewAncestor = newAncestors.has(edge.to);
    return (fromMoves && toIsNewAncestor) || (toMoves && fromIsNewAncestor);
  });
}

/** Applies exactly one randomly-chosen mutation attempt through the public primitives alone. A rejected attempt (e.g. a would-be cycle) is itself a valid outcome — invariants must hold whether the op commits or not. */
function applyRandomOp(ctx: PrimitiveContext, registry: NodeTypeRegistry, rng: () => number): void {
  const nodes = ctx.store.listNodes(ctx.scope);
  const edges = ctx.store.listEdges(ctx.scope);
  const ids = nonRootIds(nodes);
  const op = pick(rng, OPS);

  switch (op) {
    case 'add_node': {
      const parent = pick(rng, [ROOT_NODE_ID, ...ids]) ?? ROOT_NODE_ID;
      const depCandidate = ids.length > 0 && rng() < 0.5 ? pick(rng, ids) : undefined;
      const depTarget = depCandidate && !containmentRelated(nodes, depCandidate, parent) ? depCandidate : undefined;
      add_node(ctx, registry, freshId(), 'test:fake', parent, { dependsOn: depTarget ? [depTarget] : [] });
      return;
    }
    case 'remove_node': {
      const target = pick(rng, ids);
      if (!target) return;
      const children = pick(rng, CHILD_STRATEGIES) ?? 'cascade';
      const dependents = pick(rng, DEPENDENT_STRATEGIES) ?? 'detach';
      remove_node(ctx, target, { children, dependents });
      return;
    }
    case 'add_dependency': {
      const from = pick(rng, ids);
      const to = pick(rng, ids);
      if (!from || !to || from === to || containmentRelated(nodes, from, to)) return;
      add_dependency(ctx, from, to);
      return;
    }
    case 'remove_dependency': {
      const edge = pick(rng, edges.filter((e) => e.kind === 'depends_on'));
      if (!edge) return;
      remove_dependency(ctx, edge.from, edge.to);
      return;
    }
    case 'move_node': {
      const target = pick(rng, ids);
      const newParent = pick(rng, [ROOT_NODE_ID, ...ids]);
      if (!target || !newParent) return;
      if (wouldCrossContainmentAndDependency(nodes, edges, target, newParent)) return;
      move_node(ctx, target, newParent);
      return;
    }
    case 'set_order': {
      const target = pick(rng, ids);
      if (!target) return;
      set_order(ctx, target, Math.floor(rng() * 10));
      return;
    }
    case 'expand': {
      const anchor = pick(rng, [ROOT_NODE_ID, ...ids]) ?? ROOT_NODE_ID;
      const parent = pick(rng, [ROOT_NODE_ID, ...ids]) ?? ROOT_NODE_ID;
      const depCandidate = ids.length > 0 && rng() < 0.5 ? pick(rng, ids) : undefined;
      const depTarget = depCandidate && !containmentRelated(nodes, depCandidate, parent) ? depCandidate : undefined;
      expand(ctx, registry, anchor, {
        specs: [{ key: freshId(), type: 'test:fake', parent, dependsOn: depTarget ? [depTarget] : [], data: {} }],
      });
      return;
    }
    case 'reset': {
      const target = pick(rng, ids);
      if (!target) return;
      reset(ctx, target, rng() < 0.5);
      return;
    }
    case 'toggle': {
      const target = pick(rng, ids);
      if (!target) return;
      toggle(ctx, target);
      return;
    }
    case 'resume': {
      // Only a disabled node (from `toggle`) is resumable here; no primitive in this mix ever mints
      // `blocked`/`failed`, but guard for them anyway. When the resumed node has a depends_on
      // predecessor, resume also organically stamps a `budgetAnchor` (its chain tip). Note: the
      // sibling `add_corrective` primitive is deliberately *not* in this mix — it commits a
      // corrective→review `depends_on` edge that can cross a containment relationship (the documented
      // out-of-scope engine gap this generator steers around); its behavior, including its
      // `resolveChainTip`/`budgetAnchor` read, is covered deterministically in `corrective.test.ts`.
      const target = pick(
        rng,
        nodes.filter((node) => node.id !== ROOT_NODE_ID && (node.disabled === true || node.status === 'blocked' || node.status === 'failed')),
      );
      if (!target) return;
      resume(ctx, target.id);
      return;
    }
    default:
      return;
  }
}

/**
 * Advances a random not-yet-run node straight to `done`/`in_progress` via a raw `store.apply` —
 * the same seeding idiom every other test file's own `seed()` helper already uses (the store's
 * `apply` is the sole public write path; this is not a second one). Interleaved with the named
 * mutation primitives so `reset`/dependency-driven frontier eligibility have something to actually
 * exercise, since none of those primitives can, by itself, mint a `done` node.
 */
function maybeAdvanceAStatus(ctx: PrimitiveContext, rng: () => number): void {
  if (rng() >= 0.3) return;
  const nodes = ctx.store.listNodes(ctx.scope);
  const candidate = pick(
    rng,
    nodes.filter((node) => node.id !== ROOT_NODE_ID && node.status === 'not_started' && !node.disabled),
  );
  if (!candidate) return;

  const after: DagNode = { ...candidate, status: rng() < 0.5 ? 'done' : 'in_progress' };
  ctx.store.apply(ctx.scope, {
    primitive: 'apply_event',
    params: { node: candidate.id, testHarnessStatusSeed: after.status },
    nodeChanges: [{ op: 'updated', before: candidate, after }],
    edgeChanges: [],
  });
}

/**
 * Stamps a `budgetAnchor` on a random node, pointing at one of its own `depends_on` predecessors — the
 * same node a real `resume` would anchor to (the corrective-budget chain tip). Seeded directly via the
 * raw `store.apply` idiom because `resume`'s own stamping path (a *disabled* node that *also* has a
 * predecessor, then resumed) is far too rare to emerge from random ops, leaving the field otherwise
 * unexercised. Interleaving this gives the no-dangling-anchor invariant real teeth: arbitrary later
 * `remove_node`/`move_node`/`reset` sequences must never leave a `budgetAnchor` pointing at a gone node.
 */
function maybeStampAnchor(ctx: PrimitiveContext, rng: () => number): void {
  if (rng() >= 0.25) return;
  const nodes = ctx.store.listNodes(ctx.scope);
  const edges = ctx.store.listEdges(ctx.scope);
  const subject = pick(rng, nodes.filter((node) => node.id !== ROOT_NODE_ID && node.budgetAnchor == null));
  if (!subject) return;
  const predecessors = edges.filter((edge) => edge.kind === 'depends_on' && edge.to === subject.id).map((edge) => edge.from);
  const anchor = pick(rng, predecessors);
  if (!anchor) return;

  const after: DagNode = { ...subject, budgetAnchor: anchor };
  ctx.store.apply(ctx.scope, {
    primitive: 'apply_event',
    params: { node: subject.id, testHarnessAnchorSeed: anchor },
    nodeChanges: [{ op: 'updated', before: subject, after }],
    edgeChanges: [],
  });
}

// ── The independent reference resolver `frontier`'s own output is cross-checked against ──────────
// Mirrors `derive/readiness.ts`'s own entered/roll-up rule (hand-transcribed, not imported), reusing
// only the trivial roll-up primitive (`deriveContainerStatus`, independently unit-tested elsewhere)
// so this is a genuine cross-check of `frontier`'s eligibility + entry-tracking logic, not a
// call into the same resolver under test.
function buildReferenceResolver(nodes: readonly DagNode[], edges: readonly DagEdge[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, DagNode[]>();
  for (const node of nodes) {
    if (node.parent === null) continue;
    const siblings = childrenByParent.get(node.parent);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parent, [node]);
  }

  const statusMemo = new Map<string, NodeStatus>();
  const beganMemo = new Map<string, boolean>();

  function predecessorsDone(id: string): boolean {
    return edges.filter((edge) => edge.kind === 'depends_on' && edge.to === id).every((edge) => resolve(edge.from) === 'done');
  }

  function hasBegun(node: DagNode): boolean {
    const cached = beganMemo.get(node.id);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (node.parent === null) {
      result = true;
    } else {
      const parent = byId.get(node.parent);
      result = parent !== undefined && hasBegun(parent) && predecessorsDone(node.id);
    }
    beganMemo.set(node.id, result);
    return result;
  }

  function resolve(id: string): NodeStatus {
    const cached = statusMemo.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) return 'not_started';
    const children = childrenByParent.get(id) ?? [];
    let result: NodeStatus;
    if (node.parent === null || children.length === 0) result = node.status;
    else if (!hasBegun(node)) result = 'not_started';
    else result = deriveContainerStatus(node, children.map((child) => ({ ...child, status: resolve(child.id) })));
    statusMemo.set(id, result);
    return result;
  }

  return { resolve, predecessorsDone, childrenByParent, byId };
}

function expectedFrontierIds(nodes: readonly DagNode[], edges: readonly DagEdge[], scope: string): Set<string> {
  const { resolve, predecessorsDone, childrenByParent, byId } = buildReferenceResolver(nodes, edges);
  if (!byId.has(scope) || resolve(scope) !== 'in_progress') return new Set();

  const ids = nodes
    .filter((node) => node.parent === scope)
    .filter((node) => node.status === 'not_started' && !node.disabled)
    .filter((node) => (childrenByParent.get(node.id)?.length ?? 0) === 0)
    .filter((node) => predecessorsDone(node.id))
    .map((node) => node.id);
  return new Set(ids);
}

describe('property: arbitrary mutation sequences preserve acyclicity, tree-shape, and a correct frontier', () => {
  // Seeds 4 and 7 are deliberately retained beyond the original 1-3: with the `budgetAnchor` seeding
  // now in the mix, they construct a "remove a still-anchored node" sequence, so the no-dangling-anchor
  // invariant genuinely catches a regression of `remove_node`'s anchor scrub (not just asserts vacuously).
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: depends_on stays acyclic, parent stays a tree, and frontier matches the reference resolver after every step', (seed) => {
    const ctx: PrimitiveContext = { store: new InMemoryStateStore(), scope: { projectId: `proj-${seed}` } };
    const registry = createNodeTypeRegistry([FAKE_NODE_TYPE]);
    const rng = mulberry32(seed * 7919 + 1);

    for (let step = 0; step < 150; step += 1) {
      applyRandomOp(ctx, registry, rng);
      maybeAdvanceAStatus(ctx, rng);
      maybeStampAnchor(ctx, rng);

      const nodes = ctx.store.listNodes(ctx.scope);
      const edges = ctx.store.listEdges(ctx.scope);

      expect(detectCycle(edges)).toBeNull();
      expect(isTreeShaped(nodes)).toBe(true);

      // No dangling budget anchor: `resume` stamps `budgetAnchor` at a chain tip, which a later
      // `remove_node` can delete — a surviving node must never point at a node that no longer exists.
      const idSet = new Set(nodes.map((node) => node.id));
      for (const node of nodes) {
        if (node.budgetAnchor != null) expect(idSet.has(node.budgetAnchor)).toBe(true);
      }

      const containers = new Set<string>([ROOT_NODE_ID, ...nodes.filter((node) => node.parent !== null).map((node) => node.parent as string)]);
      for (const containerId of containers) {
        const actual = new Set(frontier(nodes, edges, containerId).map((node) => node.id));
        expect(actual).toEqual(expectedFrontierIds(nodes, edges, containerId));
      }
    }
  });
});
