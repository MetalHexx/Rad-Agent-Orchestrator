import type {
  NodeDef,
  NodeState,
  ParallelNodeDef,
  PipelineTemplate,
  ForEachPhaseNodeDef,
  ForEachTaskNodeDef,
} from './types.js';
import { NODE_STATUSES } from './constants.js';

export function scaffoldNodeState(nodeDef: NodeDef): NodeState {
  switch (nodeDef.kind) {
    case 'step':
      return { kind: 'step', status: NODE_STATUSES.NOT_STARTED, doc_path: null, retries: 0 };
    case 'gate':
      return { kind: 'gate', status: NODE_STATUSES.NOT_STARTED, gate_active: false };
    case 'conditional':
      return { kind: 'conditional', status: NODE_STATUSES.NOT_STARTED, branch_taken: null };
    case 'parallel': {
      const pDef = nodeDef as ParallelNodeDef;
      const nodes: Record<string, NodeState> = {};
      for (const child of pDef.children) {
        nodes[child.id] = scaffoldNodeState(child);
      }
      return { kind: 'parallel', status: NODE_STATUSES.NOT_STARTED, nodes };
    }
    case 'for_each_phase':
      return { kind: 'for_each_phase', status: NODE_STATUSES.NOT_STARTED, iterations: [] };
    case 'for_each_task':
      return { kind: 'for_each_task', status: NODE_STATUSES.NOT_STARTED, iterations: [] };
    default: {
      const _exhaustive: never = nodeDef;
      throw new Error(`Unexpected node kind: ${(_exhaustive as NodeDef).kind}`);
    }
  }
}

// Finds the task-loop body node defs (the nodes nested under the first
// for_each_task inside the first for_each_phase). Used both to birth a
// corrective's scaffolded nodes (mutations.ts) and to walk a corrective's
// body (dag-walker.ts). Lives here — already imported by both — so the
// walker never needs to import from mutations.ts.
export function findTaskLoopBodyDefs(template: PipelineTemplate): NodeDef[] {
  for (const nodeDef of template.nodes) {
    if (nodeDef.kind === 'for_each_phase') {
      for (const bodyNode of (nodeDef as ForEachPhaseNodeDef).body) {
        if (bodyNode.kind === 'for_each_task') {
          return (bodyNode as ForEachTaskNodeDef).body;
        }
      }
    }
  }
  return [];
}
