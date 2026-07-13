// The seed replay vocabulary shared by the `/engine-graph/seed` route (`http/engine-graph.ts`) and
// the template compiler (`templates/compile.ts`) — one `SeedStep` definition, not two independently
// maintained copies of the same three primitives.
import type { Expansion, NodeId, NodeTypeName } from '@rad-orchestration/graph-engine';

export interface SeedAddNodeStep {
  readonly primitive: 'add_node';
  readonly id: NodeId;
  readonly type: NodeTypeName;
  readonly parent: NodeId;
  readonly order?: number;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly dependsOn?: readonly NodeId[];
}

export interface SeedAddDependencyStep {
  readonly primitive: 'add_dependency';
  readonly from: NodeId;
  readonly to: NodeId;
}

export interface SeedExpandStep {
  readonly primitive: 'expand';
  readonly node: NodeId;
  readonly expansion: Expansion;
}

export type SeedStep = SeedAddNodeStep | SeedAddDependencyStep | SeedExpandStep;
