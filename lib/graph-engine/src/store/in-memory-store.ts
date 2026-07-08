import type { NodeId, DagNode } from '../model/node.js';
import type { DagEdge } from '../model/edge.js';
import type { ChangeDelta, NodeChange, EdgeChange } from '../model/delta.js';
import type { Result } from '../result.js';
import { assertNever } from '../model/vocab.js';
import { createRootNode } from '../model/root.js';
import type { ProjectScope, StateStore } from './state-store.js';

interface ScopeState {
  nodes: Map<NodeId, DagNode>;
  edges: Map<string, DagEdge>;
}

type NodeMutation =
  | { readonly kind: 'set'; readonly node: DagNode }
  | { readonly kind: 'delete'; readonly id: NodeId };

type EdgeMutation =
  | { readonly kind: 'set'; readonly key: string; readonly edge: DagEdge }
  | { readonly kind: 'delete'; readonly key: string };

function edgeKey(edge: Pick<DagEdge, 'from' | 'to' | 'kind'>): string {
  return `${edge.kind}:${edge.from}->${edge.to}`;
}

function invalidDelta(message: string): Result<never> {
  return { ok: false, error: { code: 'invalid_delta', message } };
}

function planNodeChange(state: ScopeState, change: NodeChange): Result<NodeMutation> {
  switch (change.op) {
    case 'created': {
      if (!change.after) return invalidDelta(`a 'created' node change requires 'after'`);
      if (state.nodes.has(change.after.id)) {
        return invalidDelta(`node '${change.after.id}' already exists`);
      }
      return { ok: true, data: { kind: 'set', node: change.after } };
    }
    case 'updated': {
      if (!change.before || !change.after) {
        return invalidDelta(`an 'updated' node change requires 'before' and 'after'`);
      }
      if (!state.nodes.has(change.before.id)) {
        return invalidDelta(`node '${change.before.id}' does not exist`);
      }
      return { ok: true, data: { kind: 'set', node: change.after } };
    }
    case 'removed': {
      if (!change.before) return invalidDelta(`a 'removed' node change requires 'before'`);
      if (!state.nodes.has(change.before.id)) {
        return invalidDelta(`node '${change.before.id}' does not exist`);
      }
      return { ok: true, data: { kind: 'delete', id: change.before.id } };
    }
    default:
      return assertNever(change.op);
  }
}

function planEdgeChange(state: ScopeState, change: EdgeChange): Result<EdgeMutation> {
  switch (change.op) {
    case 'created': {
      if (!change.after) return invalidDelta(`a 'created' edge change requires 'after'`);
      const key = edgeKey(change.after);
      if (state.edges.has(key)) return invalidDelta(`edge '${key}' already exists`);
      return { ok: true, data: { kind: 'set', key, edge: change.after } };
    }
    case 'updated': {
      if (!change.before || !change.after) {
        return invalidDelta(`an 'updated' edge change requires 'before' and 'after'`);
      }
      const beforeKey = edgeKey(change.before);
      if (!state.edges.has(beforeKey)) return invalidDelta(`edge '${beforeKey}' does not exist`);
      return { ok: true, data: { kind: 'set', key: edgeKey(change.after), edge: change.after } };
    }
    case 'removed': {
      if (!change.before) return invalidDelta(`a 'removed' edge change requires 'before'`);
      const key = edgeKey(change.before);
      if (!state.edges.has(key)) return invalidDelta(`edge '${key}' does not exist`);
      return { ok: true, data: { kind: 'delete', key } };
    }
    default:
      return assertNever(change.op);
  }
}

/**
 * The in-memory `StateStore` every engine test runs against. Each scope is backed by its own pair
 * of `Map`s — proving the interface carries no single-global-graph assumption — and is seeded with
 * the project-scoped root anchor the first time it is touched, by any method, so working-context
 * is never null.
 *
 * `apply` validates every change in the delta against the current state before mutating anything,
 * so a malformed delta (e.g. removing a node that doesn't exist) leaves the store untouched —
 * transactional, all-or-nothing.
 */
export class InMemoryStateStore implements StateStore {
  private readonly scopes = new Map<string, ScopeState>();

  private scopeState(scope: ProjectScope): ScopeState {
    let state = this.scopes.get(scope.projectId);
    if (!state) {
      const root = createRootNode();
      state = { nodes: new Map([[root.id, root]]), edges: new Map() };
      this.scopes.set(scope.projectId, state);
    }
    return state;
  }

  getNode(scope: ProjectScope, id: NodeId): DagNode | null {
    return this.scopeState(scope).nodes.get(id) ?? null;
  }

  listNodes(scope: ProjectScope): DagNode[] {
    return [...this.scopeState(scope).nodes.values()];
  }

  listEdges(scope: ProjectScope): DagEdge[] {
    return [...this.scopeState(scope).edges.values()];
  }

  apply(scope: ProjectScope, delta: ChangeDelta): Result<void> {
    const state = this.scopeState(scope);

    const nodeMutations: NodeMutation[] = [];
    for (const change of delta.nodeChanges) {
      const planned = planNodeChange(state, change);
      if (!planned.ok) return planned;
      nodeMutations.push(planned.data);
    }

    const edgeMutations: EdgeMutation[] = [];
    for (const change of delta.edgeChanges) {
      const planned = planEdgeChange(state, change);
      if (!planned.ok) return planned;
      edgeMutations.push(planned.data);
    }

    for (const mutation of nodeMutations) {
      if (mutation.kind === 'set') state.nodes.set(mutation.node.id, mutation.node);
      else state.nodes.delete(mutation.id);
    }
    for (const mutation of edgeMutations) {
      if (mutation.kind === 'set') state.edges.set(mutation.key, mutation.edge);
      else state.edges.delete(mutation.key);
    }

    return { ok: true, data: undefined };
  }
}
