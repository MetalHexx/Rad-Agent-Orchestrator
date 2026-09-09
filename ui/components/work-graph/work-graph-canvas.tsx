'use client';

import { useMemo } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildWorkGraphView } from '@/lib/work-graph-view';
import { computeWorkGraphLayout } from '@/lib/work-graph-layout';
import { WorkGraphProjectNode } from './work-graph-project-node';
import { WorkGraphContainerNode } from './work-graph-container-node';
import type { WorkGraphResponse, StartFrom, EdgeTypeKey } from '@/types/work-graph';

// Module scope, not component body — a fresh object identity every render would
// force React Flow to re-register the node types and re-mount every node.
const nodeTypes: NodeTypes = {
  workGraphProject: WorkGraphProjectNode,
  workGraphContainer: WorkGraphContainerNode,
};

const defaultEdgeOptions = {
  style: { stroke: 'var(--canvas-edge-stroke)', strokeWidth: 1.5 },
};

interface WorkGraphCanvasProps {
  graph: WorkGraphResponse;
  scope: string;         // 'all' or a group id — the transform needs it to keep an explicitly-selected empty group
  filter: string;        // already debounced by the page
  startFrom: StartFrom;
  enabledEdgeTypes: EdgeTypeKey[];
}

/**
 * Pure read-only React Flow rendering of a work graph: a function of
 * `(graph, scope, filter, startFrom, enabledEdgeTypes)`. Fetches nothing — the
 * caller owns that via `useWorkGraph`.
 */
export function WorkGraphCanvas({ graph, scope, filter, startFrom, enabledEdgeTypes }: WorkGraphCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const view = buildWorkGraphView(graph, { filter, scope, enabledEdgeTypes });
    return computeWorkGraphLayout(view.nodes, view.edges, startFrom);
  }, [graph, scope, filter, startFrom, enabledEdgeTypes]);

  if (nodes.length === 0) {
    return (
      <div
        className="flex-1 w-full overflow-hidden flex items-center justify-center"
        role="region"
        aria-label="Work graph — read only"
      >
        <span className="text-sm text-[var(--muted-foreground)]">No projects match the current filter.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full overflow-hidden" role="region" aria-label="Work graph — read only">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        fitView
        elementsSelectable={false} nodesConnectable={false} nodesDraggable={false}
        nodesFocusable={false} edgesFocusable={false}
        deleteKeyCode={null}
        panOnDrag zoomOnScroll zoomOnPinch
        defaultEdgeOptions={defaultEdgeOptions}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
